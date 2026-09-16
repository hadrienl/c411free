// Recommandations du profil (onglet « Pour vous ») : goûts déduits de l'historique de visionnage à partir des fiches TMDB
// de c411 (genres, mots-clés, réalisateurs, acteurs), candidats c411 dans les genres préférés et parmi les plus partagés,
// notés puis diversifiés. Sans clé API : tout vient de c411.

var FEATURES_KEY = 'c411free.features';           // commun à tous les profils (décrit les titres, pas les goûts)
var FEATURES_TTL_MS = 30 * 24 * 3600 * 1000;
var FEATURES_MISS_TTL_MS = 3 * 24 * 3600 * 1000;  // titre introuvable : nouvel essai plus tôt
var FEATURES_MAX = 500;
var RECOS_KEY = 'c411free.recos';                 // par profil
var RECOS_TTL_MS = 6 * 3600 * 1000;
var RECO_COUNT = 28;
var RECO_DETAIL_POOL = 40;
var RECO_HISTORY_MAX = 20;
var RECO_TOP_GENRES = 3;
var RECO_SUBCATS = '6,7,1,2';                     // Film, Série TV, Animation, Animation Série
var RECO_PER_PERSON = 2;

// Genres TMDB (souvent « A & B », parfois en anglais) rapprochés des genres de c411
var GENRE_ALIASES = {
  adventure: 'aventure', war: 'guerre', politics: 'politique', mystere: 'enquete', mystery: 'enquete', kids: 'famille',
  familial: 'famille', soap: 'drame', reality: 'tele realite', histoire: 'historique', musique: 'musical', talk: 'varietes tv'
};

function genreKeys(label) {
  return String(label || '').split(/\s*&\s*/).map(function (part) { var k = normTitle(part); return GENRE_ALIASES[k] || k; }).filter(Boolean);
}

// Index « genre normalisé → identifiant d'option c411 » (nom complet et chacune de ses parties)
function genreIndex(c411Genres) {
  var index = {};
  (c411Genres || []).forEach(function (g) {
    [normTitle(g.name)].concat(genreKeys(g.name)).forEach(function (k) { if (k && index[k] == null) index[k] = g.id; });
  });
  return index;
}

function names(list) { return (list || []).map(function (x) { return typeof x === 'string' ? x : x && x.name; }).filter(Boolean); }

function unique(list) {
  var seen = {};
  return list.filter(function (x) { var k = normTitle(x); if (!k || seen[k]) return false; seen[k] = true; return true; });
}

// Mots-clés TMDB sans valeur pour rapprocher deux titres : ambiance (« admiring », « amused »…) et thèmes présents
// dans des milliers de fiches (« family », « sequel », « island »…). Relevés sur les fiches c411.
var KEYWORD_STOPLIST = new RegExp('^(admiring|amused|amusing|lighthearted|dramatic|nostalgic|suspenseful|intense|thoughtful|inspirational|'
  + 'hopeful|sad|melancholy|cheerful|exhilarated|provocative|bold|playful|joyous|romantic|dark|comforting|empathetic|frustrated|'
  + 'family|sequel|prequel|remake|love|friendship|island|based on novel or book|based on comic|based on true story|woman director|'
  + 'duringcreditsstinger|aftercreditsstinger|miniseries|sitcom|anime|live action|3d|biography|christmas)$');

// Caractéristiques d'un titre à partir de sa fiche c411
function featuresFromDetail(d) {
  var t = (d && d.metadata && d.metadata.tmdbData) || {};
  if (!t.title && !t.id) return null;
  return {
    tmdbId: t.id || null,
    isSeries: /tv|serie/i.test(t.type || ''),
    year: String(t.year || ''),
    genres: names(t.genres).slice(0, 5),
    keywords: unique(names(t.keywords).filter(function (k) { return !KEYWORD_STOPLIST.test(String(k).toLowerCase().trim()); })).slice(0, 15),
    people: unique(names(t.directors).slice(0, 2).concat(names(t.createdBy).slice(0, 3))), // créateurs souvent listés deux fois
    cast: unique(names(t.cast)).slice(0, 5),
    rating: Number(t.rating) || 0
  };
}

// Release qui représente un titre : saison complète ou intégrale plutôt qu'un épisode isolé, puis la plus partagée
function releaseRank(r) {
  var info = episodeInfo(r.name);
  return (info && info.episode != null ? 0 : 1) * 1e9 + (r.seeders || 0);
}

// Titre comparable entre releases : « Rick et Morty », « Rick And Morty » et « Rick & Morty » donnent la même clé
function titleKeyOf(name) {
  var title = prettyName(String(name || '').replace(/^\[[^\]]*\][\s._\-]*/, '')).title.replace(/&/g, ' ');
  return normTitle(title).split(' ').filter(function (w) { return w !== 'et' && w !== 'and'; }).join(' ');
}

