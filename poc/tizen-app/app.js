// C411free — parcourir et chercher sur c411, télécharger sur la Freebox, regarder, à la télécommande.
var S = window.SECRETS || {};
var FBX = 'http://mafreebox.freebox.fr/api/v16';
var C411 = 'https://c411.org';
var LOG_URL = 'http://MAC_IP:8765/log'; // journal de débogage sur le Mac (POC, best effort)
var PER_PAGE = 28;
var PREFS_KEY = 'c411free.trackPrefs';
var WATCHED_KEY = 'c411free.watched';
var WATCHED_RATIO = 0.25; // un fichier est « vu » au-delà de 25 % de sa durée

var KEY = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, IME_DONE: 65376, IME_CANCEL: 65385,
  PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412
};
var state = {
  screen: 'home', detailFrom: 'home', subcat: '',
  home: { page: 0, items: [], total: 0 },
  results: { q: '', page: 0, items: [], total: 0 },
  detail: null, session: null, pollTimer: null, lastFocus: {},
  tasks: [], dlSort: 'recent', filesTask: null
};

var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function debug(level, message, extra) {
  try {
    var text = String(message).split(S.c411ApiKey || '\u0000').join('***');
    fetch(LOG_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ at: new Date().toISOString(), level: level, screen: state.screen, message: text, extra: extra }) }).catch(function () {});
  } catch (e) { /* best effort */ }
}
window.addEventListener('error', function (e) { debug('error', e.message, { src: e.filename, line: e.lineno }); });
window.addEventListener('unhandledrejection', function (e) { debug('error', (e.reason && e.reason.message) || e.reason); });

var toastTimer;
function toast(text, ko) {
  var t = $('toast');
  t.textContent = text;
  t.className = ko ? 'ko' : '';
  // Pendant la saisie, le clavier Samsung occupe le bas de l'écran : le message passe en haut
  var typing = document.activeElement === $('query');
  t.style.top = typing ? '40px' : 'auto';
  t.style.bottom = typing ? 'auto' : '50px';
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = 'none'; }, ko ? 6000 : 3000);
  if (ko) debug('error', text);
}

// ---------- Navigation ----------
function show(screen, focusEl) {
  var current = document.activeElement;
  if (current && current.id && current.hasAttribute('data-f')) state.lastFocus[state.screen] = current.id;
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('active', s.id === screen); });
  state.screen = screen;
  if (screen !== 'downloads') stopPolling();
  var target = focusEl || (state.lastFocus[screen] && $(state.lastFocus[screen])) || focusables()[0];
  if (target) { target.focus(); target.scrollIntoView({ block: 'nearest' }); }
}

function focusables() {
  var scope = modalOpen() ? '#modal [data-f]' : '.screen.active [data-f]';
  if (state.screen === 'player') scope = menuOpen() ? '#track-menu [data-f]' : '#controls [data-f], #seekbar, #next-episode.show';
  return Array.prototype.filter.call(document.querySelectorAll(scope), function (el) { return el.offsetParent !== null; });
}

