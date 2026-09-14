import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['core.js', 'c411.js']);
const release = (name, extra = {}) => ({ name, category: { id: 1 }, subcategory: { id: 6 }, ...extra });

test('filtre familial : films et séries acceptés', () => {
  assert.equal(app.isFamilySafe(release('Vaiana.2.2024.MULTI.1080p.WEB')), true);
  assert.equal(app.isFamilySafe(release('xXx.2002.MULTI.1080p')), true, 'le film « xXx » en début de titre reste visible');
});

test('filtre familial : catégories et sous-catégories hors liste refusées', () => {
  assert.equal(app.isFamilySafe(null), false);
  assert.equal(app.isFamilySafe(release('Film', { category: { id: 1, isXxx: true } })), false);
  assert.equal(app.isFamilySafe(release('Film', { category: { id: 3 } })), false);
  assert.equal(app.isFamilySafe(release('Film', { subcategory: { id: 99 } })), false);
});

test('filtre familial : noms à caractère adulte refusés même mal classés', () => {
  assert.equal(app.isFamilySafe(release('Some.Show.Uncensored.1080p')), false);
  assert.equal(app.isFamilySafe(release('Some.Release.XXX.1080p')), false);
});

test('MediaInfo : pistes audio et compatibilité avec la TV', () => {
  const nfo = [
    'General', 'Duration : 40 min', '',
    'Audio #1', 'Format : E-AC-3', 'Channel(s) : 6 channels', 'Language : French', 'Title : VFF', '',
    'Audio #2', 'Format : DTS', 'Language : English', '',
    'Text #1', 'Format : UTF-8', 'Language : French', 'Forced : Yes'
  ].join('\n');
  const audio = app.parseAudio(nfo);
  assert.deepEqual(plain(audio.map((t) => [t.format, t.lang, t.title])), [['E-AC-3', 'French', 'VFF'], ['DTS', 'English', '']]);
  assert.deepEqual(plain(audio.map((t) => app.trackOk(t))), [true, false]);
  assert.equal(app.mediaTracks(nfo, 'Text')[0].forced, 'Yes');
});
