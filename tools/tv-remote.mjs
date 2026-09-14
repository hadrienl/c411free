#!/usr/bin/env node
// Télécommande réseau Samsung : envoie des touches à la TV depuis le Mac.
// Usage : node tools/tv-remote.mjs KEY_1 KEY_2 KEY_3 KEY_4 KEY_5
// Au premier lancement, la TV demande d'autoriser « C411free » : acceptez avec la télécommande.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // certificat auto-signé de la TV, réseau local uniquement
// IP de la TV : variable TV_IP ou secrets/local.env (non versionné, modèle : tools/local.env.example)
const localEnv = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'secrets', 'local.env'), 'utf8').catch(() => '');
const TV_IP = process.env.TV_IP || localEnv.match(/^TV_IP=(.+)$/m)?.[1]?.trim();
if (!TV_IP) { console.log('Définissez TV_IP dans secrets/local.env (voir tools/local.env.example)'); process.exit(1); }
const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'secrets', 'tv-token.json');
const keys = process.argv.slice(2);
if (!keys.length) { console.log('Usage : node tools/tv-remote.mjs KEY_1 KEY_2 …'); process.exit(1); }

const token = await readFile(TOKEN_FILE, 'utf8').then((s) => JSON.parse(s).token).catch(() => '');
const name = Buffer.from('C411free').toString('base64');
const ws = new WebSocket(`wss://${TV_IP}:8002/api/v2/channels/samsung.remote.control?name=${name}${token ? `&token=${token}` : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(token ? '🔌 Connexion à la TV…' : '👉 Acceptez « C411free » sur l\'écran de la TV…');
const timeout = setTimeout(() => { console.error('❌ Pas de réponse de la TV (90 s)'); process.exit(1); }, 90000);

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.event === 'ms.channel.unauthorized') { console.error('❌ Refusé sur la TV'); process.exit(1); }
  if (msg.event !== 'ms.channel.connect') return;
  clearTimeout(timeout);
  if (msg.data?.token && msg.data.token !== token) {
    await mkdir(dirname(TOKEN_FILE), { recursive: true });
    await writeFile(TOKEN_FILE, JSON.stringify({ token: msg.data.token }), { mode: 0o600 });
  }
  for (const key of keys) {
    ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
    console.log(`   ⌨️  ${key}`);
    await sleep(400);
  }
  ws.close();
  console.log('✅ Touches envoyées');
};
ws.onerror = (e) => { console.error(`❌ ${e.message || 'connexion impossible'}`); process.exit(1); };
