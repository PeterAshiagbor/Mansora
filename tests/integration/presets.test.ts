import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRESETS } from '@mansora/domain';
import { startCloud, type Cloud } from '../cloud';
import { makeShop } from '../helpers';
import { flakyNetwork } from '../cloud';

let cloud: Cloud;
beforeAll(async () => { cloud = await startCloud(); });
afterAll(() => cloud.close());
const names = (shop: any) => (shop.engine.db.prepare('SELECT name FROM categories ORDER BY name').all() as any[]).map((c) => c.name);

describe('business-type presets (acquisition spec PR-06)', () => {
  it('a newly activated shop starts with the categories of its business type', async () => {
    const client = await cloud.createClient('Preset Mini Mart');
    await cloud.api('PUT', `/v1/admin/clients/${client.id}`, { name: 'Preset Mini Mart', ownerName: 'Owner', businessType: 'mini_mart', status: 'onboarding' });
    const shop = await makeShop({ fetch: flakyNetwork().fetch, apiUrl: cloud.url, code: client.code });
    expect(names(shop)).toEqual([...PRESETS.mini_mart.categories].sort());
    expect(await shop.run(shop.owner, 'preset.current', {})).toEqual({ presetId: 'mini_mart', version: 1, businessType: 'mini_mart' });
  });

  it('applying again adds nothing; switching adds only what is missing and never removes, renames or changes settings', async () => {
    const client = await cloud.createClient('Preset Wholesale');
    const shop = await makeShop({ fetch: flakyNetwork().fetch, apiUrl: cloud.url, code: client.code });
    const before = names(shop);
    const settings = await shop.run(shop.owner, 'app.state', {});
    await shop.run(shop.owner, 'category.save', { name: 'cartons' }); // already there in lower case
    const r = await shop.run(shop.owner, 'preset.apply', { presetId: 'wholesale' });
    expect(r.categoriesAdded).not.toContain('Cartons');
    const once = names(shop);
    expect((await shop.run(shop.owner, 'preset.apply', { presetId: 'wholesale' })).categoriesAdded).toEqual([]);
    expect(names(shop)).toEqual(once);
    for (const n of before) expect(once).toContain(n);
    const after = await shop.run(shop.owner, 'app.state', {});
    expect(after.business).toEqual(settings.business);
    expect(shop.engine.db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 3 });
    await expect(shop.run(shop.cashier, 'preset.apply', { presetId: 'retail' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(shop.run(shop.owner, 'preset.apply', { presetId: 'restaurant' })).rejects.toBeTruthy();
  });

  it('every preset points only at pages that exist and suggests no unsafe defaults', () => {
    const pages = ['dashboard', 'checkout', 'sales', 'shifts', 'customers', 'credit', 'products', 'categories', 'stock', 'purchases', 'reports', 'expenses', 'statements', 'staff', 'settings', 'data', 'billing', 'sync', 'backup', 'support', 'audit', 'help'];
    for (const p of Object.values(PRESETS)) {
      for (const g of p.guidance) expect(pages, `${p.id}: ${g.page}`).toContain(g.page);
      expect(p.recommended.allowNegativeStock).toBe(false);
      expect(new Set(p.categories.map((c) => c.toLowerCase())).size).toBe(p.categories.length);
    }
  });
});
