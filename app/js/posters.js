// Affiches des médias : titre recherché sur c411 (affiches TMDB), résultat mémorisé sur la TV.

var POSTERS_KEY = 'c411free.posters';
var POSTER_RETRY_MS = 7 * 24 * 3600 * 1000; // titre sans affiche : nouvel essai au bout d'une semaine
var POSTER_CONCURRENCY = 2;
var COMBINING_MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

// « Le Cœur » / « le coeur » / « Le.Coeur » → « le coeur »
function normTitle(text) {
  return String(text || '').normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Titre et année à rechercher : « Le Coeur — Saison 1 » → Le Coeur, « [EBD].Fullmetal.Alchemist.Brotherhood » → Fullmetal Alchemist Brotherhood
function posterQuery(m) {
  var name = String(m.name || '').split(' — ')[0].replace(/^\[[^\]]*\][\s._\-]*/, '');
  var n = prettyName(name);
  var title = n.title.replace(/[\s\-–]+$/, '').trim();
  if (normTitle(title).length < 2) return null;
  return { title: title, year: n.year, key: normTitle(title) + (n.year ? '|' + n.year : '') };
}

// Meilleure affiche parmi les résultats c411 : même titre, puis même année ; à défaut, le résultat le plus pertinent
function pickPoster(results, q) {
  var want = normTitle(q.title), best = null, bestScore = -1;
  (results || []).forEach(function (r) {
    if (!r.posterUrl) return;
    var n = prettyName(r.name || ''), title = normTitle(n.title);
    var score = (title === want ? 4 : title.indexOf(want) === 0 || want.indexOf(title) === 0 ? 2 : 0) + (q.year && n.year === q.year ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  });
  return best ? best.posterUrl : '';
}

function loadPosterCache() { try { return JSON.parse(localStorage.getItem(POSTERS_KEY)) || {}; } catch (e) { return {}; } }
function savePosterCache(all) { try { localStorage.setItem(POSTERS_KEY, JSON.stringify(all)); } catch (e) { /* stockage plein ou indisponible */ } }

// Affiche connue (url), absente ('') ou à rechercher (null)
function cachedPoster(cache, q, nowMs) {
  if (!q) return '';
  var c = cache[q.key];
  if (!c) return null;
  if (c.url) return c.url;
  return nowMs - c.at < POSTER_RETRY_MS ? '' : null;
}

function rememberPoster(q, url, nowMs) {
  var all = loadPosterCache();
  all[q.key] = { url: url || '', at: nowMs };
  savePosterCache(all);
}

// Recherche les affiches manquantes, POSTER_CONCURRENCY à la fois, tant que isActive() ; onFound(clé, url) met à jour l'écran
var postersRunning = false;
async function fetchPosters(entries, isActive, onFound) {
  if (postersRunning) return;
  postersRunning = true;
  try {
    var cache = loadPosterCache(), now = Date.now(), queued = {};
    var todo = entries.map(posterQuery).filter(function (q) {
      if (!q || queued[q.key] || cachedPoster(cache, q, now) !== null) return false;
      queued[q.key] = true;
      return true;
    });
    while (todo.length && isActive()) {
      await Promise.all(todo.splice(0, POSTER_CONCURRENCY).map(function (q) {
        return c411('/api/torrents', { name: q.title, category: 1, sortBy: 'relevance', perPage: 10, page: 1 }).then(function (j) {
          var url = pickPoster(j && j.data, q);
          rememberPoster(q, url, Date.now());
          if (url) onFound(q.key, url);
        }).catch(function () { /* réseau ou c411 indisponible : nouvel essai à la prochaine ouverture */ });
      }));
    }
  } finally {
    postersRunning = false;
  }
}
