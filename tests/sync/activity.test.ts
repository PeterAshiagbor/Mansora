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

    for (const who of [shop.cashier, shop.cashier]) await shop.run(who, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    await shop.run(shop.owner, 'sync.run', {});
    row = (await cloud.api('GET', '/v1/admin/activity')).body.find((r: any) => r.name === 'Activity Mart');
    expect(row).toMatchObject({ usage: 'active', sales_today: 2 });
    expect(row.staff_active_today).toBeGreaterThanOrEqual(2); // owner and cashier recorded actions today
    expect(row.last_sale_at).toBeTruthy();
    // No amounts are reported or stored for this view.
    expect(Object.keys(row).some((k) => /total|amount|gross|revenue/.test(k))).toBe(false);
  });

  it('flags a shop whose last sale is a week old as quiet', async () => {
    await cloud.db.platform((q) => q(`UPDATE devices SET last_sale_at = now() - interval '8 days', activity_day = CURRENT_DATE - 8 WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'Activity Mart')`));
    const row = (await cloud.api('GET', '/v1/admin/activity')).body.find((r: any) => r.name === 'Activity Mart');
    expect(row).toMatchObject({ usage: 'quiet', sales_today: 0 });
  });

  it('refuses the activity view without an administrator session', async () => {
    expect((await cloud.api('GET', '/v1/admin/activity', undefined, null)).status).toBe(401);
  });
});
