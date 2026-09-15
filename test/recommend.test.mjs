import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'profiles.js', 'names.js', 'storage.js', 'posters.js', 'intro.js', 'filters.js', 'series.js', 'history.js', 'recommend.js']);
const DAY = 86400000, NOW = 1_800_000_000_000;

test('historique : identité des titres et avancement le plus loin', () => {
  assert.deepEqual(plain(app.viewIdentity('Lost.S04E12.MULTI.1080p.mkv', '')), { key: 'serie:lost', title: 'Lost', year: '', isSeries: true });
  assert.deepEqual(plain(app.viewIdentity('Inception.2010.MULTI.1080p.mkv', '')), { key: 'film:inception|2010', title: 'Inception', year: '2010', isSeries: false });
  let h = app.recordView({}, app.viewIdentity('Inception.2010.mkv', ''), 'Inception.2010.mkv', 0.62, NOW, 'ABC');
  h = app.recordView(h, app.viewIdentity('Inception.2010.mkv', ''), 'Inception.2010.mkv', 0.3, NOW + 1, null);
  assert.equal(h['film:inception|2010'].files['Inception.2010.mkv'], 0.62, 'on garde le plus loin atteint');
  assert.equal(h['film:inception|2010'].infoHash, 'abc');
  assert.deepEqual(plain(app.recordView({}, null, 'x', 0.5, NOW)), {});
});

test('intérêt : film fini > abandonné, série selon les épisodes, atténué avec le temps', () => {
  const film = (r, at = NOW) => ({ isSeries: false, files: { f: r }, lastAt: at });
  assert.equal(app.engagement(film(0.05), NOW), 0);
  assert.ok(app.engagement(film(0.3), NOW) < app.engagement(film(0.7), NOW));
  assert.equal(app.engagement(film(0.95), NOW), 1);
  assert.ok(Math.abs(app.engagement(film(0.95, NOW - 120 * DAY), NOW) - 0.5) < 1e-9, 'demi-vie 120 jours');
  const series = (n) => ({ isSeries: true, files: Object.fromEntries(Array.from({ length: n }, (_, i) => ['e' + i, 0.9])), lastAt: NOW });
  assert.ok(app.engagement(series(1), NOW) < app.engagement(series(6), NOW));
  assert.equal(app.engagement(series(20), NOW), 1);
  assert.equal(Object.keys(app.historyFromWatched({ a: { files: { 'Lost.S01E01.mkv': NOW, 'Tanguy.2001.mkv': NOW } } })).length, 2);
});

test('genres TMDB rapprochés des genres c411', () => {
  assert.deepEqual(plain(app.genreKeys('Action & Adventure')), ['action', 'aventure']);
  assert.deepEqual(plain(app.genreKeys('Science-Fiction & Fantastique')), ['science fiction', 'fantastique']);
  const index = app.genreIndex([{ id: 86, name: 'Science Fiction' }, { id: 44, name: 'Aventure' }, { id: 59, name: 'Épouvante & Horreur' }, { id: 61, name: 'Famille' }]);
  assert.equal(index['science fiction'], 86);
  assert.equal(index['aventure'], 44);
  assert.equal(index['horreur'], 59);
  assert.equal(index[app.genreKeys('Familial')[0]], 61);
});

const features = (o) => ({ tmdbId: 1, isSeries: false, year: '2010', genres: [], keywords: [], people: [], cast: [], rating: 0, ...o });

test('goûts, notes, raisons et diversité', () => {
  const known = [
    { title: 'Lost', weight: 1, features: features({ isSeries: true, genres: ['Drame', 'Mystère'], keywords: ['île', 'crash d\'avion'], people: ['J.J. Abrams'], cast: ['Matthew Fox'] }) },
    { title: 'Inception', weight: 0.5, features: features({ genres: ['Science-Fiction', 'Action'], keywords: ['rêve'], people: ['Christopher Nolan'], cast: ['Leonardo DiCaprio'] }) }
  ];
  const taste = app.tasteProfile(known);
  assert.ok(Math.abs(taste.seriesShare - 2 / 3) < 1e-9);
  assert.ok(taste.genres['drame'] > taste.genres['action']);
  assert.deepEqual(plain(app.topKeys(taste.genres, 2)), ['drame', 'enquete']);

  const alike = features({ isSeries: true, genres: ['Drame'], keywords: ['île'], people: ['J.J. Abrams'] });
  const other = features({ genres: ['Comédie'] });
  assert.ok(app.scoreCandidate({ seeders: 10 }, taste, alike) > app.scoreCandidate({ seeders: 5000 }, taste, other), 'goûts avant popularité');
  assert.equal(app.reasonFor(alike, known, taste), 'Parce que vous avez regardé « Lost »');
  assert.equal(app.reasonFor(features({ genres: ['Comédie', 'Action'] }), known, taste), 'Action', 'sinon les genres appréciés');

  const byNolan = (n) => ({ key: 'n' + n, features: features({ tmdbId: 100 + n, people: ['Christopher Nolan'], cast: ['Acteur ' + n] }) });
  assert.equal(app.diversify([byNolan(1), byNolan(2), byNolan(3), { key: 'x', features: other }], 10).length, 3, 'pas plus de 2 par réalisateur');
});

