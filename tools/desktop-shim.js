// Shim de développement (Mac/Chrome) : ne fait jamais partie du paquet TV.
// Chargé avant js/core.js (voir tools/run-chrome.sh) pour que ses écouteurs
// clavier, posés en phase de capture, s'exécutent avant ceux de js/nav.js.

// ---------- Stub minimal de window.tizen ----------
// L'app n'y touche qu'à deux endroits en dehors de la lecture (grep app/js/*.js) :
// - nav.js : RETOUR quitte l'app depuis l'Accueil (tizen.application.getCurrentApplication().exit())
// - main.js : enregistrement des touches média au démarrage (tizen.tvinputdevice.registerKey), déjà
//   protégé par un try/catch mais on fournit un vrai no-op pour rester fidèle au comportement TV.
if (typeof window.tizen === 'undefined') {
  window.tizen = {
    application: {
      getCurrentApplication: function () {
        return {
          exit: function () {
            console.info('RETOUR sur l’accueil : sur la TV, l’app se fermerait ici.');
          }
        };
      }
    },
    tvinputdevice: {
      registerKey: function () { /* no-op : pas de touches média matérielles sur Mac */ }
    }
  };
}
// window.webapis n'est utilisé qu'au moment de la lecture (webapis.avplay, toujours dans des fonctions
// appelées sur action de lecture) : aucun accès au chargement du script, donc rien à stubber ici.

// ---------- Traduction clavier Mac → télécommande Tizen ----------
// nav.js attend des KeyboardEvent dont e.keyCode vaut KEY.BACK (10009) pour RETOUR. Les flèches et
// Entrée utilisent déjà les codes standards (37-40, 13) : on ne touche à rien pour elles.
(function () {
  'use strict';

  // Envoie un événement synthétique portant le keyCode attendu par nav.js, sur l'élément qui a le focus
  // (comme le ferait la télécommande). Marqué __shimSynthetic pour ne pas être re-traduit par ce même écouteur.
  function dispatchBack(type) {
    var ev = new KeyboardEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: function () { return 10009; } }); // KEY.BACK
    ev.__shimSynthetic = true;
    (document.activeElement || document).dispatchEvent(ev);
  }

  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  function translateKey(e) {
    if (e.__shimSynthetic) return; // événement déjà traduit : laisser passer vers nav.js

    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      dispatchBack(e.type);
      return;
    }
    // Retour arrière hors saisie : équivalent RETOUR (dans un champ, on laisse effacer le texte)
    if (e.key === 'Backspace' && !isTextField(document.activeElement)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      dispatchBack(e.type);
    }
  }

  document.addEventListener('keydown', translateKey, true);
  document.addEventListener('keyup', translateKey, true);

  // IME_DONE/IME_CANCEL (clavier Samsung) : nav.js les gère déjà via KEY.ENTER/KEY.BACK pour les champs
  // #query et #nick-input, et Entrée/Échap génèrent ici les codes standards ou 10009 : rien à traduire de plus.
})();