function move(dir) {
  var list = focusables();
  var cur = document.activeElement;
  if (list.indexOf(cur) < 0) { if (list[0]) list[0].focus(); return; }
  var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  var best = null, bestScore = Infinity;
  list.forEach(function (el) {
    if (el === cur) return;
    var q = el.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
    var vertical = dir === 'up' || dir === 'down';
    if ((dir === 'up' && dy >= -1) || (dir === 'down' && dy <= 1) || (dir === 'left' && dx >= -1) || (dir === 'right' && dx <= 1)) return;
    var score = vertical ? Math.abs(dy) + Math.abs(dx) * 3 : Math.abs(dx) + Math.abs(dy) * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
}

document.addEventListener('keydown', function (e) {
  var el = document.activeElement;
  // Fenêtre modale ouverte : navigation limitée à ses boutons, RETOUR la ferme
  if (modalOpen()) {
    e.preventDefault();
    if (e.keyCode === KEY.BACK) closeModal();
    else if (e.keyCode === KEY.UP) move('up');
    else if (e.keyCode === KEY.DOWN) move('down');
    else if (e.keyCode === KEY.ENTER && el && el.hasAttribute('data-f')) el.click();
    return;
  }
  if (state.screen === 'player') { playerKey(e); return; }
  // Saisie dans le vrai champ (clavier Samsung) : il garde les flèches, on ne gère que valider / annuler
  if (el && el.id === 'query') {
    if (e.keyCode === KEY.ENTER || e.keyCode === KEY.IME_DONE) { e.preventDefault(); closeSearch(true); }
    else if (e.keyCode === KEY.IME_CANCEL || e.keyCode === KEY.BACK) { e.preventDefault(); closeSearch(false); }
    return;
  }
  switch (e.keyCode) {
    case KEY.UP: e.preventDefault(); move('up'); break;
    case KEY.DOWN: e.preventDefault(); move('down'); break;
    case KEY.LEFT: e.preventDefault(); move('left'); break;
    case KEY.RIGHT: e.preventDefault(); move('right'); break;
    case KEY.ENTER:
      if (el && el.hasAttribute('data-f')) { e.preventDefault(); el.click(); }
      break;
    case KEY.BACK:
      e.preventDefault();
      if (state.screen === 'home') tizen.application.getCurrentApplication().exit();
      else if (state.screen === 'detail') show(state.detailFrom);
      else if (state.screen === 'files') openDownloads();
      else show('home');
      break;
  }
});

// ---------- c411 ----------
// Filtre familial, appliqué à toutes les réponses c411 (accueil, onglets, recherche, « Voir plus », fiches) :
// uniquement Films & Vidéos (sous-catégories connues) et aucun nom à caractère adulte. c411 masque la catégorie XXX
// pour ce compte, mais du contenu adulte peut être mal classé (ex. hentai en « Animation Série »).
var SAFE_CATEGORY = 1;
var SAFE_SUBCATEGORIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 54, 57];
var ADULT_NAME = /\b(hentai|porn\w*|brazzers|onlyfans|bangbros|reality\s*kings|naughty\s*america|blacked|tushy|jav|uncensored|erotic\w*|érotique\w*|erotique\w*|nsfw|milf|xvideos|playboy\s*tv)\b/i;

function isFamilySafe(t) {
  if (!t) return false;
  if (t.category) {
    if (t.category.isXxx || Number(t.category.id || t.category) !== SAFE_CATEGORY) return false;
  }
  var sub = t.subcategory && (t.subcategory.id || t.subcategory);
  if (sub && SAFE_SUBCATEGORIES.indexOf(Number(sub)) < 0) return false;
  var name = String(t.name || '').replace(/[._]/g, ' ');
  if (ADULT_NAME.test(name)) return false;
  // « XXX » comme balise au milieu d'un nom de release (mais pas le film « xXx » en début de titre)
  if (/\S\s+XXX\b/i.test(name)) return false;
  return true;
}

function c411(path, params) {
  var qs = Object.keys(params || {}).filter(function (k) { return params[k] !== '' && params[k] != null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
  qs.push('apikey=' + encodeURIComponent(S.c411ApiKey));
  return fetch(C411 + path + '?' + qs.join('&'), { headers: { Accept: 'application/json' } }).then(function (res) {
    if (!res.ok) throw new Error('c411 a répondu HTTP ' + res.status);
    return res.json();
  }).then(function (json) {
    if (/^\/api\/torrents\/?$/.test(path) && json && Array.isArray(json.data)) {
      var before = json.data.length;
      json.data = json.data.filter(isFamilySafe);
      if (before !== json.data.length) debug('info', 'filtre familial', { path: path, retires: before - json.data.length });
    } else if (/^\/api\/torrents\/[0-9a-f]{40}$/i.test(path) && !isFamilySafe(json)) {
      throw new Error('contenu non disponible');
    }
    return json;
  });
}

// « Has.Fallen.2026.S02E01.VFF.2160p… » → { title: "Has Fallen", year: "2026", episode: "S02E01" }
function prettyName(name) {
  var clean = String(name).replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '').replace(/[._]/g, ' ');
  var episode = (clean.match(/\bS\d{1,2}(E\d{1,3})?\b/i) || [''])[0].toUpperCase();
  var m = clean.match(/^(.*?)\s*\(?\b(19\d{2}|20\d{2})\b\)?/);
  var title = (m && m[1].trim()) || clean.split(/\b(S\d{1,2}|MULTI|VFF|VF2|VFQ|FRENCH|TRUEFRENCH|2160p|1080p|720p)\b/i)[0].trim() || clean;
  return { title: title.replace(/\s+S\d{1,2}(E\d{1,3})?$/i, ''), year: m ? m[2] : '', episode: episode };
}
function label(name) { var n = prettyName(name); return n.title + (n.episode ? ' · ' + n.episode : ''); }
function resolution(name) { return /2160p|4K|UHD/i.test(name) ? '4K' : /1080p/i.test(name) ? '1080p' : /720p/i.test(name) ? '720p' : ''; }
function shortLang(language, name) {
  var src = (language || '') + ' ' + name;
  var m = src.match(/\b(MULTI|VFF|VF2|VFQ|VFI|TRUEFRENCH|VOSTFR)\b/i);
  return m ? m[1].toUpperCase() : /fran/i.test(language || '') ? 'VF' : '';
}
function nameAudioOk(name) { return /\b(AC3|EAC3|E-AC3|DDP|DD\+|DD5|AAC|Opus)\b/i.test(name) || !/\b(DTS|TrueHD)\b/i.test(name); }
function poster(url, size) { return url ? url.replace(/\/t\/p\/w\d+\//, '/t/p/' + size + '/') : ''; }
function gb(bytes) { return (Number(bytes || 0) / 1e9).toFixed(1) + ' Go'; }

function cardHtml(prefix, t) {
  var n = prettyName(t.name);
  var text = n.title + (n.episode ? ' · ' + n.episode : '') + (n.year ? ' (' + n.year + ')' : '');
  var img = t.posterUrl
    ? '<img src="' + esc(poster(t.posterUrl, 'w342')) + '" loading="lazy" onerror="this.remove()">'
    : '';
  return '<div class="card" data-f tabindex="-1" id="' + prefix + t.infoHash + '" data-hash="' + t.infoHash + '">'
    + '<div class="poster"><div class="ph">' + esc(n.title) + '</div>' + img
    + (resolution(t.name) ? '<span class="q">' + resolution(t.name) + '</span>' : '')
    + (nameAudioOk(t.name) ? '' : '<span class="q warn">⚠️ son</span>') + '</div>'
    + '<div class="cap">' + esc(text) + '</div>'
    + '<div class="sub">' + esc([shortLang(t.language, t.name), gb(t.size), '▲ ' + (t.seeders || 0)].filter(Boolean).join(' · ')) + '</div>'
    + '</div>';
}

function renderGrid(gridId, prefix, bucket, append) {
  var grid = $(gridId);
  var oldMore = grid.querySelector('.more');
  if (oldMore) oldMore.remove();
  var start = append ? bucket.items.length - bucket.lastBatch : 0;
  var html = bucket.items.slice(start).map(function (t) { return cardHtml(prefix, t); }).join('');
  if (bucket.items.length < bucket.total) {
    html += '<div class="card more" data-f tabindex="-1" id="' + prefix + 'more" data-more="1"><div class="poster">➕</div><div class="cap">Voir plus</div><div class="sub">' + bucket.items.length + ' / ' + bucket.total + '</div></div>';
  }
  if (append) grid.insertAdjacentHTML('beforeend', html); else grid.innerHTML = html || '<div class="empty">Aucun résultat.</div>';
  return start;
}

async function loadHome(reset) {
  var b = state.home;
  if (reset) { b.page = 0; b.items = []; }
  try {
    var j = await c411('/api/torrents', { category: 1, subcat: state.subcat, sortBy: 'createdAt', sortOrder: 'desc', perPage: PER_PAGE, page: b.page + 1 });
    b.page += 1;
    b.total = j.meta ? j.meta.total : j.data.length;
    b.lastBatch = j.data.length;
    b.items = b.items.concat(j.data);
    var start = renderGrid('home-grid', 'h-', b, !reset);
    if (!reset && b.items[start]) $('h-' + b.items[start].infoHash).focus();
  } catch (e) {
    toast('Impossible de charger les nouveautés : ' + e.message, true);
  }
}

async function search(reset) {
  var b = state.results;
  if (reset) {
    var q = $('query').value.trim();
    if (!q) { toast('Tapez un titre à rechercher'); return; }
    b.q = q; b.page = 0; b.items = [];
    toast('Recherche de « ' + q + ' »…');
  }
  try {
    var j = await c411('/api/torrents', { name: b.q, category: 1, sortBy: 'relevance', perPage: PER_PAGE, page: b.page + 1 });
    b.page += 1;
    b.total = j.meta ? j.meta.total : j.data.length;
    b.lastBatch = j.data.length;
    b.items = b.items.concat(j.data);
    $('results-title').innerHTML = esc(b.total + ' résultat(s) pour « ' + b.q + ' »') + '<small>RETOUR nouvelle recherche</small>';
    var start = renderGrid('results-grid', 'r-', b, !reset);
    if (reset) { state.lastFocus.results = null; show('results'); }
    else if (b.items[start]) $('r-' + b.items[start].infoHash).focus();
  } catch (e) {
    toast('Recherche impossible : ' + e.message, true);
  }
}

// MediaInfo (nfoContent) → pistes réelles d'un type donné (« Audio », « Text »), dans l'ordre du fichier
function mediaTracks(nfo, kind) {
  if (!nfo) return [];
  return String(nfo).split(/\n\s*\n/).filter(function (block) { return new RegExp('^\\s*' + kind + '\\b', 'i').test(block); }).map(function (block) {
    var get = function (k) { return ((block.match(new RegExp('^' + k + '\\s*:\\s*(.+)$', 'mi')) || [])[1] || '').trim(); };
    return { format: get('Format'), channels: get('Channel\\(s\\)'), lang: get('Language'), title: get('Title'), forced: get('Forced') };
  }).filter(function (t) { return t.format; });
}
function parseAudio(nfo) { return mediaTracks(nfo, 'Audio'); }
function trackOk(t) { var f = t.format.toUpperCase(); return !/DTS|MLP|TRUEHD/.test(f) && /AC-3|AAC|OPUS|MPEG AUDIO|PCM|DOLBY DIGITAL/.test(f); }
var LANG = { French: 'Français', English: 'Anglais', Japanese: 'Japonais', Spanish: 'Espagnol', German: 'Allemand', Italian: 'Italien' };

async function openDetail(hash, from) {
  state.detailFrom = from;
  var item = (from === 'home' ? state.home.items : state.results.items).filter(function (t) { return t.infoHash === hash; })[0] || {};
  var n = prettyName(item.name || '');
  // Affichage immédiat avec les données de la liste, puis enrichissement
  $('d-backdrop').style.backgroundImage = '';
  $('d-poster').src = poster(item.posterUrl, 'w500') || '';
  $('d-title').textContent = n.title + (n.episode ? ' · ' + n.episode : '');
  $('d-meta').textContent = n.year;
  $('d-overview').textContent = 'Chargement de la fiche…';
  $('d-people').innerHTML = '';
  $('d-release').textContent = item.name || '';
  $('d-badges').innerHTML = '';
  $('d-audio').textContent = '';
  state.detail = { infoHash: hash, name: item.name, size: item.size };
  show('detail', $('d-download'));

  try {
    var d = await c411('/api/torrents/' + hash);
    if (state.detail.infoHash !== hash) return;
    var meta = d.metadata || {};
    var tmdb = meta.tmdbData || {};
    state.detail = { infoHash: hash, name: d.name, size: d.size };

    if (tmdb.backdropUrl) $('d-backdrop').style.backgroundImage = 'url("' + tmdb.backdropUrl + '")';
    if (tmdb.posterUrl) $('d-poster').src = tmdb.posterUrl;
    $('d-title').textContent = (tmdb.title || n.title) + (n.episode ? ' · ' + n.episode : '');
    $('d-meta').textContent = [
      tmdb.year || n.year,
      tmdb.rating ? '★ ' + tmdb.rating.toFixed(1) : '',
      tmdb.runtime ? Math.floor(tmdb.runtime / 60) + ' h ' + ('0' + tmdb.runtime % 60).slice(-2) : '',
      (tmdb.genres || []).slice(0, 3).join(', ')
    ].filter(Boolean).join(' · ');
    var fallback = String(d.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    $('d-overview').textContent = tmdb.overview || fallback || 'Pas de description.';
    $('d-people').innerHTML = [
      (tmdb.directors || []).length ? '<b>Réalisation :</b> ' + esc(tmdb.directors.slice(0, 2).join(', ')) : '',
      (tmdb.cast || []).length ? '<b>Avec :</b> ' + esc(tmdb.cast.slice(0, 4).map(function (c) { return c.name; }).join(', ')) : ''
    ].filter(Boolean).join('<br>');

    var langOpt = (meta.options || []).filter(function (o) { return o.slug === 'langue'; })[0];
    var tracks = parseAudio(meta.nfoContent);
    var ok = tracks.length ? tracks.some(trackOk) : nameAudioOk(d.name);
    $('d-release').textContent = d.name;
    $('d-badges').innerHTML = [
      resolution(d.name) ? '<span class="badge">' + resolution(d.name) + '</span>' : '',
      langOpt ? '<span class="badge">' + esc(langOpt.values.map(function (v) { return v.value; }).join(', ')) + '</span>' : '',
      '<span class="badge">' + gb(d.size) + '</span>',
      '<span class="badge">▲ ' + (d.seeders || 0) + ' sources</span>',
      '<span class="badge">' + (d.files || []).length + ' fichier(s)</span>',
      ok ? '<span class="badge ok">📺 son lisible par la TV</span>' : '<span class="badge warn">⚠️ son non lisible par la TV (DTS/TrueHD)</span>'
    ].join('');
    $('d-audio').textContent = tracks.length
      ? 'Audio : ' + tracks.map(function (t) { return (LANG[t.lang] || t.lang || '?') + ' ' + t.format + (t.channels ? ' ' + t.channels.replace(/ channels?/, ' can.') : '') + (trackOk(t) ? '' : ' ✗'); }).join(' · ')
      : '';
  } catch (e) {
    $('d-overview').textContent = 'Fiche indisponible.';
    toast('Fiche indisponible : ' + e.message, true);
  }
}

function onGridClick(from) {
  return function (e) {
    var card = e.target.closest('[data-hash],[data-more]');
    if (!card) return;
    if (card.hasAttribute('data-more')) { if (from === 'home') loadHome(false); else search(false); return; }
    openDetail(card.getAttribute('data-hash'), from);
  };
}

// ---------- Freebox ----------
async function fbx(path, opts, retried) {
  opts = opts || {};
  if (!state.session) await openSession();
  var headers = Object.assign({ 'X-Fbx-App-Auth': state.session }, opts.headers || {});
  var res = await fetch(FBX + path, Object.assign({}, opts, { headers: headers }));
  var json = await res.json();
  if (!json.success && (json.error_code === 'auth_required' || json.error_code === 'invalid_session') && !retried) {
    state.session = null;
    return fbx(path, opts, true);
  }
  if (!json.success) throw new Error('Freebox : ' + (json.msg || json.error_code));
  return json.result;
}

async function openSession() {
  var ch = (await (await fetch(FBX + '/login/')).json()).result.challenge;
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey('raw', enc.encode(S.freeboxAppToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  var sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ch)));
  var password = Array.prototype.map.call(sig, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  var json = await (await fetch(FBX + '/login/session/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: S.freeboxAppId, password: password }) })).json();
  if (!json.success) throw new Error('connexion Freebox refusée : ' + (json.msg || json.error_code));
  state.session = json.result.session_token;
}

var downloading = false;
async function startDownload() {
  var d = state.detail;
  if (!d || downloading) return;
  downloading = true;
  $('d-download').textContent = '⏳ Envoi à la Freebox…';
  try {
    var res = await fetch(C411 + '/api?t=get&id=' + d.infoHash + '&apikey=' + encodeURIComponent(S.c411ApiKey));
    if (!res.ok) throw new Error('c411 a refusé le .torrent (HTTP ' + res.status + ')');
    var blob = await res.blob();
    var head = new TextDecoder().decode(await blob.slice(0, 1).arrayBuffer());
    if (head !== 'd') throw new Error('fichier reçu invalide (pas un .torrent)');
    var form = new FormData();
    form.append('download_file', new Blob([blob], { type: 'application/x-bittorrent' }), d.infoHash + '.torrent');
    var added = await fbx('/downloads/add', { method: 'POST', body: form });
    debug('info', 'téléchargement ajouté', { id: added.id, name: d.name });
    toast('✅ Ajouté à la Freebox : ' + prettyName(d.name).title);
    state.lastFocus.downloads = null;
    openDownloads();
  } catch (e) {
    toast('Échec : ' + e.message, true);
  } finally {
    downloading = false;
    $('d-download').textContent = '📥 Télécharger sur la Freebox';
  }
}

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

// ---------- Téléchargements ----------
var STATUS = { downloading: 'Téléchargement', seeding: 'Partage', done: 'Terminé', stopped: 'En pause', queued: 'En attente', error: 'Erreur', checking: 'Vérification', stopping: 'Arrêt', retry: 'Nouvel essai', starting: 'Démarrage', extracting: 'Extraction', repairing: 'Réparation' };
var ICON = { downloading: '⬇️', seeding: '✅', done: '✅', stopped: '⏸', queued: '⏳', error: '⚠️', checking: '🔍', starting: '⏳', retry: '🔁' };
// Date d'un média : ajout du téléchargement associé ou dernière modification de ses fichiers
function mediaDate(m) { return Math.max(m.task ? m.task.created_ts || 0 : 0, m.mtime || 0); }
var SORTS = {
  recent: function (a, b) { return mediaDate(b) - mediaDate(a); },
  old: function (a, b) { return mediaDate(a) - mediaDate(b); },
  az: function (a, b) { return label(a.name).localeCompare(label(b.name), 'fr', { numeric: true }); },
  za: function (a, b) { return label(b.name).localeCompare(label(a.name), 'fr', { numeric: true }); },
  size: function (a, b) { return b.size - a.size; }
};

function fmtEta(s) { if (!s) return ''; var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? h + ' h ' + m + ' min' : m + ' min'; }
function fmtDate(ts) {
  var d = new Date(ts * 1000), now = new Date();
  var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  var days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return "aujourd'hui " + hm;
  if (days === 1) return 'hier ' + hm;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function isPlayable(t) { return t.rx_pct >= 10000 && (t.status === 'done' || t.status === 'seeding' || t.status === 'stopped'); }

// Médias : vidéos des disques (films et dossiers d'épisodes), avec la progression des téléchargements associés
function renderDownloads() {
  var focusedId = document.activeElement && document.activeElement.getAttribute('data-id');
  var focusedMore = document.activeElement && document.activeElement.getAttribute('data-more-id');
  var media = state.media;
  var list = media.entries.map(function (m, i) { return { m: m, i: i }; })
    .sort(function (a, b) { return SORTS[state.dlSort](a.m, b.m); });
  $('dl-count').textContent = media.entries.length + ' média(s)' + (media.scanning ? ' · analyse des disques… ' + media.progress : '');
  $('downloads-list').innerHTML = list.map(function (x) {
    var m = x.m, t = m.task;
    var inProgress = !!t && !isPlayable(t);
    var active = !!t && t.status === 'downloading';
    var pct = t ? (t.rx_pct || 0) / 100 : 0;
    var seen = watchedBadge(mediaOwner(m));
    var icon = inProgress ? (ICON[t.status] || '⬇️') : m.kind === 'folder' ? '📁' : '🎬';
    var meta = [];
    if (m.kind === 'folder') meta.push(m.files.length + ' vidéos');
    if (inProgress) meta.push((STATUS[t.status] || t.status) + (active ? ' · ' + (t.rx_rate / 1e6).toFixed(1) + ' Mo/s · reste ' + fmtEta(t.eta) : ''));
    meta.push('ajouté ' + fmtDate(mediaDate(m)));
    if (!inProgress) meta.push('▶ OK pour regarder');
    return '<div class="item" data-f tabindex="-1" id="dl-' + x.i + '" data-id="' + x.i + '">'
      + '<span class="icon">' + icon + '</span>'
      + '<div class="main"><div class="title">' + esc(label(m.name)) + (seen ? ' <span class="seen">' + seen + '</span>' : '') + '</div>'
      + '<div class="meta">' + esc(meta.join(' · ')) + '</div></div>'
      + '<span class="size">' + gb(m.size) + '</span>'
      + (t
        ? '<div class="progress' + (active ? ' active' : '') + '"><div style="width:' + pct.toFixed(1) + '%"></div></div><span class="pct">' + pct.toFixed(0) + ' %</span>'
        : '<div class="progress" style="visibility:hidden"></div><span class="pct"></span>')
      + '<span class="more-btn" data-f tabindex="-1" id="more-' + x.i + '" data-more-id="' + x.i + '">⋯</span>'
      + '</div>';
  }).join('') || '<div class="empty">' + (media.scanning ? 'Analyse des disques en cours…' : 'Aucune vidéo trouvée.') + '</div>';
  if (focusedMore && $('more-' + focusedMore)) $('more-' + focusedMore).focus();
  else if (focusedId && $('dl-' + focusedId)) $('dl-' + focusedId).focus();
}

// Index des vidéos : cache immédiat, réanalyse des disques en arrière-plan (au plus toutes les 10 min,
// à la fin d'un téléchargement, ou à la demande avec « Actualiser »)
var MEDIA_MAX_AGE = 10 * 60 * 1000;
var mediaCache = Media.loadCache();
state.media = {
  grouped: mediaCache && mediaCache.videos ? Media.group(mediaCache.videos) : [],
  entries: [],
  scannedAt: mediaCache ? mediaCache.at || 0 : 0,
  scanning: false,
  progress: ''
};

// Propriétaire d'un média pour les fichiers vus et les positions : le téléchargement associé (info_hash), sinon son chemin
function mediaOwner(m) { return m.task || { id: 'path:' + m.path, name: m.name }; }

function updateMediaEntries() { state.media.entries = Media.attachTasks(state.media.grouped, state.tasks); }

async function scanMedia(force) {
  var media = state.media;
  if (media.scanning || (!force && media.scannedAt && Date.now() - media.scannedAt < MEDIA_MAX_AGE)) return;
  media.scanning = true;
  media.progress = '';
  if (state.screen === 'downloads') renderDownloads();
  var started = Date.now();
  try {
    var videos = await Media.scan(function (path) {
      return fbx('/fs/ls/' + Media.utf8ToB64(path) + '?removeHidden=1').then(function (r) { return (r && r.entries) || []; });
    }, function (dirs, count) {
      media.progress = dirs + ' dossiers, ' + count + ' vidéos';
      if (state.screen === 'downloads') $('dl-count').textContent = 'analyse des disques… ' + media.progress;
    });
    media.grouped = Media.group(videos);
    media.scannedAt = Date.now();
    Media.saveCache(videos);
    updateMediaEntries();
    debug('info', 'médias indexés', { videos: videos.length, medias: media.grouped.length, ms: Date.now() - started });
  } catch (e) {
    toast('Analyse des disques impossible : ' + e.message, true);
  } finally {
    media.scanning = false;
    if (state.screen === 'downloads') renderDownloads();
  }
}

async function refreshDownloads() {
  try {
    var previous = state.tasks;
    state.tasks = (await fbx('/downloads/')) || [];
    // Un téléchargement vient de se terminer : réanalyser les disques pour y trouver ses vidéos
    var finished = state.tasks.some(function (t) {
      var before = previous.filter(function (p) { return p.id === t.id; })[0];
      return before && !isPlayable(before) && isPlayable(t);
    });
    updateMediaEntries();
    if (finished) scanMedia(true);
    if (state.screen === 'downloads') renderDownloads();
  } catch (e) {
    toast('Freebox injoignable : ' + e.message, true);
  }
}

$('dl-rescan').addEventListener('click', function () { scanMedia(true); });

async function openDownloads() {
  show('downloads');
  stopPolling();
  updateMediaEntries();
  renderDownloads(); // affichage immédiat depuis le cache
  scanMedia(false);  // réanalyse en arrière-plan si l'index a plus de 10 min
  await refreshDownloads();
  if (!document.activeElement || !document.activeElement.hasAttribute('data-id')) {
    var target = (state.lastFocus.downloads && $(state.lastFocus.downloads)) || $('downloads-list').querySelector('[data-id]');
    if (target) { target.focus(); target.scrollIntoView({ block: 'nearest' }); }
  }
  state.pollTimer = setInterval(refreshDownloads, 3000);
}
function stopPolling() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

async function onTaskClick(index) {
  var m = state.media.entries[index];
  if (!m) return;
  var t = m.task;
  if (m.kind === 'task' || (t && !isPlayable(t))) {
    toast(t.status === 'error' ? 'Ce téléchargement est en erreur.' : 'Pas encore disponible : ' + ((t.rx_pct || 0) / 100).toFixed(0) + ' % téléchargés' + (t.eta ? ', reste ' + fmtEta(t.eta) : ''));
    return;
  }
  if (!m.files.length) { toast('Aucune vidéo trouvée pour ce média.'); return; }
  var owner = mediaOwner(m);
  setVideoCount(owner, m.files.length);
  if (m.files.length === 1) { play(m.files[0], 'downloads', owner); return; }
  state.filesTask = { task: owner, files: m.files };
  renderFiles();
  showFiles();
}

// ---------- Menu « ⋯ » et suppression ----------
var modalState = { buttons: [], returnFocusId: null };

function modalOpen() { return $('modal').classList.contains('open'); }

// Fenêtre modale : { title, text, warn, buttons: [{ label, danger, focus, action }] }
function openModal(opts) {
  if (!modalOpen()) modalState.returnFocusId = document.activeElement && document.activeElement.id;
  modalState.buttons = opts.buttons || [];
  $('modal-title').textContent = opts.title || '';
  $('modal-text').textContent = opts.text || '';
  $('modal-warn').textContent = opts.warn || '';
  $('modal-warn').style.display = opts.warn ? 'block' : 'none';
  $('modal-buttons').innerHTML = modalState.buttons.map(function (b, i) {
    return '<span class="btn' + (b.danger ? ' danger' : '') + '" data-f tabindex="-1" id="modal-btn-' + i + '" data-modal-btn="' + i + '">' + esc(b.label) + '</span>';
  }).join('');
  $('modal').classList.add('open');
  var focusIndex = Math.max(0, modalState.buttons.findIndex(function (b) { return b.focus; }));
  if ($('modal-btn-' + focusIndex)) $('modal-btn-' + focusIndex).focus();
}

function closeModal() {
  $('modal').classList.remove('open');
  var back = modalState.returnFocusId && $(modalState.returnFocusId);
  modalState.returnFocusId = null;
  if (back) back.focus();
}

$('modal-buttons').addEventListener('click', function (e) {
  var el = e.target.closest('[data-modal-btn]');
  if (!el) return;
  var b = modalState.buttons[Number(el.getAttribute('data-modal-btn'))];
  if (b && b.action) b.action(); else closeModal();
});

// Décision de suppression (fonction pure, testable) :
//  - média associé à un ou plusieurs téléchargements → suppression du téléchargement (avec ou sans les fichiers) ;
//  - sinon → suppression des fichiers / dossiers calculés par Media.deletionTargets.
function deletePlan(m, tasks, grouped, nowMs) {
  var related = Media.tasksFor(m, tasks);
  if (related.length) {
    var young = related.filter(function (t) { return t.status === 'seeding' && nowMs / 1000 - t.created_ts < 48 * 3600; });
    var hours = young.length ? Math.floor(Math.min.apply(null, young.map(function (t) { return nowMs / 1000 - t.created_ts; })) / 3600) : 0;
    return {
      mode: 'download', tasks: related,
      warn: young.length ? '⚠️ Partage en cours depuis ' + hours + ' h : c411 demande au moins 48 h de partage (ratio).' : ''
    };
  }
  return { mode: 'files', targets: Media.deletionTargets(m, grouped) };
}

function describeTargets(m, targets) {
  var isFile = function (p) { return m.files.some(function (f) { return f.path === p; }); };
  if (targets.length === 1) {
    var name = targets[0].split('/').pop();
    return isFile(targets[0])
      ? 'Le fichier « ' + name + ' » sera supprimé du disque.'
      : 'Le dossier « ' + name + ' » et tout son contenu seront supprimés du disque.';
  }
  return targets.length + ' éléments seront supprimés du disque :\n'
    + targets.slice(0, 4).map(function (p) { return '• ' + p.split('/').pop(); }).join('\n')
    + (targets.length > 4 ? '\n• … et ' + (targets.length - 4) + ' autre(s)' : '');
}

function openMediaMenu(index) {
  var m = state.media.entries[index];
  if (!m) return;
  openModal({
    title: label(m.name),
    text: m.kind === 'folder' ? m.files.length + ' vidéos · ' + gb(m.size) : gb(m.size),
    buttons: [
      { label: '🗑 Supprimer…', danger: true, action: function () { confirmDelete(m); } },
      { label: 'Annuler', action: closeModal }
    ]
  });
}

function confirmDelete(m) {
  var plan = deletePlan(m, state.tasks, state.media.grouped, Date.now());
  if (plan.mode === 'download') {
    var n = plan.tasks.length;
    openModal({
      title: n > 1 ? 'Supprimer les ' + n + ' téléchargements ?' : 'Supprimer le téléchargement ?',
      text: label(m.name),
      warn: plan.warn,
      buttons: [
        { label: '🗑 Supprimer le téléchargement et les fichiers', danger: true, action: function () { runDelete(m, function () { return deleteDownloads(plan.tasks, true); }, plan.tasks.map(Media.taskPath)); } },
        { label: 'Supprimer uniquement le téléchargement (garder les fichiers)', action: function () { runDelete(m, function () { return deleteDownloads(plan.tasks, false); }, []); } },
        { label: 'Annuler', focus: true, action: closeModal }
      ]
    });
  } else if (!plan.targets.length) {
    toast('Rien à supprimer pour ce média.');
    closeModal();
  } else {
    openModal({
      title: 'Supprimer définitivement ?',
      text: label(m.name) + '\n\n' + describeTargets(m, plan.targets),
      buttons: [
        { label: '🗑 Supprimer', danger: true, action: function () { runDelete(m, function () { return deleteFiles(plan.targets); }, plan.targets); } },
        { label: 'Annuler', focus: true, action: closeModal }
      ]
    });
  }
}

async function deleteDownloads(tasks, withFiles) {
  for (var i = 0; i < tasks.length; i++) {
    await fbx('/downloads/' + tasks[i].id + (withFiles ? '/erase' : ''), { method: 'DELETE' });
  }
}

// Suppression de fichiers / dossiers : tâche asynchrone de la Freebox, suivie jusqu'à la fin puis nettoyée
async function deleteFiles(paths) {
  var task = await fbx('/fs/rm/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: paths.map(function (p) { return Media.utf8ToB64(p); }) }) });
  var started = Date.now();
  while (task && task.state !== 'done' && task.state !== 'failed') {
    if (Date.now() - started > 120000) throw new Error('la suppression prend trop de temps');
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
    task = await fbx('/fs/tasks/' + task.id);
  }
  if (task) fbx('/fs/tasks/' + task.id, { method: 'DELETE' }).catch(function () {});
  if (task && task.state === 'failed') throw new Error('la Freebox a refusé (' + task.error + ')');
}

// Retire de l'index les vidéos situées sous les chemins supprimés, puis regroupe
function removeFromIndex(paths) {
  var media = state.media;
  var gone = function (p) { return paths.some(function (d) { return p === d || p.indexOf(d + '/') === 0; }); };
  var videos = [];
  media.grouped.forEach(function (x) { x.files.forEach(function (f) { if (!gone(f.path)) videos.push(f); }); });
  media.grouped = Media.group(videos);
  Media.saveCache(videos);
  updateMediaEntries();
}

var deleting = false;
async function runDelete(m, operation, removedPaths) {
  if (deleting) return;
  deleting = true;
  closeModal();
  toast('Suppression en cours…');
  try {
    await operation();
    if (removedPaths.length) removeFromIndex(removedPaths);
    await refreshDownloads();
    toast('🗑 Supprimé : ' + label(m.name));
    debug('info', 'média supprimé', { chemins: removedPaths.length });
  } catch (e) {
    toast('Suppression impossible : ' + e.message, true);
  } finally {
    deleting = false;
    if (state.screen === 'downloads' && !$('downloads-list').contains(document.activeElement)) {
      var first = $('downloads-list').querySelector('[data-f]');
      if (first) first.focus();
    }
  }
}

function renderFiles() {
  var ft = state.filesTask;
  if (!ft) return;
  var entry = watchedEntry(ft.task);
  var seenCount = ft.files.filter(function (f) { return entry.files[f.name]; }).length;
  $('files-title').textContent = label(ft.task.name) + ' — ' + ft.files.length + ' vidéos' + (seenCount ? ' · ' + seenCount + ' vue(s)' : '');
  $('files-list').innerHTML = ft.files.map(function (f, i) {
    var seen = !!entry.files[f.name];
    return '<div class="item" data-f tabindex="-1" id="file-' + i + '" data-file="' + i + '">'
      + '<span class="icon' + (seen ? ' seen' : '') + '">' + (seen ? '👁' : '▶') + '</span>'
      + '<div class="main"><div class="title">' + esc(label(f.name)) + (seen ? ' <span class="seen">Vu</span>' : '') + '</div>'
      + '<div class="meta">' + esc(f.name) + '</div></div>'
      + '<span class="size">' + gb(f.size) + '</span></div>';
  }).join('');
}

// Ouvre la liste sur le premier fichier non vu (ou le premier si tout a été vu)
function showFiles() {
  var ft = state.filesTask;
  var entry = watchedEntry(ft.task);
  var index = ft.files.findIndex(function (f) { return !entry.files[f.name]; });
  var target = $('file-' + (index < 0 ? 0 : index));
  show('files', target);
  if (target) target.scrollIntoView({ block: 'center' });
}

// ---------- Lecteur (AVPlay, décodeur matériel de la TV) ----------
var player = {
  returnTo: 'downloads', task: null, file: null, audio: [], text: [], currentAudio: null, currentText: 'default',
  info: { audio: [], text: [] }, tick: null, osdTimer: null, subTimer: null, watchdog: null
};

// Serveur UPnP/DLNA de la Freebox : bon type MIME, HEAD et Range, sans authentification (réseau local uniquement).
// Il refuse le nom mafreebox.freebox.fr (403) : il faut l'adresse IP locale de la box.
var upnpHost = null;
async function upnpUrl(filepathB64) {
  if (!upnpHost) {
    try { upnpHost = (await fbx('/lan/config/')).ip; } catch (e) { debug('error', 'lan/config : ' + e.message); }
    upnpHost = upnpHost || '192.168.1.254';
  }
  var path = new TextDecoder().decode(Uint8Array.from(atob(filepathB64), function (c) { return c.charCodeAt(0); }));
  return 'http://' + upnpHost + ':52424/files' + path.split('/').map(encodeURIComponent).join('/');
}

function fmtTime(ms) {
  var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + sec).slice(-2);
}
function avState() { try { return webapis.avplay.getState(); } catch (e) { return 'NONE'; } }
function menuOpen() { return $('track-menu').classList.contains('open'); }

function osdState(text, ms) {
  var el = $('osd-state');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
  clearTimeout(osdState.t);
  if (text && ms) osdState.t = setTimeout(function () { el.style.display = 'none'; }, ms);
}

// Barre de contrôle : visible au moindre appui, masquée après 5 s d'inactivité
// (sauf pause, menu ouvert ou déplacement en cours sur la barre de lecture)
function showOsd(focusControls) {
  var osd = $('osd');
  var wasHidden = osd.classList.contains('hidden');
  osd.classList.remove('hidden');
  if (focusControls || wasHidden) {
    var cur = document.activeElement;
    if (!cur || !(cur === $('seekbar') || $('controls').contains(cur))) $('ctl-play').focus();
  }
  clearTimeout(player.osdTimer);
  player.osdTimer = setTimeout(function () {
    if (avState() === 'PLAYING' && !menuOpen() && player.scrub == null) osd.classList.add('hidden');
  }, 5000);
}

function updateOsd() {
  try {
    var av = webapis.avplay, cur = av.getCurrentTime(), dur = av.getDuration();
    $('osd-time').textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
    $('osd-bar').style.width = (dur ? cur / dur * 100 : 0).toFixed(2) + '%';
    renderSeekCursor(cur, dur);
    if (dur && cur / dur >= WATCHED_RATIO && player.task && player.file) markWatched(player.task, player.file.name);
    // Sauvegarde régulière de la position (TV éteinte, app fermée brutalement…)
    if (player.resumeReady && Date.now() - (player.positionSavedAt || 0) > 10000) {
      persistPosition(cur, dur);
      player.positionSavedAt = Date.now();
    }
    // Épisode suivant : bouton proposé au début du générique
    if (!player.nextShown && !player.nextDismissed && player.resumeReady && avState() === 'PLAYING' && dur) {
      var creditsAt = player.creditsAt != null ? player.creditsAt : creditsStart(null, dur);
      if (cur >= creditsAt && nextFile()) showNextEpisode();
    }
  } catch (e) { /* lecteur pas prêt */ }
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

// ---------- Épisode suivant (comme Netflix) ----------
// Fichier suivant du même dossier, dans l'ordre alphanumérique de la liste des vidéos
function nextFile() {
  var ft = state.filesTask;
  if (!ft || !player.file || !player.task || taskKey(ft.task) !== taskKey(player.task)) return null;
  var i = ft.files.map(function (f) { return f.name; }).indexOf(player.file.name);
  return i >= 0 && i + 1 < ft.files.length ? ft.files[i + 1] : null;
}

// « 43 min 43 s », « 1 h 2 min », « 22 min 50 s 120 ms » → millisecondes
function mediaDuration(text) {
  var ms = 0, m, re = /(\d+)\s*(h|min|ms|s)\b/g;
  var unit = { h: 3600000, min: 60000, ms: 1, s: 1000 };
  while ((m = re.exec(String(text || '')))) ms += Number(m[1]) * unit[m[2]];
  return ms;
}

// Début du générique de fin : chapitre du MediaInfo c411 s'il décrit bien ce fichier (même durée à 3 s près),
// sinon les dernières secondes de l'épisode (3 % de la durée, entre 40 s et 2 min)
var CREDITS_NAME = /credit|g[ée]n[ée]rique|ending|outro|\bend\b|\bfin\b/i;
function creditsStart(nfo, dur) {
  if (!dur) return null;
  var fallback = dur - Math.max(40000, Math.min(120000, dur * 0.03));
  var blocks = String(nfo || '').split(/\n\s*\n/);
  var general = blocks.filter(function (b) { return /^\s*General\b/i.test(b); })[0] || '';
  var nfoDur = mediaDuration((general.match(/^Duration\s*:\s*(.+)$/mi) || [])[1]);
  var menu = blocks.filter(function (b) { return /^\s*Menu\b/i.test(b); })[0];
  if (!menu || !nfoDur || Math.abs(nfoDur - dur) > 3000) return fallback;
  var chapters = menu.split('\n').map(function (line) {
    var m = line.match(/^\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*:\s*(.*)$/);
    return m ? { at: ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]), name: m[5] } : null;
  }).filter(Boolean);
  var named = chapters.filter(function (c) { return CREDITS_NAME.test(c.name) && c.at > dur * 0.5; }).pop();
  if (named) return named.at;
  var last = chapters[chapters.length - 1];
  if (last && last.at >= dur * 0.85 && dur - last.at <= 180000) return last.at;
  return fallback;
}

function showNextEpisode() {
  player.nextShown = true;
  $('next-episode').classList.add('show');
  if (!menuOpen()) $('next-episode').focus();
  debug('info', 'épisode suivant proposé', { position: webapis.avplay.getCurrentTime(), generique: player.creditsAt });
}

function hideNextEpisode() { $('next-episode').classList.remove('show'); }

function dismissNextEpisode() {
  player.nextDismissed = true;
  hideNextEpisode();
  $('ctl-play').focus();
  showOsd(false);
}

function playNextEpisode() {
  var next = nextFile(), task = player.task;
  if (!next) { hideNextEpisode(); return; }
  // L'épisode en cours est considéré comme terminé : vu, et sans position de reprise
  markWatched(task, player.file.name);
  clearPosition(task, player.file);
  player.resumeReady = false;
  hideNextEpisode();
  stopPlayback();
  play(next, 'files', task);
}

// Curseur de la barre de lecture : position réelle, ou position visée pendant un déplacement
function renderSeekCursor(cur, dur) {
  var target = player.scrub == null ? cur : player.scrub;
  var pct = dur ? Math.max(0, Math.min(100, target / dur * 100)) : 0;
  $('seek-cursor').style.left = pct + '%';
  var bubble = $('seek-label');
  bubble.style.left = Math.max(4, Math.min(96, pct)) + '%';
  if (player.scrub == null) {
    bubble.textContent = fmtTime(cur);
  } else {
    var delta = Math.round((player.scrub - cur) / 1000);
    bubble.textContent = fmtTime(player.scrub) + '  (' + (delta >= 0 ? '+' : '−') + fmtTime(Math.abs(delta) * 1000) + ')';
  }
}

// --- Pistes : langue normalisée, libellés, préférences mémorisées ---
var LANG_NAMES = { fr: 'Français', en: 'Anglais', ja: 'Japonais', es: 'Espagnol', de: 'Allemand', it: 'Italien', pt: 'Portugais', ko: 'Coréen', zh: 'Chinois', ru: 'Russe', nl: 'Néerlandais' };
function langCode(value) {
  var s = String(value || '').toLowerCase().trim();
  if (!s) return '';
  if (/^(fr|fre|fra)\b|fran/.test(s)) return 'fr';
  if (/^(en|eng)\b|english|anglais/.test(s)) return 'en';
  if (/^(ja|jpn)\b|japan/.test(s)) return 'ja';
  if (/^(es|spa)\b|spanish|espa/.test(s)) return 'es';
  if (/^(de|ger|deu)\b|german|allem/.test(s)) return 'de';
  if (/^(it|ita)\b|italian/.test(s)) return 'it';
  if (/^(pt|por)\b|portug/.test(s)) return 'pt';
  if (/^(ko|kor)\b|korean/.test(s)) return 'ko';
  if (/^(zh|chi|zho)\b|chinese/.test(s)) return 'zh';
  if (/^(ru|rus)\b|russian/.test(s)) return 'ru';
  if (/^(nl|dut|nld)\b|dutch/.test(s)) return 'nl';
  return s.slice(0, 2);
}
function extraInfo(t) { try { return JSON.parse(t.extra_info) || {}; } catch (e) { return {}; } }
function codecName(fourCC, format) {
  var f = String(fourCC || format || '').toLowerCase().replace(/^audio\/(x-)?/, '');
  var map = { eac3: 'E-AC-3', ac3: 'AC-3', 'mpeg': 'AAC', aac: 'AAC', opus: 'Opus', dts: 'DTS', truehd: 'TrueHD', mp3: 'MP3', flac: 'FLAC' };
  return map[f] || format || f.toUpperCase();
}
function channelsName(ch) { var n = parseInt(ch, 10); return n === 8 ? '7.1' : n === 6 ? '5.1' : n === 2 ? 'stéréo' : n === 1 ? 'mono' : (n ? n + ' can.' : ''); }

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } }
function savePrefs(patch) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.assign(loadPrefs(), patch))); } catch (e) { /* stockage indisponible */ } }

// Libellés des pistes : langue de AVPlay, complétée par le MediaInfo c411 (titre « VFF », « Forced »…) si les pistes concordent
function describeTracks() {
  var mia = player.info.audio.length === player.audio.length ? player.info.audio : [];
  var mit = player.info.text.length === player.text.length ? player.info.text : [];
  player.audio.forEach(function (t, i) {
    var ex = extraInfo(t), mi = mia[i] || {};
    t.lang = langCode(ex.language || mi.lang);
    t.title = mi.title || '';
    t.name = (LANG_NAMES[t.lang] || ex.language || 'Piste ' + (i + 1)) + (t.title ? ' — ' + t.title : '');
    t.desc = [codecName(ex.fourCC, mi.format), channelsName(ex.channels || mi.channels)].filter(Boolean).join(' · ');
  });
  player.text.forEach(function (t, i) {
    var ex = extraInfo(t), mi = mit[i] || {};
    t.lang = langCode(ex.track_lang || mi.lang);
    t.title = mi.title || '';
    t.forced = /yes/i.test(mi.forced || '') || /forc/i.test(t.title);
    t.image = /PGS|VobSub|DVB/i.test(mi.format || '');
    t.name = (t.lang ? (LANG_NAMES[t.lang] || t.lang) : 'Sous-titres ' + (i + 1)) + (t.title ? ' — ' + t.title : (t.forced ? ' — forcés' : ''));
    t.desc = t.image ? 'image, non affichable' : (mi.format && mi.format !== 'UTF-8' ? mi.format : '');
  });
}

function bestMatch(tracks, pref) {
  var cands = tracks.filter(function (t) { return t.lang && t.lang === pref.lang; });
  if (!cands.length) return null;
  if (typeof pref.forced === 'boolean') {
    var sameForced = cands.filter(function (t) { return !!t.forced === pref.forced; });
    if (sameForced.length) cands = sameForced;
  }
  if (pref.title) {
    var sameTitle = cands.filter(function (t) { return t.title && t.title.toLowerCase() === pref.title.toLowerCase(); });
    if (sameTitle.length) cands = sameTitle;
  }
  return cands[0];
}

function selectAudio(t, remember) {
  try {
    webapis.avplay.setSelectTrack('AUDIO', t.index);
    player.currentAudio = t;
    if (remember) savePrefs({ audio: { lang: t.lang, title: t.title } });
  } catch (e) {
    toast('Impossible de changer de piste audio : ' + (e.message || e.name), true);
  }
  renderTrackSummary();
}

function selectSubtitles(t, remember) {
  var av = webapis.avplay;
  try {
    if (!t) {
      av.setSilentSubtitle(true);
      $('subs').textContent = '';
      player.currentText = null;
      if (remember) savePrefs({ subs: { off: true } });
    } else {
      av.setSelectTrack('TEXT', t.index);
      av.setSilentSubtitle(false);
      player.currentText = t;
      if (remember) savePrefs({ subs: { lang: t.lang, forced: !!t.forced, title: t.title } });
    }
  } catch (e) {
    toast('Impossible de changer les sous-titres : ' + (e.message || e.name), true);
  }
  renderTrackSummary();
}

function applyPrefs() {
  var p = loadPrefs();
  if (p.audio && p.audio.lang) {
    var a = bestMatch(player.audio, p.audio);
    if (a && a !== player.currentAudio) selectAudio(a, false);
  }
  if (p.subs) {
    if (p.subs.off) selectSubtitles(null, false);
    else if (p.subs.lang) {
      var s = bestMatch(player.text.filter(function (t) { return !t.image; }), p.subs);
      if (s) selectSubtitles(s, false);
    }
  }
  debug('info', 'préférences appliquées', { prefs: p, audio: player.currentAudio && player.currentAudio.name, subs: player.currentText && player.currentText.name });
}

function renderTrackSummary() {
  var subs = player.currentText === 'default' ? 'défaut du fichier' : player.currentText ? player.currentText.name : 'désactivés';
  $('osd-tracks').textContent = '🔊 ' + (player.currentAudio ? player.currentAudio.name : '—') + '   💬 ' + subs;
}

// --- Menus Audio / Sous-titres ---
function openMenu(kind) {
  var items;
  if (kind === 'audio') {
    items = player.audio.map(function (t, i) { return { i: i, name: t.name, desc: t.desc, checked: t === player.currentAudio }; });
  } else {
    items = [{ i: -1, name: 'Désactivés', desc: '', checked: player.currentText === null }].concat(
      player.text.map(function (t, i) { return { i: i, name: t.name, desc: t.desc, checked: t === player.currentText }; }));
  }
  var menu = $('track-menu');
  menu.setAttribute('data-kind', kind);
  $('tm-title').textContent = kind === 'audio' ? '🔊 Langue audio' : '💬 Sous-titres';
  $('tm-list').innerHTML = items.length
    ? items.map(function (it) {
      return '<div class="tm-item" data-f tabindex="-1" id="tm-' + it.i + '" data-i="' + it.i + '">'
        + '<span class="check">' + (it.checked ? '✓' : '') + '</span><span>' + esc(it.name) + '</span>'
        + (it.desc ? '<span class="desc">' + esc(it.desc) + '</span>' : '') + '</div>';
    }).join('')
    : '<div class="tm-item"><span class="check"></span><span>Aucune piste disponible</span></div>';
  // Aligné au-dessus du bouton qui l'ouvre
  var btn = $(kind === 'audio' ? 'ctl-audio' : 'ctl-subs').getBoundingClientRect();
  menu.style.left = Math.max(40, Math.min(1920 - 800, btn.left)) + 'px';
  menu.classList.add('open');
  clearTimeout(player.osdTimer);
  var checked = items.filter(function (it) { return it.checked; })[0];
  var target = $('tm-' + (checked ? checked.i : items.length ? items[0].i : '')) || menu.querySelector('[data-f]');
  if (target) { target.focus(); target.scrollIntoView({ block: 'nearest' }); }
}

function closeMenu() {
  var kind = $('track-menu').getAttribute('data-kind');
  $('track-menu').classList.remove('open');
  $(kind === 'audio' ? 'ctl-audio' : 'ctl-subs').focus();
  showOsd(false);
}

$('tm-list').addEventListener('click', function (e) {
  var item = e.target.closest('[data-i]');
  if (!item) return;
  var i = Number(item.getAttribute('data-i'));
  if ($('track-menu').getAttribute('data-kind') === 'audio') {
    if (player.audio[i]) { selectAudio(player.audio[i], true); osdState('🔊 ' + player.audio[i].name, 1500); }
  } else {
    var t = i < 0 ? null : player.text[i];
    if (t && t.image) toast('Ces sous-titres sont en image (PGS) : la TV ne peut pas les afficher dans l\'app.');
    selectSubtitles(t, true);
    osdState('💬 ' + (t ? t.name : 'Sous-titres désactivés'), 1500);
  }
  closeMenu();
});

// --- Commandes ---
function togglePause() {
  var av = webapis.avplay, st = avState();
  if (st === 'PLAYING') { av.pause(); osdState('⏸ Pause'); $('ctl-play').textContent = '▶ Lecture'; }
  else if (st === 'PAUSED') { av.play(); osdState(''); $('ctl-play').textContent = '⏸ Pause'; }
}
function seek(seconds) {
  var av = webapis.avplay, st = avState();
  if (st !== 'PLAYING' && st !== 'PAUSED') return;
  try {
    if (seconds > 0) av.jumpForward(seconds * 1000); else av.jumpBackward(-seconds * 1000);
    osdState(seconds > 0 ? '⏩ +' + seconds + ' s' : '⏪ ' + seconds + ' s', 1000);
  } catch (e) { /* hors limites */ }
  updateOsd();
}

$('controls').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.getAttribute('data-act')) {
    case 'back': seek(-10); break;
    case 'toggle': togglePause(); break;
    case 'fwd': seek(30); break;
    case 'audio': openMenu('audio'); break;
    case 'subs': openMenu('subs'); break;
    case 'quit': stopPlayback(); break;
  }
});

