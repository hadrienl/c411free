// Bandeau d'accueil façon Netflix : « exclusivités populaires » de c411 (/api/homepage), avec l'image de fond TMDB,
// le titre, la note, les genres et le résumé. Défilement automatique en fondu ; sélectionné, ◀ ▶ changent de titre
// et OK ouvre la fiche.

var HERO_INTERVAL_MS = 8000;
var HERO_MAX = 8;
// Durée de l'animation de repli/déploiement du bandeau : doit rester égale à FILTERS_ANIM_MS (catalog.js),
// la même durée que le tiroir de filtres, pour que les deux animations restent synchronisées.
var HERO_ANIM_MS = 380;
var heroHideTimer = null;
// Dernière sélection reçue de c411, mémorisée sur la TV (commune à tous les profils) : /api/homepage renvoie
// souvent une sélection vide au lancement, le bandeau serait sinon absent jusqu'aux nouveaux essais.
var HERO_KEY = 'c411free.hero';
var HERO_CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
state.hero = { items: [], index: 0, layer: 0, timer: null };

function loadHeroCache() { try { return JSON.parse(localStorage.getItem(HERO_KEY)); } catch (e) { return null; } }

function saveHeroCache(items) {
  try { localStorage.setItem(HERO_KEY, JSON.stringify({ at: Date.now(), items: items })); } catch (e) { /* stockage indisponible */ }
}

// Sélection mémorisée exploitable : non vide et de moins d'une semaine
function heroCacheUsable(cache, nowMs) {
  return !!cache && Array.isArray(cache.items) && cache.items.length > 0 && nowMs - (cache.at || 0) < HERO_CACHE_MAX_AGE;
}

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

// Affiche la sélection mémorisée en attendant que c411 réponde ; vrai si elle a pu servir
function showHeroFromCache(reason, extra) {
  var cache = loadHeroCache(), usable = heroCacheUsable(cache, Date.now());
  debug('info', 'bandeau : ' + reason, Object.assign({ cache: usable ? cache.items.length : 0 }, extra || {}));
  if (!usable || state.hero.items.length) return false;
  state.hero.items = cache.items;
  state.hero.index = 0;
  renderHero();
  updateHeroVisibility();
  startHeroTimer();
  return true;
}

async function loadHero() {
  var home;
  try {
    home = await c411('/api/homepage');
  } catch (e) {
    var served = showHeroFromCache('page d\'accueil injoignable', { erreur: e.message });
    retryHeroLater(e.message);
    if (served) return; // bandeau affiché depuis le cache : le démarrage suit son cours normal
    throw e;
  }
  var root = (home && (home.data || home)) || {};
  var list = (root.exclusivePopular || []).slice(0, HERO_MAX);
  if (!list.length) {
    showHeroFromCache('sélection vide', { cles: Object.keys(root) });
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
  if (state.hero.items.length) saveHeroCache(state.hero.items); // servira au prochain lancement si c411 répond à vide
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

// Passage automatique, sauf si le bandeau est sélectionné, masqué (ou en train de se replier), couvert par le
// panneau de filtres, ou si l'accueil n'est pas affiché
function startHeroTimer() {
  clearInterval(state.hero.timer);
  state.hero.timer = setInterval(function () {
    var hero = $('hero');
    if (state.screen !== 'home' || document.hidden || document.activeElement === hero
      || hero.classList.contains('off') || hero.classList.contains('collapsed') || filtersOpen()) return;
    heroStep(1);
  }, HERO_INTERVAL_MS);
}

// Détermine l'animation à jouer selon l'état du bandeau avant/après et l'écran affiché ; fonction pure, testée
// isolément. 'collapse' (se replie avant de passer à off), 'expand' (se redéploie), 'immediate' (bascule sans
// attendre, hors accueil), 'none' (rien ne change).
function heroTransition(visibleBefore, visibleAfter, onHome) {
  if (visibleBefore === visibleAfter) return 'none';
  if (!onHome) return 'immediate';
  return visibleAfter ? 'expand' : 'collapse';
}

// Visible seulement sur l'accueil du Catalogue, hors recherche et filtre actif (le panneau de filtres, lui,
// est une surcouche qui ne masque plus le bandeau : ailleurs, la place revient aux résultats).
// hero-off (qui rend sa place à la grille) est posé/retiré DÈS le début du repli/déploiement, en même temps
// que collapsed : la grille glisse en un seul mouvement, synchronisé avec le bandeau (même durée/courbe).
// Le minuteur ne sert plus qu'à poser off (display: none) une fois le bandeau devenu invisible.
function updateHeroVisibility() {
  var visible = state.hero.items.length > 0 && onCatalogTab('home') && !state.query.catalog && !activeFilterCount(state.filters);
  var hero = $('hero');
  if (!visible && document.activeElement === hero && $('tab-' + currentTab())) $('tab-' + currentTab()).focus();

  // « collapsed » sans « off » : repli en cours, pas encore pleinement masqué. Compte comme non-visible, sinon
  // une réouverture pendant les 380 ms serait vue comme « aucun changement » et laisserait le minuteur en cours
  // ajouter « off » malgré tout.
  var visibleBefore = !hero.classList.contains('off') && !hero.classList.contains('collapsed');
  var transition = heroTransition(visibleBefore, visible, state.screen === 'home');
  if (transition === 'none') return;

  if (transition === 'collapse') {
    clearTimeout(heroHideTimer);
    hero.classList.add('collapsed');
    hero.parentNode.classList.add('hero-off');
    heroHideTimer = setTimeout(function () {
      hero.classList.add('off');
      heroHideTimer = null;
    }, HERO_ANIM_MS);
    return;
  }

  if (transition === 'expand') {
    clearTimeout(heroHideTimer);
    heroHideTimer = null;
    hero.classList.remove('off');
    void hero.offsetWidth; // force le reflow : sinon retirer collapsed/hero-off juste après off ne relance pas les transitions
    hero.classList.remove('collapsed');
    hero.parentNode.classList.remove('hero-off');
    return;
  }

  // 'immediate' : écran autre que l'accueil, pas d'animation invisible à attendre
  clearTimeout(heroHideTimer);
  heroHideTimer = null;
  hero.classList.remove('collapsed');
  hero.classList.toggle('off', !visible);
  hero.parentNode.classList.toggle('hero-off', !visible);
}

function openHeroItem() {
  var item = state.hero.items[state.hero.index];
  if (item) openDetail(item.infoHash);
}
