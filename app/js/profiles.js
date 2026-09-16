// Profils : chacun a son surnom, son avatar et ses propres données (épisodes vus, reprises, séries suivies, préférences
// de pistes). Le premier profil (« Famille ») garde les clés historiques : les données existantes lui reviennent sans migration.

var PROFILES_KEY = 'c411free.profiles';
var PROFILE_NAME_MAX = 16;
// Données propres à chaque profil (les autres réglages sont communs : médias, filtres, affiches, génériques appris…)
var PROFILE_DATA_KEYS = ['c411free.watched', 'c411free.positions', 'c411free.trackPrefs', 'c411free.series', 'c411free.history', 'c411free.recos', 'c411free.later'];

// Dix avatars dessinés (viewBox 100 × 100, fond ajouté par avatarSvg)
var AVATARS = {
  renard: { label: 'Renard', bg: '#1d4ed8', svg: '<path d="M20 20 L42 38 L28 54Z" fill="#c2410c"/><path d="M80 20 L58 38 L72 54Z" fill="#c2410c"/><path d="M22 38 Q50 26 78 38 Q76 66 50 84 Q24 66 22 38Z" fill="#f97316"/><path d="M33 58 Q50 53 67 58 Q61 76 50 84 Q39 76 33 58Z" fill="#fff7ed"/><circle cx="39" cy="51" r="4" fill="#111827"/><circle cx="61" cy="51" r="4" fill="#111827"/><ellipse cx="50" cy="68" rx="5" ry="3.5" fill="#111827"/>' },
  chat: { label: 'Chat', bg: '#7c3aed', svg: '<path d="M22 24 L38 40 L22 50Z" fill="#94a3b8"/><path d="M78 24 L62 40 L78 50Z" fill="#94a3b8"/><circle cx="50" cy="56" r="30" fill="#cbd5e1"/><path d="M26 28 L34 38 L27 42Z" fill="#fda4af"/><path d="M74 28 L66 38 L73 42Z" fill="#fda4af"/><ellipse cx="39" cy="52" rx="4.5" ry="6" fill="#16a34a"/><ellipse cx="61" cy="52" rx="4.5" ry="6" fill="#16a34a"/><ellipse cx="39" cy="52" rx="1.6" ry="5" fill="#111827"/><ellipse cx="61" cy="52" rx="1.6" ry="5" fill="#111827"/><path d="M46 63 L54 63 L50 67Z" fill="#f472b6"/><path d="M50 67 Q46 72 42 70 M50 67 Q54 72 58 70" stroke="#475569" stroke-width="2" fill="none"/><path d="M30 64 L16 61 M30 68 L16 70 M70 64 L84 61 M70 68 L84 70" stroke="#64748b" stroke-width="1.6"/>' },
  panda: { label: 'Panda', bg: '#0d9488', svg: '<circle cx="27" cy="30" r="11" fill="#111827"/><circle cx="73" cy="30" r="11" fill="#111827"/><circle cx="50" cy="55" r="31" fill="#f8fafc"/><ellipse cx="38" cy="52" rx="8" ry="10" transform="rotate(-25 38 52)" fill="#111827"/><ellipse cx="62" cy="52" rx="8" ry="10" transform="rotate(25 62 52)" fill="#111827"/><circle cx="39" cy="51" r="3" fill="#fff"/><circle cx="61" cy="51" r="3" fill="#fff"/><ellipse cx="50" cy="66" rx="5" ry="3.5" fill="#111827"/><path d="M45 72 Q50 76 55 72" stroke="#111827" stroke-width="2" fill="none"/>' },
  hibou: { label: 'Hibou', bg: '#b45309', svg: '<path d="M24 22 L36 34 L24 38Z" fill="#78350f"/><path d="M76 22 L64 34 L76 38Z" fill="#78350f"/><ellipse cx="50" cy="58" rx="30" ry="32" fill="#92400e"/><ellipse cx="50" cy="68" rx="18" ry="20" fill="#fde68a"/><circle cx="38" cy="48" r="12" fill="#fef3c7"/><circle cx="62" cy="48" r="12" fill="#fef3c7"/><circle cx="38" cy="48" r="6" fill="#111827"/><circle cx="62" cy="48" r="6" fill="#111827"/><circle cx="40" cy="46" r="2" fill="#fff"/><circle cx="64" cy="46" r="2" fill="#fff"/><path d="M46 58 L54 58 L50 66Z" fill="#f59e0b"/>' },
  grenouille: { label: 'Grenouille', bg: '#db2777', svg: '<circle cx="33" cy="34" r="13" fill="#4ade80"/><circle cx="67" cy="34" r="13" fill="#4ade80"/><ellipse cx="50" cy="62" rx="34" ry="24" fill="#4ade80"/><circle cx="33" cy="33" r="7" fill="#fff"/><circle cx="67" cy="33" r="7" fill="#fff"/><circle cx="34" cy="34" r="3.5" fill="#111827"/><circle cx="66" cy="34" r="3.5" fill="#111827"/><path d="M30 64 Q50 80 70 64" stroke="#166534" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="26" cy="60" r="4" fill="#f9a8d4" opacity=".7"/><circle cx="74" cy="60" r="4" fill="#f9a8d4" opacity=".7"/>' },
  lion: { label: 'Lion', bg: '#15803d', svg: '<circle cx="50" cy="52" r="36" fill="#b45309"/><circle cx="50" cy="55" r="25" fill="#fbbf24"/><circle cx="31" cy="34" r="6" fill="#fbbf24"/><circle cx="69" cy="34" r="6" fill="#fbbf24"/><circle cx="41" cy="52" r="3.5" fill="#111827"/><circle cx="59" cy="52" r="3.5" fill="#111827"/><ellipse cx="50" cy="63" rx="10" ry="7" fill="#fef3c7"/><path d="M46 60 L54 60 L50 64Z" fill="#78350f"/><path d="M50 64 L50 67 M46 69 Q50 71 54 69" stroke="#78350f" stroke-width="2" fill="none"/>' },
  lapin: { label: 'Lapin', bg: '#0891b2', svg: '<ellipse cx="38" cy="26" rx="8" ry="20" fill="#f1f5f9"/><ellipse cx="62" cy="26" rx="8" ry="20" fill="#f1f5f9"/><ellipse cx="38" cy="26" rx="3.5" ry="14" fill="#fbcfe8"/><ellipse cx="62" cy="26" rx="3.5" ry="14" fill="#fbcfe8"/><circle cx="50" cy="62" r="26" fill="#f1f5f9"/><circle cx="41" cy="58" r="3.5" fill="#111827"/><circle cx="59" cy="58" r="3.5" fill="#111827"/><path d="M47 66 L53 66 L50 69Z" fill="#f472b6"/><rect x="47" y="71" width="6" height="6" rx="1" fill="#fff" stroke="#cbd5e1"/><circle cx="34" cy="67" r="4" fill="#fbcfe8" opacity=".8"/><circle cx="66" cy="67" r="4" fill="#fbcfe8" opacity=".8"/>' },
  robot: { label: 'Robot', bg: '#475569', svg: '<line x1="50" y1="14" x2="50" y2="26" stroke="#cbd5e1" stroke-width="3"/><circle cx="50" cy="13" r="5" fill="#f43f5e"/><rect x="24" y="26" width="52" height="46" rx="12" fill="#cbd5e1"/><rect x="31" y="36" width="38" height="18" rx="9" fill="#0f172a"/><circle cx="41" cy="45" r="4.5" fill="#22d3ee"/><circle cx="59" cy="45" r="4.5" fill="#22d3ee"/><rect x="38" y="60" width="24" height="6" rx="3" fill="#94a3b8"/><rect x="18" y="42" width="6" height="14" rx="3" fill="#94a3b8"/><rect x="76" y="42" width="6" height="14" rx="3" fill="#94a3b8"/><rect x="36" y="74" width="28" height="12" rx="5" fill="#94a3b8"/>' },
  couettes: { label: 'Couettes', bg: '#e11d48', svg: '<circle cx="20" cy="40" r="11" fill="#7c2d12"/><circle cx="80" cy="40" r="11" fill="#7c2d12"/><circle cx="50" cy="54" r="28" fill="#fed7aa"/><path d="M22 50 Q24 24 50 24 Q76 24 78 50 Q66 36 50 38 Q34 36 22 50Z" fill="#9a3412"/><circle cx="40" cy="56" r="3.5" fill="#111827"/><circle cx="60" cy="56" r="3.5" fill="#111827"/><path d="M42 66 Q50 72 58 66" stroke="#9a3412" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="33" cy="64" r="4.5" fill="#fb7185" opacity=".55"/><circle cx="67" cy="64" r="4.5" fill="#fb7185" opacity=".55"/>' },
  lunettes: { label: 'Lunettes', bg: '#9333ea', svg: '<circle cx="50" cy="56" r="28" fill="#f5c9a0"/><path d="M22 52 Q20 22 50 22 Q82 22 78 52 Q74 38 62 36 Q52 42 36 38 Q26 40 22 52Z" fill="#422006"/><circle cx="39" cy="55" r="9" fill="none" stroke="#1f2937" stroke-width="3"/><circle cx="61" cy="55" r="9" fill="none" stroke="#1f2937" stroke-width="3"/><line x1="48" y1="55" x2="52" y2="55" stroke="#1f2937" stroke-width="3"/><circle cx="39" cy="55" r="3" fill="#111827"/><circle cx="61" cy="55" r="3" fill="#111827"/><path d="M43 69 Q50 74 57 69" stroke="#7c2d12" stroke-width="3" fill="none" stroke-linecap="round"/>' }
};
var AVATAR_KEYS = Object.keys(AVATARS);