test('candidats regroupés par titre, déjà vus exclus', () => {
  const lists = [
    { genre: 'drame', data: [{ infoHash: 'a', name: 'Lost.S01.MULTI.1080p', seeders: 50 }, { infoHash: 'b', name: 'Dark.S01.MULTI', seeders: 30 }] },
    { genre: 'enquete', data: [{ infoHash: 'c', name: 'Dark.S02.MULTI.2160p', seeders: 90 }] },
    { genre: null, data: [{ infoHash: 'd', name: 'Tanguy.2001.FRENCH', seeders: 900 }] }
  ];
  const c = app.groupCandidates(lists);
  assert.deepEqual(plain(c.map((x) => [x.key, x.release.infoHash, x.genres])), [['lost', 'a', ['drame']], ['dark', 'c', ['drame', 'enquete']], ['tanguy', 'd', []]]);
  const excluded = app.excludedTitleKeys({ 'serie:lost': { title: 'Lost' } }, [{ name: 'Tanguy.2001.mkv', kind: 'file', files: [] }]);
  assert.deepEqual(plain(c.filter((x) => !excluded[x.key]).map((x) => x.key)), ['dark']);
  assert.deepEqual(plain(app.featuresFromDetail({ metadata: { tmdbData: { id: 9, type: 'tv', title: 'Dark', keywords: [{ name: 'voyage dans le temps' }], createdBy: [{ name: 'Baran bo Odar' }], cast: ['Louis Hofmann'], genres: ['Drame'] } } })),
    { tmdbId: 9, isSeries: true, year: '', genres: ['Drame'], keywords: ['voyage dans le temps'], people: ['Baran bo Odar'], cast: ['Louis Hofmann'], rating: 0 });
});

test('raisons fiables : mots-clés génériques ignorés, noms dédoublonnés, saison complète préférée', () => {
  // Cas relevés sur les vraies fiches c411
  const youngSheldon = app.featuresFromDetail({ metadata: { tmdbData: { id: 1, type: 'tv', title: 'Young Sheldon', genres: ['Comédie', 'Familial'], keywords: ['family', 'coming of age', 'admiring', 'amused', 'kid genius'], createdBy: ['Steven Molaro', 'Chuck Lorre', 'Steven Molaro', 'Chuck Lorre'], cast: ['Iain Armitage'] } } });
  assert.deepEqual(plain(youngSheldon.keywords), ['coming of age', 'kid genius']);
  assert.deepEqual(plain(youngSheldon.people), ['Steven Molaro', 'Chuck Lorre']);
  const lost = features({ isSeries: true, genres: ['Mystère'], keywords: ['airplane crash', 'uncharted'], people: ['Damon Lindelof'], cast: ['Matthew Fox'] });
  const known = [{ title: 'Young Sheldon', weight: 1, features: youngSheldon }, { title: 'Lost', weight: 1, features: lost }];
  const taste = app.tasteProfile(known);
  const houseOfTheDragon = features({ isSeries: true, genres: ['Drame', 'Action & Adventure'], keywords: ['dragon', 'king'], people: ['Ryan Condal'] });
  assert.equal(app.reasonFor(houseOfTheDragon, known, taste), 'Drame · Action & Adventure', 'aucun point commun réel : les genres');
  const oneKeyword = features({ genres: ['Aventure'], keywords: ['uncharted', 'pirates'] });
  assert.doesNotMatch(app.reasonFor(oneKeyword, known, taste), /Parce que/, 'un seul mot-clé commun ne suffit pas');
  const twoKeywords = features({ genres: ['Aventure'], keywords: ['uncharted', 'airplane crash'] });
  assert.equal(app.reasonFor(twoKeywords, known, taste), 'Parce que vous avez regardé « Lost »');
  const sameActor = features({ genres: ['Drame'], cast: ['Matthew Fox'] });
  assert.equal(app.reasonFor(sameActor, known, taste), 'Parce que vous avez regardé « Lost »');

  const c = app.groupCandidates([{ genre: 'drame', data: [
    { infoHash: 'e', name: 'House.of.the.Dragon.S03E08.MULTI.1080p', seeders: 2000 },
    { infoHash: 's', name: 'House.of.the.Dragon.S01.MULTI.1080p', seeders: 300 }
  ] }]);
  assert.equal(c[0].release.infoHash, 's', 'saison complète plutôt que le dernier épisode');

  // Même série sous deux orthographes (relevé sur c411), puis même œuvre TMDB sous deux titres
  assert.equal(app.titleKeyOf('Rick.et.Morty.S09E08.MULTI'), app.titleKeyOf('Rick.And.Morty.S09E07.VOSTFR'));
  assert.equal(app.titleKeyOf('Rick & Morty S08'), 'rick morty');
  const same = [{ key: 'a', features: features({ tmdbId: 60625 }) }, { key: 'b', features: features({ tmdbId: 60625 }) }, { key: 'c', features: features({ tmdbId: 1399 }) }];
  assert.deepEqual(plain(app.diversify(same, 10).map((x) => x.key)), ['a', 'c']);
});

test('signature de l\'historique : change quand un titre est vraiment regardé', () => {
  const h = { 'serie:lost': { files: { e1: 0.9 } } };
  const s1 = app.historySignature(h);
  h['serie:lost'].files.e1 = 0.91;
  assert.equal(app.historySignature(h), s1, 'simple progression : pas de recalcul');
  h['serie:lost'].files.e2 = 0.8;
  assert.notEqual(app.historySignature(h), s1);
});
