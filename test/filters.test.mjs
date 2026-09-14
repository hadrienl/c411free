import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'filters.js']);
const OPTIONS = [
  { slug: 'langue', values: [{ id: 1, value: 'Anglais' }] },
  { slug: 'genre', values: [{ id: 57, value: 'Drame' }, { id: 39, value: 'Action' }, { id: 59, value: 'Épouvante & Horreur' }] }
];

test('paramètres envoyés à c411', () => {
  assert.deepEqual(plain(app.filterParams(app.emptyFilters())), { subcat: '', year: '', options: '' });
  assert.deepEqual(plain(app.filterParams({ subcat: '1,2', year: '2020', genre: '39' })), { subcat: '1,2', year: '2020', options: '39' });
  assert.equal(app.activeFilterCount({ subcat: '6', year: '', genre: '39' }), 2);
  assert.equal(app.activeFilterCount(app.emptyFilters()), 0);
});

test('types proposés : sous-catégories vidéo', () => {
  assert.deepEqual(plain(app.FILTER_TYPES.map((t) => t.label)), ['Tout', 'Films', 'Séries', 'Animation', 'Documentaires', 'Suivi']);
  assert.equal(app.FILTER_TYPES.find((t) => t.label === 'Animation').subcat, '1,2', 'films et séries d\'animation');
});

test('années de la plus récente à la plus ancienne', () => {
  const years = plain(app.yearChoices(2026, 2020));
  assert.deepEqual(years, [2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  assert.equal(app.yearChoices(2026).at(-1), 1920);
});

test('genres de c411 triés par nom, libellé des filtres actifs', () => {
  const genres = app.genresFromOptions(OPTIONS);
  assert.deepEqual(plain(genres.map((g) => g.name)), ['Action', 'Drame', 'Épouvante & Horreur']);
  assert.deepEqual(plain(app.genresFromOptions([])), []);
  assert.equal(app.filterSummary({ subcat: '6', year: '2020', genre: '39' }, genres), 'Films · 2020 · Action');
  assert.equal(app.filterSummary(app.emptyFilters(), genres), '');
});

test('liste des genres chargée une fois puis mise en cache', async () => {
  let calls = 0;
  app.c411 = async (path) => { calls++; assert.equal(path, '/api/categories/1/options'); return { data: OPTIONS }; };
  assert.equal((await app.loadGenres()).length, 3);
  assert.equal((await app.loadGenres()).length, 3);
  assert.equal(calls, 1);
  assert.equal(app.genreName('59'), 'Épouvante & Horreur');
});
