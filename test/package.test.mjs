import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('même version dans config.xml, package.json et l\'app', () => {
  const widget = read('app/config.xml').match(/<widget[^>]*\sversion="([^"]+)"/)[1];
  const app = read('app/js/core.js').match(/var VERSION = '([^']+)'/)[1];
  assert.equal(app, widget);
  assert.equal(JSON.parse(read('package.json')).version, widget);
});

test('index.html charge tous les scripts de app/js, config.js en premier', () => {
  const scripts = [...read('app/index.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.startsWith('$WEBAPIS'));
  assert.equal(scripts[0], 'config.js');
  assert.equal(scripts.at(-1), 'js/main.js');
  const files = readdirSync(new URL('../app/js', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);
  assert.deepEqual([...scripts.slice(1)].sort(), files.sort());
});

test('aucun secret ni journal de débogage codé en dur dans l\'app', () => {
  for (const f of readdirSync(new URL('../app/js', import.meta.url))) {
    const src = read(`app/js/${f}`);
    assert.doesNotMatch(src, /192\.168\.1\.70|apikey=[a-z0-9]{8,}/i, f);
  }
});
