// Bandeau d'accueil façon Netflix : « exclusivités populaires » de c411 (/api/homepage), avec l'image de fond TMDB,
// le titre, la note, les genres et le résumé. Défilement automatique en fondu ; sélectionné, ◀ ▶ changent de titre
// et OK ouvre la fiche.

var HERO_INTERVAL_MS = 8000;
var HERO_MAX = 8;
state.hero = { items: [], index: 0, layer: 0, timer: null };

// Image de fond en 1280 px de large (la taille d'origine est inutilement lourde pour la TV)
function heroBackdrop(url) {
  return url ? String(url).replace(/\/t\/p\/(original|w\d+)\//, '/t/p/w1280/') : '';
}

// Élément du bandeau à partir d'une fiche c411 ; sans image de fond, le titre n'est pas retenu
function heroItemFromDetail(infoHash, d) {
  var tmdb = (d && d.metadata && d.metadata.tmdbData) || {};
  if (!tmdb.backdropUrl) return null;
  var n = prettyName((d && d.name) || '');
  return {
    infoHash: infoHash,
    title: tmdb.title || n.title,
    year: String(tmdb.year || n.year || ''),
    rating: Number(tmdb.rating) || 0,
    genres: (tmdb.genres || []).slice(0, 3),
    overview: tmdb.overview || '',
    backdrop: heroBackdrop(tmdb.backdropUrl),
    isSeries: /tv|serie/i.test(tmdb.type || '')
  };
}

function heroStepIndex(index, count, step) {
  return count ? (index + step + count) % count : 0;
}

// « 2025 · ★ 7.8 · Série · Drame, Crime »
function heroMeta(item) {
  return [item.year, item.rating ? '★ ' + item.rating.toFixed(1) : '', item.isSeries ? 'Série' : '', item.genres.join(', ')].filter(Boolean).join(' · ');
}

// c411 renvoie parfois une sélection vide (constaté sur la TV, passager) : nouvel essai discret, quelques fois au plus
var HERO_RETRY_MS = 60000;
var HERO_RETRIES = 3;
var heroRetries = 0;

function retryHeroLater(reason) {
  if (heroRetries >= HERO_RETRIES) return;
  heroRetries++;
  debug('info', 'bandeau : nouvel essai prévu', { raison: reason, essai: heroRetries });
  setTimeout(function () { loadHero().catch(function (e) { retryHeroLater(e.message); }); }, HERO_RETRY_MS);
}

async function loadHero() {
  var home;
  try {
    home = await c411('/api/homepage');
  } catch (e) {
    retryHeroLater(e.message);
    throw e;
  }
  var root = (home && (home.data || home)) || {};
  var list = (root.exclusivePopular || []).slice(0, HERO_MAX);
  if (!list.length) {
    debug('info', 'bandeau : sélection vide', { cles: Object.keys(root) });
    retryHeroLater('sélection vide');
    return;
  }
  var items = await Promise.all(list.map(function (x) {
    // La fiche passe par le filtre familial de c411() : un contenu écarté lève une erreur et sort du bandeau
    return c411('/api/torrents/' + x.infoHash)
      .then(function (d) { return heroItemFromDetail(x.infoHash, d); })
      .catch(function () { return null; });
  }));
  state.hero.items = items.filter(Boolean);
  state.hero.index = 0;
  debug('info', 'bandeau', { elements: state.hero.items.length, proposes: list.length });
  renderHero();
  updateHeroVisibility();
  startHeroTimer();
}

// Affiche l'élément courant : image préchargée puis fondu enchaîné, texte animé, points de progression
function renderHero() {
  var h = state.hero, item = h.items[h.index];
  if (!item) return;
  var img = new Image();
  var show = function () {
    if (h.items[h.index] !== item) return; // un autre titre a été demandé pendant le chargement
    var layers = document.querySelectorAll('#hero .hero-img');
    var next = layers[1 - h.layer];
    next.style.backgroundImage = 'url("' + item.backdrop.replace(/"/g, '%22') + '")';
    next.classList.add('on');
    layers[h.layer].classList.remove('on');
    h.layer = 1 - h.layer;
    var content = $('hero-content');
    content.classList.remove('in');
    void content.offsetWidth; // relance l'animation d'entrée du texte
    content.classList.add('in');
    $('hero-title').textContent = item.title;
    $('hero-meta').textContent = heroMeta(item);
    $('hero-overview').textContent = item.overview;
    $('hero-dots').innerHTML = h.items.map(function (x, i) { return '<span' + (i === h.index ? ' class="on"' : '') + '></span>'; }).join('');
  };
  img.onload = show;
  img.onerror = show;
  img.src = item.backdrop;
}

function heroStep(step) {
  var h = state.hero;
  if (h.items.length < 2) return;
  h.index = heroStepIndex(h.index, h.items.length, step);
  renderHero();
}

// Passage automatique, sauf si le bandeau est sélectionné, masqué, ou si l'accueil n'est pas affiché
function startHeroTimer() {
  clearInterval(state.hero.timer);
  state.hero.timer = setInterval(function () {
    if (state.screen !== 'home' || document.hidden || document.activeElement === $('hero') || $('hero').classList.contains('off')) return;
    heroStep(1);
  }, HERO_INTERVAL_MS);
}

// Masqué dès qu'un filtre ou l'onglet Suivi est actif (la place revient aux résultats)
function updateHeroVisibility() {
  var visible = state.hero.items.length > 0 && !activeFilterCount(state.filters);
  var hero = $('hero');
  if (!visible && document.activeElement === hero) $('open-filters').focus();
  hero.classList.toggle('off', !visible);
}

function openHeroItem() {
  var item = state.hero.items[state.hero.index];
  if (item) openDetail(item.infoHash, 'home');
}
