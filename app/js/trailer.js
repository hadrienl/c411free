// Bande-annonce de la fiche : première vidéo d'une recherche YouTube (sans clé API), lue en plein écran dans l'app
// avec le lecteur intégré YouTube (IFrame Player API). Les erreurs du lecteur sont journalisées (101/150/152/153 : lecture
// intégrée refusée).

var TRAILER_API_TIMEOUT_MS = 10000;
var TRAILER_MUTED_FALLBACK_MS = 2500; // son bloqué par la règle d'autolecture : relance en muet
var trailerState = { player: null, apiPromise: null, cache: {} };

// Requête de recherche : « Inception 2010 bande annonce VF »
function trailerQuery(title, year) {
  return [String(title || '').trim(), year || '', 'bande annonce VF'].filter(Boolean).join(' ');
}

// Première vidéo des résultats (hors publicités et Shorts, qui n'utilisent pas videoRenderer)
function firstVideoId(html) {
  var m = String(html || '').match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  return m ? m[1] : null;
}

async function findTrailer(title, year) {
  var query = trailerQuery(title, year);
  if (!title) return null;
  if (trailerState.cache[query] !== undefined) return trailerState.cache[query];
  var res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), { headers: { 'Accept-Language': 'fr-FR' } });
  var id = res.ok ? firstVideoId(await res.text()) : null;
  trailerState.cache[query] = id;
  debug('info', 'bande-annonce trouvée', { query: query, videoId: id, http: res.status });
  return id;
}

function trailerOpen() { return $('trailer').classList.contains('open'); }

function setTrailerStatus(text) {
  var el = $('trailer-status');
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
}

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (trailerState.apiPromise) return trailerState.apiPromise;
  trailerState.apiPromise = new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { trailerState.apiPromise = null; reject(new Error('API YouTube : délai dépassé')); }, TRAILER_API_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = function () { clearTimeout(timer); resolve(); };
    var script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = function () { clearTimeout(timer); trailerState.apiPromise = null; reject(new Error('API YouTube injoignable')); };
    document.head.appendChild(script);
  });
  return trailerState.apiPromise;
}

async function openTrailer(videoId) {
  $('trailer').classList.add('open');
  $('trailer-close').focus(); // la sélection reste dans l'app : RETOUR doit fermer la vidéo
  setTrailerStatus('Chargement de la bande-annonce…');
  try {
    await loadYouTubeApi();
  } catch (e) {
    debug('error', 'bande-annonce : ' + e.message);
    setTrailerStatus('Bande-annonce indisponible (' + e.message + ')');
    return;
  }
  if (!trailerOpen()) return;
  $('trailer-player').innerHTML = '<div id="trailer-frame"></div>';
  var player = new window.YT.Player('trailer-frame', {
    width: 1920, height: 1080, videoId: videoId,
    playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, hl: 'fr', cc_load_policy: 0 },
    events: {
      onReady: function (ev) {
        debug('info', 'bande-annonce prête', { videoId: videoId });
        ev.target.playVideo();
        setTimeout(function () {
          if (trailerState.player !== ev.target || ev.target.getPlayerState() === 1) return;
          debug('info', 'bande-annonce : relance en muet', { etat: ev.target.getPlayerState() });
          ev.target.mute();
          ev.target.playVideo();
        }, TRAILER_MUTED_FALLBACK_MS);
      },
      onStateChange: function (ev) {
        debug('info', 'bande-annonce état', { etat: ev.data }); // -1 non démarrée, 0 fin, 1 lecture, 2 pause, 3 chargement
        if (ev.data === 1) setTrailerStatus('');
        if (ev.data === 0) closeTrailer();
      },
      onError: function (ev) {
        debug('error', 'bande-annonce erreur ' + ev.data, { videoId: videoId });
        setTrailerStatus('YouTube refuse la lecture dans l\'app (erreur ' + ev.data + ')');
      }
    }
  });
  trailerState.player = player;
  $('trailer-close').focus();
}

function toggleTrailerPause() {
  var p = trailerState.player;
  if (!p || !p.getPlayerState) return;
  if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo();
}

function closeTrailer() {
  if (trailerState.player) {
    try { trailerState.player.destroy(); } catch (e) { /* déjà détruit */ }
    trailerState.player = null;
  }
  $('trailer-player').innerHTML = '';
  $('trailer').classList.remove('open');
  setTrailerStatus('');
  if (state.screen === 'detail') $('d-trailer').focus();
}
