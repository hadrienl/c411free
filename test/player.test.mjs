import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp } from './load.mjs';

const app = loadApp(['core.js', 'names.js', 'storage.js', 'tracks.js']);

test('langues des pistes normalisées', () => {
  assert.equal(app.langCode('fre'), 'fr');
  assert.equal(app.langCode('Français'), 'fr');
  assert.equal(app.langCode('English'), 'en');
  assert.equal(app.langCode(''), '');
});

test('préférence de piste : langue, puis forcés, puis titre', () => {
  const tracks = [{ lang: 'fr', title: 'VFQ' }, { lang: 'fr', title: 'VFF' }, { lang: 'en', title: '' }];
  assert.equal(app.bestMatch(tracks, { lang: 'fr', title: 'VFF' }), tracks[1]);
  assert.equal(app.bestMatch(tracks, { lang: 'fr' }), tracks[0]);
  assert.equal(app.bestMatch(tracks, { lang: 'ja' }), null);
  const subs = [{ lang: 'fr', forced: true }, { lang: 'fr', forced: false }];
  assert.equal(app.bestMatch(subs, { lang: 'fr', forced: false }), subs[1]);
});

test('début du générique : chapitre du MediaInfo, sinon fin de l\'épisode', () => {
  const dur = 40 * 60000;
  assert.equal(app.mediaDuration('1 h 2 min 3 s 120 ms'), 3723120);
  assert.equal(app.creditsStart(null, dur), dur - 72000);
  const nfo = ['General', 'Duration : 40 min 0 s', '', 'Menu', '00:00:00.000 : Intro', '00:38:30.000 : Ending'].join('\n');
  assert.equal(app.creditsStart(nfo, dur), 38.5 * 60000);
  assert.equal(app.creditsStart(nfo, dur + 60000), dur + 60000 - 73800, 'chapitres d\'un autre fichier ignorés');
});

test('sous-titres : retours à la ligne et mise en forme simple, reste échappé', () => {
  assert.equal(app.subtitleHtml('Salut<br><i>toi</i> <font color="red">&</font>{\\an8}'), 'Salut\n<i>toi</i> &amp;');
  assert.equal(app.subtitleHtml('a\\Nb <script>x</script>'), 'a\nb x');
});

test('formatage des noms, tailles et durées', () => {
  assert.deepEqual({ ...app.prettyName('Has.Fallen.2026.S02E01.VFF.2160p.WEB.mkv') }, { title: 'Has Fallen', year: '2026', episode: 'S02E01' });
  assert.equal(app.label('Has.Fallen.2026.S02E01.VFF.2160p.WEB.mkv'), 'Has Fallen · S02E01');
  assert.equal(app.resolution('Film.2160p'), '4K');
  assert.equal(app.gb(1.5e9), '1.5 Go');
  assert.equal(app.fmtTime(3723000), '1:02:03');
  assert.equal(app.isPlayable({ rx_pct: 10000, status: 'seeding' }), true);
  assert.equal(app.isPlayable({ rx_pct: 9000, status: 'downloading' }), false);
});

test('vue des Médias : vignettes par défaut, dernier choix mémorisé', () => {
  assert.equal(app.loadMediaView(), 'grid');
  app.saveMediaView('list');
  assert.equal(app.loadMediaView(), 'list');
  app.saveMediaView('grid');
  assert.equal(app.loadMediaView(), 'grid');
});

test('fichiers vus et positions de reprise mémorisés', () => {
  const task = { info_hash: 'ABC' };
  app.setVideoCount(task, 10);
  app.markWatched(task, 'e01.mkv');
  assert.equal(app.watchedBadge(task), '👁 1/10 vus');
  assert.equal(app.isWatched(task, 'e01.mkv'), true);

  const file = { name: 'e02.mkv' };
  app.player = { task, file };
  assert.equal(app.startedRatio(task, file), 0, 'pas encore commencé');
  app.persistPosition(60000, 100000);
  assert.equal(app.savedPosition(task, file), 60000);
  assert.equal(app.startedRatio(task, file), 0.6, 'commencé : 60 %');
  app.persistPosition(96000, 100000); // au-delà de 95 % : terminé
  assert.equal(app.savedPosition(task, file), 0);
  assert.equal(app.startedRatio(task, file), 0, 'terminé : plus « en cours »');
  app.persistPosition(5000, 100000); // moins de 10 s : rien à reprendre
  assert.equal(app.savedPosition(task, file), 0);
});
