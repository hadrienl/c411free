// Génériques (fonctions pures) : chapitres du fichier, générique de début appris par série.

// Noms de chapitres relevés sur les disques : « OP », « Intro », « ED », « End Credits », « Preview »…
var OPENING_CHAPTER = /\b(op|opening|g[ée]n[ée]rique|ouverture|title sequence|main titles?|theme song)\b/i;
var INTRO_CHAPTER = /\b(intro|introduction)\b/i;
var ENDING_CHAPTER = /\b(ed|ending|end credits?|credits?|g[ée]n[ée]rique de fin|outro)\b/i;
var CHAPTER_INTRO_MIN_MS = 10000;
var CHAPTER_INTRO_MAX_MS = 180000;

// Apprentissage : sauts vers l'avant enchaînés au début d'un épisode (ex. trois fois +30 s)
var SKIP_SETTLE_MS = 6000;        // plus de saut depuis 6 s : le saut est terminé
var SKIP_CHAIN_GAP_MS = 8000;     // un nouveau saut qui part à moins de 8 s de la fin du précédent le prolonge
var SKIP_MAX_START_MS = 6 * 60000;
var SKIP_MIN_MS = 20000;
var SKIP_MAX_MS = 180000;

function chapterSpans(chapters, durMs) {
  return chapters.map(function (c, i) {
    return { start: c.at, end: i + 1 < chapters.length ? chapters[i + 1].at : durMs, name: c.name };
  });
}

// Générique de début d'après les chapitres : « OP / Opening / Générique » en priorité, sinon « Intro » (10 s à 3 min, 1re moitié)
function introFromChapters(chapters, durMs) {
  if (!chapters || !chapters.length || !durMs) return null;
  var plausible = function (s) { return s.end - s.start >= CHAPTER_INTRO_MIN_MS && s.end - s.start <= CHAPTER_INTRO_MAX_MS && s.start < durMs / 2; };
  var spans = chapterSpans(chapters, durMs);
  var pick = spans.filter(function (s) { return OPENING_CHAPTER.test(s.name) && !ENDING_CHAPTER.test(s.name) && plausible(s); })[0]
    || spans.filter(function (s) { return INTRO_CHAPTER.test(s.name) && plausible(s); })[0];
  return pick ? { start: pick.start, end: pick.end, source: 'chapitres' } : null;
}

// Début du générique de fin d'après les chapitres (2e moitié du fichier), sinon null
function creditsFromChapters(chapters, durMs) {
  var credits = (chapters || []).filter(function (c) { return ENDING_CHAPTER.test(c.name) && c.at > durMs / 2; })[0];
  return credits ? credits.at : null;
}

// Série d'un épisode : titre avant SxxEyy, sinon nom du dossier (« [EBD].Fullmetal…01 » lu depuis « Fullmetal Alchemist Brotherhood »)
function seriesKey(fileName, folderName) {
  var clean = function (name) { return String(name || '').split(' — ')[0].replace(/^\[[^\]]*\][\s._\-]*/, ''); };
  var n = prettyName(clean(fileName));
  if (n.episode) return normTitle(n.title) || null;
  if (folderName) return normTitle(prettyName(clean(folderName)).title) || null;
  return null;
}

// Nouveau saut de fromMs à toMs. Enchaîné au précédent, il le prolonge ou le corrige (on dépasse puis on revient un peu) :
// le générique va du point de départ au point d'arrivée final. Un retour en arrière isolé n'est pas un saut de générique.
function trackSkip(pending, fromMs, toMs, nowMs) {
  if (pending && nowMs - pending.lastAt < SKIP_SETTLE_MS && Math.abs(fromMs - pending.end) < SKIP_CHAIN_GAP_MS) {
    return { start: pending.start, end: toMs, lastAt: nowMs };
  }
  return toMs > fromMs ? { start: fromMs, end: toMs, lastAt: nowMs } : null;
}

// Saut terminé et plausible comme générique de début → { start, end }, sinon null
function learnedSkip(pending, nowMs) {
  if (!pending || nowMs - pending.lastAt < SKIP_SETTLE_MS) return null;
  var length = pending.end - pending.start;
  if (pending.start > SKIP_MAX_START_MS || length < SKIP_MIN_MS || length > SKIP_MAX_MS) return null;
  return { start: pending.start, end: pending.end };
}

// Période d'affichage du bouton : chapitres exacts ; générique appris plus approximatif (5 s de marge)
function introWindow(intro) {
  if (!intro) return null;
  var margin = intro.source === 'chapitres' ? 0 : 5000;
  var from = Math.max(0, intro.start - margin), to = intro.end - (intro.source === 'chapitres' ? 2000 : 5000);
  return to > from ? { from: from, to: to } : null;
}
