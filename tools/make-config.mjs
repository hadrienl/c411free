#!/usr/bin/env node
// Génère config.js pour l'app TV : clé c411 et jeton Freebox (lus dans secrets/) + options de déploiement.
// Usage : node tools/make-config.mjs <fichier_sortie>      (appelé par tools/deploy-tv.sh)
//   DEBUG_LOG_URL=http://<ip>:8765/log → active le journal de débogage
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(ROOT, 'app', 'config.js'));

const env = await readFile(join(ROOT, 'secrets', 'c411.env'), 'utf8');
const c411ApiKey = env.match(/^C411_API_KEY=(.+)$/m)?.[1]?.trim();
const { app_id: freeboxAppId, app_token: freeboxAppToken } = JSON.parse(await readFile(join(ROOT, 'secrets', 'freebox.json'), 'utf8'));
if (!c411ApiKey || !freeboxAppToken) throw new Error('secrets/c411.env ou secrets/freebox.json incomplet');

const config = { c411ApiKey, freeboxAppId, freeboxAppToken, debugLogUrl: process.env.DEBUG_LOG_URL || '' };
await writeFile(out, `window.CONFIG = ${JSON.stringify(config)};\n`, { mode: 0o600 });
console.log(`🔑 Configuration générée${config.debugLogUrl ? ' (journal de débogage activé)' : ''}`);
