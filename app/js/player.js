// Lecteur AVPlay : barre de contrôle, pistes, barre de lecture, reprise, épisode suivant.

// ---------- Lecteur (AVPlay, décodeur matériel de la TV) ----------
var player = {
  returnTo: 'downloads', task: null, file: null, audio: [], text: [], currentAudio: null, currentText: 'default',
  info: { audio: [], text: [] }, tick: null, osdTimer: null, subTimer: null, watchdog: null
};

function avState() { try { return webapis.avplay.getState(); } catch (e) { return 'NONE'; } }
function menuOpen() { return $('track-menu').classList.contains('open'); }
function renderSubtitle(text) { $('subs').innerHTML = subtitleHtml(text); }

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
    updateSkipIntro(cur);
    // Série de sauts terminée : retenue comme générique de la série si elle est plausible, sinon oubliée
    if (player.skipPending && Date.now() - player.skipPending.lastAt >= SKIP_SETTLE_MS) {
      var learned = learnedSkip(player.skipPending, Date.now());
      if (learned) rememberIntro(learned);
      else debug('info', 'saut non retenu comme générique', { debut: player.skipPending.start, fin: player.skipPending.end, serie: currentSeriesKey() });
      player.skipPending = null;
    }
  } catch (e) { /* lecteur pas prêt */ }
}

// ---------- Épisode suivant (comme Netflix) ----------
// Fichier suivant du même dossier, dans l'ordre alphanumérique de la liste des vidéos
function nextFile() {
  var ft = state.filesTask;
  if (!ft || !player.file || !player.task || taskKey(ft.task) !== taskKey(player.task)) return null;
  var i = ft.files.map(function (f) { return f.name; }).indexOf(player.file.name);
  return i >= 0 && i + 1 < ft.files.length ? ft.files[i + 1] : null;
}

function showNextEpisode() {
  hideSkipIntro();
  player.nextShown = true;
  $('next-episode').classList.add('show');
  if (!menuOpen()) $('next-episode').focus();
  debug('info', 'épisode suivant proposé', { position: webapis.avplay.getCurrentTime(), generique: player.creditsAt });
}

function hideNextEpisode() { $('next-episode').classList.remove('show'); }

// ---------- Générique de début : bouton « Passer le générique » ----------
// Source : chapitres du fichier (OP, Intro…), sinon le saut que l'utilisateur a fait sur un autre épisode de la même série.
function currentSeriesKey() {
  var ft = state.filesTask;
  return player.file ? seriesKey(player.file.name, player.returnTo === 'files' && ft ? ft.task.name : '') : null;
}

function updateSkipIntro(cur) {
  var w = introWindow(player.intro), btn = $('skip-intro');
  var inside = !!w && !player.introDismissed && player.resumeReady && player.scrub == null
    && cur >= w.from && cur < w.to && !$('next-episode').classList.contains('show');
  if (inside && !btn.classList.contains('show')) {
    btn.classList.add('show');
    if (!menuOpen()) btn.focus();
    debug('info', 'générique de début proposé', { source: player.intro.source, debut: player.intro.start, fin: player.intro.end });
  } else if (!inside && btn.classList.contains('show')) {
    hideSkipIntro();
  }
}

function hideSkipIntro() {
  var btn = $('skip-intro'), hadFocus = document.activeElement === btn;
  btn.classList.remove('show');
  if (hadFocus && state.screen === 'player') $('ctl-play').focus();
}

function skipIntro() {
  var intro = player.intro;
  player.introDismissed = true;
  hideSkipIntro();
  if (!intro) return;
  try {
    webapis.avplay.seekTo(Math.floor(intro.end), function () { updateOsd(); }, function () {});
    osdState('⏩ Générique passé', 1200);
  } catch (e) { /* hors limites */ }
}

function dismissSkipIntro() {
  player.introDismissed = true;
  hideSkipIntro();
  showOsd(false);
}

// Saut manuel vers l'avant : suivi pour apprendre le générique de la série
function noteSeek(fromMs, toMs) {
  player.skipPending = trackSkip(player.skipPending, fromMs, toMs, Date.now());
}

function rememberIntro(skip) {
  if (player.intro && player.intro.source === 'chapitres') return; // le fichier fait déjà foi
  var key = currentSeriesKey();
  if (!key) return;
  saveIntroSkip(key, skip);
  debug('info', 'générique de début appris', { debut: skip.start, fin: skip.end });
}

// Lecture d'une plage d'octets du fichier (serveur UPnP). Refuse une réponse complète : ce serait tout le fichier.
function fetchRange(url, start, length) {
  return fetch(url, { headers: { Range: 'bytes=' + start + '-' + (start + length - 1) } }).then(function (res) {
    if (res.status !== 206) {
      try { if (res.body) res.body.cancel(); } catch (e) { /* ignore */ }
      throw new Error('plage refusée (HTTP ' + res.status + ')');
    }
    return res.arrayBuffer();
  }).then(function (buf) { return new Uint8Array(buf); });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error('délai dépassé')); }, ms); })]);
}

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
  if (st === 'PLAYING') { av.pause(); osdState('Pause'); renderPlayButton(true); }
  else if (st === 'PAUSED') { av.play(); osdState(''); renderPlayButton(false); }
}

var ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
function renderPlayButton(paused) {
  var btn = $('ctl-play');
  btn.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  btn.setAttribute('data-tip', paused ? 'Lecture' : 'Pause');
}

var SEEK_STEP_S = 15; // boutons, ◀ ▶ contrôles masqués, avance / retour rapides

function restart() {
  var av = webapis.avplay, st = avState();
  if (st !== 'PLAYING' && st !== 'PAUSED') return;
  try {
    noteSeek(av.getCurrentTime(), 0);
    av.seekTo(0, function () { updateOsd(); }, function () {});
    player.introDismissed = false; // le générique peut à nouveau être proposé
    osdState('⏮ Depuis le début', 1200);
  } catch (e) { /* lecteur indisponible */ }
}
function seek(seconds) {
  var av = webapis.avplay, st = avState();
  if (st !== 'PLAYING' && st !== 'PAUSED') return;
  try {
    var from = av.getCurrentTime();
    if (seconds > 0) av.jumpForward(seconds * 1000); else av.jumpBackward(-seconds * 1000);
    noteSeek(from, from + seconds * 1000);
    osdState(seconds > 0 ? '⏩ +' + seconds + ' s' : '⏪ ' + seconds + ' s', 1000);
  } catch (e) { /* hors limites */ }
  updateOsd();
}

$('controls').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.getAttribute('data-act')) {
    case 'restart': restart(); break;
    case 'back': seek(-SEEK_STEP_S); break;
    case 'toggle': togglePause(); break;
    case 'fwd': seek(SEEK_STEP_S); break;
    case 'audio': openMenu('audio'); break;
    case 'subs': openMenu('subs'); break;
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
    noteSeek(webapis.avplay.getCurrentTime(), target);
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
  // Bouton « Passer le générique » sélectionné : OK saute, RETOUR écarte, ◀ ▲ reviennent aux contrôles
  if (document.activeElement === $('skip-intro') && $('skip-intro').classList.contains('show')) {
    if (code === KEY.ENTER) { skipIntro(); return; }
    if (code === KEY.BACK) { dismissSkipIntro(); return; }
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
    case KEY.FF: seek(SEEK_STEP_S); break;
    case KEY.RW: seek(-SEEK_STEP_S); break;
    case KEY.LEFT:
    case KEY.RIGHT:
      if (onBar) debug('info', 'lecteur : touche barre', { key: code, repeat: !!e.repeat, maintenue: player.holdDir });
      // Contrôles masqués : ◀ ▶ reculent / avancent sans afficher les contrôles
      if (osdHidden) { seek(code === KEY.LEFT ? -SEEK_STEP_S : SEEK_STEP_S); return; }
      if (onBar) startScrubHold(code === KEY.LEFT ? -1 : 1);
      else move(code === KEY.LEFT ? 'left' : 'right', '#controls [data-f]'); // la barre de lecture ne se sélectionne qu'avec ▲
      break;
    case KEY.UP:
      if (!osdHidden && !onBar) $('seekbar').focus(); // des boutons vers la barre de lecture
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
  player.intro = null;
  player.introDismissed = false;
  player.skipPending = null;
  hideNextEpisode();
  hideSkipIntro();
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
    // Chapitres du fichier (générique de début et de fin), lus en parallèle du démarrage
    var chaptersPromise = /\.mkv$/i.test(file.name)
      ? withTimeout(readMkvChapters(url, fetchRange), 5000).catch(function (e) { debug('info', 'chapitres illisibles', { erreur: e.message }); return []; })
      : Promise.resolve([]);

    document.documentElement.classList.add('playing');
    $('osd-title').textContent = label(file.name);
    $('osd-tracks').textContent = '';
    $('osd-time').textContent = '0:00 / 0:00';
    $('osd-bar').style.width = '0';
    renderPlayButton(false);
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
        chaptersPromise.then(function (chapters) {
          if (player.file !== file) return;
          var dur = av.getDuration();
          player.intro = introFromChapters(chapters, dur) || learnedIntro(currentSeriesKey());
          var credits = creditsFromChapters(chapters, dur);
          if (credits != null) player.creditsAt = credits;
          trace('chapitres', { nombre: chapters.length, noms: chapters.map(function (c) { return c.name; }).slice(0, 8), debut: player.intro, fin: player.creditsAt });
        });
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
  // Saut en cours au moment de quitter : considéré comme terminé
  var learned = player.skipPending && learnedSkip(player.skipPending, player.skipPending.lastAt + SKIP_SETTLE_MS);
  if (learned) rememberIntro(learned);
  player.skipPending = null;
  player.resumeReady = false;
  hideNextEpisode();
  hideSkipIntro();
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
