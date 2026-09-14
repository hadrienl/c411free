import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'storage.js', 'posters.js', 'intro.js']);
const chapters = (...pairs) => pairs.map(([s, name]) => ({ at: s * 1000, name }));

// Motifs de chapitres relevés sur les épisodes des disques
const ANIME = chapters([0, 'OP'], [91, 'Part A'], [823, 'Part B'], [1348, 'ED'], [1438, 'Preview']);
const ANIME_COLD_OPEN = chapters([0, 'Intro'], [434, 'OP'], [524, 'Part A'], [844, 'Part B'], [1438, 'ED'], [1528, 'Preview']);
const SERIES = chapters([0, 'Chapter 1'], [455, 'Intro'], [478, 'Chapter 2'], [3667, 'End Credits']);
const CREDITS_ONLY = chapters([0, 'Chapter 1'], [3329, 'End Credits']);

test('générique de début d\'après les chapitres', () => {
  assert.deepEqual(plain(app.introFromChapters(ANIME, 1470000)), { start: 0, end: 91000, source: 'chapitres' });
  assert.deepEqual(plain(app.introFromChapters(ANIME_COLD_OPEN, 1560000)), { start: 434000, end: 524000, source: 'chapitres' }, 'OP prioritaire sur Intro');
  assert.deepEqual(plain(app.introFromChapters(SERIES, 3700000)), { start: 455000, end: 478000, source: 'chapitres' });
  assert.equal(app.introFromChapters(CREDITS_ONLY, 3400000), null);
  assert.equal(app.introFromChapters(chapters([0, 'Générique de fin']), 60000), null, 'un générique de fin n\'est pas une ouverture');
  assert.equal(app.introFromChapters([], 1000000), null);
});

test('générique de fin d\'après les chapitres', () => {
  assert.equal(app.creditsFromChapters(ANIME, 1470000), 1348000);
  assert.equal(app.creditsFromChapters(CREDITS_ONLY, 3400000), 3329000);
  assert.equal(app.creditsFromChapters(chapters([0, 'Chapter 1']), 3400000), null);
});

test('série d\'un épisode', () => {
  assert.equal(app.seriesKey('Lost.S04E02.MULTI.1080p.mkv', ''), 'lost');
  assert.equal(app.seriesKey('[EBD].Fullmetal.Alchemist.Brotherhood.01.[Bluray].mkv', 'Fullmetal.Alchemist.Brotherhood'), 'fullmetal alchemist brotherhood');
  assert.equal(app.seriesKey('Episode.mkv', 'Le Coeur — Saison 1'), 'le coeur');
  assert.equal(app.seriesKey('Tanguy.2001.mkv', ''), null, 'un film n\'a pas de générique appris');
});

test('apprentissage : sauts enchaînés au début d\'un épisode', () => {
  let pending = app.trackSkip(null, 60000, 90000, 0);
  pending = app.trackSkip(pending, 91000, 121000, 1000);
  pending = app.trackSkip(pending, 122000, 152000, 2000);
  assert.equal(app.learnedSkip(pending, 5000), null, 'saut pas encore terminé');
  assert.deepEqual(plain(app.learnedSkip(pending, 8000)), { start: 60000, end: 152000 });

  const corrected = app.trackSkip(pending, 153000, 140000, 3000);
  assert.deepEqual(plain(app.learnedSkip(corrected, 9000)), { start: 60000, end: 140000 }, 'dépassement puis retour : arrivée finale retenue');
  assert.equal(app.trackSkip(null, 150000, 140000, 3000), null, 'retour en arrière isolé : ignoré');
  assert.equal(app.learnedSkip(app.trackSkip(app.trackSkip(null, 60000, 90000, 0), 91000, 50000, 1000), 9000), null, 'revenu avant le départ : rien appris');
  assert.equal(app.learnedSkip(app.trackSkip(null, 10 * 60000, 10 * 60000 + 30000, 0), 9000), null, 'trop tard dans l\'épisode');
  assert.equal(app.learnedSkip(app.trackSkip(null, 60000, 70000, 0), 9000), null, 'trop court');
  assert.equal(app.learnedSkip(app.trackSkip(null, 60000, 600000, 0), 9000), null, 'trop long : pas un générique');
  const separate = app.trackSkip(app.trackSkip(null, 60000, 90000, 0), 91000, 121000, 7000);
  assert.deepEqual(plain(separate), { start: 91000, end: 121000, lastAt: 7000 }, 'saut trop tardif : nouveau saut');
});

test('fenêtre d\'affichage du bouton et mémorisation par série', () => {
  assert.deepEqual(plain(app.introWindow({ start: 0, end: 91000, source: 'chapitres' })), { from: 0, to: 89000 });
  assert.deepEqual(plain(app.introWindow({ start: 60000, end: 152000, source: 'appris' })), { from: 55000, to: 147000 });
  assert.equal(app.introWindow(null), null);

  assert.equal(app.learnedIntro('lost'), null);
  app.saveIntroSkip('lost', { start: 60000.4, end: 152000 });
  assert.deepEqual(plain(app.learnedIntro('lost')), { start: 60000, end: 152000, source: 'appris' });
});
