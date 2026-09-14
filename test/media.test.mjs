import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64, loadApp, plain } from './load.mjs';

const { Media } = loadApp(['media.js']);
const GB = 1e9;
const video = (path, mtime = 1) => ({ name: path.split('/').pop(), path, filepath: b64(path), size: GB, mtime });
const byPath = (entries) => Object.fromEntries(entries.map((e) => [e.path, e]));

const videos = [
  // Saison dans un dossier de rangement
  video('/Disque 1/Séries/Lost.S04.MULTI/Lost.S04E01.MULTI.1080p.mkv'),
  video('/Disque 1/Séries/Lost.S04.MULTI/Lost.S04E02.MULTI.1080p.mkv'),
  // Dossier de saison au nom générique
  video('/Disque 1/Le Coeur/Saison 1/Le.Coeur.S01E01.mkv'),
  video('/Disque 1/Le Coeur/Saison 1/Le.Coeur.S01E02.mkv'),
  // Épisodes isolés à la racine d'un disque
  video('/Disque 2/OVNIs.S01E01.1080p.mkv'),
  video('/Disque 2/OVNIs.S01E02.1080p.mkv'),
  // Numérotation seule, balise de groupe en tête
  video('/Disque 2/[EBD].Fullmetal.Alchemist.Brotherhood.01.[Bluray].mkv'),
  video('/Disque 2/[EBD].Fullmetal.Alchemist.Brotherhood.02.[Bluray].mkv'),
  // Film seul dans son dossier, film à la racine, films rangés ensemble
  video('/Disque 2/Another.Earth.2011/Another.Earth.2011.1080p.mkv'),
  video('/Disque 2/Tanguy.2001.mkv'),
  video('/Disque 1/Films/Amelie.2001.mkv'),
  video('/Disque 1/Films/Intouchables.2011.mkv')
];
const grouped = Media.group(videos);
const entries = byPath(grouped);

test('regroupe les saisons, les épisodes isolés et les films', () => {
  assert.equal(grouped.length, 8);
  assert.deepEqual(plain(grouped.map((e) => [e.kind, e.name, e.files.length]).sort()), [
    ['file', 'Amelie.2001.mkv', 1],
    ['file', 'Another.Earth.2011.1080p.mkv', 1],
    ['file', 'Intouchables.2011.mkv', 1],
    ['file', 'Tanguy.2001.mkv', 1],
    ['folder', 'Fullmetal.Alchemist.Brotherhood', 2], // balise de groupe retirée du nom
    ['folder', 'Le Coeur — Saison 1', 2],
    ['folder', 'Lost.S04.MULTI', 2],
    ['folder', 'OVNIs.S01', 2]
  ].sort());
});

test('trie les épisodes et cumule taille et date', () => {
  const lost = entries['/Disque 1/Séries/Lost.S04.MULTI'];
  assert.deepEqual(plain(lost.files.map((f) => f.name)), ['Lost.S04E01.MULTI.1080p.mkv', 'Lost.S04E02.MULTI.1080p.mkv']);
  assert.equal(lost.size, 2 * GB);
});

test('chemin d\'un téléchargement : dossier du torrent déjà inclus ou fichier seul', () => {
  assert.equal(Media.taskPath({ download_dir: b64('/Disque 1/Séries/Lost.S04.MULTI/'), name: 'Lost.S04.MULTI' }), '/Disque 1/Séries/Lost.S04.MULTI');
  assert.equal(Media.taskPath({ download_dir: b64('/Disque 2/'), name: 'Tanguy.2001.mkv' }), '/Disque 2/Tanguy.2001.mkv');
});

