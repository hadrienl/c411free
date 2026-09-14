import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp } from './load.mjs';

const app = loadApp(['core.js', 'trailer.js']);

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
