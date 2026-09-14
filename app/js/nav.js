// Navigation à la télécommande : écrans, déplacement spatial, fenêtre modale, touches.

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
  if (state.screen === 'player') scope = menuOpen() ? '#track-menu [data-f]' : '#controls [data-f], #seekbar, #next-episode.show, #skip-intro.show';
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

// Appui long sur OK dans les Médias : ouvre le menu de la ligne (appui court = action habituelle).
// Mesuré sur la télécommande : OK ne se répète pas ; appui court → keyup vers 200 ms, appui maintenu → keyup forcé
// à 1 000 ms. Sans keyup au bout de LONG_PRESS_MS, c'est un appui long ; la suite de l'appui est ignorée.
var LONG_PRESS_MS = 500;
var enterHold = null; // { el, row, start, repeated, done, timer }

function enterHoldRow(el) {
  return state.screen === 'downloads' && !modalOpen() && el && el.closest && el.closest('#downloads-list [data-id]');
}

function finishEnterHold(longPress) {
  var h = enterHold;
  if (!h || h.done) return;
  h.done = true;
  h.long = longPress;
  clearTimeout(h.timer);
  if (longPress) openMediaMenu(Number(h.row.getAttribute('data-id')));
  else h.el.click();
}

document.addEventListener('keydown', function (e) {
  if (e.keyCode !== KEY.ENTER) return;
  if (enterHold && (!enterHold.done || (enterHold.long && Date.now() - enterHold.start < 1500))) {
    // Répétition de l'appui en cours
    e.preventDefault(); e.stopImmediatePropagation();
    if (!enterHold.done && Date.now() - enterHold.start >= LONG_PRESS_MS) finishEnterHold(true);
    else enterHold.repeated = true;
    return;
  }
  enterHold = null;
  var row = enterHoldRow(document.activeElement);
  if (!row) return;
  e.preventDefault(); e.stopImmediatePropagation();
  enterHold = { el: document.activeElement, row: row, start: Date.now(), repeated: false, done: false };
  // Toujours pas relâché au bout du délai : appui long (la TV ne répète pas OK, elle envoie juste un keyup forcé à ~1 s)
  enterHold.timer = setTimeout(function () { if (enterHold) finishEnterHold(true); }, LONG_PRESS_MS);
}, true);

document.addEventListener('keyup', function (e) {
  if (e.keyCode !== KEY.ENTER || !enterHold) return;
  var h = enterHold;
  if (!h.done) finishEnterHold(Date.now() - h.start >= LONG_PRESS_MS);
  // Après un appui long, on garde l'état un instant : des répétitions tardives ne doivent pas valider le menu
  if (!h.long) enterHold = null;
}, true);

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
