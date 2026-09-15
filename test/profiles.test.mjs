import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const fresh = () => loadApp(['core.js', 'profiles.js', 'storage.js']);

test('premier lancement : un profil « Famille » qui garde les données existantes', () => {
  const app = fresh();
  assert.deepEqual(plain(app.loadProfiles()), { list: [{ id: 1, name: 'Famille', avatar: 'renard' }], currentId: 1 });
  assert.equal(app.profileKey('c411free.watched', 1), 'c411free.watched', 'clé historique : pas de migration');
  assert.equal(app.profileKey('c411free.watched', 3), 'c411free.watched@3');
  assert.equal(Object.keys(app.AVATARS).length, 10);
});

test('ajout, modification et suppression', () => {
  const app = fresh();
  const p = app.defaultProfiles();
  const lea = app.addProfile(p, '  Léa   la  grande  ', 'panda');
  assert.equal(lea, 2);
  assert.deepEqual(plain(app.findProfile(p, 2)), { id: 2, name: 'Léa la grande', avatar: 'panda' });
  const tom = app.addProfile(p, '', 'inconnu');
  assert.equal(app.findProfile(p, tom).name, 'Profil 3');
  assert.equal(app.findProfile(p, tom).avatar, 'chat', 'avatar encore libre');
  assert.equal(app.cleanName('Un surnom beaucoup trop long'), 'Un surnom beauco');

  assert.equal(app.updateProfile(p, 2, '', 'robot'), true);
  assert.deepEqual(plain(app.findProfile(p, 2)), { id: 2, name: 'Léa la grande', avatar: 'robot' }, 'surnom vide : ancien gardé');

  p.currentId = 2;
  assert.equal(app.removeProfile(p, 2), true);
  assert.equal(p.currentId, 1, 'profil courant supprimé : retour au premier');
  assert.equal(app.addProfile(p, 'Mamie', 'hibou'), 4, 'identifiant jamais réutilisé');
  app.removeProfile(p, 3); app.removeProfile(p, 4);
  assert.equal(app.removeProfile(p, 1), false, 'le dernier profil ne se supprime pas');
});

test('données séparées entre profils, effacées avec le profil', () => {
  const app = fresh();
  const p = app.loadProfiles();
  const id = app.addProfile(p, 'Léa', 'panda');
  app.saveProfiles(p);
  const task = { info_hash: 'ABC' };

  app.markWatched(task, 'Lost.S01E01.mkv');
  assert.equal(app.isWatched(task, 'Lost.S01E01.mkv'), true);

  p.currentId = id; app.saveProfiles(p);
  assert.equal(app.isWatched(task, 'Lost.S01E01.mkv'), false, 'pas vu par Léa');
  app.savePrefs({ subs: { off: true } });
  app.markWatched(task, 'Lost.S01E02.mkv');

  p.currentId = 1; app.saveProfiles(p);
  assert.equal(app.isWatched(task, 'Lost.S01E02.mkv'), false);
  assert.deepEqual(plain(app.loadPrefs()), {}, 'préférences de pistes propres à chacun');

  app.removeProfileData(id);
  p.currentId = id; app.saveProfiles(p);
  assert.equal(app.isWatched(task, 'Lost.S01E02.mkv'), false, 'données de Léa effacées');
  assert.deepEqual(plain(app.loadPrefs()), {});
});

test('profils mémorisés et relus', () => {
  const app = fresh();
  const p = app.loadProfiles();
  app.addProfile(p, 'Tom', 'robot');
  p.currentId = 2;
  app.saveProfiles(p);
  app.profilesCache = null;
  assert.equal(app.currentProfile().name, 'Tom');
  assert.deepEqual(plain(app.normalizeProfiles({ list: [{ id: 5, name: 'A', avatar: 'chat' }], currentId: 9 })).currentId, 5, 'profil courant introuvable : premier');
});
