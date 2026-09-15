// Suivi des séries : dernier épisode vu par série (mémorisé sur la TV) et nouveaux épisodes disponibles sur c411.
// Une série est retrouvée sur c411 par son titre exact, ses titres connus (release c411 téléchargée) et, par extension,
// par l'affiche TMDB commune à ses releases (« Lost » → « Lost Les Disparus », mais pas « Lost Girl »).

var SERIES_KEY = 'c411free.series';
var SERIES_MAX = 200;
var SERIES_SUBCATS = '7,2,57'; // Série TV, Animation Série, Série Documentaire
var SERIES_SEARCH_TTL_MS = 20 * 60 * 1000;
var SERIES_SEARCH_CONCURRENCY = 3;

// « Lost.S04E12 » → { season: 4, episode: 12 } ; « Lost.S05.MULTI » → { season: 5, pack: true } ; « INTEGRALE » → { complete: true }.
// inFolder : fichier local rangé dans un dossier de série, numérotation seule acceptée (« Fullmetal…01.[Bluray] »).
function episodeInfo(name, inFolder) {
  var n = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ');
  var m = n.match(/\bS(\d{1,2})\s?E(\d{1,3})(?:\s?-?\s?E?(\d{1,3}))?\b/i);
  if (m) return { season: Number(m[1]), episode: Math.max(Number(m[2]), m[3] ? Number(m[3]) : 0) };
  m = n.match(/\b(\d{1,2})x(\d{2,3})\b/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = n.match(/\bS(\d{1,2})\b/i) || n.match(/\b(?:saison|season)\s?(\d{1,2})\b/i);
  if (m) return { season: Number(m[1]), pack: true };
  if (/\b(int[ée]grale|complete)\b/i.test(n)) return { complete: true };
  m = n.match(/\s-\s(\d{2,3})\b/) || (inFolder ? n.match(/^(?:\[[^\]]*\]\s*)?.*?[a-z].*?\s(\d{2,3})(?=\s|\[|\(|$)/i) : null);
  if (m) return { season: 1, episode: Number(m[1]) };
  return null;
}

function pad2(n) { return ('0' + n).slice(-2); }

// « S04E12 », « Saison 5 », « Intégrale »
function episodeCode(info) {
  if (!info) return '';
  if (info.episode != null && info.season != null) return 'S' + pad2(info.season) + 'E' + pad2(info.episode);
  if (info.pack) return 'Saison ' + info.season;
  return info.complete ? 'Intégrale' : '';
}

// Release plus avancée que le dernier épisode vu : épisode suivant, saison suivante, ou pack de la saison en cours sorti depuis
function isNewer(info, seen, releasedAtMs) {
  if (!info || !seen) return false;
  if (info.episode != null) return info.season > seen.season || (info.season === seen.season && info.episode > seen.episode);
  if (info.pack) return info.season > seen.season || (info.season === seen.season && releasedAtMs > seen.at);
  return false;
}

function episodeRank(info) {
  if (!info) return 0;
  if (info.complete) return 1;
  return info.season * 1000 + (info.episode != null ? info.episode : 999);
}

// Identifiant d'affiche TMDB (même image quelle que soit la taille demandée)
function posterId(url) { return url ? String(url).split('/').pop() : ''; }

function seriesTitle(fileName, folderName) {
  var clean = function (name) { return String(name || '').split(' — ')[0].replace(/^\[[^\]]*\][\s._\-]*/, ''); };
  var n = prettyName(clean(fileName));
  return n.episode || !folderName ? n.title : prettyName(clean(folderName)).title;
}

function addUnique(list, value) { if (value && list.indexOf(value) < 0) list.push(value); }

// Épisode vu : série créée ou avancée jusqu'à l'épisode le plus loin ; alias = { name, poster } de la release c411 si connue
function recordEpisode(all, key, title, info, alias, nowMs) {
  if (!key || !info || info.episode == null) return all;
  var s = all[key] || { title: title, season: 0, episode: 0, at: 0, names: [], posters: [] };
  if (info.season > s.season || (info.season === s.season && info.episode >= s.episode)) {
    s.season = info.season; s.episode = info.episode; s.at = nowMs;
  }
  if (alias) { addUnique(s.names, alias.name); addUnique(s.posters, alias.poster); }
  all[key] = s;
  return all;
}

// Ne plus suivre une série (elle revient si un nouvel épisode est regardé)
function removeSeries(all, key) {
  delete all[key];
  delete seriesSearchCache[key];
  return all;
}

// Reprise de l'historique « vu » existant ({ <tâche>: { files: { <nom>: horodatage } } }) : épisodes SxxEyy seulement
function seriesFromWatched(watched) {
  var all = {};
  Object.keys(watched || {}).forEach(function (k) {
    var files = (watched[k] && watched[k].files) || {};
    Object.keys(files).forEach(function (name) {
      var info = episodeInfo(name);
      var key = info && info.episode != null ? seriesKey(name, '') : null;
      if (key) recordEpisode(all, key, seriesTitle(name, ''), info, null, files[name]);
    });
  });
  return all;
}

// Releases c411 de la série : titre exact ou connu, puis mêmes affiches que ces releases
function matchSeriesReleases(series, releases) {
  var names = [normTitle(series.title)].concat(series.names || []);
  var titleOk = function (r) { return names.indexOf(normTitle(prettyName(r.name).title)) >= 0; };
  var posters = (series.posters || []).slice();
  releases.forEach(function (r) { if (titleOk(r)) addUnique(posters, posterId(r.posterUrl)); });
  var seen = {};
  return releases.filter(function (r) {
    if (seen[r.infoHash]) return false;
    var ok = titleOk(r) || (r.posterUrl && posters.indexOf(posterId(r.posterUrl)) >= 0);
    if (ok) seen[r.infoHash] = true;
    return ok;
  });
}

// Résumé d'une série : releases annotées (nouveautés d'abord, puis de la plus avancée à la moins avancée), nombre de nouveautés,
// date de la release la plus récente (tri des vignettes) et affiche
function seriesSummary(series, matched) {
  var releases = (matched || []).map(function (r) {
    var info = episodeInfo(r.name), at = Date.parse(r.createdAt) || 0;
    return { release: r, info: info, at: at, isNew: isNewer(info, series, at) };
  });
  releases.sort(function (a, b) { return (b.isNew - a.isNew) || (episodeRank(b.info) - episodeRank(a.info)) || (b.at - a.at); });
  var fresh = {};
  releases.forEach(function (a) { if (a.isNew) fresh[episodeCode(a.info)] = true; });
  var latest = releases.reduce(function (m, a) { return Math.max(m, a.at); }, 0);
  var withPoster = releases.filter(function (a) { return a.release.posterUrl; }).sort(function (a, b) { return b.at - a.at; })[0];
  return { releases: releases, newCount: Object.keys(fresh).length, latestAt: latest || series.at || 0, posterUrl: withPoster ? withPoster.release.posterUrl : '' };
}

// ---------- Mémoire sur la TV ----------
function loadSeries() { try { return JSON.parse(localStorage.getItem(pkey(SERIES_KEY))) || {}; } catch (e) { return {}; } }

function saveSeries(all) {
  var keys = Object.keys(all);
  if (keys.length > SERIES_MAX) {
    keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - SERIES_MAX).forEach(function (k) { delete all[k]; });
  }
  try { localStorage.setItem(pkey(SERIES_KEY), JSON.stringify(all)); } catch (e) { /* stockage indisponible */ }
}

