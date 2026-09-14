import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp } from './load.mjs';

const app = loadApp(['spatial.js']);
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

// Tiroir des filtres (dimensions proches de l'écran réel), puis la première rangée de vignettes juste en dessous
const TOUT = box(250, 200, 150, 80), FILMS = box(418, 200, 170, 80), SERIES = box(606, 200, 180, 80);
const ANIMATION = box(804, 200, 230, 80), DOCS = box(1052, 200, 280, 80);
const ANNEE = box(250, 310, 340, 80), GENRE = box(742, 310, 380, 80), RESET = box(1560, 310, 240, 80);
const CARDS = [0, 1, 2, 3, 4, 5, 6].map((col) => box(80 + col * 256, 450, 230, 400));
const screen = [TOUT, FILMS, SERIES, ANIMATION, DOCS, ANNEE, GENRE, RESET, ...CARDS];

// Élément choisi depuis `from` (undefined si aucun), comme le fait move() : les autres éléments comme candidats
const pick = (from, dir, rects = screen) => {
  const others = rects.filter((r) => r !== from);
  return others[app.spatialPick(from, others, dir)];
};

test('◀ ▶ restent sur la rangée : Année ▶ Genre, pas Séries', () => {
  assert.equal(pick(ANNEE, 'right'), GENRE);
  assert.equal(pick(GENRE, 'right'), RESET);
  assert.equal(pick(GENRE, 'left'), ANNEE);
  assert.equal(pick(FILMS, 'right'), SERIES);
  assert.equal(pick(DOCS, 'right'), RESET, 'bout de la rangée : vers la rangée la plus proche');
});

test('▼ va sur la rangée suivante : Documentaires ▼ Genre, pas une vignette', () => {
  assert.equal(pick(DOCS, 'down'), GENRE);
  assert.equal(pick(FILMS, 'down'), ANNEE);
  assert.equal(pick(TOUT, 'down'), ANNEE);
  assert.equal(pick(RESET, 'down'), CARDS[6], 'dernière ligne du tiroir : vignette la plus proche');
  assert.equal(pick(ANNEE, 'down'), CARDS[1]);
});

test('▲ remonte sur la rangée précédente, au plus proche horizontalement', () => {
  assert.equal(pick(GENRE, 'up'), ANIMATION);
  assert.equal(pick(CARDS[0], 'up'), ANNEE);
  assert.equal(pick(CARDS[4], 'up'), GENRE);
  assert.equal(pick(TOUT, 'up'), undefined);
});

test('défilement : juste ce qu\'il faut pour montrer l\'élément avec sa marge', () => {
  // Liste de 900 px de haut, défilée à 1000 ; marge 60
  assert.equal(app.scrollTargetFor(1200, 1600, 1000, 900, 60), null, 'déjà visible');
  assert.equal(app.scrollTargetFor(1700, 2100, 1000, 900, 60), 1260, 'en dessous : le bas de l\'élément arrive en bas de la liste');
  assert.equal(app.scrollTargetFor(700, 1100, 1000, 900, 60), 640, 'au-dessus : le haut de l\'élément arrive en haut');
  assert.equal(app.scrollTargetFor(20, 400, 300, 900, 60), 0, 'jamais au-dessus du début');
  assert.equal(app.easeOutCubic(0), 0);
  assert.equal(app.easeOutCubic(1), 1);
  assert.ok(app.easeOutCubic(0.5) > 0.8, 'ralentit à l\'arrivée');
});

test('grille de vignettes : même colonne en ▲ ▼, pas de saut de rangée en ◀ ▶', () => {
  const cards = [0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((col) => box(100 + col * 250, 500 + row * 420, 230, 400)));
  assert.equal(pick(cards[1], 'right', cards), cards[2]);
  assert.equal(pick(cards[1], 'down', cards), cards[5]);
  assert.equal(pick(cards[6], 'up', cards), cards[2]);
  assert.equal(pick(cards[4], 'left', cards), undefined, 'début de rangée');
  assert.equal(pick(cards[3], 'right', cards), undefined, 'fin de rangée');
});