function addWeight(map, key, w) { if (key) map[key] = (map[key] || 0) + w; }

// Goûts : caractéristiques des titres regardés, pondérées par l'intérêt montré, ramenées à un total de 1
function tasteProfile(known) {
  var t = { genres: {}, keywords: {}, people: {}, cast: {}, seriesShare: 0.5, total: 0 };
  var seriesWeight = 0;
  known.forEach(function (x) {
    var f = x.features, w = x.weight;
    if (!f || !(w > 0)) return;
    t.total += w;
    if (f.isSeries) seriesWeight += w;
    var seen = {};
    f.genres.forEach(function (g) { genreKeys(g).forEach(function (k) { if (!seen[k]) { seen[k] = true; addWeight(t.genres, k, w); } }); });
    f.keywords.forEach(function (k) { addWeight(t.keywords, normTitle(k), w); });
    f.people.forEach(function (p) { addWeight(t.people, normTitle(p), w); });
    f.cast.forEach(function (a) { addWeight(t.cast, normTitle(a), w); });
  });
  if (t.total) {
    ['genres', 'keywords', 'people', 'cast'].forEach(function (m) { Object.keys(t[m]).forEach(function (k) { t[m][k] /= t.total; }); });
    t.seriesShare = seriesWeight / t.total;
  }
  return t;
}

function topKeys(map, n) { return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, n); }

// Candidats : une entrée par titre (plusieurs releases regroupées, représentées par la mieux adaptée, voir releaseRank)
function groupCandidates(lists) {
  var byKey = {}, order = [];
  lists.forEach(function (l) {
    (l.data || []).forEach(function (r) {
      var key = titleKeyOf(r.name);
      if (!key) return;
      var c = byKey[key];
      if (!c) { c = byKey[key] = { key: key, release: r, genres: [], seeders: 0 }; order.push(key); }
      if (releaseRank(r) > releaseRank(c.release)) c.release = r;
      c.seeders = Math.max(c.seeders, r.seeders || 0);
      if (l.genre && c.genres.indexOf(l.genre) < 0) c.genres.push(l.genre);
    });
  });
  return order.map(function (k) { return byKey[k]; });
}

// Note : proximité avec les goûts (genres, puis mots-clés, réalisateurs, acteurs si la fiche est connue), type de contenu préféré,
// un peu de popularité pour départager
function scoreCandidate(c, taste, f) {
  var genres = f ? [].concat.apply([], f.genres.map(genreKeys)) : c.genres;
  var s = 0, counted = {};
  genres.forEach(function (g) { if (!counted[g]) { counted[g] = true; s += taste.genres[g] || 0; } });
  if (f) {
    f.keywords.forEach(function (k) { s += 0.5 * (taste.keywords[normTitle(k)] || 0); });
    f.people.forEach(function (p) { s += 0.8 * (taste.people[normTitle(p)] || 0); });
    f.cast.forEach(function (a) { s += 0.4 * (taste.cast[normTitle(a)] || 0); });
    if (f.rating >= 7) s += 0.1;
    s *= f.isSeries ? 0.5 + taste.seriesShare : 1.5 - taste.seriesShare;
  }
  return s + 0.03 * Math.log10(1 + (c.seeders || 0));
}

function overlap(a, b) {
  var set = (b || []).map(normTitle);
  return (a || []).filter(function (x) { return set.indexOf(normTitle(x)) >= 0; }).length;
}

// Raison affichée : un titre regardé qui partage une personne (réalisateur, créateur, acteur) ou au moins deux mots-clés précis ;
// sinon les genres appréciés
function reasonFor(f, known, taste) {
  if (!f) return '';
  var best = null, bestScore = 0;
  known.forEach(function (x) {
    var g = x.features;
    if (!g) return;
    var keywords = overlap(f.keywords, g.keywords), persons = overlap(f.people, g.people) + overlap(f.cast, g.cast);
    if (!persons && keywords < 2) return;
    var score = (persons + keywords * 0.5 + 0.25 * overlap(f.genres, g.genres)) * x.weight;
    if (score > bestScore) { bestScore = score; best = x; }
  });
  if (best) return 'Parce que vous avez regardé « ' + best.title + ' »';
  var liked = f.genres.filter(function (g) { return genreKeys(g).some(function (k) { return taste.genres[k]; }); });
  return (liked.length ? liked : f.genres).slice(0, 2).join(' · ');
}

