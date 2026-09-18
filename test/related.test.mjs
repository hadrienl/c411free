import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'profiles.js', 'names.js', 'storage.js', 'posters.js', 'intro.js', 'filters.js', 'series.js', 'related.js']);
const POSTER = 'https://image.tmdb.org/t/p/w500/8502I2bOEMQpJGB0h489YButCYp.jpg';
let n = 0;
const rel = (name, extra = {}) => ({ infoHash: 'h' + (++n), name, createdAt: '2026-03-0' + ((n % 9) + 1) + 'T10:00:00Z', seeders: 5, ...extra });
const codes = (list) => list.map((r) => app.episodeCode(app.episodeInfo(r.name)));
const hit = (x) => x && app.episodeCode(x.info);

test('référence d\'un titre : noms connus, affiche, année, film ou série', () => {
  const ref = app.relatedRef('Lost.Les.Disparus.S03E04.MULTI.1080p', ['Lost : Les Disparus', 'Lost'], POSTER, 2004);
  assert.deepEqual(plain(ref), { names: ['lost les disparus', 'lost'], poster: '8502I2bOEMQpJGB0h489YButCYp.jpg', year: '2004', episodic: true });
  assert.equal(app.relatedRef('Dune.2021.MULTI.2160p', [], '', '').year, '2021');
  assert.equal(app.relatedRef('Dune.2021.MULTI.2160p').episodic, false);
});

test('versions d\'un film : même titre et même année, ou même affiche, sans les séries', () => {
  const ref = app.relatedRef('Dune.2021.MULTI.VFF.2160p', ['Dune'], POSTER, 2021);
  const list = [
    rel('Dune.2021.MULTI.1080p.BluRay', { createdAt: '2024-01-01T00:00:00Z' }),
    rel('Dune.1984.MULTI.1080p', { createdAt: '2025-01-01T00:00:00Z' }),
    rel('Dune.Prophecy.S01E01.MULTI.1080p', { posterUrl: POSTER }),
    rel('Dune.Premiere.Partie.2021.MULTI.720p', { posterUrl: POSTER, createdAt: '2025-06-01T00:00:00Z' }),
    rel('Dune.MULTI.720p', { createdAt: '2023-01-01T00:00:00Z' })
  ];
  const kept = app.relatedReleases(ref, list.concat([list[0]]));
  assert.deepEqual(kept.map((r) => r.name), ['Dune.Premiere.Partie.2021.MULTI.720p', 'Dune.2021.MULTI.1080p.BluRay', 'Dune.MULTI.720p'],
    'plus récentes d\'abord, sans doublon, sans Dune 1984 ni la série');
});

test('versions d\'une série : tous les épisodes et packs, les films exclus', () => {
  const ref = app.relatedRef('Pluribus.S01E04.MULTI.1080p', ['Pluribus'], POSTER, 2025);
  const list = [rel('Pluribus.S01E01.MULTI.1080p'), rel('Pluribus.2025.S01.MULTI.2160p'), rel('Pluribus.2025.MULTI.1080p'), rel('Other.S01E01', { posterUrl: POSTER })];
  assert.deepEqual(codes(app.relatedReleases(ref, list)).sort(), ['S01E01', 'S01E01', 'Saison 1']);
});

test('épisode précédent et suivant dans la saison', () => {
  const cur = rel('Show.S04E03.MULTI.1080p');
  const list = [rel('Show.S04E02.MULTI.1080p'), rel('Show.S04E04.MULTI.1080p'), rel('Show.S04E01.MULTI.1080p'), rel('Show.S04E05.MULTI.1080p')];
  assert.equal(hit(app.neighbourRelease(cur, list, -1)), 'S04E02');
  assert.equal(hit(app.neighbourRelease(cur, list, 1)), 'S04E04');
});

