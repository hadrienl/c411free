#!/usr/bin/env node
// POC n°1 — pilotage du téléchargeur Freebox OS.
// Usage :
//   node poc/freebox.mjs auth                 → demande l'autorisation (valider sur l'écran de la Freebox)
//   node poc/freebox.mjs list                 → liste les téléchargements
//   node poc/freebox.mjs files <id>           → fichiers d'une tâche (avec preview_url)
//   node poc/freebox.mjs add <fichier.torrent|url> [dossier]
//   node poc/freebox.mjs stats                → statistiques globales
import { createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FBX = process.env.FBX_URL || 'http://mafreebox.freebox.fr';
const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'secrets', 'freebox.json');
const APP = { app_id: 'fr.c411free.tv', app_name: 'C411free TV', app_version: '0.1.0', device_name: 'C411free' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiBase() {
  const v = await (await fetch(`${FBX}/api_version`)).json();
  return `${FBX}${v.api_base_url}v${parseInt(v.api_version, 10)}`;
}

async function call(base, path, { method = 'GET', body, session, raw } = {}) {
  const headers = {};
  if (session) headers['X-Fbx-App-Auth'] = session;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: raw ? body : body && JSON.stringify(body) });
  const json = await res.json();
  if (!json.success) throw new Error(`${method} ${path} → ${json.error_code}: ${json.msg}`);
  return json.result;
}

async function auth(base) {
  const { app_token, track_id } = await call(base, '/login/authorize/', { method: 'POST', body: APP });
  console.log(`👉 Validez « ${APP.app_name} » sur l'écran du Freebox Server (flèche › puis Oui)… (track_id=${track_id})`);
  const start = Date.now();
  for (;;) {
    const { status } = await call(base, `/login/authorize/${track_id}`);
    if (status === 'granted') break;
    if (status !== 'pending') {
      throw new Error(`Autorisation « ${status} » après ${Math.round((Date.now() - start) / 1000)} s. `
        + 'Vérifiez Freebox OS → Paramètres → Gestion des accès → onglet Paramètres → « Permettre les nouvelles demandes d\'association ».');
    }
    process.stdout.write(`\r⏳ en attente depuis ${Math.round((Date.now() - start) / 1000)} s`);
    await sleep(2000);
  }
  process.stdout.write('\n');
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify({ app_id: APP.app_id, app_token }, null, 2), { mode: 0o600 });
  console.log(`✅ app_token enregistré dans ${TOKEN_FILE}`);
}

async function openSession(base) {
  const { app_id, app_token } = JSON.parse(await readFile(TOKEN_FILE, 'utf8'));
  const { challenge } = await call(base, '/login/');
  const password = createHmac('sha1', app_token).update(challenge).digest('hex');
  const { session_token, permissions } = await call(base, '/login/session/', { method: 'POST', body: { app_id, password } });
  if (!permissions.downloader) console.warn('⚠️  Permission « downloader » absente : l\'activer dans Freebox OS → Paramètres → Gestion des accès → Applications.');
  return session_token;
}

const b64 = (s) => Buffer.from(s).toString('base64');
const unb64 = (s) => (s ? Buffer.from(s, 'base64').toString() : '');
const fmtSize = (n) => `${(n / 1e9).toFixed(2)} Go`;

async function main() {
  const [cmd = 'list', ...args] = process.argv.slice(2);
  const base = await apiBase();
  if (cmd === 'auth') return auth(base);

  const session = await openSession(base);
  if (cmd === 'list') {
    const tasks = (await call(base, '/downloads/', { session })) || [];
    for (const t of tasks) {
      console.log(`#${t.id} [${t.status}] ${(t.rx_pct / 100).toFixed(1)}% ${fmtSize(t.size)} eta=${t.eta}s ${t.name}  → ${unb64(t.download_dir)}`);
    }
    if (!tasks.length) console.log('(aucun téléchargement)');
  } else if (cmd === 'files') {
    for (const f of await call(base, `/downloads/${args[0]}/files`, { session })) {
      console.log(`${f.status} ${(f.rx / Math.max(f.size, 1) * 100).toFixed(1)}% ${f.mimetype} ${fmtSize(f.size)} ${f.name}\n   preview_url: ${f.preview_url || '—'}`);
    }
  } else if (cmd === 'add') {
    const [src, dir] = args;
    let result;
    if (/^(https?|magnet):/.test(src)) {
      const form = new URLSearchParams({ download_url: src });
      if (dir) form.set('download_dir', b64(dir));
      result = await call(base, '/downloads/add', { method: 'POST', session, raw: true, body: form });
    } else {
      const form = new FormData();
      form.set('download_file', new Blob([await readFile(src)], { type: 'application/x-bittorrent' }), basename(src));
      if (dir) form.set('download_dir', b64(dir));
      result = await call(base, '/downloads/add', { method: 'POST', session, raw: true, body: form });
    }
    console.log(`✅ Tâche ajoutée : #${result.id}`);
  } else if (cmd === 'stats') {
    console.log(await call(base, '/downloads/stats', { session }));
  } else if (cmd === 'get') {
    console.log(JSON.stringify(await call(base, args[0], { session }), null, 2));
  } else if (cmd === 'playlist') {
    // Les preview_url (btpreview) tombent en 400 après un redémarrage de la box :
    // on crée des liens de partage temporaires, réécrits en adresse LAN pour la TV.
    const SHARES_FILE = join(dirname(TOKEN_FILE), 'share-links.json');
    const OUT = join(dirname(fileURLToPath(import.meta.url)), 'tizen-player', 'videos.js');
    const expire = Math.floor(Date.now() / 1000) + Number(process.env.SHARE_DAYS || 7) * 86400;
    const previous = JSON.parse(await readFile(SHARES_FILE, 'utf8').catch(() => '[]'));
    for (const token of previous) await call(base, `/share_link/${token}`, { method: 'DELETE', session }).catch(() => {});
    const tokens = [];
    const videos = [];
    for (const id of args) {
      const files = await call(base, `/downloads/${id}/files`, { session });
      for (const f of files.filter((x) => x.mimetype?.startsWith('video/'))) {
        const path = unb64(f.filepath);
        const { token, fullurl } = await call(base, '/share_link/', { method: 'POST', session, body: { path: b64(path), expire, fullurl: '' } });
        tokens.push(token);
        videos.push({ label: `${f.name} — ${fmtSize(f.size)}`, url: fullurl.replace(/^https?:\/\/[^/]+/, FBX) });
        console.log(`🔗 #${id} ${path}`);
      }
    }
    await writeFile(SHARES_FILE, JSON.stringify(tokens), { mode: 0o600 });
    await writeFile(OUT, `window.VIDEOS = ${JSON.stringify(videos, null, 2)};\n`);
    console.log(`✅ ${videos.length} vidéo(s) → ${OUT} (liens valables ${process.env.SHARE_DAYS || 7} j, ${previous.length} ancien(s) supprimé(s))`);
  } else {
    throw new Error(`Commande inconnue : ${cmd}`);
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
