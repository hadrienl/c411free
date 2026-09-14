import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'storage.js', 'posters.js', 'intro.js', 'filters.js', 'series.js']);
const rel = (hash, name, createdAt, posterUrl) => ({ infoHash: hash, name, createdAt, posterUrl });

test('codes d\'épisode des fichiers et des releases', () => {
  assert.deepEqual(plain(app.episodeInfo('Lost.S04E12.MULTI.1080p.mkv')), { season: 4, episode: 12 });
  assert.deepEqual(plain(app.episodeInfo('Show.S01E01E02.1080p')), { season: 1, episode: 2 }, 'double épisode');
  assert.deepEqual(plain(app.episodeInfo('Show.S01E09.10bit.x265')), { season: 1, episode: 9 });
  assert.deepEqual(plain(app.episodeInfo('Show.3x07.HDTV')), { season: 3, episode: 7 });
  assert.deepEqual(plain(app.episodeInfo('Lost.S05.MULTI.1080p.BluRay')), { season: 5, pack: true });
  assert.deepEqual(plain(app.episodeInfo('Lost.INTEGRALE.MULTI.1080p')), { complete: true });
  assert.deepEqual(plain(app.episodeInfo('[SR-71] K Project - 03 VOSTFR [1080p]')), { season: 1, episode: 3 });
  assert.equal(app.episodeInfo('[EBD].Fullmetal.Alchemist.Brotherhood.01.[Bluray].mkv'), null, 'numéro seul : uniquement dans un dossier');
  assert.deepEqual(plain(app.episodeInfo('[EBD].Fullmetal.Alchemist.Brotherhood.01.[Bluray].mkv', true)), { season: 1, episode: 1 });
  assert.equal(app.episodeInfo('Tanguy.2001.1080p.mkv'), null, 'un film n\'est pas un épisode');
  assert.equal(app.episodeCode({ season: 4, episode: 12 }), 'S04E12');
  assert.equal(app.episodeCode({ season: 5, pack: true }), 'Saison 5');
});

test('nouveauté par rapport au dernier épisode vu', () => {
  const seen = { season: 4, episode: 12, at: Date.parse('2026-05-01') };
  assert.equal(app.isNewer({ season: 4, episode: 13 }, seen, 0), true);
  assert.equal(app.isNewer({ season: 5, episode: 1 }, seen, 0), true);
  assert.equal(app.isNewer({ season: 4, episode: 12 }, seen, 0), false);
  assert.equal(app.isNewer({ season: 3, episode: 20 }, seen, 0), false);
  assert.equal(app.isNewer({ season: 5, pack: true }, seen, 0), true, 'saison suivante complète');
  assert.equal(app.isNewer({ season: 4, pack: true }, seen, Date.parse('2026-06-01')), true, 'pack de la saison en cours sorti depuis');
  assert.equal(app.isNewer({ season: 4, pack: true }, seen, Date.parse('2026-01-01')), false);
  assert.equal(app.isNewer({ complete: true }, seen, Date.parse('2026-06-01')), false);
});

test('titre de release : le code d\'épisode au milieu du nom est coupé', () => {
  assert.equal(app.prettyName('Georgie.and.Mandys.First.Marriage.S02E21.MULTI.1080p').title, 'Georgie and Mandys First Marriage');
  assert.equal(app.prettyName('Lost.Les.Disparus.INTEGRALE.MULTI.1080p').title, 'Lost Les Disparus');
});

