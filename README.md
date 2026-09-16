# C411free

App pour TV Samsung (Tizen) pensée pour la famille, entièrement pilotable à la télécommande :

- **Deux sections**, dans un en-tête unique à trois rangées (recherche et profil, sections, sous-onglets) : **Catalogue** (ce qu'il y a sur c411) et **Bibliothèque** (ce qui est sur les disques de la Freebox). La rangée de sous-onglets change avec la section.
- **Recherche contextuelle** : la barre de recherche (clavier natif Samsung) cherche là où l'on se trouve — sur c411 dans le Catalogue, dans la liste affichée pour « Pour vous », « Suivi » et « En attente », parmi les vidéos des disques dans la Bibliothèque. Les résultats remplacent la grille en place, chaque section garde sa recherche, et RETOUR l'efface.
- **Catalogue** : nouveautés en vignettes (**Accueil**), fiche détaillée (affiche, résumé, distribution, pistes audio compatibles avec la TV). RETOUR referme le panneau de filtres, efface la recherche, remonte la liste, revient à l'Accueil, puis quitte l'app.
- **Filtres** (bouton à droite de la rangée des sous-onglets) : type, année et genre proposés par c411, dans un panneau qui s'ouvre sous l'en-tête. Ils valent pour tout le Catalogue — nouveautés, recherche, « Pour vous », « En attente » et les releases d'une série suivie. Le genre ne s'applique qu'aux nouveautés et à la recherche : les items de liste ne le portent pas, seule la fiche d'un titre le connaît.
- **Profils** (avatar en haut à droite) : chaque membre de la famille a son surnom, son avatar (dix au choix) et ses propres épisodes vus, reprises, séries suivies et préférences de pistes. L'écran « Qui regarde ? » permet de changer de profil, d'en modifier ou d'en ajouter un.
- **Pour vous** (sous-onglet du Catalogue) : recommandations propres à chaque profil. Les goûts sont déduits de ce qui a été regardé et jusqu'où (film fini ou abandonné, nombre d'épisodes d'une série), à partir des genres, mots-clés, réalisateurs et acteurs des fiches TMDB de c411. Les propositions viennent de c411, sans ce qui a déjà été vu ou est déjà sur les disques, avec la raison sous chaque vignette.
- **Suivi des séries** (sous-onglet du Catalogue) : chaque série regardée est mémorisée avec son dernier épisode vu. L'onglet affiche les séries par dernière sortie, avec leurs nouveautés sur c411 (épisodes suivants, saisons suivantes). Une série ouvre la liste de ses releases en place, nouveautés en premier ; RETOUR revient aux séries suivies.
- **En attente** (sous-onglet du Catalogue) : sur la fiche d'un titre, « Plus tard » le met de côté sans le télécharger. L'onglet liste ces titres, du plus récent au plus ancien ; le signet disparaît dès que le titre est envoyé à la Freebox.
- **Filtre familial** : aucun contenu adulte, même mal classé sur c411.
- **Bande-annonce** dans la fiche : MP4 d'AlloCiné lu dans le lecteur de l'app (RETOUR revient à la fiche), sinon ouverture de l'app YouTube de la TV.
- **Téléchargement** : envoi du .torrent au téléchargeur de la Freebox Ultra.
- **Bibliothèque** : toutes les vidéos des disques de la Freebox, en sous-onglets **Tout**, **Films** et **Séries**, en vignettes ou en liste, triées au choix (date, nom, taille), avec la progression des téléchargements en cours, les vidéos déjà vues et la suppression (appui long sur OK). Les disques sont réanalysés tout seuls (au plus toutes les 10 min, et à la fin d'un téléchargement).
- **Lecteur intégré** (AVPlay, décodeur matériel) : pistes audio et sous-titres mémorisés, barre de lecture, reprise là où on s'était arrêté, « Passer le générique » (chapitres du fichier, sinon générique appris en sautant une fois sur un autre épisode de la série), épisode suivant à l'arrivée du générique de fin.

L'app est autonome sur la TV : elle parle directement à c411 et à la Freebox, sans serveur.

## Organisation

```
app/                  App TV (Tizen, HTML/JS sans dépendance ni build)
  config.xml          Identité, version et privilèges du paquet
  index.html          Écrans
  css/app.css         Styles (écran 1920 × 1080)
  js/                 Scripts classiques chargés dans l'ordre d'index.html
    core.js           Configuration, état global, journal, messages
    names.js          Formatage : noms de releases, tailles, dates, durées
    storage.js        Mémorisé sur la TV : vus, positions, préférences de pistes
    c411.js           API c411 et filtre familial, MediaInfo
    freebox.js        Session Freebox (HMAC), API, adresses UPnP
    media.js          Index des médias : parcours des disques, regroupement, téléchargements, cibles de suppression
    tracks.js         Logique pure du lecteur : langues, préférences, générique, sous-titres
    sections.js       Sections, sous-onglets et recherche : état de navigation et fonctions pures
    nav.js            Navigation à la télécommande, en-tête, fenêtre modale, touches
    catalog.js        Catalogue : accueil, filtres, recherche, fiche, envoi à la Freebox
    library.js        Bibliothèque et liste des fichiers d'un dossier
    delete.js         Menu d'une ligne et suppression
    player.js         Lecteur AVPlay
    main.js           Actions des écrans et démarrage
tools/                Scripts du Mac : déploiement, certificats, diagnostic
test/                 Tests de la logique pure (node --test)
secrets/              Secrets locaux, jamais versionnés
```

`app/config.js` (clé c411, jeton Freebox, options) est généré à chaque déploiement dans le paquet uniquement.

## Prérequis

- Node.js ≥ 20.
- Tizen Studio en ligne de commande dans `~/tizen-studio-cli` (ou `TIZEN_HOME`).
- TV en mode développeur, avec l'IP du Mac déclarée. `sdb connect <IP de la TV>` doit fonctionner.
- `secrets/local.env` (copie de `tools/local.env.example`) : IP de la TV (`TV_IP`) et son DUID (`TV_DUID`, pour les certificats).
- Dans `secrets/` :
  - `c411.env` : `C411_API_KEY=…` ;
  - `freebox.json` : jeton de l'app, obtenu avec `node tools/freebox.mjs auth` puis validé sur l'écran de la Freebox ;
  - `tizen-cert.password` et `tizen-cert/` : certificats Samsung liés à la TV.

### Certificats (une fois, ou à leur expiration)

```sh
tools/make-cert.sh <email_compte_samsung>   # outil tizencertificates dans Docker, connexion au compte Samsung
tools/register-cert.sh                      # profil de signature « c411free » dans la CLI tizen
```

## Utilisation

```sh
npm test               # tests de la logique (regroupement des médias, suppression, filtre, lecteur…)
npm run check          # syntaxe de tous les scripts
npm run deploy         # génère la config, empaquette, installe et lance l'app sur la TV
```

### Déboguer sur la TV

```sh
npm run logs           # terminal 1 : récepteur du journal (logs/tv-log.jsonl)
npm run deploy:debug   # terminal 2 : déploie avec le journal envoyé à ce Mac
```

Sans `DEBUG_LOG=1`, l'app n'envoie aucun journal. La clé c411 est masquée dans les messages.

Variables utiles : `TV_IP` (sinon lue dans `secrets/local.env`), `LOG_HOST` (IP du Mac, détectée sur en0/en1), `LOG_PORT` (8765).

### Autres outils

- `node tools/freebox.mjs list|files|add|stats` : diagnostic du téléchargeur Freebox.
- `node tools/c411.mjs caps|search|grab` : diagnostic de l'API c411.
- `node tools/tv-remote.mjs KEY_…` : télécommande réseau Samsung.
- `npm run chrome` : lance l'app dans Google Chrome sur le Mac (1920×1080), avec la vraie configuration et un shim pour le clavier et les API Tizen — pratique pour développer sans repasser par la TV.

## Points techniques à connaître

- **Télécommande** : pas de touches de couleur ni de chiffres. Le bouton Multi View n'est jamais transmis à l'app.
  - Touche maintenue : la TV envoie un faux `keyup` au bout d'environ 1 s.
  - OK n'est jamais répété : un appui court se relâche vers 200 ms. L'appui long est donc détecté quand il n'y a toujours pas eu de `keyup` au bout de 500 ms.
- **Lecture** : la vidéo passe par le serveur UPnP de la Freebox (`http://<IP LAN>:52424/files/…`). Le nom `mafreebox.freebox.fr` y est refusé. Il faut appeler `play()` avant de choisir les pistes.
- **Freebox** :
  - `download_dir` inclut déjà le dossier des torrents à plusieurs fichiers.
  - `DELETE /downloads/{id}` supprime la tâche ; `/erase` supprime aussi ses fichiers.
  - `POST /fs/rm/` crée une tâche de fichiers, suivie avec `/fs/tasks/{id}`.
- **c411** : un .torrent téléchargé compte pour le ratio. Il faut partager au moins 48 h, et l'app avertit avant de supprimer un partage plus récent.
- **Génériques** : AVPlay ne donne accès ni à l'image, ni au son, ni aux chapitres.
  - Les chapitres MKV sont lus directement dans le fichier : environ 1 épisode sur 6 en contient (mesuré sur les disques).
  - Sinon, l'app retient le générique d'une série quand on saute vers l'avant au début d'un épisode : sauts enchaînés dans les 6 premières minutes, totalisant 20 s à 3 min.
- **Données sur la TV** (localStorage) : `c411free.trackPrefs`, `c411free.watched`, `c411free.positions`, `c411free.mediaIndex`, `c411free.posters`, `c411free.mediaView`, `c411free.mediaSort`, `c411free.introSkips`, `c411free.series`, `c411free.genres`, `c411free.hero`, `c411free.profiles`.
  - Données propres à chaque profil : `watched`, `positions`, `trackPrefs` et `series`. Le premier profil garde ces clés telles quelles ; les suivants les suffixent par `@<id>` (ex. `c411free.watched@2`).

## Licence

[MIT](LICENSE) © 2026 Hadrien Lanneau.

Projet personnel sans lien avec c411, Free, Samsung, AlloCiné ou YouTube. Il nécessite vos propres identifiants c411 et une Freebox ; à utiliser dans le respect de leurs conditions d'utilisation.
