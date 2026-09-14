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
  var scope = pickerOpen() ? '#picker [data-f]' : modalOpen() ? '#modal [data-f]' : '.screen.active [data-f]';
  if (state.screen === 'player') scope = menuOpen() ? '#track-menu [data-f]' : '#controls [data-f], #seekbar, #next-episode.show, #skip-intro.show';
  return Array.prototype.filter.call(document.querySelectorAll(scope), function (el) {
    return el.offsetParent !== null && !el.closest('.drawer:not(.open)'); // tiroir fermé : ses boutons ne sont pas sélectionnables
  });
}

// Déplacement vers l'élément le plus proche dans la direction, éventuellement limité aux éléments correspondant à `only`
function move(dir, only) {
  var list = focusables();
  if (only) list = list.filter(function (el) { return el.matches(only); });
  var cur = document.activeElement;
  if (list.indexOf(cur) < 0) { if (list[0]) list[0].focus(); return; }
  var others = list.filter(function (el) { return el !== cur; });
  var index = spatialPick(cur.getBoundingClientRect(), others.map(function (el) { return el.getBoundingClientRect(); }), dir);
  var best = others[index];
  if (best) { best.focus({ preventScroll: true }); reveal(best); }
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
  if (modalOpen() || pickerOpen()) {
    e.preventDefault();
    if (e.keyCode === KEY.BACK) { if (pickerOpen()) closePicker(); else closeModal(); }
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
      if (state.screen === 'home' && filtersOpen()) toggleFilters(false); // RETOUR ferme d'abord le tiroir des filtres
      else if (scrollListToTop()) { /* liste défilée : remontée en haut, on reste sur l'écran */ }
      else if (state.screen === 'home') tizen.application.getCurrentApplication().exit();
      else if (state.screen === 'detail') show(state.detailFrom);
      else if (state.screen === 'files') openDownloads();
      else show('home');
      break;
  }
});

// ---------- Défilement animé ----------
// Le défilement natif (focus, scrollIntoView) est instantané sur la TV : animation maison, recalée si on appuie
// plusieurs fois de suite (elle repart de la position courante vers la nouvelle cible, sans à-coup).
var SCROLL_ANIM_MS = 280;
var SCROLL_MARGIN_PX = 60;
var SCROLL_CONTAINERS = '.grid-wrap, .list-wrap, #picker, .track-menu';

function animateScroll(wrap, top, duration) {
  top = Math.max(0, Math.min(top, wrap.scrollHeight - wrap.clientHeight));
  cancelAnimationFrame(wrap.scrollAnim);
  var from = wrap.scrollTop, delta = top - from, start = null;
  if (Math.abs(delta) < 1) { wrap.scrollTarget = null; return; }
  wrap.scrollTarget = top;
  function step(now) {
    if (start === null) start = now;
    var t = Math.min(1, (now - start) / (duration || SCROLL_ANIM_MS));
    wrap.scrollTop = from + delta * easeOutCubic(t);
    if (t < 1) wrap.scrollAnim = requestAnimationFrame(step);
    else wrap.scrollTarget = null;
  }
  wrap.scrollAnim = requestAnimationFrame(step);
}

// Fait apparaître l'élément sélectionné dans sa liste, en douceur
function reveal(el) {
  var wrap = el.closest(SCROLL_CONTAINERS);
  if (!wrap) { el.scrollIntoView({ block: 'nearest' }); return; }
  var w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  var elTop = r.top - w.top + wrap.scrollTop, elBottom = r.bottom - w.top + wrap.scrollTop;
  // Positions dans le contenu (indépendantes du défilement) ; animation en cours : on raisonne depuis sa cible
  var base = wrap.scrollTarget != null ? wrap.scrollTarget : wrap.scrollTop;
  var target = scrollTargetFor(elTop, elBottom, base, wrap.clientHeight, SCROLL_MARGIN_PX);
  if (target != null) animateScroll(wrap, target);
}

// RETOUR dans une liste défilée (vignettes, médias, épisodes) : remonte tout en haut et sélectionne le premier élément.
// Courte distance : défilement animé ; longue distance : fondu enchaîné (plutôt que de faire défiler des dizaines d'affiches).
// Renvoie false si la liste est déjà en haut : RETOUR fait alors son action habituelle (quitter, écran précédent).
var SCROLL_TOP_THRESHOLD_PX = 10;
var SCROLL_TOP_FADE_MS = 200;
function scrollListToTop() {
  var wrap = document.querySelector('.screen.active .grid-wrap, .screen.active .list-wrap');
  if (!wrap || wrap.scrollTop < SCROLL_TOP_THRESHOLD_PX) return false;
  var first = wrap.querySelector('[data-f]');
  if (wrap.scrollTop <= wrap.clientHeight * 1.5) {
    if (first) first.focus({ preventScroll: true });
    animateScroll(wrap, 0, 480);
    return true;
  }
  wrap.classList.add('fade-out');
  setTimeout(function () {
    cancelAnimationFrame(wrap.scrollAnim);
    wrap.scrollTarget = null;
    wrap.scrollTop = 0;
    if (first) first.focus({ preventScroll: true });
    wrap.classList.remove('fade-out');
  }, SCROLL_TOP_FADE_MS);
  return true;
}

// ---------- Liste déroulante (années, genres…) ----------
// items : [{ value, label }] ; onPick(item) après fermeture ; RETOUR ferme sans choisir
var pickerState = { items: [], onPick: null, anchorId: null };

function pickerOpen() { return $('picker').classList.contains('open'); }

function openPicker(anchor, title, items, selected, onPick) {
  pickerState = { items: items, onPick: onPick, anchorId: anchor.id };
  $('picker-title').textContent = title;
  $('picker-list').innerHTML = items.map(function (it, i) {
    var checked = String(it.value) === String(selected);
    return '<div class="picker-item" data-f tabindex="-1" id="pick-' + i + '" data-pick="' + i + '"><span class="check">' + (checked ? '✓' : '') + '</span>' + esc(it.label) + '</div>';
  }).join('');
  var r = anchor.getBoundingClientRect(), picker = $('picker');
  picker.style.left = Math.max(40, Math.min(1920 - 560, r.left)) + 'px';
  picker.style.top = Math.min(1080 - 700, r.bottom + 14) + 'px';
  picker.classList.add('open');
  var index = Math.max(0, items.findIndex(function (it) { return String(it.value) === String(selected); }));
  var target = $('pick-' + index);
  if (target) { target.focus(); target.scrollIntoView({ block: 'center' }); }
}

function closePicker() {
  $('picker').classList.remove('open');
  var anchor = pickerState.anchorId && $(pickerState.anchorId);
  if (anchor) anchor.focus();
}

$('picker-list').addEventListener('click', function (e) {
  var el = e.target.closest('[data-pick]');
  if (!el) return;
  var item = pickerState.items[Number(el.getAttribute('data-pick'))], onPick = pickerState.onPick;
  closePicker();
  if (item && onPick) onPick(item);
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
