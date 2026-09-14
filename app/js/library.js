// Médias : liste des vidéos des disques, progression des téléchargements, liste des fichiers d'un dossier.

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

// Médias : vidéos des disques (films et dossiers d'épisodes), avec la progression des téléchargements associés
function renderDownloads() {
  var focusedId = document.activeElement && document.activeElement.getAttribute('data-id');
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
      + '<span class="more-btn" data-more-id="' + x.i + '">⋯</span>'
      + '</div>';
  }).join('') || '<div class="empty">' + (media.scanning ? 'Analyse des disques en cours…' : 'Aucune vidéo trouvée.') + '</div>';
  if (focusedId && $('dl-' + focusedId)) $('dl-' + focusedId).focus();
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
