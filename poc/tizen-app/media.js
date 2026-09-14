// Médias : index de toutes les vidéos présentes sur les disques de la Freebox (API fichiers /fs/ls/),
// regroupées en films et dossiers d'épisodes indépendamment de l'arborescence, puis associées aux téléchargements.
var Media = (function () {
  var CACHE_KEY = 'c411free.mediaIndex';
  var VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|ts|m2ts|webm|wmv|mpe?g)$/i;
  var MIN_SIZE = 50 * 1024 * 1024; // écarte les extraits (samples) et segments vidéo
  var EXCLUDED_DIR = /^(VMs|lost\+found|System Volume Information|\$RECYCLE\.BIN|\.Trash.*)$/i;
  var EPISODE = /\bs\d{1,2}\s?e\d{1,3}\b|\b\d{1,2}x\d{2,3}\b|\bep(isode)?\s?\d{1,3}\b|\s-\s\d{2,3}\b/i;
  var SEASON_DIR = /\b(s\d{1,2}|saison|season|int[ée]grale|complete)\b/i;
  var STOP_WORDS = /^(the|le|la|les|l|un|une|a|de|des|du|et|and|of)$/;
  var CONCURRENCY = 4;

  function b64ToUtf8(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); }));
  }

  function utf8ToB64(text) {
    var bin = '';
    new TextEncoder().encode(text).forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function isVideo(e) {
    return VIDEO_EXT.test(e.name) && (e.size || 0) >= MIN_SIZE && !/\bsample\b/i.test(e.name);
  }

  // Parcours complet des disques, CONCURRENCY dossiers à la fois. ls(chemin) → entrées de /fs/ls/.
  async function scan(ls, onProgress) {
    var videos = [], pending = ['/'], dirs = 0;
    while (pending.length) {
      var batch = pending.splice(0, CONCURRENCY);
      var results = await Promise.all(batch.map(function (path) {
        return Promise.resolve().then(function () { return ls(path); }).catch(function () { return []; });
      }));
      results.forEach(function (entries) {
        dirs++;
        (entries || []).forEach(function (e) {
          if (e.name === '.' || e.name === '..' || e.hidden) return;
          var path = b64ToUtf8(e.path);
          if (e.type === 'dir') {
            if (!EXCLUDED_DIR.test(e.name)) pending.push(path);
          } else if (isVideo(e)) {
            videos.push({ name: e.name, path: path, filepath: e.path, size: e.size || 0, mtime: e.modification || 0 });
          }
        });
      });
      if (onProgress) onProgress(dirs, videos.length);
    }
    return videos;
  }

  function normalized(name) { return name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').toLowerCase(); }

  function significantWords(text) {
    return normalized(text).split(/[^a-z0-9àâäéèêëïîôöùûüç]+/).filter(function (w) { return w.length >= 3 && !STOP_WORDS.test(w) && !/^\d+$/.test(w); });
  }

  function sortFiles(files) {
    return files.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr', { numeric: true }); });
  }

  function makeEntry(kind, name, path, files) {
    files = sortFiles(files);
    return {
      kind: kind, name: name, path: path, files: files,
      size: files.reduce(function (s, f) { return s + f.size; }, 0),
      mtime: files.reduce(function (m, f) { return Math.max(m, f.mtime); }, 0)
    };
  }

  function fileEntry(file) { return makeEntry('file', file.name, file.path, [file]); }

  // Dossier aux vidéos d'une même série : nom générique (« Saison 1 », « OAV's ») → préfixé par le dossier parent
  function folderEntry(node, parent, files) {
    var fileWords = significantWords(files.map(function (f) { return f.name; }).join(' '));
    var shared = significantWords(node.name).some(function (w) { return fileWords.indexOf(w) >= 0; });
    var name = !shared && parent && parent.name ? parent.name + ' — ' + node.name : node.name;
    return makeEntry('folder', name, node.path, files);
  }

  // Épisodes d'une même série : même titre avant le numéro d'épisode (≥ 80 %), dossier de saison,
  // ou premiers mots communs significatifs (« Gremlins 1 », « Gremlins 2 »)
  function looksLikeEpisodes(dir, files) {
    var names = files.map(function (f) { return normalized(f.name); });
    var titles = {};
    names.forEach(function (n) {
      var i = n.search(EPISODE);
      if (i > 0) { var t = n.slice(0, i).trim(); titles[t] = (titles[t] || 0) + 1; }
    });
    var best = Object.keys(titles).reduce(function (m, t) { return Math.max(m, titles[t]); }, 0);
    if (best >= names.length * 0.8) return true;
    if (SEASON_DIR.test(dir.name.replace(/[._]+/g, ' '))) return true;
    var words = names.map(function (n) { return n.split(/\s+/); });
    var common = [];
    for (var i = 0; i < words[0].length; i++) {
      var w = words[0][i];
      if (!words.every(function (ws) { return ws[i] === w; })) break;
      common.push(w);
    }
    return common.filter(function (w) { return !STOP_WORDS.test(w) && !/^\d+$/.test(w); }).join(' ').length >= 4;
  }

  // Série + saison d'un épisode isolé (« ovnis 2021 s1 », « fullmetal alchemist brotherhood ») et nom affiché du groupe
  function episodeGroup(file) {
    // Balise de groupe en tête ignorée : « [EBD].Fullmetal.Alchemist… », « [SR-71] K Project… »
    var base = file.name.replace(/\.[^.]+$/, '').replace(/^\[[^\]]*\][\s._\-]*/, '');
    var m = base.match(/^(.*?[\s._\-]*S(\d{1,2}))\s?E\d{1,3}\b/i) || base.match(/^(.*?[\s._\-]*?(\d{1,2}))x\d{2,3}\b/i);
    if (m && m[1].replace(/[\s._\-]*S?\d{1,2}$/i, '').trim()) {
      var title = normalized(m[1].replace(/[\s._\-]*S?\d{1,2}$/i, '')).trim();
      return { key: title + ' s' + Number(m[2]), name: m[1].replace(/[\s._\-]+$/, '') };
    }
    m = base.match(/^(.*?)(?:[\s._]+ep(?:isode)?[\s._]?|\s-\s)\d{1,3}\b/i);
    if (m && m[1].trim()) return { key: normalized(m[1]).trim(), name: m[1].trim() };
    // Numéro d'épisode seul, à 2 ou 3 chiffres, entre séparateurs : « Fullmetal.Alchemist.Brotherhood.01.[Bluray…] »
    // (les années à 4 chiffres, 1080p, x264 ou 5.1 ne correspondent pas)
    m = base.match(/^(.*?[a-z].*?)[\s._\-]+(\d{2,3})(?=[\s._\-\[(]|$)/i);
    if (m && m[1].trim()) return { key: normalized(m[1]).trim(), name: m[1].replace(/[\s._\-]+$/, '') };
    return null;
  }

  // Regroupement indépendant de l'arborescence :
  //  - un dossier d'épisodes (posés directement dedans ou un par sous-dossier) → un média « dossier » ;
  //  - des épisodes isolés d'une même série et saison au même niveau (ex. à la racine d'un disque) → un dossier virtuel ;
  //  - une vidéo seule → un média « fichier » ;
  //  - tout autre dossier (rangement « Séries », « Films », « Téléchargements »…) est traversé.
  function group(videos) {
    var root = { name: '', path: '', dirs: {}, files: [] };
    videos.forEach(function (v) {
      var parts = v.path.split('/').filter(Boolean), node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var childPath = node.path + '/' + parts[i];
        node = node.dirs[parts[i]] = node.dirs[parts[i]] || { name: parts[i], path: childPath, dirs: {}, files: [] };
      }
      node.files.push(v);
    });
    function subtree(node) {
      return Object.keys(node.dirs).reduce(function (list, k) { return list.concat(subtree(node.dirs[k])); }, node.files);
    }
    var out = [];

    function visit(node, depth, parent) {
      var files = subtree(node);
      if (!files.length) return;
      var subdirs = Object.keys(node.dirs).map(function (k) { return node.dirs[k]; });
      if (depth >= 2) { // jamais la racine ni un disque entier
        if (files.length === 1) { out.push(fileEntry(files[0])); return; }
        var flat = subdirs.every(function (d) { return subtree(d).length <= 1; });
        if (flat && looksLikeEpisodes(node, files)) { out.push(folderEntry(node, parent, files)); return; }
      }
      // Vidéos isolées de ce niveau : posées ici, ou seules dans leur sous-dossier
      var singles = node.files.slice();
      subdirs.forEach(function (d) {
        var inside = subtree(d);
        if (inside.length === 1 && depth >= 1) singles.push(inside[0]);
      });
      // Épisodes isolés d'une même série et saison → dossier virtuel
      var clusters = {};
      singles.forEach(function (f) {
        var g = episodeGroup(f);
        if (!g) return;
        (clusters[g.key] = clusters[g.key] || { name: g.name, files: [] }).files.push(f);
      });
      var clustered = [];
      Object.keys(clusters).forEach(function (k) {
        var c = clusters[k];
        if (c.files.length < 2) return;
        out.push(makeEntry('folder', c.name, node.path + '/' + c.name, c.files));
        clustered = clustered.concat(c.files);
      });
      singles.forEach(function (f) { if (clustered.indexOf(f) < 0) out.push(fileEntry(f)); });
      subdirs.forEach(function (d) {
        if (depth >= 1 && subtree(d).length === 1) return; // déjà traité parmi les vidéos isolées
        visit(d, depth + 1, node);
      });
    }

    visit(root, 0, null);
    return out;
  }

  // Chemin sur disque d'un téléchargement. Pour un torrent à plusieurs fichiers, la Freebox indique déjà
  // le dossier du torrent dans download_dir (« /Disque 2/Lost.S06…/ ») : ne pas y rajouter son nom.
  function taskPath(task) {
    var dir = (task.download_dir ? b64ToUtf8(task.download_dir) : '').replace(/\/+$/, '');
    var name = String(task.name || '');
    var last = dir.split('/').pop();
    return (last === name ? dir : dir + '/' + name).replace(/\/+/g, '/');
  }

  // Un média relève d'un téléchargement : même chemin, ou vidéos contenues dans le dossier téléchargé
  function covers(entry, tp) {
    return entry.path === tp || entry.path.indexOf(tp + '/') === 0
      || entry.files.some(function (f) { return f.path === tp || f.path.indexOf(tp + '/') === 0; });
  }

  // Tous les téléchargements d'un média (un dossier regroupé peut en couvrir plusieurs, ex. 5 épisodes)
  function tasksFor(entry, tasks) {
    if (entry.kind === 'task') return entry.task ? [entry.task] : [];
    return (tasks || []).filter(function (t) { return covers(entry, taskPath(t)); });
  }

  // Chemins à supprimer pour un média sans téléchargement :
  //  - dossier réel ne contenant que les vidéos du média → ce dossier ;
  //  - sinon chaque vidéo, ou son dossier si elle y est seule (fichiers annexes .nfo… compris) ;
  //  - jamais la racine ni un disque entier.
  function deletionTargets(entry, allEntries) {
    var videoPaths = [];
    allEntries.forEach(function (m) { m.files.forEach(function (f) { videoPaths.push(f.path); }); });
    var depth = function (p) { return p.split('/').filter(Boolean).length; };
    var videosUnder = function (dir) { return videoPaths.filter(function (p) { return p.indexOf(dir + '/') === 0; }).length; };
    var realFolder = entry.kind === 'folder' && entry.files.every(function (f) { return f.path.indexOf(entry.path + '/') === 0; });
    if (realFolder && depth(entry.path) >= 2 && videosUnder(entry.path) === entry.files.length) return [entry.path];
    var targets = [];
    entry.files.forEach(function (f) {
      var parent = f.path.slice(0, f.path.lastIndexOf('/'));
      var target = depth(parent) >= 2 && videosUnder(parent) === 1 ? parent : f.path;
      if (targets.indexOf(target) < 0) targets.push(target);
    });
    return targets;
  }

  // Associe chaque média au téléchargement correspondant ;
  // les téléchargements en cours absents de l'index sont ajoutés pour afficher leur progression.
  function attachTasks(entries, tasks) {
    var matched = {};
    entries.forEach(function (m) { m.task = null; });
    (tasks || []).forEach(function (t) {
      var tp = taskPath(t);
      entries.forEach(function (m) {
        if (!covers(m, tp)) return;
        matched[t.id] = true;
        if (!m.task || t.created_ts > m.task.created_ts) m.task = t;
      });
    });
    var extra = (tasks || []).filter(function (t) { return !matched[t.id] && (t.rx_pct || 0) < 10000; }).map(function (t) {
      return { kind: 'task', name: t.name, path: taskPath(t), files: [], size: t.size || 0, mtime: t.created_ts || 0, task: t };
    });
    return entries.concat(extra);
  }

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
  }

  function saveCache(videos) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), videos: videos })); } catch (e) { /* stockage plein ou indisponible */ }
  }

  return {
    scan: scan, group: group, attachTasks: attachTasks, taskPath: taskPath, tasksFor: tasksFor, deletionTargets: deletionTargets,
    loadCache: loadCache, saveCache: saveCache, utf8ToB64: utf8ToB64
  };
})();
