import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(process.argv[2]);
const callbacks = [], store = new Map();
let unexpectedNetwork = 0;
const context = {
  window: { fetch: async () => { unexpectedNetwork++; throw new Error('Unexpected network'); } },
  location: { href: 'https://demo.example/client/', pathname: '/client/' },
  document: { addEventListener: (_event, callback) => callbacks.push(callback) },
  sessionStorage: { setItem: (key, value) => store.set(key, value) },
  URL, Response, crypto: globalThis.crypto, Event,
};
runInNewContext(readFileSync(resolve(root, 'demo-data.js'), 'utf8'), context);
runInNewContext(readFileSync(resolve(root, 'demo.js'), 'utf8'), context);
const invoke = async (command, input) => {
  const result = await context.window.mansora.invoke(command, input);
  assert.equal(result.ok, true, result.error?.message); return result.data;
};
assert.equal((await invoke('app.state')).business.name, 'Sample Mini Mart');
assert.equal((await invoke('product.list')).length, 9);
assert.equal((await invoke('product.list', { search: 'Milo' })).length, 1);
assert.equal(await invoke('product.lookup', { code: 'missing' }), null);
const added = await invoke('product.save', { name: 'Preview carton item', sellingPrice: 600, costPrice: 417, openingStock: 24 });
const p = (await invoke('product.list', { search: 'Preview carton' }))[0];
assert.equal(p.id, added.id); assert.equal(p.cost_price, 417); assert.equal(p.quantity, 24);
assert.equal((await context.window.mansora.invoke('sale.complete', {})).ok, false);
assert.equal((await context.window.mansora.invoke('import.preview', {})).ok, false);
const fixture = context.window.MANSORA_DEMO_DATA;
for (const path of Object.keys(fixture.admin)) {
  const response = await context.window.fetch(path, { method: 'GET' }); assert.equal(response.status, 200); await response.json();
}
assert.equal((await context.window.fetch('/v1/admin/clients', { method: 'POST' })).status, 409);
assert.equal(unexpectedNetwork, 0);
for (const name of ['client', 'admin']) {
  const html = readFileSync(resolve(root, name, 'index.html'), 'utf8');
  assert(html.indexOf('/demo.js') < html.indexOf('type="module"'));
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/(?:client|admin)\/[^"?]+)"/g)) assert(existsSync(resolve(root, '.' + asset)), `Missing ${asset}`);
}
console.log('Interface demo checks passed: fixture identities, filtering, carton-price sample edits, mutation isolation, all admin reads and asset paths.');
