// Historique de visionnage du profil : jusqu'où chaque fichier a été regardé, pour mesurer l'intérêt montré pour un film
// ou une série (base des recommandations). Alimenté pendant la lecture ; les bandes-annonces n'y entrent pas.

var HISTORY_KEY = 'c411free.history';
var HISTORY_MAX = 300;
var INTEREST_HALF_LIFE_DAYS = 120;

// Identité d'un titre regardé : série (titre avant SxxEyy, sinon nom du dossier) ou film (titre et année)
function viewIdentity(fileName, folderName) {
  var info = episodeInfo(fileName, !!folderName);
  if (info && info.episode != null) {
    var key = seriesKey(fileName, folderName);
    return key ? { key: 'serie:' + key, title: seriesTitle(fileName, folderName), year: '', isSeries: true } : null;
  }
  var n = prettyName(String(fileName || '').replace(/^\[[^\]]*\][\s._\-]*/, ''));
  var title = normTitle(n.title);
  if (!title) return null;
  return { key: 'film:' + title + (n.year ? '|' + n.year : ''), title: n.title, year: n.year, isSeries: false };
}

// Avancement d'un fichier (0 à 1, on garde le plus loin atteint) ; historique limité aux titres les plus récents
function recordView(hist, identity, fileName, ratio, nowMs, infoHash) {
  if (!identity || !(ratio > 0)) return hist;
  var e = hist[identity.key] || { title: identity.title, year: identity.year || '', isSeries: identity.isSeries, files: {}, lastAt: 0 };
  e.files[fileName] = Math.max(e.files[fileName] || 0, Math.min(1, Math.round(ratio * 100) / 100));
  e.lastAt = Math.max(e.lastAt, nowMs);
  if (infoHash) e.infoHash = String(infoHash).toLowerCase();
  hist[identity.key] = e;
  var keys = Object.keys(hist);
  if (keys.length > HISTORY_MAX) {
    keys.sort(function (a, b) { return hist[a].lastAt - hist[b].lastAt; }).slice(0, keys.length - HISTORY_MAX).forEach(function (k) { delete hist[k]; });
  }
  return hist;
}

// Intérêt montré (0 à 1) : film abandonné < film vu en entier ; série d'autant plus que des épisodes ont été vraiment regardés ;
// atténué avec le temps (moitié au bout de INTEREST_HALF_LIFE_DAYS)
function engagement(entry, nowMs) {
  var ratios = Object.keys(entry.files || {}).map(function (k) { return entry.files[k]; });
  if (!ratios.length) return 0;
  var best = Math.max.apply(null, ratios), base;
  if (entry.isSeries) {
    var watched = ratios.filter(function (r) { return r >= 0.5; }).length;
    base = watched ? Math.min(1, 0.35 + 0.08 * watched) : best * 0.3;
  } else {
    base = best < 0.1 ? 0 : best < 0.4 ? 0.15 : best < 0.85 ? 0.2 + best * 0.6 : 1;
  }
  var days = Math.max(0, (nowMs - entry.lastAt) / 86400000);
  return base * Math.pow(0.5, days / INTEREST_HALF_LIFE_DAYS);
}

// Reprise de l'historique « vu » (fichiers vus au-delà de 25 %, avancement exact inconnu : compté à moitié)
function historyFromWatched(watched) {
  var hist = {};
  Object.keys(watched || {}).forEach(function (k) {
    var files = (watched[k] && watched[k].files) || {};
    Object.keys(files).forEach(function (name) { recordView(hist, viewIdentity(name, ''), name, 0.5, files[name]); });
  });
  return hist;
}

// Signature courte de ce qui compte pour les recommandations (titres et épisodes vraiment regardés)
function historySignature(hist) {
  var text = Object.keys(hist).sort().map(function (k) {
    var files = hist[k].files || {};
    return k + ':' + Object.keys(files).filter(function (f) { return files[f] >= 0.5; }).length + ':' + Math.round(Math.max.apply(null, Object.keys(files).map(function (f) { return files[f]; }).concat([0])) * 10);
  }).join(',');
  var h = 5381;
  for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + Object.keys(hist).length;
}

// ---------- Mémoire (par profil) ----------
function loadHistory() { try { return JSON.parse(localStorage.getItem(pkey(HISTORY_KEY))) || {}; } catch (e) { return {}; } }
function saveHistory(hist) { try { localStorage.setItem(pkey(HISTORY_KEY), JSON.stringify(hist)); } catch (e) { /* stockage indisponible */ } }

function ensureHistoryBackfill() {
  if (Object.keys(loadHistory()).length) return;
  var hist = historyFromWatched(loadWatched());
  if (Object.keys(hist).length) saveHistory(hist);
}

// Lecture en cours : avancement du fichier (appelé par le lecteur)
function recordPlayback(ratio) {
  if (typeof player === 'undefined' || !player.file || player.file.url) return; // bande-annonce : ignorée
  var ft = state.filesTask;
  var identity = viewIdentity(player.file.name, player.returnTo === 'files' && ft ? ft.task.name : '');
  if (!identity) return;
  saveHistory(recordView(loadHistory(), identity, player.file.name, ratio, Date.now(), player.task && player.task.info_hash));
}
