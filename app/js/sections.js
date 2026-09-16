// Navigation : les deux sections de l'app (Catalogue, Bibliothèque), leurs sous-onglets et la recherche,
// propre à chaque section. Ce fichier ne contient que l'état et des fonctions pures : l'affichage de
// l'en-tête est dans nav.js, les contenus dans catalog.js et library.js.

state.section = 'catalog';                          // 'catalog' | 'library'
state.tab = { catalog: 'home', library: 'all' };    // sous-onglet retenu pour chacune des deux sections
state.query = { catalog: '', library: '' };         // recherche en cours dans chaque section
state.seriesOpen = null;                            // releases d'une série suivie affichées en place (index dans state.follow.list)

function currentTab() { return state.tab[state.section]; }

// Vrai quand la section Catalogue montre ce sous-onglet (les modes « Pour vous », « Suivi » et « En attente »
// ne sont plus des filtres c411 : ils dépendent de l'onglet affiché)
function onCatalogTab(tab) { return state.section === 'catalog' && currentTab() === tab; }

// Onglets dont le contenu est une liste déjà en mémoire : la recherche y filtre sur place, sans appeler c411
function isLocalFilterTab(tab) { return tab === 'foryou' || tab === 'follow' || tab === 'later'; }

// Ce que propose la barre de recherche selon l'endroit où l'on se trouve
function searchPlaceholder(section, tab) {
  if (section === 'library') return 'Rechercher dans la bibliothèque…';
  return isLocalFilterTab(tab) ? 'Filtrer la liste…' : 'Rechercher sur c411…';
}

function foldText(text) {
  return String(text == null ? '' : text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Filtrage local : sans casse ni accents (« Dûne » trouve « dune »). Une requête vide laisse tout passer.
function matchesQuery(text, q) {
  var needle = foldText(q).trim();
  return !needle || foldText(text).indexOf(needle) >= 0;
}

// Filtres du catalogue appliqués à un item déjà en mémoire (recommandations, file d'attente, releases d'une série).
// Le genre est ignoré : seule la fiche d'un titre le porte, pas les items de liste.
function itemMatchesFilters(item, f) {
  if (!item || !f) return true;
  if (f.subcat) {
    var sub = item.subcategory && (item.subcategory.id || item.subcategory);
    // Un item sans sous-catégorie passe : c411 ne la renvoie pas toujours
    if (sub && f.subcat.split(',').map(Number).indexOf(Number(sub)) < 0) return false;
  }
  if (f.year && prettyName(item.name).year !== f.year) return false;
  return true;
}

// Sous-onglet de la Bibliothèque retenant ce média (« all » ne trie pas)
function inLibraryTab(m, tab) { return tab === 'all' || libraryKind(m) === tab; }

// Rangement d'un média de la Bibliothèque : dossier d'épisodes ou nom d'épisode → séries, sinon films
function libraryKind(m) {
  if (!m) return 'films';
  if (m.kind === 'folder') return 'series';
  var info = episodeInfo(m.name);
  return info && info.episode != null ? 'series' : 'films';
}
