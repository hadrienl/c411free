// Catalogue c411 : nouveautés, recherche (clavier natif), fiche détaillée et envoi à la Freebox.

function cardHtml(prefix, t) {
  var n = prettyName(t.name);
  var text = n.title + (n.episode ? ' · ' + n.episode : '') + (n.year ? ' (' + n.year + ')' : '');
  var img = t.posterUrl
    ? '<img src="' + esc(poster(t.posterUrl, 'w342')) + '" loading="lazy" onerror="this.remove()">'
    : '';
  return '<div class="card" data-f tabindex="-1" id="' + prefix + t.infoHash + '" data-hash="' + t.infoHash + '">'
    + '<div class="poster"><div class="ph">' + esc(n.title) + '</div>' + img
    + (resolution(t.name) ? '<span class="q">' + resolution(t.name) + '</span>' : '')
    + (nameAudioOk(t.name) ? '' : '<span class="q warn">⚠️ son</span>') + '</div>'
    + '<div class="cap">' + esc(text) + '</div>'
    + '<div class="sub">' + esc([shortLang(t.language, t.name), gb(t.size), '▲ ' + (t.seeders || 0)].filter(Boolean).join(' · ')) + '</div>'
    + '</div>';
}

function renderGrid(gridId, prefix, bucket, append) {
  var grid = $(gridId);
  var oldMore = grid.querySelector('.more');
  if (oldMore) oldMore.remove();
  var start = append ? bucket.items.length - bucket.lastBatch : 0;
  var html = bucket.items.slice(start).map(function (t) { return cardHtml(prefix, t); }).join('');
  if (bucket.items.length < bucket.total) {
    html += '<div class="card more" data-f tabindex="-1" id="' + prefix + 'more" data-more="1"><div class="poster">➕</div><div class="cap">Voir plus</div><div class="sub">' + bucket.items.length + ' / ' + bucket.total + '</div></div>';
  }
  if (append) grid.insertAdjacentHTML('beforeend', html); else grid.innerHTML = html || '<div class="empty">Aucun résultat.</div>';
  return start;
}

async function loadHome(reset) {
  var b = state.home;
  if (reset) { b.page = 0; b.items = []; }
  try {
    var j = await c411('/api/torrents', { category: 1, subcat: state.subcat, sortBy: 'createdAt', sortOrder: 'desc', perPage: PER_PAGE, page: b.page + 1 });
    b.page += 1;
    b.total = j.meta ? j.meta.total : j.data.length;
    b.lastBatch = j.data.length;
    b.items = b.items.concat(j.data);
    var start = renderGrid('home-grid', 'h-', b, !reset);
    if (!reset && b.items[start]) $('h-' + b.items[start].infoHash).focus();
  } catch (e) {
    toast('Impossible de charger les nouveautés : ' + e.message, true);
  }
}

async function search(reset) {
  var b = state.results;
  if (reset) {
    var q = $('query').value.trim();
    if (!q) { toast('Tapez un titre à rechercher'); return; }
    b.q = q; b.page = 0; b.items = [];
    toast('Recherche de « ' + q + ' »…');
  }
  try {
    var j = await c411('/api/torrents', { name: b.q, category: 1, sortBy: 'relevance', perPage: PER_PAGE, page: b.page + 1 });
    b.page += 1;
    b.total = j.meta ? j.meta.total : j.data.length;
    b.lastBatch = j.data.length;
    b.items = b.items.concat(j.data);
    $('results-title').innerHTML = esc(b.total + ' résultat(s) pour « ' + b.q + ' »') + '<small>RETOUR nouvelle recherche</small>';
    var start = renderGrid('results-grid', 'r-', b, !reset);
    if (reset) { state.lastFocus.results = null; show('results'); }
    else if (b.items[start]) $('r-' + b.items[start].infoHash).focus();
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
  show('detail', $('d-download'));

  try {
    var d = await c411('/api/torrents/' + hash);
    if (state.detail.infoHash !== hash) return;
    var meta = d.metadata || {};
    var tmdb = meta.tmdbData || {};
    state.detail = { infoHash: hash, name: d.name, size: d.size };

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
    var card = e.target.closest('[data-hash],[data-more]');
    if (!card) return;
    if (card.hasAttribute('data-more')) { if (from === 'home') loadHome(false); else search(false); return; }
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
