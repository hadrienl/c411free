// Démarrage : actions des écrans et chargement de l'accueil.

// ---------- Actions ----------
$('open-filters').addEventListener('click', function () { toggleFilters(); });
$('filter-type').addEventListener('click', function (e) {
  var tab = e.target.closest('[data-subcat]');
  if (!tab) return;
  state.filters.subcat = tab.getAttribute('data-subcat');
  applyFilters();
});
$('filter-year').addEventListener('click', pickYear);
$('filter-genre').addEventListener('click', pickGenre);
$('filter-reset').addEventListener('click', resetFilters);
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
if (!S.c411ApiKey || !S.freeboxAppToken) toast('Configuration manquante : redéployez avec tools/deploy-tv.sh', true);
renderFilters();
loadHome(true).then(function () {
  var first = $('home-grid').querySelector('[data-f]');
  (first || $('search-box')).focus();
});
debug('info', 'app démarrée (v' + VERSION + ')');
