// Autres versions d'un titre sur c411 (même film ou même série) et épisodes voisins d'une release.

var RELATED_PAGES = 3;          // pages de 100 releases par titre recherché
var RELATED_QUERIES = 3;        // titres recherchés au plus (release, titre TMDB, titre original)
var RELATED_TTL_MS = 20 * 60 * 1000;
var RELATED_YEAR_TOLERANCE = 1; // film : année de la release à ±1 an de celle de la fiche

// Ce qui identifie un titre : ses noms normalisés, son affiche TMDB, son année, film ou série
function relatedRef(name, titles, posterUrl, year) {
  var n = prettyName(name || ''), names = [];
  [n.title].concat(titles || []).forEach(function (t) { var k = normTitle(t); if (k.length >= 2) addUnique(names, k); });
  return { names: names, poster: posterId(posterUrl), year: String(year || n.year || ''), episodic: !!episodeInfo(name) };
}

// Même affiche TMDB, ou même titre (et, pour un film, même année) ; un film ne se mélange pas avec une série
function isRelated(ref, r) {
  if (!!episodeInfo(r.name) !== ref.episodic) return false;
  if (ref.poster && posterId(r.posterUrl) === ref.poster) return true;
  var n = prettyName(r.name || '');
  if (ref.names.indexOf(normTitle(n.title)) < 0) return false;
  return ref.episodic || !ref.year || !n.year || Math.abs(Number(n.year) - Number(ref.year)) <= RELATED_YEAR_TOLERANCE;
}

// Releases du titre, sans doublon, de la plus récente à la plus ancienne
function relatedReleases(ref, releases) {
  var seen = {};
  return (releases || []).filter(function (r) {
    if (!r || seen[r.infoHash] || !isRelated(ref, r)) return false;
    seen[r.infoHash] = true;
    return true;
  }).sort(function (a, b) { return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0); });
}