// --- Barre de lecture : déplacer un curseur, puis sauter précisément à ce point ---
// Le pas accélère quand les appuis s'enchaînent (touche maintenue) : 10 s, 30 s, 1 min, 2 min, puis 5 % de la durée
var SCRUB_STEPS = [10000, 30000, 60000, 120000];

function scrubMove(direction) {
  var av = webapis.avplay, st = avState();
  if (st !== 'PLAYING' && st !== 'PAUSED') return;
  var dur = av.getDuration(), now = Date.now();
  // Seuls les appuis enchaînés pendant un même déplacement accélèrent : un nouveau déplacement repart à 10 s
  var quick = player.scrub != null && now - (player.scrubAt || 0) < 450;
  if (player.scrub == null) player.scrub = av.getCurrentTime();
  player.scrubRun = quick ? (player.scrubRun || 0) + 1 : 0;
  player.scrubAt = now;
  var level = Math.min(Math.floor(player.scrubRun / 4), SCRUB_STEPS.length);
  var step = level < SCRUB_STEPS.length ? SCRUB_STEPS[level] : Math.max(SCRUB_STEPS[SCRUB_STEPS.length - 1], dur * 0.05);
  player.scrub = Math.max(0, Math.min(dur - 1000, player.scrub + direction * step));
  renderSeekCursor(av.getCurrentTime(), dur);
}

