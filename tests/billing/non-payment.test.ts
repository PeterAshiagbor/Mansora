import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { CASHIER, expectCode, login, makeShop, OWNER, type TestShop } from '../helpers';
import { admin, at, GHS, one, q } from './helpers';

// The till and the cloud share one controllable calendar for this scenario.
let cloud: Cloud;
let shop: TestShop;
let tenantId: string;
let invoiceId: string;
let a: ReturnType<typeof admin>;
const net = flakyNetwork();
const clock = { day: '2034-03-01' };
// Jumping days locks idle sessions, as it would on a real till, so staff sign in again.
const move = async (day: string) => {
  clock.day = day; at(cloud, day);
  if (shop) { shop.owner = await login(shop.engine, OWNER); shop.cashier = await login(shop.engine, CASHIER); }
};
const sync = () => shop.run(shop.owner, 'sync.run', {});
const stage = async () => (await shop.run(shop.owner, 'sync.status', {})).standing?.stage ?? 'good';
const range = () => ({ from: clock.day, to: clock.day });

beforeAll(async () => {
  cloud = await startCloud();
  a = admin(cloud);
  await move('2034-03-01');
  const client = await cloud.createClient('Late Payer Mart');
  tenantId = client.id;
  shop = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code, now: () => new Date(`${clock.day}T10:00:00.000Z`) });
  const inv = await a.post('/invoices', { tenantId, lines: [{ description: 'Monthly service', quantity: 1, unitPrice: GHS(300), serviceCode: 'subscription' }], dueDate: '2034-03-10', issue: true });
  invoiceId = inv.body.id;
});
afterAll(() => cloud.close());

