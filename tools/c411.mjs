#!/usr/bin/env node
// Outil c411 : recherche (Torznab) et récupération d'un .torrent, pour diagnostiquer l'API depuis le Mac.
// Usage :
//   node tools/c411.mjs caps                         → capacités/catégories de l'API
//   node tools/c411.mjs search "vaiana 2" [cat]      → résultats triés, compatibilité TV signalée
//   node tools/c411.mjs grab <n°> "vaiana 2" [cat]   → télécharge le .torrent du résultat n° dans ./downloads
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.C411_API_URL || 'https://c411.org/api/torznab';
const ADULT = /^6\d{3}$/; // catégorie adulte, exclue en dur

async function apiKey() {
  const env = await readFile(join(ROOT, 'secrets', 'c411.env'), 'utf8');
  const key = env.match(/^C411_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!key || key === 'VOTRE_CLE') throw new Error('Clé absente : renseignez C411_API_KEY dans secrets/c411.env');
  return key;
}

const mask = (s, key) => s.split(key).join('***');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`))?.[1] ?? '');

async function torznab(params) {
  const key = await apiKey();
  const url = `${API}?${new URLSearchParams({ ...params, apikey: key })}`;
  const res = await fetch(url);
  const xml = await res.text();
  if (!res.ok || /<error\b/.test(xml)) throw new Error(`HTTP ${res.status} : ${mask(xml.slice(0, 300), key)}`);
  return { xml, key };
}

function parseItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const attrs = Object.fromEntries([...it.matchAll(/<torznab:attr name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const title = tag(it, 'title');
    return {
      title,
      size: Number(attrs.size || tag(it, 'size') || 0),
      seeders: Number(attrs.seeders || 0),
      category: attrs.category || tag(it, 'category'),
      tmdb: attrs.tmdbid || attrs.tmdb,
      link: decode(it.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] || tag(it, 'link')),
      // Le QN800C (Tizen 7, 2023) ne décode ni DTS ni TrueHD
      tvOk: !/\b(DTS|TrueHD|Atmos[ ._-]?TrueHD)\b/i.test(title) || /\b(AC3|EAC3|DDP|DD\+|AAC)\b/i.test(title),
    };
  }).filter((r) => !ADULT.test(r.category));
}

async function search(q, cat) {
  const { xml } = await torznab({ t: 'search', q, limit: 100, ...(cat && { cat }) });
  return parseItems(xml).sort((a, b) => b.tvOk - a.tvOk || b.seeders - a.seeders);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'caps') {
    const { xml, key } = await torznab({ t: 'caps' });
    console.log(mask(xml, key));
  } else if (cmd === 'search') {
    const results = await search(args[0], args[1]);
    results.slice(0, 30).forEach((r, i) => console.log(
      `${String(i).padStart(2)}. ${r.tvOk ? '📺' : '🚫'} ${String(r.seeders).padStart(4)}↑ ${(r.size / 1e9).toFixed(1).padStart(5)} Go [${r.category}] ${r.title}`));
    console.log(`${results.length} résultat(s) — 📺 audio compatible TV, 🚫 DTS/TrueHD seul`);
  } else if (cmd === 'grab') {
    const [n, q, cat] = args;
    const r = (await search(q, cat))[Number(n)];
    if (!r) throw new Error(`Résultat n°${n} introuvable`);
    const key = await apiKey();
    const res = await fetch(r.link);
    if (!res.ok) throw new Error(`Téléchargement .torrent : HTTP ${res.status}`);
    const out = join(ROOT, 'downloads', `${r.title.replace(/[^\w.-]+/g, '_')}.torrent`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    console.log(`✅ ${mask(out, key)}\n   → node tools/freebox.mjs add "${out}"`);
  } else {
    console.log('Usage : caps | search "<requête>" [cat] | grab <n°> "<requête>" [cat]');
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