function avatarSvg(key) {
  var a = AVATARS[key] || AVATARS.renard;
  return '<svg viewBox="0 0 100 100" role="img" aria-label="' + a.label + '"><circle cx="50" cy="50" r="50" fill="' + a.bg + '"/>' + a.svg + '</svg>';
}

// ---------- Règles (fonctions pures sur l'objet { list, currentId }) ----------
function defaultProfiles() { return { list: [{ id: 1, name: 'Famille', avatar: 'renard' }], currentId: 1 }; }

function normalizeProfiles(p) {
  if (!p || !Array.isArray(p.list) || !p.list.length) return defaultProfiles();
  if (!p.list.some(function (x) { return x.id === p.currentId; })) p.currentId = p.list[0].id;
  return p;
}

// Clé de stockage d'une donnée pour un profil : clé historique pour le premier profil, suffixée pour les autres
function profileKey(base, id) { return id && id !== 1 ? base + '@' + id : base; }

function cleanName(name) { return String(name || '').replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX); }

// Avatar pas encore utilisé (pour distinguer chacun d'un coup d'œil), sinon le suivant dans la liste
function freeAvatar(p) {
  var used = p.list.map(function (x) { return x.avatar; });
  return AVATAR_KEYS.filter(function (k) { return used.indexOf(k) < 0; })[0] || AVATAR_KEYS[p.list.length % AVATAR_KEYS.length];
}

