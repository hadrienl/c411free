// Catalogue c411 : nouveautés, filtres, recherche (clavier natif), fiche détaillée et envoi à la Freebox.

// ---------- Filtres : tiroir animé sous l'en-tête de l'accueil ----------
state.filters = emptyFilters();
var FILTERS_ANIM_MS = 380;
var filtersSettleTimer = null;

function filtersOpen() { return $('filters').classList.contains('open'); }

function toggleFilters(open) {
  var drawer = $('filters');
  open = open == null ? !filtersOpen() : open;
  clearTimeout(filtersSettleTimer);
  drawer.classList.remove('settled');
  drawer.classList.toggle('open', open);
  if (open) {
    // Débordement autorisé une fois ouvert, pour que le halo des boutons sélectionnés ne soit pas coupé
    filtersSettleTimer = setTimeout(function () { drawer.classList.add('settled'); }, FILTERS_ANIM_MS);
    var first = drawer.querySelector('.tab.selected') || drawer.querySelector('[data-f]');
    if (first) first.focus();
    loadGenres().then(renderFilters); // prépare la liste des genres
  } else {
    $('open-filters').focus();
  }
}

function renderFilters() {
  var f = state.filters, n = activeFilterCount(f);
  document.querySelectorAll('#filter-type [data-subcat]').forEach(function (x) { x.classList.toggle('selected', x.getAttribute('data-subcat') === f.subcat); });
  $('filter-year').innerHTML = esc(f.year || 'Toutes les années') + '<span class="caret">▾</span>';
  $('filter-genre').innerHTML = esc((f.genre && genreName(f.genre)) || 'Tous les genres') + '<span class="caret">▾</span>';
  $('open-filters').innerHTML = FILTER_ICON + 'Filtres' + (n ? '<span class="count">' + n + '</span>' : '');
}

