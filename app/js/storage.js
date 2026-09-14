// Données mémorisées sur la TV (localStorage) : fichiers vus, positions de lecture, préférences de pistes.

var PREFS_KEY = 'c411free.trackPrefs';
var WATCHED_KEY = 'c411free.watched';
var WATCHED_RATIO = 0.25; // un fichier est « vu » au-delà de 25 % de sa durée
var MEDIA_VIEW_KEY = 'c411free.mediaView';

// ---------- Vue des Médias : vignettes (par défaut) ou liste ----------
function loadMediaView() { try { return localStorage.getItem(MEDIA_VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch (e) { return 'grid'; } }
function saveMediaView(view) { try { localStorage.setItem(MEDIA_VIEW_KEY, view); } catch (e) { /* stockage indisponible */ } }

// ---------- Fichiers vus (mémorisés sur la TV) ----------
// { "<info_hash ou id de tâche>": { total: <nombre de vidéos>, files: { "<nom du fichier>": <horodatage> } } }
function taskKey(task) { return String(task.info_hash || task.id).toLowerCase(); }
function loadWatched() { try { return JSON.parse(localStorage.getItem(WATCHED_KEY)) || {}; } catch (e) { return {}; } }
function saveWatched(all) { try { localStorage.setItem(WATCHED_KEY, JSON.stringify(all)); } catch (e) { /* stockage indisponible */ } }
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
function loadPositions() { try { return JSON.parse(localStorage.getItem(POSITIONS_KEY)) || {}; } catch (e) { return {}; } }
function storePositions(all) { try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(all)); } catch (e) { /* stockage indisponible */ } }
function savedPosition(task, file) { var p = loadPositions()[positionKey(task, file)]; return p && p.pos > 0 ? p.pos : 0; }

function clearPosition(task, file) {
  var all = loadPositions(), key = positionKey(task, file);
  if (all[key]) { delete all[key]; storePositions(all); }
}

function persistPosition(cur, dur) {
  if (!player.file || !dur) return;
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

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } }
function savePrefs(patch) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.assign(loadPrefs(), patch))); } catch (e) { /* stockage indisponible */ } }
