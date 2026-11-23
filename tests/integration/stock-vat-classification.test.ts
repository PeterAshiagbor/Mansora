import { afterEach, expect, it } from 'vitest';
import { defaultTaxConfig } from '../../packages/domain/src';
import { expectCode, makeShop, stockOf, uuid, type TestShop } from '../helpers';
let shop: TestShop;
afterEach(() => shop?.engine.db.close());
const setup = async () => { shop = await makeShop({ now: () => new Date('2026-11-23T12:00:00Z') }); };
const enable = (date = '2026-01-01') => shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: date, tin: 'TEST-TIN', reason: 'Synthetic VAT setup' });
const classify = async (id: string, taxClass = 'standard') => { const p = (await shop.run(shop.owner, 'product.list')).find((p: any) => p.id === id); await shop.run(shop.owner, 'product.save', { id, name: p.name, sellingPrice: p.selling_price, taxClass }); };

it('blocks unclassified opening stock and rolls back the entire product creation', async () => {
  await setup(); await enable();
  const before = shop.engine.db.prepare('SELECT COUNT(*) n FROM products').get();
  await expectCode(shop.run(shop.owner, 'product.save', { name: 'Unclassified opening stock', sellingPrice: 100, openingStock: 10 }), 'TAX_CLASS_REQUIRED');
  expect(shop.engine.db.prepare('SELECT COUNT(*) n FROM products').get()).toEqual(before);
  expect((await shop.run(shop.owner, 'stock.vatPolicy')).classificationRequired).toBe(true);
  for (const taxClass of ['standard', 'zero', 'exempt', 'outside']) {
    const p = await shop.run(shop.owner, 'product.save', { name: 'Classified ' + taxClass, sellingPrice: 100, openingStock: 2, taxClass });
    expect(stockOf(shop.engine, p.id)).toBe(2);
  }
  expect((await shop.run(shop.owner, 'product.save', { name: 'Catalogue only', sellingPrice: 100 })).id).toBeTruthy();
});

it('rejects a mixed purchase atomically, then allows it after classification', async () => {
  await setup(); await enable(); await classify(shop.products.rice);
  const input = { items: [{ productId: shop.products.rice, quantity: 2, unitCost: 6000 }, { productId: shop.products.milk, quantity: 2, unitCost: 900 }] };
  const before = stockOf(shop.engine, shop.products.rice);
  await expectCode(shop.run(shop.owner, 'purchase.receive', input), 'TAX_CLASS_REQUIRED');
  expect(stockOf(shop.engine, shop.products.rice)).toBe(before);
  expect(shop.engine.db.prepare('SELECT COUNT(*) n FROM purchases').get()).toEqual({ n: 0 });
  await classify(shop.products.milk, 'exempt');
  await shop.run(shop.owner, 'purchase.receive', input);
  expect(stockOf(shop.engine, shop.products.rice)).toBe(before + 2);
});

it('blocks positive corrections and counts, but preserves reductions', async () => {
  await setup(); await enable();
  await expectCode(shop.run(shop.owner, 'stock.adjust', { productId: shop.products.milk, type: 'MANUAL_CORRECTION', delta: 1, reason: 'Count correction' }), 'TAX_CLASS_REQUIRED');
  await expectCode(shop.run(shop.owner, 'stock.count', { lines: [{ productId: shop.products.rice, counted: 19 }, { productId: shop.products.milk, counted: 51 }] }), 'TAX_CLASS_REQUIRED');
  expect(stockOf(shop.engine, shop.products.rice)).toBe(20);
  await shop.run(shop.owner, 'stock.adjust', { productId: shop.products.milk, type: 'DAMAGE', delta: -1, reason: 'Damaged' });
  expect(stockOf(shop.engine, shop.products.milk)).toBe(49);
});

it('checks imports during preview and commit and supports explicit VAT columns', async () => {
  await setup(); await enable();
  const file = (csv: string) => ({ fileName: 'stock.csv', contentBase64: Buffer.from(csv).toString('base64') });
  const bad = file('Name,Selling price,Opening stock\nUnclassified import,10,3');
  const preview = await shop.run(shop.owner, 'import.preview', bad);
  expect(preview.rows[0].errors).toContain('Choose a VAT classification before importing opening stock');
  await expectCode(shop.run(shop.owner, 'import.commit', { ...bad, mapping: preview.mapping, confirmOpeningStock: true }), 'IMPORT_HAS_ERRORS');
  const good = file('Name,Selling price,Opening stock,VAT classification\nClassified import,10,3,zero-rated');
  const valid = await shop.run(shop.owner, 'import.preview', good);
  expect(valid.rows[0].errors).toEqual([]);
  await shop.run(shop.owner, 'import.commit', { ...good, mapping: valid.mapping, confirmOpeningStock: true });
  expect((await shop.run(shop.owner, 'product.list')).find((p: any) => p.name === 'Classified import')).toMatchObject({ tax_class: 'zero', quantity: 3 });
});

it('allows additions before VAT is effective and while platform collection is disabled', async () => {
  await setup(); await enable('2026-12-01');
  const add = () => shop.run(shop.owner, 'stock.adjust', { productId: shop.products.milk, type: 'MANUAL_CORRECTION', delta: 1, reason: 'Count correction' });
  await add(); await enable();
  shop.engine.setMeta('platform_vat_feature', JSON.stringify({ enabled: false, revision: 1, events: [] }));
  await add();
  shop.engine.setMeta('platform_vat_feature', JSON.stringify({ enabled: true, revision: 2, events: [] }));
  await expectCode(add(), 'TAX_CLASS_REQUIRED');
});

it('retains refunds against a legacy unclassified sale', async () => {
  await setup();
  const sale = await shop.run(shop.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: shop.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 1250 }] });
  const details = await shop.run(shop.cashier, 'sale.get', { id: sale.id });
  await enable(); await shop.run(shop.owner, 'shift.open', { openingFloat: 1250 });
  await shop.run(shop.owner, 'refund.create', { id: uuid(), saleId: sale.id, reason: 'Returned original sale', lines: [{ saleItemId: details.items[0].id, quantity: 1 }] });
  expect(stockOf(shop.engine, shop.products.milk)).toBe(50);
});
