// Fond d'écran d'ambiance : affiche de la vignette sélectionnée, floutée, en fondu enchaîné.
// Deux calques alternent : le nouveau apparaît quand l'image est prête, l'ancien s'efface.

var AMBIENT_DELAY_MS = 200; // navigation rapide : on attend que la sélection se pose
var ambient = { current: 0, url: '', timer: null };

function setAmbient(url) {
  if (!url || url === ambient.url) return;
  ambient.url = url;
  var img = new Image();
  img.onload = function () {
    if (ambient.url !== url) return; // la sélection a changé pendant le chargement
    var layers = document.querySelectorAll('#ambient .amb');
    var next = layers[1 - ambient.current];
    next.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
    next.classList.add('on');
    layers[ambient.current].classList.remove('on');
    ambient.current = 1 - ambient.current;
  };
  img.src = url; // affiche déjà chargée par la vignette : servie par le cache
}

// Vignette sélectionnée avec une affiche → nouveau fond ; sans affiche (ou autre élément) → le fond reste
document.addEventListener('focusin', function (e) {
  var card = e.target.closest && e.target.closest('.card');
  var img = card && card.querySelector('.poster img');
  if (!img) return;
  clearTimeout(ambient.timer);
  var src = img.getAttribute('src');
  ambient.timer = setTimeout(function () { setAmbient(src); }, AMBIENT_DELAY_MS);
});
