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
  sessionStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  URL, URLSearchParams, Response, crypto: globalThis.crypto, Event,
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
const billing = await invoke('billing.summary');
assert(billing.subscription, 'Owner billing has an actual synthetic subscription');
assert(billing.invoices.length > 0 && billing.payments.length > 0, 'Sample invoice and receipt available');
assert(billing.outstanding > 0, 'Partial sample payment leaves an outstanding amount');
for (const command of ['billing.pay', 'billing.mandate.setup', 'billing.cancel', 'billing.document']) assert.equal((await context.window.mansora.invoke(command, {})).ok, false, command);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await context.window.fetch('/v1/admin/billing/settings', { method })).status, 409);
const invoices = await (await context.window.fetch('/v1/admin/billing/invoices?q=no-such-sample-invoice')).json();
assert.equal(invoices.length, 0, 'Invoice search does not mislabel the original list');
assert.equal((await (await context.window.fetch('/v1/admin/billing/invoices?q=Sample%20General')).json()).length, 1, 'Invoice search matches client names');
assert.equal((await (await context.window.fetch('/v1/admin/billing/invoices?status=paid')).json()).length, 1, 'Invoice status filter is effective');
assert.equal((await context.window.fetch('/v1/admin/billing/reports/summary?from=1900-01-01&to=1900-02-01')).status, 409);
for (const path of ['/collections?filter=all', '/subscriptions', '/invoices', '/payments', '/providers', '/settings', '/merchant-accounts']) assert.equal((await context.window.fetch('/v1/admin/billing' + path)).status, 200, path);

assert.equal(unexpectedNetwork, 0);
store.set('mansora-demo-role', 'cashier');
runInNewContext(readFileSync(resolve(root, 'demo.js'), 'utf8'), context);
assert.equal((await invoke('app.state')).user.role, 'cashier');
assert.equal((await context.window.mansora.invoke('billing.summary')).ok, false, 'Cashier cannot read owner billing');
assert.equal((await invoke('report.dashboard')).scope, 'own');
assert(await invoke('shift.current'), 'Cashier can preview the checkout screen with a sample shift');
assert(!('cost_price' in (await invoke('product.list'))[0]));
assert.equal((await context.window.mansora.invoke('product.save', { name: 'Forbidden' })).ok, false);
for (const name of ['client', 'admin']) {
  const html = readFileSync(resolve(root, name, 'index.html'), 'utf8');
  assert(html.indexOf('/demo.js') < html.indexOf('type="module"'));
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/[^"?]+)"/g)) assert(existsSync(resolve(root, '.' + asset)), `Missing ${asset}`);
}
const walkthrough = readFileSync(resolve(root, 'walkthrough/index.html'), 'utf8');
for (const [, asset] of walkthrough.matchAll(/src="(screenshots\/[^"]+)"/g)) assert(existsSync(resolve(root, 'walkthrough', asset)), `Missing walkthrough ${asset}`);
assert(walkthrough.includes('Getting started'), 'Walkthrough includes owner setup guidance');
console.log('Interface demo checks passed: fixture identities, filtering, carton-price sample edits, mutation isolation, all admin/billing reads, blocked payments, correct invoice filtering/date scope and asset paths.');
