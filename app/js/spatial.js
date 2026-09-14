// Navigation spatiale (fonction pure) : élément le plus proche dans une direction, à partir des rectangles à l'écran.
// ◀ ▶ restent sur la même rangée tant qu'un élément y est aligné (sinon « Année » ▶ remontait sur « Séries », plus proche
// en diagonale que « Genre » au bout de la ligne).
// ▲ ▼ vont sur la rangée immédiatement suivante, puis sur l'élément le plus proche horizontalement dans cette rangée
// (sinon « Documentaires » ▼ sautait la ligne Année / Genre pour une vignette pile en dessous).

var SPATIAL_OFF_ROW_PENALTY = 1e6;

// Défilement nécessaire pour montrer un élément (positions dans le contenu de la liste, marge autour) :
// nouvelle position, ou null s'il est déjà entièrement visible
function scrollTargetFor(elTop, elBottom, scrollTop, viewHeight, margin) {
  if (elTop - margin < scrollTop) return Math.max(0, elTop - margin);
  if (elBottom + margin > scrollTop + viewHeight) return elBottom + margin - viewHeight;
  return null;
}

// Courbe de défilement : démarre vite, ralentit en douceur à l'arrivée
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function overlaps(a1, a2, b1, b2) { return a1 < b2 - 2 && a2 > b1 + 2; }

// Distance horizontale entre deux rectangles : 0 s'ils se chevauchent en largeur
function horizontalGap(a, b) { return Math.max(0, b.left - a.right, a.left - b.right); }

// from : { left, top, right, bottom } ; rects : même forme ; renvoie l'index du meilleur rectangle, ou -1
function spatialPick(from, rects, dir) {
  var cx = (from.left + from.right) / 2, cy = (from.top + from.bottom) / 2;
  var candidates = [];
  rects.forEach(function (q, i) {
    var dx = (q.left + q.right) / 2 - cx, dy = (q.top + q.bottom) / 2 - cy;
    if ((dir === 'up' && dy >= -1) || (dir === 'down' && dy <= 1) || (dir === 'left' && dx >= -1) || (dir === 'right' && dx <= 1)) return;
    candidates.push({ i: i, q: q, dx: dx, dy: dy });
  });
  if (!candidates.length) return -1;

  var best = null, bestScore = Infinity;
  if (dir === 'up' || dir === 'down') {
    // Rangée la plus proche : le candidat dont le centre est le plus près verticalement, et ceux alignés avec lui
    var nearest = candidates.reduce(function (n, c) { return Math.abs(c.dy) < Math.abs(n.dy) ? c : n; });
    candidates.forEach(function (c) {
      if (!overlaps(c.q.top, c.q.bottom, nearest.q.top, nearest.q.bottom)) return;
      var score = horizontalGap(from, c.q) * 10 + Math.abs(c.dx);
      if (score < bestScore) { bestScore = score; best = c; }
    });
  } else {
    candidates.forEach(function (c) {
      var sameRow = overlaps(c.q.top, c.q.bottom, from.top, from.bottom);
      var score = Math.abs(c.dx) + Math.abs(c.dy) * 3 + (sameRow ? 0 : SPATIAL_OFF_ROW_PENALTY);
      if (score < bestScore) { bestScore = score; best = c; }
    });
  }
  return best ? best.i : -1;
}