test('mémoire : épisode le plus avancé, alias c411, reprise de l\'historique', () => {
  let all = app.recordEpisode({}, 'lost', 'Lost', { season: 4, episode: 12 }, null, 100);
  all = app.recordEpisode(all, 'lost', 'Lost', { season: 4, episode: 3 }, { name: 'lost les disparus', poster: 'lost.jpg' }, 200);
  assert.deepEqual(plain(all.lost), { title: 'Lost', season: 4, episode: 12, at: 100, names: ['lost les disparus'], posters: ['lost.jpg'] }, 'un épisode revu plus tôt ne recule pas');
  all = app.recordEpisode(all, 'lost', 'Lost', { season: 5, episode: 1 }, null, 300);
  assert.equal(app.episodeCode(all.lost), 'S05E01');
  assert.deepEqual(plain(app.recordEpisode({}, 'x', 'X', { season: 2, pack: true }, null, 1)), {}, 'un pack n\'est pas un épisode vu');

  const fromWatched = app.seriesFromWatched({
    abc: { total: 3, files: { 'Lost.S04E11.mkv': 10, 'Lost.S04E12.mkv': 20 } },
    def: { total: 1, files: { 'Tanguy.2001.mkv': 30 } }
  });
  assert.deepEqual(plain(Object.keys(fromWatched)), ['lost']);
  assert.equal(app.episodeCode(fromWatched.lost), 'S04E12');
});

test('releases d\'une série : titre exact, titres connus et même affiche, sans les homonymes', () => {
  const releases = [
    rel('1', 'Lost.S06.MULTI.1080p', '2026-04-21T21:00:00Z', 'https://image.tmdb.org/t/p/w500/lost.jpg'),
    rel('2', 'Lost.Les.Disparus.S05.MULTI.720p', '2026-03-01T10:00:00Z', 'https://image.tmdb.org/t/p/w342/lost.jpg'),
    rel('3', 'Lost.Girl.S01.MULTI.1080p', '2026-05-01T10:00:00Z', 'https://image.tmdb.org/t/p/w500/girl.jpg'),
    rel('4', 'Lost.in.Space.S03.MULTI', '2026-05-02T10:00:00Z', 'https://image.tmdb.org/t/p/w500/space.jpg'),
    rel('1', 'Lost.S06.MULTI.1080p', '2026-04-21T21:00:00Z', 'https://image.tmdb.org/t/p/w500/lost.jpg')
  ];
  const matched = app.matchSeriesReleases({ title: 'Lost', names: [], posters: [] }, releases);
  assert.deepEqual(plain(matched.map((r) => r.infoHash)), ['1', '2']);
  const viaAlias = app.matchSeriesReleases({ title: 'Lost', names: ['lost les disparus'], posters: [] }, [releases[1]]);
  assert.equal(viaAlias.length, 1, 'titre français connu grâce à la release téléchargée');
});

test('résumé : nouveautés d\'abord, nombre de nouveautés, dernière sortie et affiche', () => {
  const series = { title: 'Show', season: 2, episode: 3, at: Date.parse('2026-05-01') };
  const summary = app.seriesSummary(series, [
    rel('a', 'Show.S02E03.1080p', '2026-04-01T00:00:00Z', 'p1'),
    rel('b', 'Show.S02E04.1080p', '2026-06-01T00:00:00Z', 'p2'),
    rel('c', 'Show.S02E04.720p', '2026-06-02T00:00:00Z', ''),
    rel('d', 'Show.S02E05.1080p', '2026-06-08T00:00:00Z', 'p3'),
    rel('e', 'Show.S01.MULTI', '2026-01-01T00:00:00Z', 'p0')
  ]);
  assert.deepEqual(plain(summary.releases.map((a) => a.release.infoHash)), ['d', 'c', 'b', 'a', 'e']);
  assert.equal(summary.newCount, 2, 'S02E04 (deux releases) et S02E05');
  assert.equal(summary.latestAt, Date.parse('2026-06-08T00:00:00Z'));
  assert.equal(summary.posterUrl, 'p3');
  assert.equal(app.seriesSummary(series, []).newCount, 0);
});

test('ne plus suivre une série', () => {
  const all = { lost: { title: 'Lost' }, 'young sheldon': { title: 'Young Sheldon' } };
  assert.deepEqual(plain(Object.keys(app.removeSeries(all, 'lost'))), ['young sheldon']);
  assert.deepEqual(plain(Object.keys(app.removeSeries(all, 'inconnue'))), ['young sheldon']);
});

test('onglet Suivi : pas un filtre envoyé à c411', () => {
  assert.equal(app.isFollowMode({ subcat: 'follow' }), true);
  assert.equal(app.filterParams({ subcat: 'follow', year: '', genre: '' }).subcat, '');
});
