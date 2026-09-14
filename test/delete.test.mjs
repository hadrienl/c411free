import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64, loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'media.js', 'delete.js']);
const video = (path) => ({ name: path.split('/').pop(), path, filepath: b64(path), size: 1e9, mtime: 1 });
const grouped = app.Media.group([
  video('/Disque 1/Séries/Lost.S04/Lost.S04E01.mkv'),
  video('/Disque 1/Séries/Lost.S04/Lost.S04E02.mkv'),
  video('/Disque 2/Tanguy.2001.mkv')
]);
const lost = grouped.find((e) => e.kind === 'folder');
const tanguy = grouped.find((e) => e.kind === 'file');
const NOW = 1_800_000_000_000;
const lostTask = (hoursAgo, status = 'seeding') => ({
  id: 7, name: 'Lost.S04', status, download_dir: b64('/Disque 1/Séries/Lost.S04/'), created_ts: NOW / 1000 - hoursAgo * 3600
});

test('média lié à un téléchargement : suppression du téléchargement, avertissement ratio avant 48 h', () => {
  const young = app.deletePlan(lost, [lostTask(10)], grouped, NOW);
  assert.equal(young.mode, 'download');
  assert.deepEqual(plain(young.tasks.map((t) => t.id)), [7]);
  assert.match(young.warn, /depuis 10 h/);
  assert.equal(app.deletePlan(lost, [lostTask(72)], grouped, NOW).warn, '');
  assert.equal(app.deletePlan(lost, [lostTask(10, 'downloading')], grouped, NOW).warn, '', 'pas de ratio en cours de téléchargement');
});

test('média sans téléchargement : suppression des fichiers', () => {
  const plan = app.deletePlan(tanguy, [lostTask(10)], grouped, NOW);
  assert.equal(plan.mode, 'files');
  assert.deepEqual(plain(plan.targets), ['/Disque 2/Tanguy.2001.mkv']);
});

test('confirmation : description de ce qui sera supprimé', () => {
  assert.match(app.describeTargets(tanguy, ['/Disque 2/Tanguy.2001.mkv']), /^Le fichier « Tanguy\.2001\.mkv »/);
  assert.match(app.describeTargets(lost, ['/Disque 1/Séries/Lost.S04']), /^Le dossier « Lost\.S04 » et tout son contenu/);
  const many = app.describeTargets(lost, ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `/Disque 2/${n}.mkv`));
  assert.match(many, /^6 éléments/);
  assert.match(many, /… et 2 autre\(s\)$/);
});
