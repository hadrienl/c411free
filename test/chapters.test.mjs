import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['chapters.js']);

// --- Fabrication de fichiers MKV minimaux ---
const size = (n) => Buffer.from([0x01, ...Buffer.from(n.toString(16).padStart(14, '0'), 'hex')]); // taille sur 8 octets
const el = (idHex, ...payload) => { const body = Buffer.concat(payload); return Buffer.concat([Buffer.from(idHex, 'hex'), size(body.length), body]); };
const uint = (n, bytes = 8) => Buffer.from(BigInt(n).toString(16).padStart(bytes * 2, '0'), 'hex');
const atom = (seconds, name, hidden = false) => el('B6',
  el('91', uint(seconds * 1e9)),
  ...(hidden ? [el('98', uint(1, 1))] : []),
  el('80', el('85', Buffer.from(name, 'utf8')), el('437C', Buffer.from('fre')))
);
const CHAPTERS = el('1043A770', el('45B9', atom(0, 'OP'), atom(91, 'Part A'), atom(60, 'Caché', true), atom(1348, 'ED')));
const EBML_HEADER = el('1A45DFA3', el('4282', Buffer.from('matroska')));
const INFO = el('1549A966', el('2AD7B1', uint(1000000, 3)));

const rangeOf = (file, calls = []) => async (url, start, length) => {
  calls.push([start, length]);
  return new Uint8Array(file.subarray(start, start + length));
};

test('chapitres au début du fichier', async () => {
  const file = Buffer.concat([EBML_HEADER, el('18538067', INFO, CHAPTERS)]);
  const calls = [];
  const chapters = await app.readMkvChapters('mkv', rangeOf(file, calls));
  assert.deepEqual(plain(chapters), [{ at: 0, name: 'OP' }, { at: 91000, name: 'Part A' }, { at: 1348000, name: 'ED' }], 'triés, chapitre masqué exclu');
  assert.equal(calls.length, 1);
});

test('chapitres plus loin, trouvés grâce au SeekHead', async () => {
  const padding = el('EC', Buffer.alloc(400 * 1024)); // élément Void : chapitres au-delà du premier bloc lu
  const seekHead = (position) => el('114D9B74', el('4DBB', el('53AB', Buffer.from('1043A770', 'hex')), el('53AC', uint(position))));
  const position = seekHead(0).length + INFO.length + padding.length;
  const file = Buffer.concat([EBML_HEADER, el('18538067', seekHead(position), INFO, padding, CHAPTERS)]);
  const calls = [];
  const chapters = await app.readMkvChapters('mkv', rangeOf(file, calls));
  assert.deepEqual(plain(chapters.map((c) => c.name)), ['OP', 'Part A', 'ED']);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][0] > 256 * 1024, 'deuxième lecture ciblée sur le bloc des chapitres');
});

test('fichier sans chapitres ou illisible', async () => {
  assert.deepEqual(plain(await app.readMkvChapters('mkv', rangeOf(Buffer.concat([EBML_HEADER, el('18538067', INFO)])))), []);
  assert.deepEqual(plain(await app.readMkvChapters('mkv', rangeOf(Buffer.from('pas un mkv')))), []);
});
