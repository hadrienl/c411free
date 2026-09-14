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
