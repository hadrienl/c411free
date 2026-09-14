// Navigation spatiale (fonction pure) : élément le plus proche dans une direction, à partir des rectangles à l'écran.
// ◀ ▶ restent sur la même rangée tant qu'un élément y est aligné (sinon « Année » ▶ remontait sur « Séries », plus proche
// en diagonale que « Genre » au bout de la ligne). ▲ ▼ : le plus proche, l'écart horizontal comptant triple.

var SPATIAL_OFF_ROW_PENALTY = 1e6;

// from : { left, top, right, bottom } ; rects : même forme ; renvoie l'index du meilleur rectangle, ou -1
function spatialPick(from, rects, dir) {
  var cx = (from.left + from.right) / 2, cy = (from.top + from.bottom) / 2;
  var vertical = dir === 'up' || dir === 'down';
  var best = -1, bestScore = Infinity;
  rects.forEach(function (q, i) {
    var dx = (q.left + q.right) / 2 - cx, dy = (q.top + q.bottom) / 2 - cy;
    if ((dir === 'up' && dy >= -1) || (dir === 'down' && dy <= 1) || (dir === 'left' && dx >= -1) || (dir === 'right' && dx <= 1)) return;
    var score;
    if (vertical) {
      score = Math.abs(dy) + Math.abs(dx) * 3;
    } else {
      var sameRow = q.top < from.bottom - 2 && q.bottom > from.top + 2;
      score = Math.abs(dx) + Math.abs(dy) * 3 + (sameRow ? 0 : SPATIAL_OFF_ROW_PENALTY);
    }
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