// Variété : pas plus de RECO_PER_PERSON titres d'un même réalisateur, créateur ou acteur principal
function diversify(ranked, limit) {
  var counts = {}, out = [], tmdbSeen = {};
  ranked.forEach(function (c) {
    if (out.length >= limit) return;
    var f = c.features, keys = f ? f.people.concat(f.cast.slice(0, 1)).map(normTitle) : [];
    if (f && f.tmdbId) {
      if (tmdbSeen[f.tmdbId]) return; // même œuvre sous un autre titre de release
      tmdbSeen[f.tmdbId] = true;
    }
    if (keys.some(function (k) { return (counts[k] || 0) >= RECO_PER_PERSON; })) return;
    keys.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    out.push(c);
  });
  return out;
}

// Titres à ne pas proposer : déjà regardés par le profil, ou déjà sur les disques
function excludedTitleKeys(hist, mediaEntries) {
  var ex = {};
  Object.keys(hist || {}).forEach(function (k) { ex[normTitle(hist[k].title)] = true; });
  (mediaEntries || []).forEach(function (m) { var q = posterQuery(m); if (q) ex[normTitle(q.title)] = true; });
  return ex;
}

function slimRelease(r) {
  return { infoHash: r.infoHash, name: r.name, posterUrl: r.posterUrl, size: r.size, seeders: r.seeders, language: r.language, category: r.category, subcategory: r.subcategory };
}

// ---------- Caches ----------
function loadFeatureCache() { try { return JSON.parse(localStorage.getItem(FEATURES_KEY)) || {}; } catch (e) { return {}; } }

function saveFeatureCache(all) {
  var keys = Object.keys(all);
  if (keys.length > FEATURES_MAX) {
    keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - FEATURES_MAX).forEach(function (k) { delete all[k]; });
  }
  try { localStorage.setItem(FEATURES_KEY, JSON.stringify(all)); } catch (e) { /* stockage plein */ }
}

// undefined : à chercher ; null : titre introuvable récemment ; objet : caractéristiques connues
function cachedFeatures(cache, key, nowMs) {
  var c = cache[key];
  if (!c) return undefined;
  return nowMs - c.at < (c.f ? FEATURES_TTL_MS : FEATURES_MISS_TTL_MS) ? c.f : undefined;
}

function loadRecos() { try { return JSON.parse(localStorage.getItem(pkey(RECOS_KEY))); } catch (e) { return null; } }
function saveRecos(r) { try { localStorage.setItem(pkey(RECOS_KEY), JSON.stringify(r)); } catch (e) { /* stockage plein */ } }

// ---------- Calcul ----------
async function mapLimit(items, limit, fn) {
  var out = new Array(items.length), next = 0;
  async function worker() {
    while (next < items.length) {
      var i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; }
    }
  }
  var workers = [];
  for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

async function detailFeatures(infoHash) {
  try { return featuresFromDetail(await c411('/api/torrents/' + String(infoHash).toLowerCase())); } catch (e) { return null; } // filtre familial compris
}

// Titre regardé : fiche du téléchargement c411 si connue, sinon release du même titre trouvée par recherche
async function featuresForHistory(key, entry, cache, nowMs) {
  var hit = cachedFeatures(cache, 'vu:' + key, nowMs);
  if (hit !== undefined) return hit;
  var f = entry.infoHash ? await detailFeatures(entry.infoHash) : null;
  if (!f) {
    var j = await c411('/api/torrents', { name: entry.title, category: 1, subcat: entry.isSeries ? '7,2,57' : '6,1,4', sortBy: 'seeders', sortOrder: 'desc', perPage: 20, page: 1 });
    var want = normTitle(entry.title);
    var match = ((j && j.data) || []).filter(function (r) {
      var year = prettyName(r.name).year;
      return titleKeyOf(r.name) === want && (!entry.year || !year || Math.abs(Number(year) - Number(entry.year)) <= 1);
    })[0];
    if (match) f = await detailFeatures(match.infoHash);
  }
  cache['vu:' + key] = { at: nowMs, f: f };
  return f;
}

async function featuresForRelease(r, cache, nowMs) {
  var hit = cachedFeatures(cache, 'h:' + r.infoHash, nowMs);
  if (hit !== undefined) return hit;
  var f = await detailFeatures(r.infoHash);
  cache['h:' + r.infoHash] = { at: nowMs, f: f };
  return f;
}

