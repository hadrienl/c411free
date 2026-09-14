import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'posters.js']);
const query = (name) => plain(app.posterQuery({ name }));

test('titre recherché pour un média', () => {
  assert.deepEqual(query('Lost.S04.MULTI'), { title: 'Lost', year: '', key: 'lost' });
  assert.deepEqual(query('Le Coeur — Saison 1'), { title: 'Le Coeur', year: '', key: 'le coeur' });
  assert.deepEqual(query('[EBD].Fullmetal.Alchemist.Brotherhood'), { title: 'Fullmetal Alchemist Brotherhood', year: '', key: 'fullmetal alchemist brotherhood' });
  assert.deepEqual(query('Another.Earth.2011.1080p.mkv'), { title: 'Another Earth', year: '2011', key: 'another earth|2011' });
  assert.deepEqual(query('OVNIs.S01'), { title: 'OVNIs', year: '', key: 'ovnis' });
  assert.equal(app.posterQuery({ name: '' }), null);
});

test('titres comparés sans accents ni ponctuation', () => {
  assert.equal(app.normTitle('Le Cœur'), 'le coeur');
  assert.equal(app.normTitle('Amélie.Poulain'), 'amelie poulain');
});

test('choix de l\'affiche : même titre et même année d\'abord', () => {
  const results = [
    { name: 'Lost.Girl.S01.1080p', posterUrl: 'girl' },
    { name: 'Lost.S01.MULTI.1080p', posterUrl: 'lost' },
    { name: 'Tanguy.Is.Back.2025', posterUrl: 'back' },
    { name: 'Tanguy.2001.FRENCH.1080p', posterUrl: 'tanguy' },
    { name: 'Sans.Affiche.2001' }
  ];
  assert.equal(app.pickPoster(results, { title: 'Lost', year: '' }), 'lost');
  assert.equal(app.pickPoster(results, { title: 'Tanguy', year: '2001' }), 'tanguy');
  assert.equal(app.pickPoster([{ name: 'Autre.Chose', posterUrl: 'autre' }], { title: 'Rien', year: '' }), 'autre', 'à défaut, le plus pertinent');
  assert.equal(app.pickPoster([{ name: 'Sans.Affiche' }], { title: 'Sans Affiche', year: '' }), '');
});

test('cache : affiche connue, absence mémorisée une semaine', () => {
  const q = { key: 'lost' }, now = 1_800_000_000_000, week = 7 * 24 * 3600 * 1000;
  assert.equal(app.cachedPoster({}, q, now), null);
  assert.equal(app.cachedPoster({ lost: { url: 'u', at: 0 } }, q, now), 'u');
  assert.equal(app.cachedPoster({ lost: { url: '', at: now - 1000 } }, q, now), '');
  assert.equal(app.cachedPoster({ lost: { url: '', at: now - week - 1 } }, q, now), null);
});

test('recherche les affiches manquantes une seule fois par titre et les mémorise', async () => {
  const calls = [];
  app.c411 = async (path, params) => {
    calls.push(params.name);
    return { data: params.name === 'Lost' ? [{ name: 'Lost.S01.MULTI', posterUrl: 'lost.jpg' }] : [] };
  };
  const found = [];
  const entries = [{ name: 'Lost.S04.MULTI' }, { name: 'Lost.S05.MULTI' }, { name: 'Inconnu.2020.mkv' }];
  await app.fetchPosters(entries, () => true, (key, url) => found.push([key, url]));
  assert.deepEqual(calls.sort(), ['Inconnu', 'Lost']);
  assert.deepEqual(found, [['lost', 'lost.jpg']]);

  calls.length = 0;
  await app.fetchPosters(entries, () => true, () => {});
  assert.deepEqual(calls, [], 'déjà en cache : aucun nouvel appel');
});