describe('non-payment policy (D-28): selling never stops, reports pause only after warning', () => {
  it('reminds, then warns with the date, then pauses reports, while the till keeps working throughout', async () => {
    await sync();
    expect(await stage()).toBe('good');
    await move('2034-03-11'); await sync();
    expect(await stage()).toBe('notice');
    await shop.run(shop.owner, 'report.sales', range()); // reports still open
    await move('2034-03-25'); await sync();
    const warned = (await shop.run(shop.owner, 'sync.status', {})).standing;
    expect(warned).toMatchObject({ stage: 'warning', restrictFrom: '2034-04-09' });
    await move('2034-04-09'); await sync();
    expect(await stage()).toBe('restricted');

    for (const cmd of ['report.sales', 'report.profit', 'report.stock', 'report.wallet']) await expectCode(shop.run(shop.owner, cmd, range()), 'SERVICE_RESTRICTED');
    // The till, the dashboard, stock, the full data export, backups and sync all keep working.
    const sale = await shop.run(shop.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 1250 }] });
    expect(sale.receiptNo).toBeTruthy();
    await shop.run(shop.owner, 'report.dashboard', {});
    await shop.run(shop.owner, 'stock.overview', {});
    await shop.run(shop.owner, 'export.business', { format: 'json' });
    expect((await sync()).ok).toBe(true);
    // Each refusal is recorded in the audit history.
    const refusals = shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'service.restricted'`).get() as { n: number };
    expect(refusals.n).toBe(4);
  });

  it('lifts as soon as a payment is recorded and the till syncs', async () => {
    const pay = await a.post(`/invoices/${invoiceId}/payment`, { amount: GHS(300), method: 'momo', reference: 'MP-PAID' });
    expect(pay.status).toBe(200);
    await sync();
    expect(await stage()).toBe('good');
    await shop.run(shop.owner, 'report.sales', range());
  });

  it('keeps escalating offline on the stored date, so disconnecting does not postpone restrictions', async () => {
    const inv = await a.post('/invoices', { tenantId, lines: [{ description: 'Next month', quantity: 1, unitPrice: GHS(300), serviceCode: 'subscription' }], dueDate: '2034-04-20', issue: true });
    await move('2034-05-06'); await sync();
    expect(await stage()).toBe('warning'); // restrictions from 2034-05-20
    net.online = false;
    await move('2034-05-20');
    expect((await sync()).ok).toBe(false);
    await expectCode(shop.run(shop.owner, 'report.sales', range()), 'SERVICE_RESTRICTED');
    await shop.run(shop.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    net.online = true;
    await a.post(`/invoices/${inv.body.id}/payment`, { amount: GHS(300), method: 'cash' });
    await sync();
    expect(await stage()).toBe('good');
  });

  it('never escalates a disputed invoice, and honours a bounded, audited payment arrangement', async () => {
    const inv = (await a.post('/invoices', { tenantId, lines: [{ description: 'June', quantity: 1, unitPrice: GHS(300), serviceCode: 'subscription' }], dueDate: '2034-06-01', issue: true })).body.id;
    expect((await a.post(`/invoices/${inv}/dispute`, { reason: 'Client says the June fee was waived' })).status).toBe(200);
    await move('2034-07-15'); await sync();
    expect(await stage()).toBe('good');
    expect((await a.post(`/invoices/${inv}/dispute/resolve`, { resolution: 'Fee stands' })).status).toBe(200);
    await sync();
    expect(await stage()).toBe('restricted'); // 44 days late once the dispute is resolved

    expect((await a.post(`/clients/${tenantId}/standing/hold`, { until: '2034-09-30', reason: 'Too long' })).status).toBe(400); // over 60 days
    expect((await a.post(`/clients/${tenantId}/standing/hold`, { until: '2034-07-14', reason: 'In the past' })).status).toBe(400);
    const held = await a.post(`/clients/${tenantId}/standing/hold`, { until: '2034-07-31', reason: 'Pays on the 31st' });
    expect(held.body).toMatchObject({ stage: 'warning', holdUntil: '2034-07-31', restrictFrom: '2034-08-01' });
    await sync();
    await shop.run(shop.owner, 'report.sales', range());
    const view = (await a.get(`/clients/${tenantId}/standing`)).body;
    expect(view.hold).toMatchObject({ until: '2034-07-31', reason: 'Pays on the 31st' });
    expect((await a.get('/collections')).body.find((r: any) => r.tenant_id === tenantId).standing.stage).toBe('warning');

    expect((await a.post(`/clients/${tenantId}/standing/clear-hold`, { reason: 'Missed the agreed payment' })).body.stage).toBe('restricted');
    await sync();
    await expectCode(shop.run(shop.owner, 'report.sales', range()), 'SERVICE_RESTRICTED');
    const actions = (await q(cloud, `SELECT action FROM billing_audit_logs WHERE tenant_id = $1 AND action LIKE 'service_hold.%' ORDER BY occurred_at`, [tenantId])).map((r: any) => r.action);
    expect(actions).toEqual(['service_hold.set', 'service_hold.cleared']);
    expect((await one(cloud, `SELECT status FROM tenants WHERE id = $1`, [tenantId])).status).not.toBe('suspended'); // the account itself is never suspended
  });

  it('bounds the thresholds and keeps saved ones when an older settings screen omits them', async () => {
    const current = (await a.get('/settings')).body;
    expect(current.standing).toMatchObject({ noticeAfterDays: 1, warnAfterDays: 15, restrictAfterDays: 30 });
    expect((await a.put('/settings', { ...current, standing: { noticeAfterDays: 1, warnAfterDays: 10, restrictAfterDays: 14 } })).status).toBe(400);
    expect((await a.put('/settings', { ...current, standing: { noticeAfterDays: 3, warnAfterDays: 20, restrictAfterDays: 45 } })).status).toBe(200);
    const { standing: _omit, ...older } = current;
    expect((await a.put('/settings', older)).status).toBe(200);
    expect((await a.get('/settings')).body.standing).toMatchObject({ noticeAfterDays: 3, warnAfterDays: 20, restrictAfterDays: 45 });
  });
});
