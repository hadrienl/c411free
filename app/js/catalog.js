// Catalogue c411 : nouveautés, filtres, recherche (clavier natif), fiche détaillée et envoi à la Freebox.

// ---------- Filtres : tiroir animé sous l'en-tête de l'accueil ----------
state.filters = emptyFilters();
var FILTERS_ANIM_MS = 380;
var filtersSettleTimer = null;

function filtersOpen() { return $('filters').classList.contains('open'); }

// Panneau ouvert et fermé par le bouton « Filtres » de l'en-tête, sans changer de sous-onglet
function toggleFilters(open) {
  var drawer = $('filters');
  open = open == null ? !filtersOpen() : open;
  if (filtersOpen() === open) return;
  clearTimeout(filtersSettleTimer);
  drawer.classList.remove('settled');
  drawer.classList.toggle('open', open);
  if (!open) { $('open-filters').focus(); return; }
  // Débordement autorisé une fois ouvert, pour que le halo des boutons sélectionnés ne soit pas coupé
  filtersSettleTimer = setTimeout(function () { drawer.classList.add('settled'); }, FILTERS_ANIM_MS);
  var first = drawer.querySelector('.selected') || drawer.querySelector('[data-f]');
  if (first) first.focus();
  loadGenres().then(renderFilters); // prépare la liste des genres
}

function renderFilters() {
  var f = state.filters;
  document.querySelectorAll('#filter-type [data-subcat]').forEach(function (x) { x.classList.toggle('selected', x.getAttribute('data-subcat') === f.subcat); });
  $('filter-year').innerHTML = esc(f.year || 'Toutes les années') + '<span class="caret">▾</span>';
  $('filter-genre').innerHTML = esc((f.genre && genreName(f.genre)) || 'Tous les genres') + '<span class="caret">▾</span>';
}

function applyFilters() {
  renderFilters();
  renderTopbar(); // compteur des filtres actifs sur le bouton « Filtres »
  refreshHome(true);
}

function pickYear() {
  var items = [{ value: '', label: 'Toutes les années' }].concat(yearChoices(new Date().getFullYear()).map(function (y) { return { value: String(y), label: String(y) }; }));
  openPicker($('filter-year'), 'Année', items, state.filters.year, function (it) { state.filters.year = it.value; applyFilters(); });
}

async function pickGenre() {
  var genres = await loadGenres();
  if (!genres.length) { toast('Genres indisponibles pour le moment', true); return; }
  var items = [{ value: '', label: 'Tous les genres' }].concat(genres.map(function (g) { return { value: String(g.id), label: g.name }; }));
  openPicker($('filter-genre'), 'Genre', items, state.filters.genre, function (it) { state.filters.genre = it.value; applyFilters(); });
}

function resetFilters() {
  state.filters = emptyFilters();
  applyFilters();
}

// note : texte à la place de la ligne langue · taille · sources (ex. raison d'une recommandation)
// newHashes : releases signalées « Nouveau » (nouveaux épisodes d'une série suivie)
function cardHtml(prefix, t, note, newHashes) {
  var n = prettyName(t.name);
  var text = n.title + (n.episode ? ' · ' + n.episode : '') + (n.year ? ' (' + n.year + ')' : '');
  var img = t.posterUrl
    ? '<img class="fade" src="' + esc(poster(t.posterUrl, 'w342')) + '" loading="lazy" onload="this.classList.add(\'on\')" onerror="this.remove()">'
    : '';
  var fresh = !!(newHashes && newHashes[t.infoHash]);
  var rightBadge = fresh ? '<span class="q right fresh">Nouveau</span>'
    : (isLater(t.infoHash) && !onCatalogTab('later')) ? '<span class="q right later">' + iconSvg('bookmark') + '</span>'
    : '';
  return '<div class="card" data-f tabindex="-1" id="' + prefix + t.infoHash + '" data-hash="' + t.infoHash + '">'
    + '<div class="poster"><div class="ph">' + iconSvg('movie') + '</div>' + img
    + '<div class="badges">'
    + (resolution(t.name) ? '<span class="q">' + resolution(t.name) + '</span>' : '')
    + (nameAudioOk(t.name) ? '' : '<span class="q warn">' + iconSvg('warning') + 'son</span>')
    + rightBadge
    + '</div></div>'
    + '<div class="cap">' + esc(text) + '</div>'
    + '<div class="sub' + (note ? ' reason' : '') + '">' + esc(note || [shortLang(t.language, t.name), gb(t.size), '▲ ' + (t.seeders || 0)].filter(Boolean).join(' · ')) + '</div>'
    + '</div>';
}