test('associe les téléchargements et ajoute ceux en cours absents des disques', () => {
  const tasks = [
    { id: 1, name: 'Lost.S04.MULTI', download_dir: b64('/Disque 1/Séries/Lost.S04.MULTI/'), rx_pct: 10000, created_ts: 10 },
    { id: 2, name: 'Nouveau.Film.2026.mkv', download_dir: b64('/Disque 2/'), rx_pct: 4200, created_ts: 20 },
    { id: 3, name: 'Archive.zip', download_dir: b64('/Disque 2/'), rx_pct: 10000, created_ts: 30 }
  ];
  const attached = Media.attachTasks(grouped, tasks);
  assert.equal(byPath(attached)['/Disque 1/Séries/Lost.S04.MULTI'].task.id, 1);
  const extras = attached.filter((e) => e.kind === 'task');
  assert.deepEqual(plain(extras.map((e) => e.task.id)), [2]);
});

test('retrouve tous les téléchargements d\'un dossier regroupé', () => {
  const tasks = [1, 2].map((n) => ({ id: n, name: `OVNIs.S01E0${n}.1080p.mkv`, download_dir: b64('/Disque 2/') }));
  assert.deepEqual(plain(Media.tasksFor(entries['/Disque 2/OVNIs.S01'], tasks).map((t) => t.id)), [1, 2]);
  assert.equal(Media.tasksFor(entries['/Disque 2/Tanguy.2001.mkv'], tasks).length, 0);
});

test('cibles de suppression : jamais un disque ni un dossier de rangement', () => {
  const targets = (path) => plain(Media.deletionTargets(entries[path], grouped));
  assert.deepEqual(targets('/Disque 1/Séries/Lost.S04.MULTI'), ['/Disque 1/Séries/Lost.S04.MULTI']);
  assert.deepEqual(targets('/Disque 1/Le Coeur/Saison 1'), ['/Disque 1/Le Coeur/Saison 1']);
  assert.deepEqual(targets('/Disque 2/OVNIs.S01'), ['/Disque 2/OVNIs.S01E01.1080p.mkv', '/Disque 2/OVNIs.S01E02.1080p.mkv']);
  assert.deepEqual(targets('/Disque 2/Another.Earth.2011/Another.Earth.2011.1080p.mkv'), ['/Disque 2/Another.Earth.2011']);
  assert.deepEqual(targets('/Disque 2/Tanguy.2001.mkv'), ['/Disque 2/Tanguy.2001.mkv']);
  assert.deepEqual(targets('/Disque 1/Films/Amelie.2001.mkv'), ['/Disque 1/Films/Amelie.2001.mkv']);
  const all = grouped.flatMap((e) => plain(Media.deletionTargets(e, grouped)));
  assert.ok(all.every((p) => p.split('/').filter(Boolean).length >= 2), 'aucune racine de disque');
  assert.ok(!all.includes('/Disque 1/Films') && !all.includes('/Disque 1/Séries'), 'aucun dossier de rangement');
});

test('parcours des disques : vidéos seulement, extraits et dossiers système exclus', async () => {
  const tree = {
    '/': [{ name: 'Disque 1', type: 'dir', path: b64('/Disque 1') }],
    '/Disque 1': [
      { name: 'Film.2020.mkv', type: 'file', size: GB, path: b64('/Disque 1/Film.2020.mkv') },
      { name: 'Film.2020.sample.mkv', type: 'file', size: GB, path: b64('/Disque 1/Film.2020.sample.mkv') },
      { name: 'Petit.mkv', type: 'file', size: 1000, path: b64('/Disque 1/Petit.mkv') },
      { name: 'notes.nfo', type: 'file', size: GB, path: b64('/Disque 1/notes.nfo') },
      { name: 'VMs', type: 'dir', path: b64('/Disque 1/VMs') }
    ],
    '/Disque 1/VMs': [{ name: 'disk.mkv', type: 'file', size: GB, path: b64('/Disque 1/VMs/disk.mkv') }]
  };
  const found = await Media.scan(async (path) => tree[path] || []);
  assert.deepEqual(plain(found.map((v) => v.path)), ['/Disque 1/Film.2020.mkv']);
});
