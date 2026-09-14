// Bande-annonce de la fiche : MP4 d'AlloCiné lu dans le lecteur de l'app, sinon première vidéo d'une recherche YouTube
// ouverte dans l'app YouTube de la TV. La lecture YouTube intégrée dans C411free est impossible : chargée depuis file://,
// l'app n'envoie pas de référent et le lecteur YouTube refuse avec l'erreur 153 (vérifié sur la TV) ; les flux YouTube
// directs exigent une connexion, et la Freebox ne permet pas d'héberger une page relais.

// App YouTube : identifiants relevés sur la TV (sdb applist), puis l'ancien identifiant générique des TV Samsung
var YT_TV_APP_IDS = ['9Ur5IzDKqV.TizenYouTube', 'com.samsung.tv.cobalt-yt', '111299001912'];
var trailerState = { cache: {} };

// Requête de recherche : « Inception 2010 bande annonce VF »
function trailerQuery(title, year) {
  return [String(title || '').trim(), year || '', 'bande annonce VF'].filter(Boolean).join(' ');
}

// Première vidéo des résultats (hors publicités et Shorts, qui n'utilisent pas videoRenderer) ;
// à défaut, première vidéo citée (autres mises en page de YouTube)
function firstVideoId(html) {
  var text = String(html || '');
  var m = text.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/)
    || text.match(/"compactVideoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/)
    || text.match(/\/watch\?v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Recherche par l'API interne de YouTube (JSON) : la page de résultats redirige (303, recherche perdue) les requêtes
// faites depuis une app, reconnues à leurs en-têtes Sec-Fetch « cross-site ».
var YT_SEARCH_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
var YT_CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'fr', gl: 'FR' };

async function findTrailer(title, year) {
  var query = trailerQuery(title, year);
  if (!title) return null;
  if (trailerState.cache[query] !== undefined) return trailerState.cache[query];
  var res = await fetch(YT_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: YT_CLIENT }, query: query })
  });
  var id = res.ok ? firstVideoId(await res.text()) : null;
  trailerState.cache[query] = id;
  debug('info', 'bande-annonce trouvée', { query: query, videoId: id, http: res.status });
  return id;
}

// ---------- AlloCiné : bandes-annonces MP4, lues dans le lecteur de l'app (RETOUR revient à la fiche) ----------
var ALLOCINE = 'https://www.allocine.fr';

// Résultat d'autocomplétion correspondant : même type, titre français ou original identique, année proche.
// Écarte le résultat sponsorisé placé en tête (autre titre) et les homonymes d'autres années.
// Séries : l'année connue est souvent celle d'une saison, elle ne sert qu'à départager.
function pickAllocineResult(results, titles, year, type) {
  var wanted = (titles || []).map(normTitle).filter(Boolean);
  var same = (results || []).filter(function (r) {
    return r.entity_type === type && [r.label, r.original_label].some(function (l) { return wanted.indexOf(normTitle(l)) >= 0; });
  });
  var y = Number(year);
  if (!y) return same[0] || null;
  var yearOf = function (r) { return Number(r.data && r.data.year) || 0; };
  var dated = same.filter(function (r) { return yearOf(r) && Math.abs(yearOf(r) - y) <= 1; });
  var undated = same.filter(function (r) { return !yearOf(r); });
  return dated[0] || undated[0] || (type === 'series' ? same[0] : null) || null;
}

function allocineVideoPageUrl(type, entityId, videoId) {
  return ALLOCINE + '/video/player_gen_cmedia=' + videoId + (type === 'series' ? '&cserie=' : '&cfilm=') + entityId + '.html';
}

// MP4 cité dans la page vidéo (JSON échappé dans le HTML), meilleure qualité d'abord (_hd_, puis _m_)
function mp4FromVideoPage(html) {
  var text = String(html || '').replace(/\\\//g, '/').replace(/&quot;/g, '"');
  var urls = [], re = /https:[^"'\s]+?\.mp4/g, m;
  while ((m = re.exec(text))) { if (urls.indexOf(m[0]) < 0) urls.push(m[0]); }
  var rank = function (u) { return /_hd_/.test(u) ? 3 : /_m_/.test(u) ? 2 : 1; };
  return urls.sort(function (a, b) { return rank(b) - rank(a); })[0] || null;
}

async function findAllocineTrailer(titles, year, isSeries) {
  var type = isSeries ? 'series' : 'movie';
  var cacheKey = ['allocine', type, titles.join('|'), year || ''].join('#');
  if (trailerState.cache[cacheKey] !== undefined) return trailerState.cache[cacheKey];
  var pick = null, queries = titles.filter(function (t, i) { return t && titles.indexOf(t) === i; }).slice(0, 2);
  for (var i = 0; i < queries.length && !pick; i++) {
    var res = await fetch(ALLOCINE + '/_/autocomplete/' + encodeURIComponent(queries[i]));
    var json = res.ok ? await res.json() : null;
    pick = pickAllocineResult(json && (json.results || json), titles, year, type);
  }
  var videoId = pick && pick.data && pick.data.default_video;
  var url = null;
  if (videoId) {
    var page = await fetch(allocineVideoPageUrl(type, pick.entity_id, videoId));
    url = page.ok ? mp4FromVideoPage(await page.text()) : null;
  }
  trailerState.cache[cacheKey] = url;
  debug('info', 'bande-annonce AlloCiné', { titre: titles[0], type: type, resultat: pick ? pick.entity_id : null, video: videoId || null, mp4: url ? url.split('/').pop() : null });
  return url;
}

// Source de la bande-annonce : AlloCiné (lecture dans l'app), sinon YouTube (ouverture de l'app YouTube)
async function findTrailerSource(titles, year, isSeries) {
  try {
    var url = await findAllocineTrailer(titles, year, isSeries);
    if (url) return { kind: 'allocine', url: url };
  } catch (e) {
    debug('error', 'AlloCiné : ' + e.message);
  }
  var videoId = await findTrailer(titles[0], year);
  return videoId ? { kind: 'youtube', videoId: videoId } : null;
}

// Ouvre la vidéo dans l'app YouTube. Pour chaque identifiant d'app, deux façons de lui transmettre la vidéo, essayées
// dans l'ordre tant que le lancement échoue : données PAYLOAD (lien profond de l'app YouTube TV), puis adresse de la vidéo.
function openTrailerInYouTube(videoId) {
  var controls = [
    function () {
      return new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null,
        [new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: 'v=' + videoId })])]);
    },
    function () { return new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', 'https://www.youtube.com/watch?v=' + videoId); }
  ];
  var tries = [];
  YT_TV_APP_IDS.forEach(function (appId) { controls.forEach(function (control, method) { tries.push({ appId: appId, control: control, method: method }); }); });
  var attempt = function (i) {
    if (i >= tries.length) { toast('Impossible d\'ouvrir YouTube', true); return; }
    var t = tries[i];
    try {
      tizen.application.launchAppControl(t.control(), t.appId,
        function () { debug('info', 'bande-annonce ouverte dans YouTube', { videoId: videoId, app: t.appId, methode: t.method }); },
        function (e) { debug('error', 'lancement YouTube refusé', { app: t.appId, methode: t.method, erreur: e && (e.name + ' ' + e.message) }); attempt(i + 1); });
    } catch (e) {
      debug('error', 'lancement YouTube impossible', { app: t.appId, methode: t.method, erreur: e.name + ' ' + e.message });
      attempt(i + 1);
    }
  };
  toast('Ouverture de la bande-annonce dans YouTube…');
  attempt(0);
}