async function computeRecommendations() {
  var now = Date.now(), hist = loadHistory();
  var watched = Object.keys(hist).map(function (k) { return { key: k, entry: hist[k], title: hist[k].title, weight: engagement(hist[k], now) }; })
    .filter(function (x) { return x.weight > 0.05; })
    .sort(function (a, b) { return b.weight - a.weight; })
    .slice(0, RECO_HISTORY_MAX);
  if (!watched.length) return { cold: true, items: [] };

  var cache = loadFeatureCache();
  var feats = await mapLimit(watched, 3, function (x) { return featuresForHistory(x.key, x.entry, cache, now); });
  watched.forEach(function (x, i) { x.features = feats[i]; });
  var known = watched.filter(function (x) { return x.features; });
  if (!known.length) { saveFeatureCache(cache); return { cold: true, items: [] }; }

  var taste = tasteProfile(known);
  var index = genreIndex(await loadGenres());
  var queries = topKeys(taste.genres, RECO_TOP_GENRES).filter(function (k) { return index[k] != null; }).map(function (k) {
    return { genre: k, params: { category: 1, subcat: RECO_SUBCATS, options: index[k], sortBy: 'seeders', sortOrder: 'desc', perPage: 40, page: 1 } };
  }).concat([{ genre: null, params: { category: 1, subcat: RECO_SUBCATS, sortBy: 'seeders', sortOrder: 'desc', perPage: 40, page: 1 } }]);
  var lists = await mapLimit(queries, 2, function (q) {
    return c411('/api/torrents', q.params).then(function (j) { return { genre: q.genre, data: (j && j.data) || [] }; });
  });

  var excluded = excludedTitleKeys(hist, state.media && state.media.grouped);
  var candidates = groupCandidates(lists.filter(Boolean)).filter(function (c) { return !excluded[c.key]; });
  candidates.forEach(function (c) { c.score = scoreCandidate(c, taste, null); });
  candidates.sort(function (a, b) { return b.score - a.score; });

  var pool = candidates.slice(0, RECO_DETAIL_POOL);
  var poolFeats = await mapLimit(pool, 4, function (c) { return featuresForRelease(c.release, cache, now); });
  pool.forEach(function (c, i) { c.features = poolFeats[i]; c.score = scoreCandidate(c, taste, c.features); });
  saveFeatureCache(cache);

  var ranked = pool.filter(function (c) { return c.features; }).sort(function (a, b) { return b.score - a.score; });
  return {
    cold: false,
    basedOn: known.map(function (x) { return x.title; }),
    items: diversify(ranked, RECO_COUNT).map(function (c) { return { release: slimRelease(c.release), reason: reasonFor(c.features, known, taste) }; })
  };
}

// ---------- Onglet « Pour vous » ----------
var forYouGeneration = 0;

async function loadForYou(force) {
  var generation = ++forYouGeneration, home = state.home, grid = $('home-grid');
  home.generation = (home.generation || 0) + 1; home.items = []; home.done = true; home.loading = false; // pas de défilement infini
  var signature = historySignature(loadHistory()), cached = loadRecos();
  var result = !force && cached && cached.signature === signature && Date.now() - cached.at < RECOS_TTL_MS ? cached : null;
  if (!result) {
    grid.innerHTML = '<div class="empty empty-status">' + iconSvg('sparkle') + '<span>Calcul de vos recommandations…</span></div>';
    var started = Date.now();
    try {
      result = await computeRecommendations();
    } catch (e) {
      if (generation === forYouGeneration) grid.innerHTML = '<div class="empty">Recommandations indisponibles : ' + esc(e.message) + '</div>';
      return;
    }
    result.at = Date.now();
    result.signature = signature;
    if (!result.cold) saveRecos(result);
    debug('info', 'recommandations calculées', { titres: result.items.length, historique: (result.basedOn || []).length, ms: Date.now() - started });
  }
  if (generation !== forYouGeneration || !isForYouMode(state.filters)) return;
  if (result.cold) { loadForYouCold(generation); return; }
  home.items = result.items.map(function (x) { return x.release; });
  var based = result.basedOn.slice(0, 3).join(', ') + (result.basedOn.length > 3 ? '…' : '');
  grid.innerHTML = '<div class="reco-intro">Sélection pour ' + esc(currentProfile().name) + ', d\'après ' + esc(based) + '</div>'
    + (result.items.map(function (x) { return cardHtml('h-', x.release, x.reason); }).join('') || '<div class="empty">Aucune recommandation pour le moment.</div>');
}

// Profil sans historique : explication, et les titres les plus partagés en attendant
async function loadForYouCold(generation) {
  var grid = $('home-grid');
  var intro = '<div class="reco-intro">Regardez quelques films ou épisodes : les recommandations de ' + esc(currentProfile().name) + ' apparaîtront ici. En attendant, les plus partagés du moment.</div>';
  grid.innerHTML = intro;
  try {
    var j = await c411('/api/torrents', { category: 1, subcat: RECO_SUBCATS, sortBy: 'seeders', sortOrder: 'desc', perPage: PER_PAGE, page: 1 });
    if (generation !== forYouGeneration || !isForYouMode(state.filters)) return;
    state.home.items = j.data || [];
    grid.innerHTML = intro + state.home.items.map(function (t) { return cardHtml('h-', t); }).join('');
  } catch (e) {
    toast('Impossible de charger les titres populaires : ' + e.message, true);
  }
}