function findProfile(p, id) { return p.list.filter(function (x) { return x.id === id; })[0] || null; }

// Les identifiants ne sont jamais réutilisés : les données d'un profil supprimé ne reviennent pas à un nouveau
function addProfile(p, name, avatar) {
  p.nextId = Math.max(p.nextId || 0, p.list.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1);
  var id = p.nextId++;
  p.list.push({ id: id, name: cleanName(name) || 'Profil ' + id, avatar: AVATARS[avatar] ? avatar : freeAvatar(p) });
  return id;
}

function updateProfile(p, id, name, avatar) {
  var x = findProfile(p, id);
  if (!x) return false;
  x.name = cleanName(name) || x.name;
  if (AVATARS[avatar]) x.avatar = avatar;
  return true;
}

// Jamais moins d'un profil ; le profil courant supprimé laisse la place au premier restant
function removeProfile(p, id) {
  if (p.list.length <= 1 || !findProfile(p, id)) return false;
  p.nextId = Math.max(p.nextId || 0, p.list.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1);
  p.list = p.list.filter(function (x) { return x.id !== id; });
  if (p.currentId === id) p.currentId = p.list[0].id;
  return true;
}

// ---------- Mémoire sur la TV ----------
var profilesCache = null;

function loadProfiles() {
  if (!profilesCache) {
    try { profilesCache = normalizeProfiles(JSON.parse(localStorage.getItem(PROFILES_KEY))); } catch (e) { profilesCache = defaultProfiles(); }
  }
  return profilesCache;
}

