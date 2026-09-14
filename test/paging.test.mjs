import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadApp, plain } from './load.mjs';

const app = loadApp(['paging.js']);
const t = (hash) => ({ infoHash: hash, name: 'Film ' + hash });

test('ajoute une page et retire les doublons', () => {
  const first = app.mergePage([], [t('a'), t('b'), t('c')], { total: 7, totalPages: 3 }, 1);
  assert.deepEqual(plain(first), { items: [t('a'), t('b'), t('c')], fresh: 3, total: 7, done: false });
  const second = app.mergePage(first.items, [t('c'), t('d'), t('d'), t('e')], { total: 8, totalPages: 3 }, 2);
  assert.deepEqual(plain(second.items.map((x) => x.infoHash)), ['a', 'b', 'c', 'd', 'e'], 'c déjà affiché, d en double dans la page');
  assert.equal(second.fresh, 2);
  assert.equal(second.done, false);
});

test('fin de liste d\'après le nombre de pages, pas la taille de la page', () => {
  assert.equal(app.mergePage([], [t('a')], { total: 60, totalPages: 3 }, 2).done, false, 'page raccourcie par le filtre familial : ce n\'est pas la fin');
  assert.equal(app.mergePage([], [t('a')], { total: 60, totalPages: 3 }, 3).done, true);
  assert.equal(app.mergePage([], [], null, 4).done, true, 'sans meta : page vide = fin');
});
