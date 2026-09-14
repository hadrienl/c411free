// Lecteur, logique pure : langues et codecs des pistes, préférences, générique de fin, sous-titres.

// « 43 min 43 s », « 1 h 2 min », « 22 min 50 s 120 ms » → millisecondes
function mediaDuration(text) {
  var ms = 0, m, re = /(\d+)\s*(h|min|ms|s)\b/g;
  var unit = { h: 3600000, min: 60000, ms: 1, s: 1000 };
  while ((m = re.exec(String(text || '')))) ms += Number(m[1]) * unit[m[2]];
  return ms;
}

// Début du générique de fin : chapitre du MediaInfo c411 s'il décrit bien ce fichier (même durée à 3 s près),
// sinon les dernières secondes de l'épisode (3 % de la durée, entre 40 s et 2 min)
var CREDITS_NAME = /credit|g[ée]n[ée]rique|ending|outro|\bend\b|\bfin\b/i;
function creditsStart(nfo, dur) {
  if (!dur) return null;
  var fallback = dur - Math.max(40000, Math.min(120000, dur * 0.03));
  var blocks = String(nfo || '').split(/\n\s*\n/);
  var general = blocks.filter(function (b) { return /^\s*General\b/i.test(b); })[0] || '';
  var nfoDur = mediaDuration((general.match(/^Duration\s*:\s*(.+)$/mi) || [])[1]);
  var menu = blocks.filter(function (b) { return /^\s*Menu\b/i.test(b); })[0];
  if (!menu || !nfoDur || Math.abs(nfoDur - dur) > 3000) return fallback;
  var chapters = menu.split('\n').map(function (line) {
    var m = line.match(/^\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*:\s*(.*)$/);
    return m ? { at: ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]), name: m[5] } : null;
  }).filter(Boolean);
  var named = chapters.filter(function (c) { return CREDITS_NAME.test(c.name) && c.at > dur * 0.5; }).pop();
  if (named) return named.at;
  var last = chapters[chapters.length - 1];
  if (last && last.at >= dur * 0.85 && dur - last.at <= 180000) return last.at;
  return fallback;
}

// --- Pistes : langue normalisée, libellés, préférences mémorisées ---
var LANG_NAMES = { fr: 'Français', en: 'Anglais', ja: 'Japonais', es: 'Espagnol', de: 'Allemand', it: 'Italien', pt: 'Portugais', ko: 'Coréen', zh: 'Chinois', ru: 'Russe', nl: 'Néerlandais' };
function langCode(value) {
  var s = String(value || '').toLowerCase().trim();
  if (!s) return '';
  if (/^(fr|fre|fra)\b|fran/.test(s)) return 'fr';
  if (/^(en|eng)\b|english|anglais/.test(s)) return 'en';
  if (/^(ja|jpn)\b|japan/.test(s)) return 'ja';
  if (/^(es|spa)\b|spanish|espa/.test(s)) return 'es';
  if (/^(de|ger|deu)\b|german|allem/.test(s)) return 'de';
  if (/^(it|ita)\b|italian/.test(s)) return 'it';
  if (/^(pt|por)\b|portug/.test(s)) return 'pt';
  if (/^(ko|kor)\b|korean/.test(s)) return 'ko';
  if (/^(zh|chi|zho)\b|chinese/.test(s)) return 'zh';
  if (/^(ru|rus)\b|russian/.test(s)) return 'ru';
  if (/^(nl|dut|nld)\b|dutch/.test(s)) return 'nl';
  return s.slice(0, 2);
}
function extraInfo(t) { try { return JSON.parse(t.extra_info) || {}; } catch (e) { return {}; } }
function codecName(fourCC, format) {
  var f = String(fourCC || format || '').toLowerCase().replace(/^audio\/(x-)?/, '');
  var map = { eac3: 'E-AC-3', ac3: 'AC-3', 'mpeg': 'AAC', aac: 'AAC', opus: 'Opus', dts: 'DTS', truehd: 'TrueHD', mp3: 'MP3', flac: 'FLAC' };
  return map[f] || format || f.toUpperCase();
}
function channelsName(ch) { var n = parseInt(ch, 10); return n === 8 ? '7.1' : n === 6 ? '5.1' : n === 2 ? 'stéréo' : n === 1 ? 'mono' : (n ? n + ' can.' : ''); }

function bestMatch(tracks, pref) {
  var cands = tracks.filter(function (t) { return t.lang && t.lang === pref.lang; });
  if (!cands.length) return null;
  if (typeof pref.forced === 'boolean') {
    var sameForced = cands.filter(function (t) { return !!t.forced === pref.forced; });
    if (sameForced.length) cands = sameForced;
  }
  if (pref.title) {
    var sameTitle = cands.filter(function (t) { return t.title && t.title.toLowerCase() === pref.title.toLowerCase(); });
    if (sameTitle.length) cands = sameTitle;
  }
  return cands[0];
}

// Sous-titres : <br> et \N deviennent des retours à la ligne, italique / gras / souligné sont conservés,
// les autres balises (font, styles ASS…) sont retirées et tout le reste est échappé
function subtitleHtml(text) {
  var clean = String(text || '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<(?!\/?(i|b|u)>)[^>]*>/gi, '');
  return clean
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>');
}