function saveProfiles(p) {
  profilesCache = normalizeProfiles(p);
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesCache)); } catch (e) { /* stockage indisponible */ }
}

function currentProfile() { var p = loadProfiles(); return findProfile(p, p.currentId); }

// Clé d'une donnée du profil courant (utilisée par storage.js et series.js)
function pkey(base) { return profileKey(base, loadProfiles().currentId); }

function removeProfileData(id) {
  PROFILE_DATA_KEYS.forEach(function (k) {
    try { localStorage.removeItem(profileKey(k, id)); } catch (e) { /* stockage indisponible */ }
  });
}

// ---------- Écrans ----------
state.profileForm = null; // { mode: 'edit' | 'add', id, name, avatar }

function renderProfileButton() {
  var me = currentProfile();
  $('profile-avatar').innerHTML = avatarSvg(me.avatar);
  $('profile-tip').textContent = 'Profil : ' + me.name + ' · OK pour changer';
}

// « Qui regarde ? » : un avatar par profil, « Modifier » sous chacun, « Ajouter » en bout de rangée
function openProfiles(focusId) {
  var p = loadProfiles();
  $('profiles-list').innerHTML = p.list.map(function (x) {
    return '<div class="pf-profile">'
      + '<span class="pf-tile" data-f tabindex="-1" id="pf-' + x.id + '" data-profile="' + x.id + '"><span class="avatar">' + avatarSvg(x.avatar) + '</span></span>'
      + '<div class="pf-name">' + esc(x.name) + '</div>'
      + '<div class="pf-current">' + (x.id === p.currentId ? iconSvg('check') + ' profil actuel' : '') + '</div>'
      + '<span class="btn pf-edit" data-f tabindex="-1" id="pf-edit-' + x.id + '" data-edit-profile="' + x.id + '">' + iconSvg('edit') + '<span>Modifier</span></span>'
      + '</div>';
  }).join('')
    + '<div class="pf-profile"><span class="pf-tile pf-add" data-f tabindex="-1" id="pf-add" data-add-profile="1"><span>+</span></span><div class="pf-name dim">Ajouter</div></div>';
  show('profiles', $('pf-' + (focusId || p.currentId)) || $('pf-add'));
}

// Changement de profil : l'en-tête, les séries suivies et les badges « vu » suivent le nouveau profil
function applyProfileChange() {
  renderProfileButton();
  ensureSeriesBackfill();
  ensureHistoryBackfill();
  state.follow.list = [];
  state.seriesOpen = null;
  forgetLater();
  if (state.screen === 'home') refreshHome(true);
  debug('info', 'profil sélectionné', { id: loadProfiles().currentId });
}

function chooseProfile(id) {
  var p = loadProfiles(), changed = id !== p.currentId;
  if (changed) { p.currentId = id; saveProfiles(p); }
  state.section = 'catalog';
  renderTopbar();
  show('home'); // l'accueil avant le rafraîchissement : applyProfileChange recharge la grille affichée
  if (!changed) return;
  applyProfileChange();
  toast('Bonjour ' + currentProfile().name + ' !');
}

function openProfileForm(mode, id) {
  var p = loadProfiles();
  if (mode === 'edit') {
    var x = findProfile(p, id);
    if (!x) return;
    state.profileForm = { mode: 'edit', id: id, name: x.name, avatar: x.avatar };
  } else {
    state.profileForm = { mode: 'add', id: null, name: '', avatar: freeAvatar(p) };
  }
  renderProfileForm();
  show('profile-edit', $('nick-box'));
}

