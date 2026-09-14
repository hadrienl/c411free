import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'posters.js', 'trailer.js']);

// Résultats d'autocomplétion AlloCiné relevés (le premier est sponsorisé)
const SPONSORED = { entity_type: 'movie', entity_id: '1000018854', label: 'Resident Evil', original_label: 'Resident Evil', data: { year: '2026', default_video: 20641191 } };
const result = (type, id, label, year, video, original) => ({ entity_type: type, entity_id: id, label, original_label: original || label, data: { year, default_video: video } });

test('AlloCiné : bon résultat malgré le sponsorisé et les homonymes', () => {
  const jardinier = [SPONSORED, result('movie', '325752', 'Le Jardinier', '2025', 20613640), result('movie', '46024', 'Le Jardinier', '1981', null)];
  assert.equal(app.pickAllocineResult(jardinier, ['Le Jardinier'], '2025', 'movie').entity_id, '325752');
  assert.equal(app.pickAllocineResult(jardinier, ['Le Jardinier'], '1981', 'movie').entity_id, '46024');
  const lost = [SPONSORED, result('movie', '47395', 'Lost in Translation', '2003'), result('series', '223', 'Lost : Les Disparus', '2004', 19147593, 'Lost')];
  assert.equal(app.pickAllocineResult(lost, ['Lost'], '2010', 'series').entity_id, '223', 'série : titre original, année indicative');
  assert.equal(app.pickAllocineResult(lost, ['Lost'], '2004', 'movie'), null, 'pas de film « Lost »');
  assert.equal(app.pickAllocineResult([SPONSORED], ['Inception'], '2010', 'movie'), null);
  assert.equal(app.pickAllocineResult([result('movie', '1', 'Amélie', '')], ['Amelie'], '2001', 'movie').entity_id, '1', 'année inconnue chez AlloCiné');
});

test('AlloCiné : page vidéo et meilleur MP4', () => {
  assert.equal(app.allocineVideoPageUrl('movie', 143692, 18955140), 'https://www.allocine.fr/video/player_gen_cmedia=18955140&cfilm=143692.html');
  assert.equal(app.allocineVideoPageUrl('series', 223, 19147593), 'https://www.allocine.fr/video/player_gen_cmedia=19147593&cserie=223.html');
  const html = '<div data-model="{&quot;sources&quot;:{&quot;medium&quot;:&quot;https:\\/\\/fr.vid.web.acsta.net\\/nmedia\\/33\\/18955140_m_013.mp4&quot;,'
    + '&quot;high&quot;:&quot;https:\\/\\/fr.vid.web.acsta.net\\/nmedia\\/33\\/18955140_hd_013.mp4&quot;}}"></div>';
  assert.equal(app.mp4FromVideoPage(html), 'https://fr.vid.web.acsta.net/nmedia/33/18955140_hd_013.mp4');
  assert.equal(app.mp4FromVideoPage('<html>rien</html>'), null);
});

test('requête de recherche de la bande-annonce', () => {
  assert.equal(app.trailerQuery('Inception', '2010'), 'Inception 2010 bande annonce VF');
  assert.equal(app.trailerQuery('Lost', ''), 'Lost bande annonce VF');
});

test('première vidéo des résultats YouTube, hors publicités et Shorts', () => {
  const html = '{"adSlotRenderer":{"videoId":"AAAAAAAAAAA"}},{"reelItemRenderer":{"videoId":"BBBBBBBBBBB"}},'
    + '{"videoRenderer":{"videoId":"HcoZbHBDHQA","thumbnail":{}}},{"videoRenderer":{"videoId":"CPTIgILtna8"}}';
  assert.equal(app.firstVideoId(html), 'HcoZbHBDHQA');
  assert.equal(app.firstVideoId('<html>aucun résultat</html>'), null);
});
