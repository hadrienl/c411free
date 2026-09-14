// c411 : filtre familial, appels API et lecture du MediaInfo.

// ---------- c411 ----------
// Filtre familial, appliqué à toutes les réponses c411 (accueil, onglets, recherche, « Voir plus », fiches) :
// uniquement Films & Vidéos (sous-catégories connues) et aucun nom à caractère adulte. c411 masque la catégorie XXX
// pour ce compte, mais du contenu adulte peut être mal classé (ex. hentai en « Animation Série »).
var SAFE_CATEGORY = 1;
var SAFE_SUBCATEGORIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 54, 57];
var ADULT_NAME = /\b(hentai|porn\w*|brazzers|onlyfans|bangbros|reality\s*kings|naughty\s*america|blacked|tushy|jav|uncensored|erotic\w*|érotique\w*|erotique\w*|nsfw|milf|xvideos|playboy\s*tv)\b/i;

function isFamilySafe(t) {
  if (!t) return false;
  if (t.category) {
    if (t.category.isXxx || Number(t.category.id || t.category) !== SAFE_CATEGORY) return false;
  }
  var sub = t.subcategory && (t.subcategory.id || t.subcategory);
  if (sub && SAFE_SUBCATEGORIES.indexOf(Number(sub)) < 0) return false;
  var name = String(t.name || '').replace(/[._]/g, ' ');
  if (ADULT_NAME.test(name)) return false;
  // « XXX » comme balise au milieu d'un nom de release (mais pas le film « xXx » en début de titre)
  if (/\S\s+XXX\b/i.test(name)) return false;
  return true;
}

function c411(path, params) {
  var qs = Object.keys(params || {}).filter(function (k) { return params[k] !== '' && params[k] != null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
  qs.push('apikey=' + encodeURIComponent(S.c411ApiKey));
  return fetch(C411 + path + '?' + qs.join('&'), { headers: { Accept: 'application/json' } }).then(function (res) {
    if (!res.ok) throw new Error('c411 a répondu HTTP ' + res.status);
    return res.json();
  }).then(function (json) {
    if (/^\/api\/torrents\/?$/.test(path) && json && Array.isArray(json.data)) {
      var before = json.data.length;
      json.data = json.data.filter(isFamilySafe);
      if (before !== json.data.length) debug('info', 'filtre familial', { path: path, retires: before - json.data.length });
    } else if (/^\/api\/torrents\/[0-9a-f]{40}$/i.test(path) && !isFamilySafe(json)) {
      throw new Error('contenu non disponible');
    }
    return json;
  });
}

// MediaInfo (nfoContent) → pistes réelles d'un type donné (« Audio », « Text »), dans l'ordre du fichier
function mediaTracks(nfo, kind) {
  if (!nfo) return [];
  return String(nfo).split(/\n\s*\n/).filter(function (block) { return new RegExp('^\\s*' + kind + '\\b', 'i').test(block); }).map(function (block) {
    var get = function (k) { return ((block.match(new RegExp('^' + k + '\\s*:\\s*(.+)$', 'mi')) || [])[1] || '').trim(); };
    return { format: get('Format'), channels: get('Channel\\(s\\)'), lang: get('Language'), title: get('Title'), forced: get('Forced') };
  }).filter(function (t) { return t.format; });
}
function parseAudio(nfo) { return mediaTracks(nfo, 'Audio'); }
function trackOk(t) { var f = t.format.toUpperCase(); return !/DTS|MLP|TRUEHD/.test(f) && /AC-3|AAC|OPUS|MPEG AUDIO|PCM|DOLBY DIGITAL/.test(f); }
var LANG = { French: 'Français', English: 'Anglais', Japanese: 'Japonais', Spanish: 'Espagnol', German: 'Allemand', Italian: 'Italien' };