test('changement de saison : dernier épisode de la précédente, premier de la suivante', () => {
  const list = [rel('Show.S03E09.1080p'), rel('Show.S03E10.1080p'), rel('Show.S03E01.1080p'), rel('Show.S04E01.1080p'), rel('Show.S04E08.1080p'), rel('Show.S05E01.1080p'), rel('Show.S05E02.1080p')];
  assert.equal(hit(app.neighbourRelease(rel('Show.S04E01.1080p'), list, -1)), 'S03E10');
  assert.equal(hit(app.neighbourRelease(rel('Show.S04E08.1080p'), list, 1)), 'S05E01');
  assert.equal(hit(app.neighbourRelease(rel('Show.S03E01.1080p'), list, -1)), null, 'premier épisode connu');
  assert.equal(hit(app.neighbourRelease(rel('Show.S05E02.1080p'), list, 1)), null, 'dernier épisode sorti');
});

test('épisode manquant : pack de la saison, sinon l\'épisode le plus proche', () => {
  const pack = [rel('Show.S01E04.1080p'), rel('Show.S01.MULTI.1080p'), rel('Show.S01E01.1080p')];
  assert.equal(hit(app.neighbourRelease(pack[0], pack, -1)), 'Saison 1', 'S01E03 absent mais dans le pack S01');
  const gap = [rel('Show.S01E04.1080p'), rel('Show.S01E01.1080p'), rel('Show.S01E07.1080p')];
  assert.equal(hit(app.neighbourRelease(gap[0], gap, -1)), 'S01E01');
  assert.equal(hit(app.neighbourRelease(gap[0], gap, 1)), 'S01E07');
  const nextSeason = [rel('Show.S01E08.1080p'), rel('Show.S02.MULTI.1080p')];
  assert.equal(hit(app.neighbourRelease(nextSeason[0], nextSeason, 1)), 'Saison 2', 'saison suivante sortie en pack');
});

test('pack de saison : saison voisine, en pack ou par ses épisodes', () => {
  const list = [rel('Show.S02.MULTI.1080p'), rel('Show.S01E09.1080p'), rel('Show.S01E10.1080p'), rel('Show.S03.MULTI.1080p'), rel('Show.S03E01.1080p')];
  assert.equal(hit(app.neighbourRelease(list[0], list, -1)), 'S01E10');
  assert.equal(hit(app.neighbourRelease(list[0], list, 1)), 'Saison 3');
  assert.equal(app.neighbourRelease(rel('Show.INTEGRALE.1080p'), list, 1), null);
  assert.equal(app.neighbourRelease(rel('Film.2020.1080p'), list, 1), null);
});

test('plusieurs releases du même épisode : la plus proche de celle affichée', () => {
  const cur = rel('Show.S01E04.MULTI.VFF.2160p.EAC3', { language: 'Multi' });
  const list = [
    rel('Show.S01E03.VOSTFR.2160p.EAC3', { seeders: 50 }),
    rel('Show.S01E03.MULTI.VFF.1080p.EAC3', { seeders: 40 }),
    rel('Show.S01E03.MULTI.VFF.2160p.DTS', { seeders: 30 }),
    rel('Show.S01E03.MULTI.VFF.2160p.EAC3', { seeders: 2 })
  ];
  assert.equal(app.neighbourRelease(cur, list, -1).release.name, 'Show.S01E03.MULTI.VFF.2160p.EAC3');
});

test('recherches ciblées des épisodes voisins', () => {
  assert.deepEqual(plain(app.neighbourQueries('Show.S04E03.1080p')), ['S04E02', 'S04E04', 'S05E01']);
  assert.deepEqual(plain(app.neighbourQueries('Show.S04E01.1080p')), ['S03', 'S04E02', 'S05E01']);
  assert.deepEqual(plain(app.neighbourQueries('Show.S01E01.1080p')), ['S01E02', 'S02E01']);
  assert.deepEqual(plain(app.neighbourQueries('Show.S01.1080p')), ['S02']);
  assert.deepEqual(plain(app.neighbourQueries('Film.2020.1080p')), []);
});