// Vignettes d'une page : remplace la grille (nouvelle liste) ou s'ajoute à la fin (page suivante)
function renderGrid(gridId, prefix, bucket, append) {
  var grid = $(gridId);
  var start = append ? bucket.items.length - bucket.lastBatch : 0;
  var html = bucket.items.slice(start).map(function (t) { return cardHtml(prefix, t, null, bucket.newHashes); }).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html); else grid.innerHTML = html || '<div class="empty">Aucun résultat.</div>';
  return start;
}

// ---------- Suivi des séries (onglet « Suivi » du tiroir des filtres) ----------
var followGeneration = 0;
state.follow = { list: [] };

function freshLabel(n) { return n === 1 ? '1 nouveauté' : n + ' nouveautés'; }

function followCardHtml(x, index) {
  var s = x.series, n = x.summary.newCount;
  var img = x.summary.posterUrl
    ? '<img class="fade" src="' + esc(poster(x.summary.posterUrl, 'w342')) + '" onload="this.classList.add(\'on\')" onerror="this.remove()">'
    : '';
  var status = x.error ? 'recherche impossible' : n ? freshLabel(n) : 'à jour';
  return '<div class="card" data-f tabindex="-1" id="s-' + index + '" data-series="' + index + '">'
    + '<div class="poster"><div class="ph">' + iconSvg('tv') + '</div>' + img
    + '<div class="badges">' + (n ? '<span class="q right fresh">' + freshLabel(n) + '</span>' : '') + '</div></div>'
    + '<div class="cap">' + esc(s.title) + '</div>'
    + '<div class="sub">' + esc('Vu : ' + episodeCode(s) + ' · ' + status) + '</div>'
    + '</div>';
}

// Séries regardées : nouveaux épisodes cherchés sur c411 (3 séries à la fois), vignettes par release la plus récente
async function loadFollowed() {
  var generation = ++followGeneration;
  var home = state.home;
  home.generation = (home.generation || 0) + 1; home.items = []; home.done = true; home.loading = false; // coupe le défilement infini
  var all = loadSeries(), keys = Object.keys(all), grid = $('home-grid');
  renderHomeTitle('');
  if (!keys.length) {
    state.follow.list = [];
    grid.innerHTML = '<div class="empty">Aucune série suivie pour l\'instant : regardez un épisode dans la Bibliothèque, la série apparaîtra ici.</div>';
    return;
  }
  grid.innerHTML = '<div class="empty">Recherche des nouveaux épisodes de ' + keys.length + ' série(s)…</div>';
  var list = [];
  for (var i = 0; i < keys.length; i += SERIES_SEARCH_CONCURRENCY) {
    var batch = await Promise.all(keys.slice(i, i + SERIES_SEARCH_CONCURRENCY).map(function (k) {
      return searchSeriesReleases(all[k])
        .then(function (matched) { return { key: k, series: all[k], summary: seriesSummary(all[k], matched) }; })
        .catch(function () { return { key: k, series: all[k], summary: seriesSummary(all[k], []), error: true }; });
    }));
    if (generation !== followGeneration || !onCatalogTab('follow')) return;
    list = list.concat(batch);
  }
  list.sort(function (a, b) { return b.summary.latestAt - a.summary.latestAt; });
  state.follow.list = list;
  renderFollowed();
  debug('info', 'séries suivies', { series: list.length, avecNouveautes: list.filter(function (x) { return x.summary.newCount; }).length });
}

// Séries suivies affichées, filtrées par la recherche en cours (l'index reste celui de state.follow.list)
function renderFollowed() {
  var q = state.query.catalog;
  var shown = state.follow.list.map(function (x, i) { return { x: x, i: i }; })
    .filter(function (e) { return matchesQuery(e.x.series.title, q); });
  $('home-grid').innerHTML = shown.map(function (e) { return followCardHtml(e.x, e.i); }).join('')
    || '<div class="empty">' + (q ? 'Aucune série suivie ne correspond à cette recherche.' : 'Aucune série suivie pour l\'instant : regardez un épisode dans la Bibliothèque, la série apparaîtra ici.') + '</div>';
  renderHomeTitle(q ? resultsLabel(shown.length, q) : '', q ? 'RETOUR effacer la recherche' : '');
}

