import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp } from './load.mjs';

const app = loadApp(['spatial.js']);
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

// Tiroir des filtres : rangée des types, puis Année · Genre · Réinitialiser
const TOUT = box(200, 200, 120, 80), FILMS = box(340, 200, 130, 80), SERIES = box(490, 200, 140, 80);
const ANNEE = box(200, 310, 340, 80), GENRE = box(760, 310, 340, 80), RESET = box(1500, 310, 240, 80);
const drawer = [TOUT, FILMS, SERIES, ANNEE, GENRE, RESET];
// Élément choisi depuis `from` (undefined si aucun), comme le fait move() : les autres éléments comme candidats
const pick = (from, dir, rects = drawer) => {
  const others = rects.filter((r) => r !== from);
  return others[app.spatialPick(from, others, dir)];
};

test('◀ ▶ restent sur la rangée : Année ▶ Genre, pas Séries', () => {
  assert.equal(pick(ANNEE, 'right'), GENRE);
  assert.equal(pick(GENRE, 'right'), RESET);
  assert.equal(pick(GENRE, 'left'), ANNEE);
  assert.equal(pick(FILMS, 'right'), SERIES);
});

test('◀ ▶ changent de rangée seulement s\'il n\'y a rien sur la même', () => {
  assert.equal(pick(SERIES, 'right'), GENRE, 'bout de la rangée des types : vers la rangée la plus proche');
  assert.equal(pick(RESET, 'right'), undefined, 'rien à droite');
});

test('▲ ▼ : le plus proche verticalement', () => {
  assert.equal(pick(FILMS, 'down'), ANNEE);
  assert.equal(pick(GENRE, 'up'), SERIES);
});

test('grille de vignettes', () => {
  const cards = [0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((col) => box(100 + col * 250, 500 + row * 420, 230, 400)));
  assert.equal(pick(cards[1], 'right', cards), cards[2]);
  assert.equal(pick(cards[1], 'down', cards), cards[5]);
  assert.equal(pick(cards[4], 'left', cards), undefined, 'début de rangée');
  assert.equal(pick(cards[3], 'right', cards), undefined, 'fin de rangée : ne saute pas à la rangée suivante');
});