// Premier lancement : séries retrouvées dans l'historique des épisodes déjà vus
function ensureSeriesBackfill() {
  if (Object.keys(loadSeries()).length) return;
  var all = seriesFromWatched(loadWatched());
  if (Object.keys(all).length) saveSeries(all);
}

// Appelé quand un fichier est compté comme vu (storage.js) ; titre et affiche c411 de la lecture en cours si connus
function noteSeriesProgress(task, fileName) {
  var folder = task && task.name && task.name !== fileName ? task.name : '';
  var info = episodeInfo(fileName, !!folder);
  if (!info || info.episode == null) return;
  var key = seriesKey(fileName, folder);
  if (!key) return;
  var alias = typeof player !== 'undefined' && player.c411 && player.file && player.file.name === fileName ? player.c411 : null;
  saveSeries(recordEpisode(loadSeries(), key, seriesTitle(fileName, folder), info, alias, Date.now()));
}

// ---------- Recherche sur c411 ----------
var seriesSearchCache = {};

async function searchSeriesReleases(series) {
  var cacheKey = normTitle(series.title), cached = seriesSearchCache[cacheKey];
  if (cached && Date.now() - cached.at < SERIES_SEARCH_TTL_MS) return cached.releases;
  var queries = [series.title];
  (series.names || []).forEach(function (n) { if (n !== cacheKey) addUnique(queries, n); });
  var releases = [];
  for (var i = 0; i < Math.min(queries.length, 3); i++) {
    var j = await c411('/api/torrents', { name: queries[i], category: 1, subcat: SERIES_SUBCATS, sortBy: 'createdAt', sortOrder: 'desc', perPage: 100, page: 1 });
    releases = releases.concat((j && j.data) || []);
  }
  var matched = matchSeriesReleases(series, releases);
  seriesSearchCache[cacheKey] = { at: Date.now(), releases: matched };
  return matched;
}
