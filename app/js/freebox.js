// Freebox : session authentifiée (HMAC), appels API et adresses de lecture UPnP.

// ---------- Freebox ----------
async function fbx(path, opts, retried) {
  opts = opts || {};
  if (!state.session) await openSession();
  var headers = Object.assign({ 'X-Fbx-App-Auth': state.session }, opts.headers || {});
  var res = await fetch(FBX + path, Object.assign({}, opts, { headers: headers }));
  var json = await res.json();
  if (!json.success && (json.error_code === 'auth_required' || json.error_code === 'invalid_session') && !retried) {
    state.session = null;
    return fbx(path, opts, true);
  }
  if (!json.success) throw new Error('Freebox : ' + (json.msg || json.error_code));
  return json.result;
}

async function openSession() {
  var ch = (await (await fetch(FBX + '/login/')).json()).result.challenge;
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey('raw', enc.encode(S.freeboxAppToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  var sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ch)));
  var password = Array.prototype.map.call(sig, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  var json = await (await fetch(FBX + '/login/session/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: S.freeboxAppId, password: password }) })).json();
  if (!json.success) throw new Error('connexion Freebox refusée : ' + (json.msg || json.error_code));
  state.session = json.result.session_token;
}

// Serveur UPnP/DLNA de la Freebox : bon type MIME, HEAD et Range, sans authentification (réseau local uniquement).
// Il refuse le nom mafreebox.freebox.fr (403) : il faut l'adresse IP locale de la box.
var upnpHost = null;
async function upnpUrl(filepathB64) {
  if (!upnpHost) {
    try { upnpHost = (await fbx('/lan/config/')).ip; } catch (e) { debug('error', 'lan/config : ' + e.message); }
    upnpHost = upnpHost || '192.168.1.254';
  }
  var path = new TextDecoder().decode(Uint8Array.from(atob(filepathB64), function (c) { return c.charCodeAt(0); }));
  return 'http://' + upnpHost + ':52424/files' + path.split('/').map(encodeURIComponent).join('/');
}
