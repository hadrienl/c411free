// Données mémorisées sur la TV (localStorage) : fichiers vus, positions de lecture, préférences de pistes.

var PREFS_KEY = 'c411free.trackPrefs';
var WATCHED_KEY = 'c411free.watched';
var WATCHED_RATIO = 0.25; // un fichier est « vu » au-delà de 25 % de sa durée
var MEDIA_VIEW_KEY = 'c411free.mediaView';
var INTRO_SKIPS_KEY = 'c411free.introSkips';
var INTRO_SKIPS_MAX = 100;

// ---------- Génériques de début appris par série ----------
// { "<série normalisée>": { start: ms, end: ms, at: horodatage } }
function loadIntroSkips() { try { return JSON.parse(localStorage.getItem(INTRO_SKIPS_KEY)) || {}; } catch (e) { return {}; } }

function saveIntroSkip(key, skip) {
  var all = loadIntroSkips();
  all[key] = { start: Math.round(skip.start), end: Math.round(skip.end), at: Date.now() };
  var keys = Object.keys(all);
  if (keys.length > INTRO_SKIPS_MAX) {
    keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - INTRO_SKIPS_MAX).forEach(function (k) { delete all[k]; });
  }
  try { localStorage.setItem(INTRO_SKIPS_KEY, JSON.stringify(all)); } catch (e) { /* stockage indisponible */ }
}

function learnedIntro(key) {
  var s = key && loadIntroSkips()[key];
  return s ? { start: s.start, end: s.end, source: 'appris' } : null;
}

// ---------- Vue des Médias : vignettes (par défaut) ou liste ----------
function loadMediaView() { try { return localStorage.getItem(MEDIA_VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch (e) { return 'grid'; } }
function saveMediaView(view) { try { localStorage.setItem(MEDIA_VIEW_KEY, view); } catch (e) { /* stockage indisponible */ } }

// ---------- Fichiers vus (mémorisés sur la TV) ----------
// { "<info_hash ou id de tâche>": { total: <nombre de vidéos>, files: { "<nom du fichier>": <horodatage> } } }
function taskKey(task) { return String(task.info_hash || task.id).toLowerCase(); }
function loadWatched() { try { return JSON.parse(localStorage.getItem(pkey(WATCHED_KEY))) || {}; } catch (e) { return {}; } }
function saveWatched(all) { try { localStorage.setItem(pkey(WATCHED_KEY), JSON.stringify(all)); } catch (e) { /* stockage indisponible */ } }
function watchedEntry(task) { return loadWatched()[taskKey(task)] || { total: 0, files: {} }; }
function isWatched(task, fileName) { return !!watchedEntry(task).files[fileName]; }

function setVideoCount(task, total) {
  var all = loadWatched(), entry = all[taskKey(task)];
  if (entry && entry.total !== total) { entry.total = total; saveWatched(all); }
  state.videoCounts = state.videoCounts || {};
  state.videoCounts[taskKey(task)] = total;
}

function markWatched(task, fileName) {
  var all = loadWatched(), key = taskKey(task);
  var entry = all[key] || { total: (state.videoCounts && state.videoCounts[key]) || 1, files: {} };
  if (entry.files[fileName]) return;
  entry.files[fileName] = Date.now();
  all[key] = entry;
  saveWatched(all);
  if (typeof noteSeriesProgress === 'function') noteSeriesProgress(task, fileName); // suivi des séries (series.js)
  debug('info', 'fichier marqué vu', { task: key, file: fileName });
}

// « 👁 Vu » pour un film, « 👁 3/10 vus » pour une saison
function watchedBadge(task) {
  var entry = watchedEntry(task), seen = Object.keys(entry.files).length;
  if (!seen) return '';
  return entry.total > 1 ? '👁 ' + seen + '/' + entry.total + ' vus' : '👁 Vu';
}

// ---------- Reprise de lecture (positions mémorisées sur la TV) ----------
// { "<info_hash>|<nom du fichier>": { pos: ms, dur: ms, at: horodatage } }
var POSITIONS_KEY = 'c411free.positions';
var RESUME_MIN_MS = 10000;     // en dessous : rien à reprendre
var RESUME_DONE_RATIO = 0.95;  // au-delà : fichier considéré comme terminé
var POSITIONS_MAX = 200;

function positionKey(task, file) { return (task ? taskKey(task) : 'fichier') + '|' + file.name; }
function loadPositions() { try { return JSON.parse(localStorage.getItem(pkey(POSITIONS_KEY))) || {}; } catch (e) { return {}; } }
function storePositions(all) { try { localStorage.setItem(pkey(POSITIONS_KEY), JSON.stringify(all)); } catch (e) { /* stockage indisponible */ } }
function savedPosition(task, file) {
  if (file.url) return 0; // bande-annonce : toujours depuis le début
  var p = loadPositions()[positionKey(task, file)];
  return p && p.pos > 0 ? p.pos : 0;
}

// Avancement d'un fichier commencé mais pas terminé (position de reprise mémorisée) : entre 0 et 1, 0 sinon
function startedRatio(task, file) {
  var p = loadPositions()[positionKey(task, file)];
  return p && p.pos > 0 && p.dur > 0 ? Math.min(1, p.pos / p.dur) : 0;
}

function clearPosition(task, file) {
  var all = loadPositions(), key = positionKey(task, file);
  if (all[key]) { delete all[key]; storePositions(all); }
}

function persistPosition(cur, dur) {
  if (!player.file || !dur || player.file.url) return; // pas de reprise pour une bande-annonce
  var all = loadPositions(), key = positionKey(player.task, player.file);
  if (cur / dur >= RESUME_DONE_RATIO || cur < RESUME_MIN_MS) {
    delete all[key];
  } else {
    all[key] = { pos: Math.floor(cur), dur: Math.floor(dur), at: Date.now() };
    var keys = Object.keys(all);
    if (keys.length > POSITIONS_MAX) {
      keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - POSITIONS_MAX).forEach(function (k) { delete all[k]; });
    }
  }
  storePositions(all);
}

function loadPrefs() { try { return JSON.parse(localStorage.getItem(pkey(PREFS_KEY))) || {}; } catch (e) { return {}; } }
function savePrefs(patch) { try { localStorage.setItem(pkey(PREFS_KEY), JSON.stringify(Object.assign(loadPrefs(), patch))); } catch (e) { /* stockage indisponible */ } }
