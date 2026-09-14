#!/usr/bin/env node
// Génère <app>/secrets.js (clé c411 + jeton Freebox) pour une app Tizen, au moment du déploiement.
// Usage : node poc/make-secrets.mjs poc/tizen-probe
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(process.argv[2] || join(ROOT, 'poc', 'tizen-probe'));

const env = await readFile(join(ROOT, 'secrets', 'c411.env'), 'utf8');
const c411ApiKey = env.match(/^C411_API_KEY=(.+)$/m)?.[1]?.trim();
const { app_id: freeboxAppId, app_token: freeboxAppToken } = JSON.parse(await readFile(join(ROOT, 'secrets', 'freebox.json'), 'utf8'));
if (!c411ApiKey || !freeboxAppToken) throw new Error('secrets/c411.env ou secrets/freebox.json incomplet');

await writeFile(join(appDir, 'secrets.js'), `window.SECRETS = ${JSON.stringify({ c411ApiKey, freeboxAppId, freeboxAppToken })};\n`, { mode: 0o600 });
console.log(`🔑 ${join(appDir, 'secrets.js')} généré`);
