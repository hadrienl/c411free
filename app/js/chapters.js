// Chapitres Matroska (MKV) lus directement dans le fichier : AVPlay ne les expose pas.
// Seuls l'en-tête puis, si besoin, le bloc des chapitres sont téléchargés (requêtes Range sur le serveur UPnP).

var MKV = {
  SEGMENT: 0x18538067, SEEK_HEAD: 0x114D9B74, SEEK: 0x4DBB, SEEK_ID: 0x53AB, SEEK_POSITION: 0x53AC,
  CHAPTERS: 0x1043A770, EDITION: 0x45B9, ATOM: 0xB6, TIME_START: 0x91, FLAG_HIDDEN: 0x98, DISPLAY: 0x80, STRING: 0x85
};
var MKV_HEAD_BYTES = 256 * 1024;
var MKV_CHAPTERS_BYTES = 64 * 1024;

// Entier à longueur variable EBML : identifiant (marqueur conservé) ou taille (marqueur retiré, « inconnue » si tous les bits à 1)
function ebmlVint(bytes, pos, keepMarker) {
  var first = bytes[pos], len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || pos + len > bytes.length) return null;
  var value = keepMarker ? first : first & (mask - 1), unknown = (first & (mask - 1)) === mask - 1;
  for (var i = 1; i < len; i++) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) unknown = false;
  }
  return { value: value, len: len, unknown: unknown };
}

function ebmlUint(bytes, start, len) {
  var value = 0;
  for (var i = 0; i < len; i++) value = value * 256 + bytes[start + i];
  return value;
}

// Éléments enfants entre start et end : { id, dataStart, size, end } (s'arrête à la fin des données disponibles)
function ebmlChildren(bytes, start, end) {
  var out = [], pos = start;
  while (pos < end && pos < bytes.length) {
    var id = ebmlVint(bytes, pos, true);
    if (!id) break;
    var size = ebmlVint(bytes, pos + id.len, false);
    if (!size) break;
    var dataStart = pos + id.len + size.len;
    out.push({ id: id.value, dataStart: dataStart, size: size.unknown ? Infinity : size.value, end: size.unknown ? Infinity : dataStart + size.value });
    if (size.unknown) break;
    pos = dataStart + size.value;
  }
  return out;
}

function childOf(bytes, parent, id) {
  return ebmlChildren(bytes, parent.dataStart, parent.end).filter(function (c) { return c.id === id; })[0];
}

// Chapitres de la première édition : [{ at: ms, name }], triés, chapitres masqués exclus
function parseChapterList(bytes, start, end) {
  var chapters = [];
  var edition = ebmlChildren(bytes, start, end).filter(function (c) { return c.id === MKV.EDITION; })[0];
  if (!edition) return chapters;
  ebmlChildren(bytes, edition.dataStart, Math.min(edition.end, bytes.length)).forEach(function (atom) {
    if (atom.id !== MKV.ATOM) return;
    var time = childOf(bytes, atom, MKV.TIME_START);
    var hidden = childOf(bytes, atom, MKV.FLAG_HIDDEN);
    if (!time || (hidden && ebmlUint(bytes, hidden.dataStart, hidden.size) === 1)) return;
    var display = childOf(bytes, atom, MKV.DISPLAY);
    var text = display && childOf(bytes, display, MKV.STRING);
    chapters.push({
      at: Math.round(ebmlUint(bytes, time.dataStart, time.size) / 1e6),
      name: text ? new TextDecoder().decode(bytes.subarray(text.dataStart, text.end)) : ''
    });
  });
  return chapters.sort(function (a, b) { return a.at - b.at; });
}

// fetchRange(url, début, longueur) → Promise<Uint8Array>
async function readMkvChapters(url, fetchRange) {
  var head = await fetchRange(url, 0, MKV_HEAD_BYTES);
  var segment = ebmlChildren(head, 0, head.length).filter(function (c) { return c.id === MKV.SEGMENT; })[0];
  if (!segment) return [];
  var top = ebmlChildren(head, segment.dataStart, head.length);
  var direct = top.filter(function (c) { return c.id === MKV.CHAPTERS && c.end <= head.length; })[0];
  if (direct) return parseChapterList(head, direct.dataStart, direct.end);
  // Chapitres plus loin dans le fichier : leur position est donnée par le SeekHead
  var seekHead = top.filter(function (c) { return c.id === MKV.SEEK_HEAD; })[0];
  if (!seekHead) return [];
  var position = null;
  ebmlChildren(head, seekHead.dataStart, Math.min(seekHead.end, head.length)).forEach(function (seek) {
    if (seek.id !== MKV.SEEK) return;
    var id = childOf(head, seek, MKV.SEEK_ID), pos = childOf(head, seek, MKV.SEEK_POSITION);
    if (id && pos && ebmlUint(head, id.dataStart, id.size) === MKV.CHAPTERS) position = segment.dataStart + ebmlUint(head, pos.dataStart, pos.size);
  });
  if (position == null) return [];
  var block = await fetchRange(url, position, MKV_CHAPTERS_BYTES);
  var element = ebmlChildren(block, 0, block.length)[0];
  return element && element.id === MKV.CHAPTERS ? parseChapterList(block, element.dataStart, Math.min(element.end, block.length)) : [];
}
