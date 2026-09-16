var LATER_KEY = 'c411free.later'; // par profil (pkey)
var LATER_MAX = 200;

var laterCache = null; // memo en mémoire : évite de reparser localStorage à chaque vignette

function loadLater() {
  try { return JSON.parse(localStorage.getItem(pkey(LATER_KEY))) || {}; } catch (e) { return {}; }
}

function saveLater(all) {
  try { localStorage.setItem(pkey(LATER_KEY), JSON.stringify(all)); } catch (e) {}
  laterCache = null; // invalide le memo : isLater relira au prochain appel
}

function isLater(hash) {
  if (!laterCache) laterCache = loadLater();
  return !!laterCache[String(hash || '').toLowerCase()];
}

function forgetLater() { laterCache = null; } // changement de profil : le memo ne vaut plus

function addLater(item, nowMs) {
  var all = loadLater(), hash = String(item.infoHash || '').toLowerCase();
  var entry = { name: item.name, size: item.size, seeders: item.seeders, language: item.language, posterUrl: item.posterUrl, at: nowMs == null ? Date.now() : nowMs };
  all[hash] = entry;
  var keys = Object.keys(all);
  if (keys.length > LATER_MAX) {
    keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - LATER_MAX).forEach(function (k) { delete all[k]; });
  }
  saveLater(all);
  return entry;
}

function removeLater(hash) {
  var all = loadLater(), key = String(hash || '').toLowerCase();
  if (!all[key]) return false;
  delete all[key];
  saveLater(all);
  return true;
}

function laterList(all) {
  all = all || loadLater();
  return Object.keys(all)
    .map(function (hash) { return Object.assign({ infoHash: hash }, all[hash]); })
    .sort(function (a, b) { return b.at - a.at; });
}
