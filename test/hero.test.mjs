import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'hero.js']);

test('élément du bandeau à partir d\'une fiche c411', () => {
  const detail = {
    name: 'Inception.2010.MULTI.1080p',
    metadata: { tmdbData: { title: 'Inception', year: 2010, rating: 8.37, genres: ['Action', 'Science-Fiction', 'Aventure', 'Thriller'], overview: 'Dom Cobb…', type: 'movie', backdropUrl: 'https://image.tmdb.org/t/p/original/s3TBrRGB1iav7gFOCNx3H31MoES.jpg' } }
  };
  assert.deepEqual(plain(app.heroItemFromDetail('abc', detail)), {
    infoHash: 'abc', title: 'Inception', year: '2010', rating: 8.37, genres: ['Action', 'Science-Fiction', 'Aventure'],
    overview: 'Dom Cobb…', backdrop: 'https://image.tmdb.org/t/p/w1280/s3TBrRGB1iav7gFOCNx3H31MoES.jpg', isSeries: false
  });
  assert.equal(app.heroItemFromDetail('x', { name: 'Sans.Image.2020', metadata: { tmdbData: { title: 'Sans image' } } }), null, 'sans image de fond : écarté');
  assert.equal(app.heroItemFromDetail('x', null), null);
});

test('sélection mémorisée : utilisable si non vide et de moins d\'une semaine', () => {
  const NOW = 1_800_000_000_000, DAY = 86_400_000;
  const items = [{ infoHash: 'a', title: 'Fracture' }];
  assert.equal(app.heroCacheUsable({ at: NOW - DAY, items }, NOW), true);
  assert.equal(app.heroCacheUsable({ at: NOW - 6 * DAY, items }, NOW), true);
  assert.equal(app.heroCacheUsable({ at: NOW - 8 * DAY, items }, NOW), false, 'trop ancienne');
  assert.equal(app.heroCacheUsable({ at: NOW, items: [] }, NOW), false, 'sélection vide');
  assert.equal(app.heroCacheUsable({ items }, NOW), false, 'sans horodatage : considérée trop ancienne');
  assert.equal(app.heroCacheUsable({ at: NOW }, NOW), false);
  assert.equal(app.heroCacheUsable(null, NOW), false);
});

test('ligne d\'infos et navigation circulaire', () => {
  assert.equal(app.heroMeta({ year: '2025', rating: 7.84, isSeries: true, genres: ['Drame', 'Crime'] }), '2025 · ★ 7.8 · Série · Drame, Crime');
  assert.equal(app.heroMeta({ year: '', rating: 0, isSeries: false, genres: [] }), '');
  assert.equal(app.heroStepIndex(0, 8, 1), 1);
  assert.equal(app.heroStepIndex(7, 8, 1), 0);
  assert.equal(app.heroStepIndex(0, 8, -1), 7);
  assert.equal(app.heroStepIndex(0, 0, 1), 0);
  assert.equal(app.heroBackdrop('https://image.tmdb.org/t/p/w780/a.jpg'), 'https://image.tmdb.org/t/p/w1280/a.jpg');
});
