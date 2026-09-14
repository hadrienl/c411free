// Pagination du catalogue (fonction pure) : ajoute une page de c411 aux vignettes déjà chargées.
// - doublons retirés (sur les nouveautés triées par date, un nouvel upload décale les pages) ;
// - fin de liste d'après meta.totalPages : le filtre familial peut raccourcir une page sans que ce soit la fin.
function mergePage(items, data, meta, page) {
  var known = {};
  items.forEach(function (t) { known[t.infoHash] = true; });
  var fresh = (data || []).filter(function (t) {
    if (known[t.infoHash]) return false;
    known[t.infoHash] = true;
    return true;
  });
  var merged = items.concat(fresh);
  return {
    items: merged,
    fresh: fresh.length,
    total: meta && meta.total != null ? meta.total : merged.length,
    done: meta && meta.totalPages ? page >= meta.totalPages : !(data || []).length
  };
}