function scrubCommit() {
  stopScrubHold();
  var target = player.scrub;
  player.scrub = null;
  if (target == null) return false;
  try {
    webapis.avplay.seekTo(Math.floor(target), function () { updateOsd(); }, function (err) { toast('Déplacement impossible : ' + err, true); });
    osdState('⏩ ' + fmtTime(target), 1200);
  } catch (e) {
    toast('Déplacement impossible : ' + (e.message || e.name), true);
  }
  return true;
}

function scrubCancel() {
  stopScrubHold();
  if (player.scrub == null) return false;
  player.scrub = null;
  updateOsd();
  return true;
}

// Touche maintenue : la télécommande ne répète pas forcément keydown. Le curseur avance donc en continu
// grâce à un minuteur jusqu'au relâchement (keyup) ; les répétitions éventuelles sont ignorées pour ne pas doubler la vitesse.
var SCRUB_HOLD_DELAY = 300; // délai + 1er intervalle (420 ms) < fenêtre d'accélération de scrubMove (450 ms)
var SCRUB_HOLD_TICK = 120;

function startScrubHold(direction) {
  if (player.holdDir === direction) return; // répétition d'une touche déjà maintenue
  stopScrubHold();
  player.holdDir = direction;
  scrubMove(direction);
  player.holdTimer = setTimeout(function () {
    player.holdInterval = setInterval(function () {
      if (player.holdDir !== direction || state.screen !== 'player') { stopScrubHold(); return; }
      scrubMove(direction);
      showOsd(false);
    }, SCRUB_HOLD_TICK);
  }, SCRUB_HOLD_DELAY);
}