// Appui long sur une série suivie : ne plus la suivre (les fichiers ne sont pas touchés)
function openSeriesMenu(index) {
  var x = state.follow.list[index];
  if (!x) return;
  openModal({
    title: x.series.title,
    text: 'Vu jusqu\'à ' + episodeCode(x.series),
    buttons: [
      { label: 'Ne plus suivre cette série…', icon: 'trash', danger: true, action: function () { confirmUnfollow(x); } },
      { label: 'Annuler', action: closeModal }
    ]
  });
}

function confirmUnfollow(x) {
  openModal({
    title: 'Ne plus suivre « ' + x.series.title + ' » ?',
    text: 'La série disparaît du Suivi ; vos fichiers ne sont pas supprimés.\nElle reviendra si vous regardez un nouvel épisode.',
    buttons: [
      { label: 'Ne plus suivre', icon: 'trash', danger: true, action: function () { unfollowSeries(x); } },
      { label: 'Annuler', focus: true, action: closeModal }
    ]
  });
}

function unfollowSeries(x) {
  saveSeries(removeSeries(loadSeries(), x.key));
  var list = state.follow.list, index = list.indexOf(x);
  if (index >= 0) list.splice(index, 1);
  closeModal();
  renderFollowed();
  var target = $('s-' + Math.min(Math.max(index, 0), list.length - 1)) || $('tab-follow');
  if (target) target.focus();
  toast('« ' + x.series.title + ' » n\'est plus suivie');
}

// Releases disponibles d'une série suivie, nouveautés en premier, affichées en place dans la grille de l'accueil
function openSeries(index) {
  var x = state.follow.list[index];
  if (!x) return;
  var fromGrid = document.activeElement && document.activeElement.closest && document.activeElement.closest('#home-grid');
  state.seriesOpen = index;
  var b = state.results;
  b.generation = (b.generation || 0) + 1; b.loading = false; b.done = true; b.q = '';
  b.items = x.summary.releases.map(function (a) { return a.release; }).filter(keepCatalogItem);
  b.total = b.items.length; b.lastBatch = b.items.length;
  b.newHashes = {};
  x.summary.releases.forEach(function (a) { if (a.isNew) b.newHashes[a.release.infoHash] = true; });
  var n = x.summary.newCount;
  renderHomeTitle(x.series.title + ' · vu jusqu\'à ' + episodeCode(x.series) + ' · ' + (n ? freshLabel(n) : 'à jour'), 'RETOUR séries suivies');
  renderGrid('home-grid', 'h-', b, false);
  if (!b.items.length) $('home-grid').innerHTML = '<div class="empty">Aucune release trouvée sur c411 pour cette série.</div>';
  $('home-grid').parentNode.scrollTop = 0;
  var first = fromGrid && $('home-grid').querySelector('[data-f]');
  if (first) first.focus({ preventScroll: true });
}

// ---------- Défilement infini ----------
var GRID_COLUMNS = 7;
var GRID_LOAD_MARGIN_PX = 300;

function setGridLoading(gridId, on) {
  var el = $(gridId).parentNode.querySelector('.grid-loading');
  if (el) el.classList.toggle('on', on);
}

// Charge une page de c411 dans l'accueil ou les résultats. Une seule page à la fois ; une réponse arrivée après
// une nouvelle recherche ou un changement de filtre (génération différente) est ignorée. Renvoie true si la grille a changé.
async function loadPage(b, gridId, prefix, params, reset) {
  if (reset) {
    b.generation = (b.generation || 0) + 1;
    b.page = 0; b.items = []; b.total = 0; b.done = false; b.loading = false;
  } else if (b.loading || b.done) {
    return false;
  }
  var generation = b.generation;
  b.loading = true;
  if (!reset) setGridLoading(gridId, true);
  try {
    var j = await c411('/api/torrents', Object.assign({ perPage: PER_PAGE, page: b.page + 1 }, params));
    if (b.generation !== generation) return false;
    b.page += 1;
    var merged = mergePage(b.items, j.data, j.meta, b.page);
    b.items = merged.items; b.lastBatch = merged.fresh; b.total = merged.total; b.done = merged.done;
    renderGrid(gridId, prefix, b, !reset);
    return true;
  } finally {
    if (b.generation === generation) { b.loading = false; setGridLoading(gridId, false); }
  }
}

