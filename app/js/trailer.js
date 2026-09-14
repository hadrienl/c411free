// Bande-annonce de la fiche : première vidéo d'une recherche YouTube, ouverte dans l'app YouTube de la TV.
// La lecture intégrée dans C411free est impossible : chargée depuis file://, l'app n'envoie pas de référent et le lecteur
// YouTube refuse avec l'erreur 153 (vérifié sur la TV et reproduit dans Chromium ; la même page servie en HTTP fonctionne).

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
