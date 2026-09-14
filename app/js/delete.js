// Médias : menu d'une ligne et suppression (téléchargements et/ou fichiers).

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
