import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const fresh = () => loadApp(['core.js', 'profiles.js', 'storage.js', 'later.js']);

test('ajout puis présent dans la file, idempotent', () => {
  const app = fresh();
  const item = { infoHash: 'ABCDEF', name: 'Film.2020.1080p', size: 42, seeders: 3, language: 'fr', posterUrl: '/p.jpg', subcategory: { id: 6 } };
  assert.equal(app.isLater(item.infoHash), false);
  const saved = app.addLater(item, 1000);
  assert.deepEqual(plain(saved), { name: item.name, size: 42, seeders: 3, language: 'fr', posterUrl: '/p.jpg', subcategory: 6, at: 1000 });
  assert.equal(app.isLater(item.infoHash), true);
  assert.equal(app.isLater('abcdef'), true, 'insensible à la casse');
  app.addLater(item, 2000); // idempotent : même clé, juste ré-écrite
  assert.equal(Object.keys(app.loadLater()).length, 1);
});

test('hash normalisé en minuscules', () => {
  const app = fresh();
  app.addLater({ infoHash: 'AbC123', name: 'x' }, 1000);
  assert.deepEqual(Object.keys(app.loadLater()), ['abc123']);
  assert.equal(app.isLater('ABC123'), true);
});

test('laterList triée du plus récent au plus ancien, infoHash inclus', () => {
  const app = fresh();
  app.addLater({ infoHash: 'aaa', name: 'Ancien' }, 1000);
  app.addLater({ infoHash: 'bbb', name: 'Récent' }, 3000);
  app.addLater({ infoHash: 'ccc', name: 'Milieu' }, 2000);
  const list = plain(app.laterList());
  assert.deepEqual(list.map((x) => x.infoHash), ['bbb', 'ccc', 'aaa']);
  assert.equal(list[0].name, 'Récent');
  // laterList(all) accepte un objet déjà chargé
  assert.deepEqual(plain(app.laterList(app.loadLater())).map((x) => x.infoHash), ['bbb', 'ccc', 'aaa']);
});

test('removeLater : true puis false, isLater redevient faux', () => {
  const app = fresh();
  app.addLater({ infoHash: 'zzz', name: 'x' }, 1000);
  assert.equal(app.removeLater('ZZZ'), true, 'hash retrouvé même en majuscules');
  assert.equal(app.isLater('zzz'), false);
  assert.equal(app.removeLater('zzz'), false, 'déjà retiré');
});

test('changement de profil : le memo est oublié, pas de fuite entre profils', () => {
  const app = fresh();
  app.addLater({ infoHash: 'aaa', name: 'x' }, 1000);
  assert.equal(app.isLater('aaa'), true);

  const p = app.loadProfiles();
  const lea = app.addProfile(p, 'Léa', 'panda');
  p.currentId = lea;
  app.saveProfiles(p);
  app.forgetLater();
  assert.equal(app.isLater('aaa'), false, 'file de Léa : vide, pas celle du profil précédent');

  p.currentId = 1;
  app.saveProfiles(p);
  app.forgetLater();
  assert.equal(app.isLater('aaa'), true, 'retour au profil d\'origine : sa file réapparaît');
});

test('plafond LATER_MAX : les plus anciens partent', () => {
  const app = fresh();
  for (let i = 0; i < app.LATER_MAX + 5; i++) app.addLater({ infoHash: 'h' + i, name: 'x' }, i);
  const all = app.loadLater();
  assert.equal(Object.keys(all).length, app.LATER_MAX);
  assert.equal(app.isLater('h0'), false, 'le plus ancien a été évincé');
  assert.equal(app.isLater('h4'), false);
  assert.equal(app.isLater('h5'), true, 'le premier gardé');
  assert.equal(app.isLater('h' + (app.LATER_MAX + 4)), true, 'le plus récent gardé');
});