// Parmi plusieurs releases d'un même épisode : la plus proche de celle affichée (définition, langue, son lisible), puis la plus partagée
function closestRelease(current, list) {
  var res = resolution(current.name || ''), lang = shortLang(current.language, current.name || '');
  var score = function (r) {
    return (resolution(r.name) === res ? 4 : 0) + (shortLang(r.language, r.name) === lang ? 2 : 0) + (nameAudioOk(r.name) ? 1 : 0);
  };
  return list.slice().sort(function (a, b) {
    return (score(b) - score(a)) || ((b.seeders || 0) - (a.seeders || 0)) || ((Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  })[0] || null;
}

// Épisode précédent (dir = -1) ou suivant (dir = 1) de la release affichée, parmi les releases du titre.
// S04E03 → S04E02 ; S04E01 → dernier épisode de la saison 3 ; S04E03 → S04E04, sinon S05E01.
// Épisode manquant : pack de la saison visée, sinon l'épisode disponible le plus proche. Pack de saison → saison voisine.
// Renvoie { release, info } ou null.
function neighbourRelease(current, releases, dir) {
  var info = episodeInfo(current.name);
  if (!info || info.complete) return null;
  var entries = (releases || []).map(function (r) { return { r: r, info: episodeInfo(r.name) }; })
    .filter(function (x) { return x.info && !x.info.complete && x.r.infoHash !== current.infoHash; });
  var singles = entries.filter(function (x) { return x.info.episode != null; });
  var packsOf = function (season) { return entries.filter(function (x) { return x.info.pack && x.info.season === season; }); };
  var pick = function (group) {
    if (!group.length) return null;
    var r = closestRelease(current, group.map(function (x) { return x.r; }));
    return { release: r, info: group[0].info };
  };
  var ofRank = function (rank) { return singles.filter(function (x) { return episodeRank(x.info) === rank; }); };

  if (info.pack) {
    var season = info.season + dir;
    var inSeason = singles.filter(function (x) { return x.info.season === season; });
    if (packsOf(season).length) return pick(packsOf(season));
    if (!inSeason.length) return null;
    var edge = inSeason.reduce(function (m, x) { return dir < 0 ? Math.max(m, episodeRank(x.info)) : Math.min(m, episodeRank(x.info)); }, dir < 0 ? -1 : Infinity);
    return pick(ofRank(edge)); // saison précédente : son dernier épisode ; suivante : son premier
  }

  var cur = episodeRank(info), nearest = null;
  singles.forEach(function (x) {
    var rank = episodeRank(x.info);
    if (dir < 0 ? rank < cur && (nearest == null || rank > nearest) : rank > cur && (nearest == null || rank < nearest)) nearest = rank;
  });
  var near = nearest != null ? ofRank(nearest)[0].info : null;
  var adjacent = near && (dir < 0
    ? (near.season === info.season && near.episode === info.episode - 1) || (info.episode === 1 && near.season === info.season - 1)
    : (near.season === info.season && near.episode === info.episode + 1) || (near.season === info.season + 1 && near.episode === 1));
  if (adjacent) return pick(ofRank(nearest));
  // Épisode visé absent : le pack de sa saison le contient
  var target = dir < 0 ? (info.episode > 1 ? info.season : info.season - 1) : (near && near.season === info.season ? null : info.season + 1);
  if (target != null && packsOf(target).length) return pick(packsOf(target));
  return near ? pick(ofRank(nearest)) : null;
}

// Recherches ciblées quand la liste des releases est incomplète (titre trop courant, plus de 300 releases)
function neighbourQueries(name) {
  var info = episodeInfo(name);
  if (!info || info.complete) return [];
  var s = function (n) { return 'S' + pad2(n); };
  if (info.pack) return [s(info.season - 1), s(info.season + 1)].filter(function (q) { return q !== 'S00'; });
  var codes = [info.episode > 1 ? s(info.season) + 'E' + pad2(info.episode - 1) : s(info.season - 1),
    s(info.season) + 'E' + pad2(info.episode + 1), s(info.season + 1) + 'E01'];
  return codes.filter(function (q) { return q !== 'S00'; });
}

var relatedCache = {};

// Toutes les releases c411 du titre : chaque nom connu est recherché (3 pages de 100 au plus), puis filtré
async function searchRelated(ref) {
  var key = ref.names.join('|') + '#' + ref.poster + '#' + ref.year + '#' + ref.episodic;
  var cached = relatedCache[key];
  if (cached && Date.now() - cached.at < RELATED_TTL_MS) return cached.result;
  var truncated = false;
  var lists = await Promise.all(ref.names.slice(0, RELATED_QUERIES).map(async function (q) {
    var all = [];
    for (var page = 1; page <= RELATED_PAGES; page++) {
      var j = await c411('/api/torrents', { name: q, category: 1, sortBy: 'createdAt', sortOrder: 'desc', perPage: 100, page: page });
      all = all.concat((j && j.data) || []);
      if (page >= ((j && j.meta && j.meta.totalPages) || 1)) return all;
    }
    truncated = true;
    return all;
  }));
  var result = { releases: relatedReleases(ref, [].concat.apply([], lists)), truncated: truncated };
  relatedCache[key] = { at: Date.now(), result: result };
  return result;
}

// Épisodes précédent et suivant de la release affichée : { prev, next }, chacun { release, info } ou null
async function searchNeighbours(ref, current) {
  var found = await searchRelated(ref), releases = found.releases;
  if (found.truncated && ref.names.length) {
    var extra = await Promise.all(neighbourQueries(current.name).map(function (code) {
      return c411('/api/torrents', { name: ref.names[0] + ' ' + code, category: 1, sortBy: 'createdAt', sortOrder: 'desc', perPage: 100, page: 1 })
        .then(function (j) { return (j && j.data) || []; }).catch(function () { return []; });
    }));
    releases = relatedReleases(ref, releases.concat([].concat.apply([], extra)));
  }
  return { prev: neighbourRelease(current, releases, -1), next: neighbourRelease(current, releases, 1) };
}
