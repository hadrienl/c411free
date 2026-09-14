#!/usr/bin/env node
// Récepteur du journal de débogage de la TV (app déployée avec DEBUG_LOG=1).
// Usage : npm run logs   → affiche les messages et les ajoute à logs/tv-log.jsonl
import { appendFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.LOG_PORT || 8765);
const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'tv-log.jsonl');
mkdirSync(LOG_DIR, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.method === 'POST' && body) {
      appendFileSync(LOG_FILE, body.replace(/\n/g, ' ') + '\n');
      try {
        const { at, level, screen, message, extra } = JSON.parse(body);
        console.log(`${at.slice(11, 19)} ${level === 'error' ? '❌' : '·'} [${screen}] ${message}${extra ? ' ' + JSON.stringify(extra) : ''}`);
      } catch { console.log(body); }
    }
    res.end('ok');
  });
}).listen(PORT, '0.0.0.0', () => console.log(`📡 Journal de la TV sur le port ${PORT} → ${LOG_FILE}`));
