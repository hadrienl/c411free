import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'posters.js', 'intro.js', 'filters.js', 'series.js', 'sections.js']);

test('la barre de recherche annonce ce qu\'elle cherche', () => {
  assert.equal(app.searchPlaceholder('catalog', 'home'), 'Rechercher sur c411…');
  assert.equal(app.searchPlaceholder('catalog', 'foryou'), 'Filtrer la liste…');
  assert.equal(app.searchPlaceholder('catalog', 'follow'), 'Filtrer la liste…');
  assert.equal(app.searchPlaceholder('catalog', 'later'), 'Filtrer la liste…');
  assert.equal(app.searchPlaceholder('library', 'films'), 'Rechercher dans la bibliothèque…');
  assert.equal(app.searchPlaceholder('library', 'series'), 'Rechercher dans la bibliothèque…');
});

test('onglets filtrés sur place, sans appeler c411', () => {
  assert.equal(app.isLocalFilterTab('foryou'), true);
  assert.equal(app.isLocalFilterTab('follow'), true);
  assert.equal(app.isLocalFilterTab('later'), true);
  assert.equal(app.isLocalFilterTab('home'), false);
});

test('filtrage local : sans casse ni accents', () => {
  assert.equal(app.matchesQuery('Dûne', 'dune'), true);
  assert.equal(app.matchesQuery('Dune', 'DÛNE'), true);
  assert.equal(app.matchesQuery('Le Cœur battant', 'cœur'), true);
  assert.equal(app.matchesQuery('Dune', 'partie'), false);
  assert.equal(app.matchesQuery('Dune', ''), true, 'requête vide : tout passe');
  assert.equal(app.matchesQuery('Dune', '   '), true);
  assert.equal(app.matchesQuery('', 'dune'), false);
});

test('filtres du catalogue appliqués à un item déjà en mémoire', () => {
  const film = { name: 'Fracture.2024.MULTI.1080p', subcategory: { id: 6 } };
  const serie = { name: 'Nova.Terra.S01E02.2023.1080p', subcategory: 7 };
  const sansSub = { name: 'Brume.Rouge.2022.1080p' };
  const films = { subcat: '6', year: '', genre: '' };
  assert.equal(app.itemMatchesFilters(film, films), true);
  assert.equal(app.itemMatchesFilters(serie, films), false);
  assert.equal(app.itemMatchesFilters(sansSub, films), true, 'sous-catégorie absente : on garde l\'item');
  assert.equal(app.itemMatchesFilters(serie, { subcat: '1,2,7', year: '', genre: '' }), true, 'plusieurs sous-catégories');
  assert.equal(app.itemMatchesFilters(film, { subcat: '', year: '2024', genre: '' }), true);
  assert.equal(app.itemMatchesFilters(film, { subcat: '', year: '2023', genre: '' }), false);
  assert.equal(app.itemMatchesFilters(film, { subcat: '6', year: '2024', genre: '39' }), true, 'genre ignoré : les items de liste ne le portent pas');
  assert.equal(app.itemMatchesFilters(film, app.emptyFilters()), true);
  assert.equal(app.itemMatchesFilters(null, films), true);
});

test('rangement d\'un média entre films et séries', () => {
  const folder = { kind: 'folder', name: 'Lost.S04.MULTI' };
  const episode = { kind: 'file', name: 'Nova.Terra.S01E02.1080p.mkv' };
  const film = { kind: 'file', name: 'Inception.2010.MULTI.1080p.mkv' };
  assert.equal(app.libraryKind(folder), 'series');
  assert.equal(app.libraryKind(episode), 'series');
  assert.equal(app.libraryKind(film), 'films');
  assert.equal(app.libraryKind(null), 'films');

  assert.equal(app.state.tab.library, 'all', 'la Bibliothèque s\'ouvre sur « Tout »');
  [folder, episode, film].forEach((m) => assert.equal(app.inLibraryTab(m, 'all'), true, '« Tout » ne trie pas'));
  assert.equal(app.inLibraryTab(film, 'films'), true);
  assert.equal(app.inLibraryTab(film, 'series'), false);
  assert.equal(app.inLibraryTab(folder, 'series'), true);
});
