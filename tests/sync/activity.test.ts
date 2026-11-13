import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { makeShop, type TestShop } from '../helpers';

// C34: each sync reports counts only, and the admin Overview shows which shops are using the till.
let cloud: Cloud;
let shop: TestShop;
const net = flakyNetwork();
beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Activity Mart');
  await cloud.db.platform((q) => q(`UPDATE tenants SET status = 'active' WHERE name = 'Activity Mart'`));
  shop = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code });
});
afterAll(() => cloud.close());

describe('shop activity for Mansora (counts only)', () => {
  it('shows a shop with no sales yet, then active with today\'s counts after it sells and syncs', async () => {
    await shop.run(shop.owner, 'sync.run', {});
    let row = (await cloud.api('GET', '/v1/admin/activity')).body.find((r: any) => r.name === 'Activity Mart');
    expect(row).toMatchObject({ usage: 'never_sold', sales_today: 0 });

    await shop.run(shop.owner, 'shift.open', { openingFloat: 0 });
    for (const who of [shop.owner, shop.cashier]) await shop.run(who, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    await shop.run(shop.owner, 'sync.run', {});
    row = (await cloud.api('GET', '/v1/admin/activity')).body.find((r: any) => r.name === 'Activity Mart');
    expect(row).toMatchObject({ usage: 'active', sales_today: 2 });
    expect(row.staff_active_today).toBeGreaterThanOrEqual(2); // the owner and the cashier both sold today
    expect(row.last_sale_at).toBeTruthy();
    // No amounts are reported or stored for this view.
    expect(Object.keys(row).some((k) => /total|amount|gross|revenue/.test(k))).toBe(false);
  });

  it('flags a shop whose last sale is a week old as quiet', async () => {
    await cloud.db.platform((q) => q(`UPDATE devices SET last_sale_at = now() - interval '8 days', activity_day = CURRENT_DATE - 8 WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'Activity Mart')`));
    const row = (await cloud.api('GET', '/v1/admin/activity')).body.find((r: any) => r.name === 'Activity Mart');
    expect(row).toMatchObject({ usage: 'quiet', sales_today: 0 });
  });

  it('keeps syncing when an older server refuses the activity field, and never records a future sale time', async () => {
    const older = await cloud.createClient('Older Server Mart');
    let refused = 0;
    const strictOld: typeof fetch = (async (input: any, init?: any) => {
      if (String(input).endsWith('/v1/sync/events') && String(init?.body).includes('"activity"')) {
        refused++;
        return new Response(JSON.stringify({ code: 'INVALID_INPUT', message: 'device: Unrecognized key: "activity"' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return fetch(input, init);
    }) as typeof fetch;
    const legacy = await makeShop({ fetch: strictOld, apiUrl: cloud.url, code: older.code });
    await legacy.run(legacy.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: legacy.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    expect(await legacy.run(legacy.owner, 'sync.run', {})).toMatchObject({ ok: true, pending: 0 });
    await legacy.run(legacy.owner, 'sync.run', {});
    expect(refused).toBe(1); // tried once, then remembered not to send it

    // A laptop clock running a month fast cannot make a shop look active.
    const future = await cloud.createClient('Fast Clock Mart');
    const fast = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: future.code, now: () => new Date(Date.now() + 30 * 86_400_000) });
    await fast.run(fast.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: fast.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    await fast.run(fast.owner, 'sync.run', {});
    const [row] = await cloud.db.platform((q) => q(`SELECT last_sale_at FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE t.name = 'Fast Clock Mart'`));
    expect(new Date(row.last_sale_at).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('keeps suspended shops in view, since suspension does not stop selling', async () => {
    await cloud.db.platform((q) => q(`UPDATE tenants SET status = 'suspended' WHERE name = 'Activity Mart'`));
    expect((await cloud.api('GET', '/v1/admin/activity')).body.some((r: any) => r.name === 'Activity Mart')).toBe(true);
  });

  it('activates at most one laptop when two codes for the same shop are redeemed at once', async () => {
    const res = await cloud.api('POST', '/v1/admin/clients', { name: 'Race Mart', ownerName: 'Owner', phone: '0240000000', address: 'Accra' });
    const id = res.body.id;
    const codes = await Promise.all([1, 2].map(async () => (await cloud.api('POST', `/v1/admin/clients/${id}/activation-codes`)).body.code));
    const results = await Promise.all(codes.map((code, i) => cloud.api('POST', '/v1/devices/activate', { code, deviceName: `Laptop ${i}`, appVersion: 'test' }, null)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [n] = await cloud.db.platform((q) => q(`SELECT COUNT(*)::int AS n FROM devices WHERE tenant_id = $1 AND status = 'active'`, [id]));
    expect(n.n).toBe(1);
  });

  it('refuses the activity view without an administrator session', async () => {
    expect((await cloud.api('GET', '/v1/admin/activity', undefined, null)).status).toBe(401);
  });
});
