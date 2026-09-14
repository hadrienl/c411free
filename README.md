# C411free

App pour TV Samsung (Tizen) pensée pour la famille, entièrement pilotable à la télécommande :

- **Catalogue c411** : nouveautés en vignettes, tiroir de filtres (type, année, genre proposés par c411), recherche avec le clavier natif Samsung, fiche détaillée (affiche, résumé, distribution, pistes audio compatibles avec la TV).
- **Suivi des séries** (onglet « Suivi » des filtres) : chaque série regardée est mémorisée avec son dernier épisode vu. L'onglet affiche les séries par dernière sortie, avec leurs nouveautés sur c411 (épisodes suivants, saisons suivantes). Une série ouvre la liste de ses releases, nouveautés en premier.
- **Filtre familial** : aucun contenu adulte, même mal classé sur c411.
- **Bande-annonce** dans la fiche : MP4 d'AlloCiné lu dans le lecteur de l'app (RETOUR revient à la fiche), sinon ouverture de l'app YouTube de la TV.
- **Téléchargement** : envoi du .torrent au téléchargeur de la Freebox Ultra.
- **Médias** : toutes les vidéos des disques de la Freebox, regroupées en films et dossiers d'épisodes, avec la progression des téléchargements en cours, les vidéos déjà vues et la suppression (appui long sur OK).
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
    nav.js            Navigation à la télécommande, fenêtre modale, touches
    catalog.js        Accueil, recherche, fiche, envoi à la Freebox
    library.js        Écran Médias et liste des fichiers d'un dossier
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
- **Données sur la TV** (localStorage) : `c411free.trackPrefs`, `c411free.watched`, `c411free.positions`, `c411free.mediaIndex`, `c411free.posters`, `c411free.mediaView`, `c411free.introSkips`.