function renderProfileForm() {
  var f = state.profileForm, p = loadProfiles();
  if (!f) return;
  $('pf-form-title').textContent = f.mode === 'add' ? 'Ajouter un profil' : 'Modifier le profil';
  $('pf-preview').innerHTML = avatarSvg(f.avatar);
  $('pf-preview-name').textContent = f.name || 'Nouveau profil';
  $('nick-label').textContent = f.name || 'Choisir un surnom…';
  $('nick-label').classList.toggle('nick-empty', !f.name);
  $('pf-avatars').innerHTML = AVATAR_KEYS.map(function (k) {
    return '<span class="pf-pick' + (k === f.avatar ? ' selected' : '') + '" data-f tabindex="-1" id="pf-av-' + k + '" data-avatar="' + k + '" title="' + AVATARS[k].label + '"><span class="avatar">' + avatarSvg(k) + '</span></span>';
  }).join('');
  $('pf-save').textContent = f.mode === 'add' ? 'Créer le profil' : 'Enregistrer';
  $('pf-remove').classList.toggle('off', f.mode !== 'edit' || p.list.length <= 1);
}

// Surnom : barre visible dans la navigation, vrai champ (clavier natif Samsung) seulement pendant la saisie
function openNickname() {
  $('nick-wrap').classList.add('editing');
  $('nick-input').value = state.profileForm ? state.profileForm.name : '';
  $('nick-input').focus();
  toast('Tapez le surnom puis « Terminé » · RETOUR pour annuler');
}

function closeNickname(submit) {
  var wrap = $('nick-wrap');
  if (!wrap.classList.contains('editing')) return;
  if (submit && state.profileForm) state.profileForm.name = cleanName($('nick-input').value);
  wrap.classList.remove('editing'); // avant blur : le blur qui suit ne doit rien refaire
  $('nick-input').blur();
  $('toast').style.display = 'none';
  renderProfileForm();
  $('nick-box').focus();
}

function pickAvatar(key) {
  if (!state.profileForm || !AVATARS[key]) return;
  state.profileForm.avatar = key;
  renderProfileForm();
  $('pf-av-' + key).focus();
}

function saveProfileForm() {
  var f = state.profileForm, p = loadProfiles();
  if (!f) return;
  var id = f.mode === 'add' ? addProfile(p, f.name, f.avatar) : f.id;
  if (f.mode === 'edit') updateProfile(p, f.id, f.name, f.avatar);
  saveProfiles(p);
  if (id === p.currentId) renderProfileButton();
  var saved = findProfile(p, id);
  state.profileForm = null;
  openProfiles(id);
  toast(f.mode === 'add' ? 'Profil « ' + saved.name + ' » créé' : 'Profil « ' + saved.name + ' » enregistré');
}

function cancelProfileForm() {
  var id = state.profileForm && state.profileForm.id;
  state.profileForm = null;
  openProfiles(id);
}

function confirmRemoveProfile() {
  var f = state.profileForm, p = loadProfiles(), x = f && findProfile(p, f.id);
  if (!x || p.list.length <= 1) return;
  openModal({
    title: 'Supprimer le profil « ' + x.name + ' » ?',
    text: 'Ses épisodes vus, reprises, séries suivies et préférences seront effacés.\nLes fichiers ne sont pas touchés.',
    buttons: [
      { label: 'Supprimer le profil', icon: 'trash', danger: true, action: function () {
        var all = loadProfiles(), wasCurrent = all.currentId === x.id;
        removeProfile(all, x.id);
        saveProfiles(all);
        removeProfileData(x.id);
        closeModal();
        state.profileForm = null;
        if (wasCurrent) applyProfileChange();
        openProfiles();
        toast('Profil « ' + x.name + ' » supprimé');
      } },
      { label: 'Annuler', focus: true, action: closeModal }
    ]
  });
}
