// Filtres du catalogue c411 : type (sous-catégories), année de sortie et genre (option « genre » de la catégorie vidéo).
// API : /api/torrents?subcat=1,2 (l'une ou l'autre) &year=2020 &options=<valeur d'option> ; combinés entre eux.

var GENRES_KEY = 'c411free.genres';
var GENRES_MAX_AGE = 7 * 24 * 3600 * 1000;
var FILTER_MIN_YEAR = 1920;
var FILTER_TYPES = [
  { subcat: '', label: 'Tout' },
  { subcat: '6', label: 'Films' },
  { subcat: '7', label: 'Séries' },
  { subcat: '1,2', label: 'Animation' },
  { subcat: '4,57', label: 'Documentaires' },
  { subcat: 'foryou', label: 'Pour vous' }, // recommandations du profil (pas un filtre c411)
  { subcat: 'follow', label: 'Suivi' },     // séries regardées et leurs nouveaux épisodes (pas un filtre c411)
  { subcat: 'later', label: 'En attente' }  // file d'attente « plus tard » (pas un filtre c411)
];

function isFollowMode(f) { return !!f && f.subcat === 'follow'; }
function isForYouMode(f) { return !!f && f.subcat === 'foryou'; }
function isLaterMode(f) { return !!f && f.subcat === 'later'; }
var FILTER_ICON = '<svg class="ico" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';

function emptyFilters() { return { subcat: '', year: '', genre: '' }; }

// Paramètres ajoutés à /api/torrents (les valeurs vides sont ignorées par c411())
function filterParams(f) {
  // Seules les vraies sous-catégories (« 6 », « 1,2 ») partent vers c411 ; « Pour vous » et « Suivi » sont des modes de l'app
  return { subcat: (f && /^[\d,]+$/.test(f.subcat || '') ? f.subcat : ''), year: (f && f.year) || '', options: (f && f.genre) || '' };
}

function activeFilterCount(f) {
  return ['subcat', 'year', 'genre'].filter(function (k) { return f && f[k]; }).length;
}

// Années proposées, de la plus récente à la plus ancienne
function yearChoices(currentYear, minYear) {
  var years = [];
  for (var y = currentYear; y >= (minYear || FILTER_MIN_YEAR); y--) years.push(y);
  return years;
}

// Genres proposés par c411 pour la catégorie vidéo (/api/categories/1/options), triés par nom
function genresFromOptions(options) {
  var genre = (options || []).filter(function (o) { return o.slug === 'genre'; })[0];
  return genre ? genre.values.map(function (v) { return { id: v.id, name: v.value }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }) : [];
}

// Libellé court des filtres actifs : « Films · 2020 · Action »
function filterSummary(f, genres) {
  var type = FILTER_TYPES.filter(function (t) { return t.subcat === (f.subcat || ''); })[0];
  return [f.subcat && type ? type.label : '', f.year || '', f.genre ? genreName(f.genre, genres) : ''].filter(Boolean).join(' · ');
}

var genresCache = null;
function genreName(id, genres) {
  var g = (genres || genresCache || []).filter(function (x) { return String(x.id) === String(id); })[0];
  return g ? g.name : '';
}

// Liste des genres : mémoire, puis cache sur la TV (une semaine), puis c411
async function loadGenres() {
  if (genresCache && genresCache.length) return genresCache;
  try {
    var cached = JSON.parse(localStorage.getItem(GENRES_KEY));
    if (cached && Date.now() - cached.at < GENRES_MAX_AGE && cached.genres && cached.genres.length) return (genresCache = cached.genres);
  } catch (e) { /* cache illisible */ }
  try {
    var j = await c411('/api/categories/1/options');
    genresCache = genresFromOptions(j && j.data);
    if (genresCache.length) {
      try { localStorage.setItem(GENRES_KEY, JSON.stringify({ at: Date.now(), genres: genresCache })); } catch (e) { /* stockage indisponible */ }
    }
  } catch (e) {
    debug('error', 'genres c411 : ' + e.message);
  }
  return genresCache || [];
}
