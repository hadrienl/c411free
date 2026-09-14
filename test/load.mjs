// Charge des scripts de l'app TV (scripts classiques à variables globales) dans un contexte isolé, sans navigateur.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadApp(files, globals = {}) {
  const store = new Map();
  const ctx = vm.createContext({
    window: { addEventListener() {}, CONFIG: {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    TextEncoder, TextDecoder, atob, btoa, console,
    ...globals
  });
  for (const file of files) {
    vm.runInContext(readFileSync(new URL(`../app/js/${file}`, import.meta.url), 'utf8'), ctx, { filename: `app/js/${file}` });
  }
  return ctx;
}

// Les objets créés dans le contexte ont d'autres prototypes : comparaison sur leur forme JSON
export const plain = (value) => JSON.parse(JSON.stringify(value));

export const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
