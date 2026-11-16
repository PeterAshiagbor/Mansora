import { afterEach, describe, expect, it } from 'vitest';
import { defaultTaxConfig, validateEventRows } from '../../packages/domain/src';
import { expectCode, makeShop, uuid, type TestShop } from '../helpers';
let shop: TestShop;
afterEach(() => shop?.engine.db.close());
const now = () => new Date('2026-11-15T12:00:00.000Z');
async function setup() {
  shop = await makeShop({ now });
  await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), effectiveDate: '2026-01-01', registered: true, registrationDate: '2026-01-01', tin: 'C123', vatNumber: 'V123', reason: 'Confirmed registration' });
  for (const id of Object.values(shop.products)) {
    const p = shop.engine.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    await shop.run(shop.owner, 'product.save', { id, name: p.name, sellingPrice: p.selling_price, taxClass: 'standard' });
  }
  return shop;
}
async function sale(quantity = 1) {
  return shop.run(shop.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: shop.products.milk, quantity }], tenders: [{ method: 'cash', amount: 100000 }] });
}
describe('VAT transactions and evidence', () => {
  it('quotes, collects, snapshots, prints, refunds and reports original tax after a rate edit', async () => {
    await setup();
    const quote = await shop.run(shop.cashier, 'sale.quote', { lines: [{ productId: shop.products.milk, quantity: 2 }] });
    const result = await sale(2);
    expect(result.total).toBe(quote.total);
    const details = await shop.run(shop.cashier, 'sale.get', { id: result.id });
    const original = JSON.parse(details.items[0].tax_snapshot);
    const receipt = await shop.run(shop.cashier, 'sale.receipt', { id: result.id });
    expect(receipt.html).toContain('V123'); expect(receipt.html).toContain('NHIL'); expect(receipt.html).toContain('GETFund');
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'NEW-TIN', vatNumber: 'NEW-VAT', vatBps: 1000, ruleOverrideAuthority: 'SYNTHETIC TEST RULE ONLY', reason: 'Rate change for future transactions' });
    const reprint = await shop.run(shop.cashier, 'sale.receipt', { id: result.id });
    expect(reprint.html).toContain('V123'); expect(reprint.html).not.toContain('NEW-TIN');
    await shop.run(shop.owner, 'shift.open', { openingFloat: 0 });
    for (let n = 0; n < 2; n++) await shop.run(shop.owner, 'refund.create', { id: uuid(), saleId: result.id, reason: 'Returned', lines: [{ saleItemId: details.items[0].id, quantity: 1 }] });
    const r = await shop.run(shop.owner, 'tax.report', { month: '2026-11' });
    expect(r.output.vat).toBe(original.vat); expect(r.reversed).toEqual(r.output);
    expect(r.payable).toBe(0);
    expect((await shop.run(shop.owner, 'report.profit', { from: '2026-11-01', to: '2026-11-30' })).grossProfit).toBe(0);
    const events = shop.engine.db.prepare('SELECT payload FROM outbox').all() as any[];
    for (const e of events) expect(() => validateEventRows(JSON.parse(e.payload).rows)).not.toThrow();
  });
  it('rejects unclassified registered sales and restricts editable tax settings to the owner', async () => {
    shop = await makeShop({ now });
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'TIN', vatNumber: 'VAT', reason: 'Registration' });
    await expectCode(sale(), 'TAX_CLASS_REQUIRED');
    await expectCode(shop.run(shop.manager, 'tax.configure', defaultTaxConfig()), 'PERMISSION_DENIED');
    await expectCode(shop.run(shop.cashier, 'tax.report', { month: '2026-11' }), 'PERMISSION_DENIED');
  });
  it('records apportioned input credits, prevents duplicate claims and carries forward each tax separately', async () => {
    await setup();
    const evidence = { id: uuid(), kind: 'input', date: '2026-10-15', invoiceDate: '2026-10-01', reference: 'SUP-001', supplierTin: 'SUP-TIN', base: 100000, vat: 15000, nhil: 2500, getfund: 2500, eligibleBps: 5000, evidenceConfirmed: true, reason: 'Invoice verified; half taxable use' };
    await shop.run(shop.owner, 'tax.record', evidence);
    expect((await shop.run(shop.owner, 'tax.record', evidence)).duplicate).toBe(true);
    await expectCode(shop.run(shop.owner, 'tax.record', { ...evidence, id: uuid() }), 'DUPLICATE_TAX_INVOICE');
    await expectCode(shop.run(shop.owner, 'tax.record', { ...evidence, id: uuid(), reference: 'OLD', invoiceDate: '2026-01-01' }), 'INPUT_CREDIT_PERIOD');
    await sale();
    const r = await shop.run(shop.owner, 'tax.report', { month: '2026-11' });
    expect(r.buckets[0].broughtForward).toBe(7500); expect(r.buckets[0].payable).toBe(0);
    expect(r.buckets[0].carriedForward).toBe(7500 - r.output.vat);
    const file = await shop.run(shop.owner, 'tax.export', { month: '2026-11' });
    expect(file.fileName).toBe('Ghana-VAT-2026-11.xlsx'); expect(Buffer.from(file.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK');
  });
  it('records acknowledgements, locks filed periods and permits later payment against the month', async () => {
    await setup();
    await shop.run(shop.owner, 'tax.file', { id: uuid(), month: '2026-10', reference: 'GRA-ACK', reason: 'Reconciled and submitted through GRA', reviewed: true, fiscalEvidenceConfirmed: true, submittedDate: '2026-11-15' });
    await expectCode(shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'adjustment', date: '2026-10-01', reference: 'ADJ', reason: 'Correction', vat: 10, evidenceConfirmed: true }), 'TAX_PERIOD_CLOSED');
    await expectCode(shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'adjustment', date: '2026-09-01', reference: 'EARLIER', reason: 'Would change filed carry-forward', vat: -10, evidenceConfirmed: true }), 'TAX_PERIOD_CLOSED');
    await shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'payment', date: '2026-10-01', reference: 'GRA-PAY', reason: 'October tax paid in November', amount: 100, period: '2026-10', evidenceConfirmed: true });
    expect((await shop.run(shop.owner, 'tax.report', { month: '2026-10' })).payments).toBe(100);
    expect(() => shop.engine.db.prepare('DELETE FROM tax_records').run()).toThrow();
  });
  it('alerts at shorter bands, does not tax early, and schedules liability after verified annual threshold crossing', async () => {
    let time = new Date('2026-11-15T12:00:00.000Z');
    shop = await makeShop({ now: () => time });
    await shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'turnover', date: '2026-11-01', reference: 'Other branch', reason: 'Verified external taxable supplies, no duplicate POS sales', base: 75000000, evidenceConfirmed: true });
    expect((await shop.run(shop.owner, 'tax.status')).annual.exceeded).toBe(false); // statute says exceeds
    await shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'turnover', date: '2026-11-02', reference: 'Other branch day 2', reason: 'Verified supplies', base: 1, evidenceConfirmed: true });
    const status = await shop.run(shop.owner, 'tax.status');
    expect(status.pendingTrigger.effectiveDate).toBe('2026-12-01'); expect(status.registered).toBe(false);
    const q = await shop.run(shop.cashier, 'sale.quote', { lines: [{ productId: shop.products.milk, quantity: 1 }] });
    expect(q.tax.vat).toBe(0);
    time = new Date('2026-12-01T12:00:00.000Z');
    // Sessions must be renewed after the clock advances.
    const token = (await shop.run(null, 'auth.login', { username: 'ama', password: 'owner-pass-1' })).token;
    const c = await shop.run(token, 'tax.current');
    expect(c.registered).toBe(true); expect(c.registrationDate).toBe('2026-12-01');
    await expectCode(shop.run(token, 'sale.quote', { lines: [{ productId: shop.products.milk, quantity: 1 }] }), 'VAT_PROFILE_REQUIRED');
    await shop.run(token, 'tax.configure', { ...defaultTaxConfig(), effectiveDate: '2026-12-01', tin: 'TIN-PENDING-CERTIFICATE', reason: 'TIN confirmed; registration application pending' });
    await shop.run(token, 'product.save', { id: shop.products.milk, name: 'Milk', sellingPrice: 1250, taxClass: 'standard' });
    const after = await shop.run(token, 'sale.quote', { lines: [{ productId: shop.products.milk, quantity: 1 }] });
    expect(after.tax.vat).toBeGreaterThan(0); expect(after.snapshots[0].registered).toBe(true);

  });
  it('uses the three-month plus nine-month forecast test without charging at an early-warning band alone', async () => {
    shop = await makeShop({ now });
    await shop.run(shop.owner, 'tax.record', { id: uuid(), kind: 'turnover', date: '2026-11-01', reference: 'External sales', reason: 'Verified taxable supplies', base: 18750001, evidenceConfirmed: true });
    expect((await shop.run(shop.owner, 'tax.status')).pendingTrigger).toBeNull();
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), forecastNineMonths: 56250000, reason: 'Confirmed orders support the next nine months' });
    const status = await shop.run(shop.owner, 'tax.status');
    expect(status.pendingTrigger).toMatchObject({ trigger: 'three_months_plus_nine_month_forecast', effectiveDate: '2026-12-01' });
    expect(status.registered).toBe(false);
  });
  it('keeps exempt supplies out of turnover and tax out of gross profit on an exclusive-price sale', async () => {
    await setup();
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'TIN', pricing: 'exclusive', reason: 'Exclusive pricing verified' });
    await shop.run(shop.owner, 'product.save', { id: shop.products.milk, name: 'Milk', sellingPrice: 10000, taxClass: 'exempt' });
    await shop.run(shop.owner, 'product.save', { id: shop.products.soap, name: 'Soap', sellingPrice: 10000, taxClass: 'standard' });
    const quote = await shop.run(shop.cashier, 'sale.quote', { lines: [{ productId: shop.products.soap, quantity: 1 }, { productId: shop.products.milk, quantity: 1 }], cartDiscount: 2000 });
    const result = await shop.run(shop.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: shop.products.soap, quantity: 1 }, { productId: shop.products.milk, quantity: 1 }], cartDiscount: 2000, tenders: [{ method: 'cash', amount: quote.total }], approver: { username: 'ama', password: 'owner-pass-1' } });
    expect(result.total).toBe(19800);
    expect((await shop.run(shop.owner, 'tax.status')).annual.total).toBe(9000);
    const profit = await shop.run(shop.owner, 'report.profit', { from: '2026-11-01', to: '2026-11-30' });
    expect(profit.revenue).toBe(18000);
  });

  it('refuses a stale tax quote without creating a sale or changing stock', async () => {
    await setup();
    await expectCode(shop.run(shop.cashier, 'sale.complete', { id: uuid(), expectedTotal: 999, lines: [{ productId: shop.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 999999 }] }), 'PRICE_CHANGED');
    expect((shop.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n).toBe(0);
    expect((shop.engine.db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(shop.products.milk) as any).quantity).toBe(50);
  });

  it('keeps service-amendment warnings visible to owners and managers until dated authority is recorded', async () => {
    await setup();
    const config = { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'TIN', supplyType: 'services', reason: 'Service profile review' };
    await shop.run(shop.owner, 'tax.configure', config);
    expect((await shop.run(shop.manager, 'tax.status')).amendmentReviewRequired).toBe(true);
    await expectCode(shop.run(shop.owner, 'tax.configure', { ...config, serviceThresholdConfirmed: true }), 'SERVICE_RULE_EVIDENCE_REQUIRED');
    await shop.run(shop.owner, 'tax.configure', { ...config, serviceThresholdConfirmed: true, serviceThresholdDate: '2026-09-01', serviceThresholdAuthority: 'SYNTHETIC TEST AUTHORITY ONLY' });
    expect((await shop.run(shop.manager, 'tax.status')).amendmentReviewRequired).toBe(false);
    await shop.run(shop.owner, 'tax.configure', { ...config, serviceThresholdConfirmed: true, serviceThresholdDate: '2026-12-01', serviceThresholdAuthority: 'SYNTHETIC FUTURE TEST AUTHORITY' });
    expect((await shop.run(shop.owner, 'tax.status')).amendmentReviewRequired).toBe(true);
    expect((await shop.run(shop.owner, 'tax.current')).registered).toBe(true);
  });

});