// Dernière rangée sélectionnée ou bas de la liste visible → page suivante
function loadMoreIfNeeded(gridId) {
  var grid = $(gridId), cards = grid.querySelectorAll('.card');
  if (!cards.length || !grid.closest('.screen.active')) return;
  var wrap = grid.parentNode;
  var index = Array.prototype.indexOf.call(cards, document.activeElement);
  var nearEnd = index >= cards.length - GRID_COLUMNS || wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - GRID_LOAD_MARGIN_PX;
  if (!nearEnd || isLocalFilterTab(currentTab()) || state.seriesOpen != null) return; // listes déjà complètes
  if (state.query.catalog) search(false); else loadHome(false);
}

function loadLaterList() {
  var home = state.home, q = state.query.catalog;
  home.generation = (home.generation || 0) + 1; home.done = true; home.loading = false; // coupe le défilement infini
  home.items = laterList().filter(keepCatalogItem);
  $('home-grid').innerHTML = home.items.map(function (t) { return cardHtml('h-', t); }).join('')
    || '<div class="empty">' + (q ? 'Aucun titre en attente ne correspond à cette recherche.'
      : 'Aucun titre en attente : sur la fiche d\'un film ou d\'une série, choisissez « Plus tard ».') + '</div>';
  renderHomeTitle(q ? resultsLabel(home.items.length, q) : '', q ? 'RETOUR effacer la recherche' : '');
}

// Ligne de titre au-dessus de la grille : ce qui est affiché, et à droite ce que fait RETOUR
function renderHomeTitle(text, hint) {
  var el = $('home-title');
  el.innerHTML = text ? esc(text) + (hint ? '<small>' + esc(hint) + '</small>' : '') : '';
  el.classList.toggle('off', !text);
}

function resultsLabel(count, q) { return count + ' résultat(s) pour « ' + q + ' »'; }

function catalogFilters() { return filterParams(state.filters); }

// Un item de liste passe la recherche et les filtres du Catalogue
function keepCatalogItem(item) {
  return matchesQuery(prettyName(item.name).title, state.query.catalog) && itemMatchesFilters(item, state.filters);
}

// Contenu de l'accueil : choisi d'après le sous-onglet, la recherche en cours et la série suivie ouverte
async function refreshHome(reset) {
  var tab = currentTab();
  updateHeroVisibility();
  if (isLocalFilterTab(tab)) {
    if (!reset) return;
    if (tab === 'foryou') await loadForYou();
    else if (tab === 'later') loadLaterList();
    else if (state.seriesOpen != null) openSeries(state.seriesOpen);
    else await loadFollowed();
    return;
  }
  await (state.query.catalog ? search(reset) : loadHome(reset));
}

async function loadHome(reset) {
  if (reset) renderHomeTitle('');
  try {
    var params = Object.assign({ category: 1, sortBy: 'createdAt', sortOrder: 'desc' }, catalogFilters());
    if (await loadPage(state.home, 'home-grid', 'h-', params, reset)) loadMoreIfNeeded('home-grid'); // page trop courte pour remplir l'écran
  } catch (e) {
    toast('Impossible de charger les nouveautés : ' + e.message, true);
  }
}

// Recherche c411 : les résultats prennent la place des nouveautés dans la grille de l'accueil
async function search(reset) {
  var b = state.results;
  if (reset) { b.q = state.query.catalog; b.newHashes = null; }
  if (!b.q) return;
  try {
    var params = Object.assign({ name: b.q, category: 1, sortBy: 'relevance' }, catalogFilters());
    if (!await loadPage(b, 'home-grid', 'h-', params, reset)) return;
    var summary = filterSummary(state.filters);
    renderHomeTitle(resultsLabel(b.total, b.q) + (summary ? ' · ' + summary : ''), 'RETOUR effacer la recherche');
    loadMoreIfNeeded('home-grid');
  } catch (e) {
    toast('Recherche impossible : ' + e.message, true);
  }
}