function stopScrubHold() {
  clearTimeout(player.holdTimer);
  clearInterval(player.holdInterval);
  player.holdTimer = null;
  player.holdInterval = null;
  player.holdDir = 0;
}

document.addEventListener('keyup', function (e) {
  if (state.screen !== 'player' || (e.keyCode !== KEY.LEFT && e.keyCode !== KEY.RIGHT)) return;
  debug('info', 'lecteur : touche relâchée', { key: e.keyCode, scrub: player.scrub });
  stopScrubHold();
});
window.addEventListener('blur', stopScrubHold);

// Sous-titres : <br> et \N deviennent des retours à la ligne, italique / gras / souligné sont conservés,
// les autres balises (font, styles ASS…) sont retirées et tout le reste est échappé
function renderSubtitle(text) {
  var clean = String(text || '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<(?!\/?(i|b|u)>)[^>]*>/gi, '');
  $('subs').innerHTML = clean
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>');
}

function playerKey(e) {
  e.preventDefault();
  var code = e.keyCode;
  if (menuOpen()) {
    if (code === KEY.UP) move('up');
    else if (code === KEY.DOWN) move('down');
    else if (code === KEY.ENTER && document.activeElement) document.activeElement.click();
    else if (code === KEY.BACK || code === KEY.LEFT || code === KEY.RIGHT) closeMenu();
    return;
  }
  // Bouton « Lire l'épisode suivant » sélectionné : OK lance, RETOUR écarte, ◀ ▲ reviennent aux contrôles
  if (document.activeElement === $('next-episode') && $('next-episode').classList.contains('show')) {
    if (code === KEY.ENTER) { playNextEpisode(); return; }
    if (code === KEY.BACK) { dismissNextEpisode(); return; }
    if (code === KEY.LEFT || code === KEY.UP) { showOsd(true); $('ctl-play').focus(); return; }
  }
  var osdHidden = $('osd').classList.contains('hidden');
  var onBar = !osdHidden && document.activeElement === $('seekbar');
  switch (code) {
    case KEY.BACK:
      if (onBar && scrubCancel()) break; // annule d'abord le déplacement en cours sur la barre
      if (!osdHidden) {                   // contrôles affichés : RETOUR les masque, la lecture continue
        clearTimeout(player.osdTimer);
        $('osd').classList.add('hidden');
        return;
      }
      stopPlayback();                     // contrôles masqués : RETOUR quitte la lecture
      return;
    case KEY.STOP: stopPlayback(); return;
    case KEY.PLAY_PAUSE: togglePause(); break;
    case KEY.PLAY: if (avState() === 'PAUSED') togglePause(); break;
    case KEY.PAUSE: if (avState() === 'PLAYING') togglePause(); break;
    case KEY.FF: seek(30); break;
    case KEY.RW: seek(-10); break;
    case KEY.LEFT:
    case KEY.RIGHT:
      if (onBar) debug('info', 'lecteur : touche barre', { key: code, repeat: !!e.repeat, maintenue: player.holdDir });
      if (osdHidden) seek(code === KEY.LEFT ? -10 : 30);
      else if (onBar) startScrubHold(code === KEY.LEFT ? -1 : 1);
      else move(code === KEY.LEFT ? 'left' : 'right');
      break;
    case KEY.UP:
      if (!osdHidden && !onBar) move('up'); // des boutons vers la barre de lecture
      break;
    case KEY.DOWN:
      if (onBar) { scrubCancel(); $('ctl-play').focus(); }
      break;
    case KEY.ENTER:
      if (osdHidden) { showOsd(true); return; }
      if (onBar) { if (!scrubCommit()) togglePause(); break; }
      if (document.activeElement && $('controls').contains(document.activeElement)) document.activeElement.click();
      break;
  }
  showOsd(false);
}

async function play(file, returnTo, task) {
  player.returnTo = returnTo;
  player.task = task || null;
  player.file = file;
  player.audio = []; player.text = []; player.currentAudio = null; player.currentText = 'default';
  player.info = { audio: [], text: [] };
  player.nextShown = false;
  player.nextDismissed = false;
  player.creditsAt = null;
  hideNextEpisode();
  toast('Préparation de la lecture…');

  // MediaInfo c411 (titres des pistes), en parallèle et sans bloquer la lecture
  var infoPromise = task && task.info_hash
    ? c411('/api/torrents/' + String(task.info_hash).toLowerCase()).then(function (d) {
      var nfo = d.metadata && d.metadata.nfoContent;
      return { audio: mediaTracks(nfo, 'Audio'), text: mediaTracks(nfo, 'Text'), nfo: nfo };
    }).catch(function () { return { audio: [], text: [] }; })
    : Promise.resolve({ audio: [], text: [] });

  try {
    var url = await upnpUrl(file.filepath);

    document.documentElement.classList.add('playing');
    $('osd-title').textContent = label(file.name);
    $('osd-tracks').textContent = '';
    $('osd-time').textContent = '0:00 / 0:00';
    $('osd-bar').style.width = '0';
    $('ctl-play').textContent = '⏸ Pause';
    $('subs').textContent = '';
    $('track-menu').classList.remove('open');
    show('player', $('ctl-play'));
    showOsd(true);
    osdState('Chargement…');

    var av = webapis.avplay;
    var trace = function (step, extra) { debug('info', 'lecteur : ' + step, Object.assign({ state: avState() }, extra || {})); };
    player.scrub = null;
    av.open(url);
    av.setListener({
      onbufferingstart: function () { osdState('Chargement…'); },
      onbufferingprogress: function (p) { osdState('Chargement… ' + p + ' %'); },
      onbufferingcomplete: function () { osdState(''); },
      oncurrentplaytime: function () {},
      onstreamcompleted: function () {
        trace('fin');
        player.scrub = null;
        player.resumeReady = false; // fichier terminé : pas de position à reprendre
        clearPosition(player.task, file);
        if (player.task) markWatched(player.task, file.name);
        // Enchaînement automatique sur l'épisode suivant, sauf si la proposition a été écartée
        var next = nextFile(), task = player.task;
        stopPlayback();
        if (next && !player.nextDismissed) play(next, 'files', task);
      },
      onevent: function (type, data) { trace('event ' + type, { data: data }); },
      onerror: function (err) { trace('erreur ' + err); toast('Lecture impossible : ' + err, true); stopPlayback(); },
      onsubtitlechange: function (duration, text) {
        renderSubtitle(text);
        clearTimeout(player.subTimer);
        player.subTimer = setTimeout(function () { $('subs').textContent = ''; }, duration);
      }
    });
    av.setDisplayRect(0, 0, 1920, 1080);
    clearTimeout(player.watchdog);
    player.watchdog = setTimeout(function () {
      var st = avState();
      if (state.screen === 'player' && st !== 'PLAYING' && st !== 'PAUSED') toast('La lecture ne démarre pas (état du lecteur : ' + st + ')', true);
    }, 20000);

    av.prepareAsync(async function () {
      // Démarrer d'abord : une erreur sur les pistes ne doit jamais empêcher la lecture
      try {
        av.play();
        trace('play', { url: url });
      } catch (e) {
        trace('play KO ' + (e.name || '') + ' ' + (e.message || e));
        toast('Lecture impossible : ' + (e.message || e.name || e), true);
        return;
      }
      osdState('');
      clearInterval(player.tick);
      player.tick = setInterval(updateOsd, 1000);
      // Reprise à la position mémorisée lors de la dernière fermeture de ce fichier
      var resumeAt = savedPosition(task, file);
      if (resumeAt) {
        trace('reprise', { position: resumeAt });
        osdState('⏯ Reprise à ' + fmtTime(resumeAt), 2500);
        try {
          av.seekTo(resumeAt, function () { player.resumeReady = true; updateOsd(); }, function () { player.resumeReady = true; });
        } catch (e) {
          player.resumeReady = true;
        }
      } else {
        player.resumeReady = true;
      }
      try {
        var tracks = av.getTotalTrackInfo() || [];
        player.audio = tracks.filter(function (t) { return t.type === 'AUDIO'; });
        player.text = tracks.filter(function (t) { return t.type === 'TEXT'; });
        try {
          var current = av.getCurrentStreamInfo() || [];
          var curAudio = current.filter(function (s) { return s.type === 'AUDIO'; })[0];
          player.currentAudio = curAudio ? player.audio.filter(function (t) { return t.index === curAudio.index; })[0] || player.audio[0] : player.audio[0];
        } catch (e) { player.currentAudio = player.audio[0] || null; }
        // Attendre le MediaInfo au plus 2,5 s pour étiqueter les pistes avant d'appliquer les préférences
        player.info = await Promise.race([infoPromise, new Promise(function (resolve) { setTimeout(function () { resolve({ audio: [], text: [] }); }, 2500); })]);
        describeTracks();
        applyPrefs();
        player.creditsAt = creditsStart(player.info.nfo, av.getDuration());
        trace('générique', { debut: player.creditsAt, mediainfo: !!player.info.nfo });
        renderTrackSummary();
        trace('pistes', { audio: player.audio.map(function (t) { return t.name; }), text: player.text.map(function (t) { return t.name; }) });
      } catch (e) {
        trace('pistes KO ' + (e.name || '') + ' ' + (e.message || e));
      }
    }, function (err) {
      trace('prepare KO ' + err);
      toast('Lecture impossible : ' + err, true);
      stopPlayback();
    });
  } catch (e) {
    toast('Lecture impossible : ' + (e.message || e.name || e), true);
    stopPlayback();
  }
}

function stopPlayback() {
  // Mémoriser la position avant d'arrêter (effacée si > 95 % ou < 10 s)
  try {
    var st = avState();
    if (player.resumeReady && (st === 'PLAYING' || st === 'PAUSED')) persistPosition(webapis.avplay.getCurrentTime(), webapis.avplay.getDuration());
  } catch (e) { /* lecteur indisponible */ }
  player.resumeReady = false;
  hideNextEpisode();
  stopScrubHold();
  try { webapis.avplay.stop(); } catch (e) { /* déjà arrêté */ }
  try { webapis.avplay.close(); } catch (e) { /* déjà fermé */ }
  clearInterval(player.tick);
  clearTimeout(player.osdTimer);
  clearTimeout(player.watchdog);
  osdState('');
  $('track-menu').classList.remove('open');
  $('osd').classList.remove('hidden');
  document.documentElement.classList.remove('playing');
  if (state.screen !== 'player') return;
  if (player.returnTo === 'files' && state.filesTask) {
    // Retour sur la liste à jour, positionnée sur le prochain fichier non vu
    renderFiles();
    showFiles();
  } else {
    openDownloads();
  }
}

// Mise en veille / retour dans l'app pendant la lecture
document.addEventListener('visibilitychange', function () {
  if (state.screen !== 'player') return;
  try { if (document.hidden) webapis.avplay.suspend(); else webapis.avplay.restore(); } catch (e) { /* ignore */ }
});

// ---------- Recherche : clavier natif Samsung (avec suggestions) ----------
// La barre visible (#search-box) fait partie de la navigation ; le vrai champ n'est affiché que pendant la saisie,
// sinon il capturerait les flèches et bloquerait l'accès aux autres boutons.
function openSearch() {
  document.querySelector('.search').classList.add('editing');
  $('query').focus();
  toast('⌨️ Tapez le titre puis « Terminé » pour rechercher · RETOUR pour fermer le clavier');
}

function closeSearch(submit) {
  var box = document.querySelector('.search');
  if (!box.classList.contains('editing')) return;
  var q = $('query').value.trim();
  box.classList.remove('editing');
  $('query').blur();
  $('search-label').textContent = q || 'Rechercher un film, une série…';
  $('search-box').focus();
  $('toast').style.display = 'none';
  if (submit && q) search(true);
}

// ---------- Actions ----------
$('tabs').addEventListener('click', function (e) {
  var tab = e.target.closest('[data-subcat]');
  if (!tab) return;
  state.subcat = tab.getAttribute('data-subcat');
  document.querySelectorAll('[data-subcat]').forEach(function (x) { x.classList.toggle('selected', x === tab); });
  loadHome(true);
});
$('dl-sorts').addEventListener('click', function (e) {
  var tab = e.target.closest('[data-sort]');
  if (!tab) return;
  state.dlSort = tab.getAttribute('data-sort');
  document.querySelectorAll('[data-sort]').forEach(function (x) { x.classList.toggle('selected', x === tab); });
  renderDownloads();
  $('downloads-list').parentNode.scrollTop = 0;
});
$('downloads-list').addEventListener('click', function (e) {
  var more = e.target.closest('[data-more-id]');
  if (more) { openMediaMenu(Number(more.getAttribute('data-more-id'))); return; }
  var row = e.target.closest('[data-id]');
  if (row) onTaskClick(Number(row.getAttribute('data-id')));
});
$('files-list').addEventListener('click', function (e) {
  var row = e.target.closest('[data-file]');
  if (row && state.filesTask) play(state.filesTask.files[Number(row.getAttribute('data-file'))], 'files', state.filesTask.task);
});
$('search-box').addEventListener('click', openSearch);
$('query').addEventListener('blur', function () { closeSearch(false); });
$('home-grid').addEventListener('click', onGridClick('home'));
$('results-grid').addEventListener('click', onGridClick('results'));
$('open-downloads').addEventListener('click', function () { state.lastFocus.downloads = null; openDownloads(); });
$('d-download').addEventListener('click', startDownload);
$('d-back').addEventListener('click', function () { show(state.detailFrom); });

try {
  ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'].forEach(function (k) { tizen.tvinputdevice.registerKey(k); });
} catch (e) { /* hors TV */ }

if (!S.c411ApiKey || !S.freeboxAppToken) toast('Secrets manquants : redéployez avec poc/deploy-tv.sh', true);
loadHome(true).then(function () {
  var first = $('home-grid').querySelector('[data-f]');
  (first || $('search-box')).focus();
});
debug('info', 'app démarrée (v0.9)');
