// Formatage (fonctions pures) : noms de releases, tailles, dates, durées.

// « Has.Fallen.2026.S02E01.VFF.2160p… » → { title: "Has Fallen", year: "2026", episode: "S02E01" }
function prettyName(name) {
  var clean = String(name).replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '').replace(/[._]/g, ' ');
  var episode = (clean.match(/\bS\d{1,2}(E\d{1,3})?\b/i) || [''])[0].toUpperCase();
  var m = clean.match(/^(.*?)\s*\(?\b(19\d{2}|20\d{2})\b\)?/);
  var title = (m && m[1].trim()) || clean.split(/\b(S\d{1,2}|MULTI|VFF|VF2|VFQ|FRENCH|TRUEFRENCH|2160p|1080p|720p)\b/i)[0].trim() || clean;
  return { title: title.replace(/\s+S\d{1,2}(E\d{1,3})?$/i, ''), year: m ? m[2] : '', episode: episode };
}
function label(name) { var n = prettyName(name); return n.title + (n.episode ? ' · ' + n.episode : ''); }
function resolution(name) { return /2160p|4K|UHD/i.test(name) ? '4K' : /1080p/i.test(name) ? '1080p' : /720p/i.test(name) ? '720p' : ''; }
function shortLang(language, name) {
  var src = (language || '') + ' ' + name;
  var m = src.match(/\b(MULTI|VFF|VF2|VFQ|VFI|TRUEFRENCH|VOSTFR)\b/i);
  return m ? m[1].toUpperCase() : /fran/i.test(language || '') ? 'VF' : '';
}
function nameAudioOk(name) { return /\b(AC3|EAC3|E-AC3|DDP|DD\+|DD5|AAC|Opus)\b/i.test(name) || !/\b(DTS|TrueHD)\b/i.test(name); }
function poster(url, size) { return url ? url.replace(/\/t\/p\/w\d+\//, '/t/p/' + size + '/') : ''; }
function gb(bytes) { return (Number(bytes || 0) / 1e9).toFixed(1) + ' Go'; }

function fmtEta(s) { if (!s) return ''; var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? h + ' h ' + m + ' min' : m + ' min'; }
function fmtDate(ts) {
  var d = new Date(ts * 1000), now = new Date();
  var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  var days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return "aujourd'hui " + hm;
  if (days === 1) return 'hier ' + hm;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function isPlayable(t) { return t.rx_pct >= 10000 && (t.status === 'done' || t.status === 'seeding' || t.status === 'stopped'); }

function fmtTime(ms) {
  var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + sec).slice(-2);
}