async function openDetail(hash) {
  state.detailFrom = 'home';
  var pick = function (list) { return (list || []).filter(function (t) { return t.infoHash === hash; })[0]; };
  var item = pick(state.results.items) || pick(state.home.items) || {};
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
  state.detail = { infoHash: hash, name: item.name, size: item.size, seeders: item.seeders, language: item.language, posterUrl: item.posterUrl, subcategory: item.subcategory };
  renderLaterButton();
  $('d-trailer').classList.add('off');
  show('detail', $('d-download'));

  try {
    var d = await c411('/api/torrents/' + hash);
    if (state.detail.infoHash !== hash) return;
    var meta = d.metadata || {};
    var tmdb = meta.tmdbData || {};
    state.detail = {
      infoHash: hash, name: d.name, size: d.size,
      seeders: d.seeders != null ? d.seeders : item.seeders,
      language: d.language || item.language,
      posterUrl: tmdb.posterUrl || item.posterUrl,
      subcategory: d.subcategory || item.subcategory // sous-catégorie retenue par « Plus tard », pour les filtres de la file d'attente
    };
    renderLaterButton();

    // Bande-annonce cherchée en arrière-plan (AlloCiné, sinon YouTube) : le bouton apparaît quand une vidéo est trouvée
    var trailerTitle = tmdb.title || n.title;
    var isSeries = /tv|serie/i.test(tmdb.type || '') || !!n.episode;
    findTrailerSource([trailerTitle, tmdb.originalTitle].filter(Boolean), tmdb.year || n.year, isSeries).then(function (source) {
      if (!source || !state.detail || state.detail.infoHash !== hash) return;
      state.detail.trailer = source;
      state.detail.trailerTitle = trailerTitle;
      buttonContent('d-trailer', 'play', source.kind === 'youtube' ? 'Bande-annonce (YouTube)' : 'Bande-annonce');
      $('d-trailer').classList.remove('off');
    }).catch(function (e) { debug('error', 'recherche de bande-annonce : ' + e.message); });

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
      ok ? '<span class="badge ok">' + iconSvg('check') + 'son lisible par la TV</span>' : '<span class="badge warn">' + iconSvg('warning') + 'son non lisible par la TV (DTS/TrueHD)</span>'
    ].join('');
    $('d-audio').textContent = tracks.length
      ? 'Audio : ' + tracks.map(function (t) { return (LANG[t.lang] || t.lang || '?') + ' ' + t.format + (t.channels ? ' ' + t.channels.replace(/ channels?/, ' can.') : '') + (trackOk(t) ? '' : ' ✗'); }).join(' · ')
      : '';
  } catch (e) {
    $('d-overview').textContent = 'Fiche indisponible.';
    toast('Fiche indisponible : ' + e.message, true);
  }
}

function renderLaterButton() {
  buttonContent('d-later', 'bookmark', isLater(state.detail.infoHash) ? 'Annuler l\'attente' : 'Plus tard');
}

function toggleLater() {
  var d = state.detail;
  if (!d) return;
  var title = prettyName(d.name).title;
  if (isLater(d.infoHash)) {
    removeLater(d.infoHash);
    toast('Retiré de la file d\'attente : ' + title);
  } else {
    addLater(d);
    toast('À télécharger plus tard : ' + title);
  }
  renderLaterButton();
  if (onCatalogTab('later')) loadLaterList(); // accueil à jour au retour, sans voler le focus
  $('d-later').focus();
}

function onGridClick(e) {
  var series = e.target.closest('[data-series]');
  if (series) { openSeries(Number(series.getAttribute('data-series'))); return; }
  var card = e.target.closest('[data-hash]');
  if (card) openDetail(card.getAttribute('data-hash'));
}

var downloading = false;
async function startDownload() {
  var d = state.detail;
  if (!d || downloading) return;
  downloading = true;
  buttonContent('d-download', 'clock', 'Envoi à la Freebox…');
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
    toast('Ajouté à la Freebox : ' + prettyName(d.name).title);
    removeLater(d.infoHash); // signet honoré : plus besoin de la file d'attente
    if (onCatalogTab('later')) loadLaterList(); // accueil à jour au retour
    state.lastFocus.downloads = null;
    openDownloads();
  } catch (e) {
    toast('Échec : ' + e.message, true);
  } finally {
    downloading = false;
    buttonContent('d-download', 'download', 'Télécharger');
  }
}

// ---------- Recherche : clavier natif Samsung (avec suggestions) ----------
// La barre visible (#search-box) fait partie de la navigation ; le vrai champ n'est affiché que pendant la saisie,
// sinon il capturerait les flèches et bloquerait l'accès aux autres boutons.
function openSearch() {
  $('search-box').parentNode.classList.add('editing');
  $('query').value = state.query[state.section];
  $('query').focus();
  toast('Tapez le titre puis « Terminé » pour rechercher · RETOUR pour fermer le clavier');
}

// Validée, la recherche s'applique à la section affichée ; vide, elle l'efface
function closeSearch(submit) {
  var box = $('search-box').parentNode;
  if (!box.classList.contains('editing')) return;
  var q = $('query').value.trim();
  box.classList.remove('editing');
  $('query').blur();
  $('search-box').focus();
  $('toast').style.display = 'none';
  if (submit) runSearch(q); else renderTopbar();
}
