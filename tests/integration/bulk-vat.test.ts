import { afterEach, expect, it } from 'vitest';
import { defaultTaxConfig } from '@mansora/domain';
import { expectCode, makeShop, stockOf, uuid, type TestShop } from '../helpers';
let shop: TestShop;
afterEach(() => shop?.engine.db.close());
const setup = async () => { shop = await makeShop(); };
const list = () => shop.run<any[]>(shop.owner, 'product.list');
const file = (csv: string) => ({ fileName: 'vat.csv', contentBase64: Buffer.from(csv).toString('base64') });
const lines = (products: any[]) => products.map(p => ({ productId: p.id, expectedVersion: p.version }));

it('bulk updates classifications only and preserves original receipts, prices and stock', async () => {
  await setup();
  const sale = await shop.run(shop.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: shop.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 1250 }] });
  const snapshot = shop.engine.db.prepare('SELECT tax_snapshot FROM sales WHERE id=?').get(sale.id);
  const products = await list();
  const input = { lines: lines(products), taxClass: 'exempt', reason: 'Owner reviewed statutory treatment' };
  await expectCode(shop.run(shop.cashier, 'product.bulkVat', input), 'PERMISSION_DENIED');
  expect(await shop.run(shop.owner, 'product.bulkVat', input)).toEqual({ updated: 3, unchanged: 0 });
  const updated = await list();
  for (const p of updated) {
    const old = products.find(x => x.id === p.id);
    expect(p).toMatchObject({ tax_class: 'exempt', selling_price: old.selling_price, cost_price: old.cost_price, quantity: old.quantity, version: old.version + 1 });
  }
  expect(shop.engine.db.prepare('SELECT tax_snapshot FROM sales WHERE id=?').get(sale.id)).toEqual(snapshot);
  expect((shop.engine.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='product.vat_class_updated'").get() as any).n).toBe(3);
});
it('rejects stale selections atomically and refuses duplicate ids', async () => {
  await setup(); const products = await list();
  const selected = lines(products); selected[1].expectedVersion++;
  await expectCode(shop.run(shop.owner, 'product.bulkVat', { lines: selected, taxClass: 'standard', reason: 'Review' }), 'PRODUCT_CHANGED');
  expect((await list()).every(p => !p.tax_class)).toBe(true);
  await expectCode(shop.run(shop.owner, 'product.bulkVat', { lines: [selected[0], selected[0]], taxClass: 'standard', reason: 'Review' }), 'INVALID_INPUT');
});
it('fills blank import classifications without overriding explicit row choices', async () => {
  await setup();
  await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'TEST-TIN', reason: 'Synthetic setup' });
  const input = { ...file('Name,Selling price,Opening stock,VAT classification\nBulk one,12,2,\nBulk two,12,2,zero'), defaultTaxClass: 'standard' };
  const preview = await shop.run(shop.owner, 'import.preview', input);
  expect(preview.rows.map((r: any) => r.data.taxClass)).toEqual(['standard', 'zero']);
  expect(preview.rows.every((r: any) => !r.errors.length)).toBe(true);
  await shop.run(shop.owner, 'import.commit', { ...input, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: true });
});
it('updates existing products from a VAT-only file without requiring prices or changing stock', async () => {
  await setup(); const before = await list();
  const input = { ...file('SKU,VAT classification\nRICE,exempt\nMILK,zero'), updateExistingVat: true };
  const preview = await shop.run(shop.owner, 'import.preview', input);
  expect(preview.needsMapping).toBe(false);
  expect(preview.rows.every((r: any) => r.vatUpdate && !r.errors.length)).toBe(true);
  await expectCode(shop.run(shop.owner, 'import.commit', { ...input, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false }), 'REASON_REQUIRED');
  const result = await shop.run(shop.owner, 'import.commit', { ...input, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false, vatUpdateReason: 'Reviewed supplies' });
  expect(result).toMatchObject({ created: 0, skipped: 0, vatUpdated: 2, openingStockApplied: false });
  for (const p of await list()) {
    const old = before.find(x => x.id === p.id);
    expect(p).toMatchObject({ selling_price: old.selling_price, cost_price: old.cost_price, quantity: old.quantity });
  }
  expect((await list()).find(p => p.sku === 'RICE').tax_class).toBe('exempt');
});
it('rejects conflicting identities and repeated existing rows before any update', async () => {
  await setup();
  for (const csv of ['Name,SKU,VAT classification\nMilk tin,RICE,exempt', 'SKU,VAT classification\nRICE,exempt\nRICE,zero']) {
    const input = { ...file(csv), updateExistingVat: true, vatUpdateReason: 'Review' };
    const preview = await shop.run(shop.owner, 'import.preview', input);
    expect(preview.rows.some((r: any) => r.errors.length)).toBe(true);
    await expectCode(shop.run(shop.owner, 'import.commit', { ...input, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false }), 'IMPORT_HAS_ERRORS');
    expect((await list()).every(p => !p.tax_class)).toBe(true);
  }
});
it('can classify a previously imported file without applying its opening stock twice', async () => {
  await setup(); const input = file('Name,SKU,Selling price,Opening stock\nReimported VAT,REIMPORT-VAT,12,5');
  const initial = await shop.run(shop.owner, 'import.preview', input);
  await shop.run(shop.owner, 'import.commit', { ...input, mapping: initial.mapping, confirmOpeningStock: true });
  const options = { ...input, updateExistingVat: true, defaultTaxClass: 'standard', vatUpdateReason: 'Classify previous import' };
  const preview = await shop.run(shop.owner, 'import.preview', options);
  expect(preview.alreadyImportedAt).toBeNull();
  expect(await shop.run(shop.owner, 'import.commit', { ...options, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false })).toMatchObject({ created: 0, vatUpdated: 1 });
  const p = (await list()).find(p => p.sku === 'REIMPORT-VAT');
  expect(stockOf(shop.engine, p.id)).toBe(5);
  await expectCode(shop.run(shop.owner, 'import.commit', { ...options, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false }), 'ALREADY_IMPORTED');
});

it('refuses a changed import preview rather than overwriting another user’s classification', async () => {
  await setup();
  const input = { ...file('SKU,VAT classification\nRICE,standard'), updateExistingVat: true, vatUpdateReason: 'Reviewed list' };
  const preview = await shop.run(shop.owner, 'import.preview', input);
  const rice = (await list()).find(p => p.sku === 'RICE');
  await shop.run(shop.owner, 'product.bulkVat', { lines: lines([rice]), taxClass: 'zero', reason: 'Another owner review' });
  await expectCode(shop.run(shop.owner, 'import.commit', { ...input, mapping: preview.mapping, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false }), 'IMPORT_CHANGED');
  expect((await list()).find(p => p.sku === 'RICE').tax_class).toBe('zero');
});

it('binds reviewed classifications to the preview even when column mapping changes', async () => {
  await setup();
  const input = { ...file('SKU,VAT classification,Alternative classification\nRICE,standard,exempt'), updateExistingVat: true, vatUpdateReason: 'Reviewed standard treatment' };
  const preview = await shop.run(shop.owner, 'import.preview', input);
  await expectCode(shop.run(shop.owner, 'import.commit', { ...input, mapping: { ...preview.mapping, tax_class: 'Alternative classification' }, expectedPreviewHash: preview.reviewHash, confirmOpeningStock: false }), 'IMPORT_CHANGED');
  expect((await list()).find(p => p.sku === 'RICE').tax_class).toBeNull();
});