function applyFilters() {
  renderFilters();
  updateHeroVisibility();
  state.lastFocus.home = null;
  loadHome(true);
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
function cardHtml(prefix, t, note) {
  var n = prettyName(t.name);
  var text = n.title + (n.episode ? ' · ' + n.episode : '') + (n.year ? ' (' + n.year + ')' : '');
  var img = t.posterUrl
    ? '<img class="fade" src="' + esc(poster(t.posterUrl, 'w342')) + '" loading="lazy" onload="this.classList.add(\'on\')" onerror="this.remove()">'
    : '';
  return '<div class="card" data-f tabindex="-1" id="' + prefix + t.infoHash + '" data-hash="' + t.infoHash + '">'
    + '<div class="poster"><div class="ph">🎬</div>' + img
    + '<div class="badges">'
    + (resolution(t.name) ? '<span class="q">' + resolution(t.name) + '</span>' : '')
    + (nameAudioOk(t.name) ? '' : '<span class="q warn">⚠️ son</span>')
    + (prefix === 'r-' && state.results.newHashes && state.results.newHashes[t.infoHash] ? '<span class="q right fresh">Nouveau</span>' : '')
    + '</div></div>'
    + '<div class="cap">' + esc(text) + '</div>'
    + '<div class="sub' + (note ? ' reason' : '') + '">' + esc(note || [shortLang(t.language, t.name), gb(t.size), '▲ ' + (t.seeders || 0)].filter(Boolean).join(' · ')) + '</div>'
    + '</div>';
}

// Vignettes d'une page : remplace la grille (nouvelle liste) ou s'ajoute à la fin (page suivante)
function renderGrid(gridId, prefix, bucket, append) {
  var grid = $(gridId);
  var start = append ? bucket.items.length - bucket.lastBatch : 0;
  var html = bucket.items.slice(start).map(function (t) { return cardHtml(prefix, t); }).join('');
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
    + '<div class="poster"><div class="ph">📺</div>' + img
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
  if (!keys.length) {
    grid.innerHTML = '<div class="empty">Aucune série suivie pour l\'instant : regardez un épisode dans Médias, la série apparaîtra ici.</div>';
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
    if (generation !== followGeneration || !isFollowMode(state.filters)) return;
    list = list.concat(batch);
  }
  list.sort(function (a, b) { return b.summary.latestAt - a.summary.latestAt; });
  state.follow.list = list;
  grid.innerHTML = list.map(followCardHtml).join('');
  debug('info', 'séries suivies', { series: list.length, avecNouveautes: list.filter(function (x) { return x.summary.newCount; }).length });
}

// Appui long sur une série suivie : ne plus la suivre (les fichiers ne sont pas touchés)
function openSeriesMenu(index) {
  var x = state.follow.list[index];
  if (!x) return;
  openModal({
    title: x.series.title,
    text: 'Vu jusqu\'à ' + episodeCode(x.series),
    buttons: [
      { label: '🗑 Ne plus suivre cette série…', danger: true, action: function () { confirmUnfollow(x); } },
      { label: 'Annuler', action: closeModal }
    ]
  });
}

function confirmUnfollow(x) {
  openModal({
    title: 'Ne plus suivre « ' + x.series.title + ' » ?',
    text: 'La série disparaît du Suivi ; vos fichiers ne sont pas supprimés.\nElle reviendra si vous regardez un nouvel épisode.',
    buttons: [
      { label: '🗑 Ne plus suivre', danger: true, action: function () { unfollowSeries(x); } },
      { label: 'Annuler', focus: true, action: closeModal }
    ]
  });
}

function unfollowSeries(x) {
  saveSeries(removeSeries(loadSeries(), x.key));
  var list = state.follow.list, index = list.indexOf(x);
  if (index >= 0) list.splice(index, 1);
  closeModal();
  var grid = $('home-grid');
  grid.innerHTML = list.map(followCardHtml).join('') || '<div class="empty">Aucune série suivie pour l\'instant : regardez un épisode dans Médias, la série apparaîtra ici.</div>';
  var target = $('s-' + Math.min(Math.max(index, 0), list.length - 1)) || $('open-filters');
  if (target) target.focus();
  toast('« ' + x.series.title + ' » n\'est plus suivie');
}

// Releases disponibles d'une série, nouveautés en premier (écran des résultats)
function openSeries(index) {
  var x = state.follow.list[index];
  if (!x) return;
  var b = state.results;
  b.generation = (b.generation || 0) + 1; b.loading = false; b.done = true; b.q = '';
  b.items = x.summary.releases.map(function (a) { return a.release; });
  b.total = b.items.length; b.lastBatch = b.items.length;
  b.newHashes = {};
  x.summary.releases.forEach(function (a) { if (a.isNew) b.newHashes[a.release.infoHash] = true; });
  var n = x.summary.newCount;
  $('results-title').innerHTML = esc(x.series.title + ' · vu jusqu\'à ' + episodeCode(x.series) + ' · ' + (n ? freshLabel(n) : 'à jour'))
    + '<small>RETOUR séries suivies</small>';
  renderGrid('results-grid', 'r-', b, false);
  if (!b.items.length) $('results-grid').innerHTML = '<div class="empty">Aucune release trouvée sur c411 pour cette série.</div>';
  state.lastFocus.results = null;
  show('results');
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
  if (!nearEnd) return;
  if (gridId === 'home-grid') loadHome(false); else search(false);
}

async function loadHome(reset) {
  if (isForYouMode(state.filters)) { if (reset) loadForYou(); return; } // onglet Pour vous : recommandations du profil
  if (isFollowMode(state.filters)) { if (reset) loadFollowed(); return; } // onglet Suivi : séries suivies à la place des nouveautés
  try {
    var params = Object.assign({ category: 1, sortBy: 'createdAt', sortOrder: 'desc' }, filterParams(state.filters));
    if (await loadPage(state.home, 'home-grid', 'h-', params, reset)) loadMoreIfNeeded('home-grid'); // page trop courte pour remplir l'écran
  } catch (e) {
    toast('Impossible de charger les nouveautés : ' + e.message, true);
  }
}

async function search(reset) {
  var b = state.results;
  if (reset) {
    var q = $('query').value.trim();
    if (!q) { toast('Tapez un titre à rechercher'); return; }
    b.q = q;
    b.newHashes = null;
    toast('Recherche de « ' + q + ' »…');
  }
  try {
    var params = Object.assign({ name: b.q, category: 1, sortBy: 'relevance' }, filterParams(state.filters));
    if (!await loadPage(b, 'results-grid', 'r-', params, reset)) return;
    var summary = filterSummary(state.filters);
    $('results-title').innerHTML = esc(b.total + ' résultat(s) pour « ' + b.q + ' »' + (summary ? ' · ' + summary : '')) + '<small>RETOUR nouvelle recherche</small>';
    if (reset) { state.lastFocus.results = null; show('results'); }
    loadMoreIfNeeded('results-grid');
  } catch (e) {
    toast('Recherche impossible : ' + e.message, true);
  }
}

async function openDetail(hash, from) {
  state.detailFrom = from;
  var item = (from === 'home' ? state.home.items : state.results.items).filter(function (t) { return t.infoHash === hash; })[0] || {};
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
  state.detail = { infoHash: hash, name: item.name, size: item.size };
  $('d-trailer').classList.add('off');
  show('detail', $('d-download'));

  try {
    var d = await c411('/api/torrents/' + hash);
    if (state.detail.infoHash !== hash) return;
    var meta = d.metadata || {};
    var tmdb = meta.tmdbData || {};
    state.detail = { infoHash: hash, name: d.name, size: d.size };

    // Bande-annonce cherchée en arrière-plan (AlloCiné, sinon YouTube) : le bouton apparaît quand une vidéo est trouvée
    var trailerTitle = tmdb.title || n.title;
    var isSeries = /tv|serie/i.test(tmdb.type || '') || !!n.episode;
    findTrailerSource([trailerTitle, tmdb.originalTitle].filter(Boolean), tmdb.year || n.year, isSeries).then(function (source) {
      if (!source || !state.detail || state.detail.infoHash !== hash) return;
      state.detail.trailer = source;
      state.detail.trailerTitle = trailerTitle;
      $('d-trailer').textContent = source.kind === 'youtube' ? '▶ Bande-annonce (YouTube)' : '▶ Bande-annonce';
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
      ok ? '<span class="badge ok">📺 son lisible par la TV</span>' : '<span class="badge warn">⚠️ son non lisible par la TV (DTS/TrueHD)</span>'
    ].join('');
    $('d-audio').textContent = tracks.length
      ? 'Audio : ' + tracks.map(function (t) { return (LANG[t.lang] || t.lang || '?') + ' ' + t.format + (t.channels ? ' ' + t.channels.replace(/ channels?/, ' can.') : '') + (trackOk(t) ? '' : ' ✗'); }).join(' · ')
      : '';
  } catch (e) {
    $('d-overview').textContent = 'Fiche indisponible.';
    toast('Fiche indisponible : ' + e.message, true);
  }
}

function onGridClick(from) {
  return function (e) {
    var series = e.target.closest('[data-series]');
    if (series) { openSeries(Number(series.getAttribute('data-series'))); return; }
    var card = e.target.closest('[data-hash]');
    if (!card) return;
    openDetail(card.getAttribute('data-hash'), from);
  };
}

var downloading = false;
async function startDownload() {
  var d = state.detail;
  if (!d || downloading) return;
  downloading = true;
  $('d-download').textContent = '⏳ Envoi à la Freebox…';
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
    toast('✅ Ajouté à la Freebox : ' + prettyName(d.name).title);
    state.lastFocus.downloads = null;
    openDownloads();
  } catch (e) {
    toast('Échec : ' + e.message, true);
  } finally {
    downloading = false;
    $('d-download').textContent = '📥 Télécharger sur la Freebox';
  }
}

// ---------- Recherche : clavier natif Samsung (avec suggestions) ----------
// La barre visible (#search-box) fait partie de la navigation ; le vrai champ n'est affiché que pendant la saisie,
// sinon il capturerait les flèches et bloquerait l'accès aux autres boutons.
function openSearch() {
  document.querySelector('.search').classList.add('editing');
  $('query').focus();
  toast('⌨️ Tapez le titre puis « Terminé » pour rechercher · RETOUR pour fermer le clavier');
}

function closeSearch(submit) {
  var box = document.querySelector('.search');
  if (!box.classList.contains('editing')) return;
  var q = $('query').value.trim();
  box.classList.remove('editing');
  $('query').blur();
  $('search-label').textContent = q || 'Rechercher un film, une série…';
  $('search-box').focus();
  $('toast').style.display = 'none';
  if (submit && q) search(true);
}
