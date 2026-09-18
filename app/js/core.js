// Socle : configuration, état global, utilitaires DOM, journal de débogage et messages.

// C411free — parcourir et chercher sur c411, télécharger sur la Freebox, regarder, à la télécommande.
var VERSION = '1.0.0'; // identique à config.xml (vérifié par les tests)
// config.js est généré au déploiement par tools/make-config.mjs (secrets + options) et n'est jamais versionné
var S = window.CONFIG || {};
var FBX = 'http://mafreebox.freebox.fr/api/v16';
var C411 = 'https://c411.org';
var LOG_URL = S.debugLogUrl || ''; // journal de débogage (DEBUG_LOG=1 au déploiement), désactivé sinon
var PER_PAGE = 28;

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

// Icônes d'interface monochromes : le SVG hérite toujours de la couleur du texte.
// Une seule bibliothèque évite les glyphes emoji, dont le dessin varie selon les TV.
var ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  movie: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4"/>',
  sparkle: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3ZM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Zm13-2 1 2.8 2.8 1-2.8 1L18 21l-1-3.2-2.8-1 2.8-1L18 13Z"/>',
  tv: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m9 3 3 3 3-3M9 22h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 19h16"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.3 6.3L4 9m2 6a7 7 0 0 0 11.7 2.7L20 15"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/>',
  play: '<path class="icon-fill" d="m9 6 9 6-9 6V6Z"/>',
  resume: '<path class="icon-fill" d="M6 5h3v14H6zm6 1 8 6-8 6V6Z"/>',
  pause: '<path class="icon-fill" d="M7 5h3v14H7zm7 0h3v14h-3z"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  retry: '<path d="M20 6v6h-6M4 18v-6h6"/><path d="M18 9a7 7 0 0 0-12-2L4 9m2 6a7 7 0 0 0 12 2l2-2"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  edit: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14 7 3 3"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>',
  audio: '<path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
  subtitles: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 12h5m2 0h5M6 16h8m2 0h2"/>',
  back: '<path d="m9 6-6 6 6 6"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  prev: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>'
};
function iconSvg(name, extraClass) {
  var body = ICON_PATHS[name] || ICON_PATHS.movie;
  return '<svg class="ui-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
}
function buttonContent(id, icon, text) { $(id).innerHTML = iconSvg(icon) + '<span>' + esc(text) + '</span>'; }

function debug(level, message, extra) {
  if (!LOG_URL) return;
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
