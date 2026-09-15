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
  var btn = e.target.closest('[data-sort-group]');
  if (btn) pickMediaSort(btn.getAttribute('data-sort-group'));
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
// Défilement infini : sélection d'une vignette ou défilement de la liste
['home-grid', 'results-grid'].forEach(function (id) {
  $(id).addEventListener('focusin', function () { loadMoreIfNeeded(id); });
  $(id).parentNode.addEventListener('scroll', function () { loadMoreIfNeeded(id); });
});
$('home-grid').addEventListener('click', onGridClick('home'));
$('results-grid').addEventListener('click', onGridClick('results'));
$('open-downloads').addEventListener('click', function () { state.lastFocus.downloads = null; openDownloads(); });
$('d-download').addEventListener('click', startDownload);
$('d-trailer').addEventListener('click', function () {
  var source = state.detail && state.detail.trailer;
  if (!source) return;
  if (source.kind === 'allocine') play({ name: 'Bande-annonce · ' + state.detail.trailerTitle, url: source.url }, 'detail', null);
  else openTrailerInYouTube(source.videoId);
});
$('d-back').addEventListener('click', function () { show(state.detailFrom); });

try {
  ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'].forEach(function (k) { tizen.tvinputdevice.registerKey(k); });
} catch (e) { /* hors TV */ }
if (!S.c411ApiKey || !S.freeboxAppToken) toast('Configuration manquante : redéployez avec tools/deploy-tv.sh', true);
ensureSeriesBackfill(); // suivi des séries : reprise de l'historique des épisodes déjà vus
ensureHistoryBackfill(); // recommandations : historique de visionnage repris des fichiers déjà vus
renderFilters();
// Profils
$('open-profiles').addEventListener('click', function () { openProfiles(); });
$('profiles-list').addEventListener('click', function (e) {
  var tile = e.target.closest('[data-profile]'), edit = e.target.closest('[data-edit-profile]');
  if (tile) chooseProfile(Number(tile.getAttribute('data-profile')));
  else if (edit) openProfileForm('edit', Number(edit.getAttribute('data-edit-profile')));
  else if (e.target.closest('[data-add-profile]')) openProfileForm('add');
});
$('nick-box').addEventListener('click', openNickname);
$('nick-input').addEventListener('blur', function () { closeNickname(true); });
$('nick-input').addEventListener('input', function (e) { $('pf-preview-name').textContent = cleanName(e.target.value) || 'Nouveau profil'; });
$('pf-avatars').addEventListener('click', function (e) {
  var b = e.target.closest('[data-avatar]');
  if (b) pickAvatar(b.getAttribute('data-avatar'));
});
$('pf-save').addEventListener('click', saveProfileForm);
$('pf-cancel').addEventListener('click', cancelProfileForm);
$('pf-remove').addEventListener('click', confirmRemoveProfile);
renderProfileButton();

// Bandeau d'accueil : sélectionné au démarrage s'il est prêt et que la sélection n'a pas encore bougé
$('hero').addEventListener('click', openHeroItem);
loadHero().then(function () {
  var active = document.activeElement, firstCard = $('home-grid').querySelector('[data-f]');
  if (!$('hero').classList.contains('off') && state.screen === 'home' && (!active || active === document.body || active === firstCard)) $('hero').focus();
}).catch(function (e) { debug('error', 'bandeau : ' + e.message); });
loadHome(true).then(function () {
  var first = $('home-grid').querySelector('[data-f]');
  (first || $('search-box')).focus();
});
debug('info', 'app démarrée (v' + VERSION + ')');
// Version avec journal : vérifie au démarrage que la recherche de bande-annonce aboutit sur la TV (résultat journalisé)
if (LOG_URL) setTimeout(function () { findTrailerSource(['Inception'], '2010', false).catch(function (e) { debug('error', 'recherche de bande-annonce : ' + e.message); }); }, 3000);
