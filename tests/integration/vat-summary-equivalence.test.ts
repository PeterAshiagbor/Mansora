/**
 * R16-09: the Tax screen's summary (`tax.report` without rows) groups ordinary lines in SQLite. It must give exactly
 * the same return as the full line-by-line calculation used for export and filing, month by month.
 */
import { afterEach, expect, it } from 'vitest';
import { defaultTaxConfig, taxAmount } from '../../packages/domain/src';
import { CASHIER, login, makeShop, OWNER, uuid, type TestShop } from '../helpers';

let shop: TestShop | undefined;
afterEach(() => shop?.engine.db.close());
const APPROVER = { username: OWNER.username, password: OWNER.password };

it('summary and full VAT returns agree on every figure, blocker and warning across a mixed history', async () => {
  let clock = new Date('2026-06-03T10:00:00Z');
  const s = (shop = await makeShop({ now: () => clock }));
  const at = async (iso: string) => { clock = new Date(iso); s.owner = await login(s.engine, OWNER); s.cashier = await login(s.engine, CASHIER); };
  const unclassified = (await s.run(s.owner, 'product.save', { name: 'Loose item', sellingPrice: 4_321, openingStock: 500 })).id;
  const fan = (await s.run(s.owner, 'product.save', { name: 'Fan', sellingPrice: 12_345, openingStock: 500, taxClass: 'standard' })).id;
  const zero = (await s.run(s.owner, 'product.save', { name: 'Export', sellingPrice: 9_999, openingStock: 500, taxClass: 'zero' })).id;
  const exempt = (await s.run(s.owner, 'product.save', { name: 'Book', sellingPrice: 7_777, openingStock: 500, taxClass: 'exempt' })).id;
  const sell = (ids: string[], q = 1) => s.run(s.cashier, 'sale.complete', { id: uuid(), lines: ids.map((productId) => ({ productId, quantity: q })), tenders: [{ method: 'cash', amount: 10_000_000 }] });
  const items = async (saleId: string) => (await s.run(s.cashier, 'sale.get', { id: saleId })).items;
  const refund = async (saleId: string, n = 1, take = 2) => s.run(s.cashier, 'refund.create', { id: uuid(), saleId, reason: 'Return', approver: APPROVER, lines: (await items(saleId)).slice(0, take).map((i: any) => ({ saleItemId: i.id, quantity: n })) });

  // June: a sale plus a line recorded before VAT support (no snapshot). July: an unclassified product, no legacy line.
  const june = await sell([fan]);
  await at('2026-07-03T10:00:00Z');
  await sell([unclassified, fan, zero], 2);
  await at('2026-07-09T10:00:00Z');
  await sell([fan, exempt]);
  // A line recorded before VAT support carries no snapshot at all.
  s.engine.db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, cost_snapshot, line_total, tax_snapshot) VALUES (?, ?, ?, 'Legacy line', 1, 500, 100, 500, NULL)`).run(uuid(), june.id, fan);

  // August: registered; ordinary trade over several days, an input credit and a refund.
  // Registration is recorded on 3 August, backdated to 1 August: the 2 August sale went out without VAT.
  await at('2026-08-02T08:00:00Z');
  await s.run(s.owner, 'product.save', { id: unclassified, name: 'Loose item', sellingPrice: 4_321, taxClass: 'standard' });
  const late = await sell([fan, unclassified, zero]);
  await at('2026-08-03T08:00:00Z');
  await s.run(s.owner, 'tax.configure', { ...defaultTaxConfig(), effectiveDate: '2026-08-01', registered: true, registrationDate: '2026-08-01', tin: 'C1', reason: 'Registered' });
  const aug: string[] = [];
  for (let d = 3; d < 28; d += 4) { await at(`2026-08-${String(d).padStart(2, '0')}T10:00:00Z`); aug.push((await sell([fan, zero, exempt], 1 + (d % 3))).id); }
  await s.run(s.owner, 'tax.record', { id: uuid(), kind: 'input', date: '2026-08-20', reference: 'IN-1', reason: 'Supplier', supplierTin: 'S1', invoiceDate: '2026-08-20', base: 50_000, vat: 7_500, nhil: 1_250, getfund: 1_250, evidenceConfirmed: true });
  await refund(aug[1]);

  // September: Mansora switches collection off, then on; one switched-off line is reconciled, then partly refunded.
  await at('2026-09-02T10:00:00Z');
  s.engine.setMeta('platform_vat_feature', JSON.stringify({ enabled: false, revision: 1, events: [] }));
  const off: string[] = [];
  for (let d = 2; d < 10; d += 2) { await at(`2026-09-${String(d).padStart(2, '0')}T10:00:00Z`); off.push((await sell([fan, zero], 2)).id); }
  s.engine.setMeta('platform_vat_feature', JSON.stringify({ enabled: true, revision: 2, events: [] }));
  await at('2026-09-15T10:00:00Z');
  for (let i = 0; i < 3; i++) await sell([fan, exempt]);
  const fixLine = (await items(off[3]))[0];
  const corrected = taxAmount(fixLine.line_total, 'standard', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-08-01', tin: 'C1' }, '2026-09-08');
  await s.run(s.owner, 'tax.record', { id: uuid(), kind: 'adjustment', date: '2026-09-08', reference: 'ADJ-1', reason: 'Switched-off sale', legalAuthority: 'Original-period output', reconcilesSaleItemId: fixLine.id, vat: corrected.vat, nhil: corrected.nhil, getfund: corrected.getfund, evidenceConfirmed: true });
  await refund(off[3], 1, 1);

  // October: refunds of September's switched-off sales, an external sale and more trade. November: a little more.
  await at('2026-10-05T10:00:00Z');
  await refund(off[0]); await refund(off[1], 2); await refund(aug[3]);
  await refund(late.id); // refund of a sale that should have carried VAT
  await s.run(s.owner, 'tax.record', { id: uuid(), kind: 'external_sale', date: '2026-10-05', reference: 'EXT-1', reason: 'Branch', base: 100_000, vat: 15_000, nhil: 2_500, getfund: 2_500, classification: 'standard', evidenceConfirmed: true });
  for (let d = 6; d < 30; d += 6) { await at(`2026-10-${String(d).padStart(2, '0')}T10:00:00Z`); await sell([fan, zero, exempt, unclassified], 3); }
  await at('2026-11-03T10:00:00Z');
  await refund(off[2]); await sell([fan]);

  let compared = 0;
  for (const month of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']) {
    const full = await s.run(s.owner, 'tax.report', { month, includeRows: true });
    const summary = await s.run(s.owner, 'tax.report', { month });
    expect(summary.sales).toBeUndefined();
    const { sales, refunds, ...rest } = full;
    expect(summary).toEqual({ ...rest, sales: undefined, refunds: undefined });
    expect(summary.lines).toEqual({ sales: sales.length, refunds: refunds.length });
    compared += sales.length + refunds.length;
  }
  // The history really exercised the special cases.
  const sep = await s.run(s.owner, 'tax.report', { month: '2026-09' });
  expect(sep.historicalExposure.length).toBeGreaterThan(0);
  expect((await s.run(s.owner, 'tax.report', { month: '2026-07' })).blockers.join(' ')).toMatch(/legacy\/unclassified/);
  expect((await s.run(s.owner, 'tax.report', { month: '2026-08' })).blockers.join(' ')).toMatch(/without VAT after the legal effective date/);
  expect((await s.run(s.owner, 'tax.report', { month: '2026-10' })).blockers.join(' ')).toMatch(/Historical refund tax is unreconciled/);
  expect(compared).toBeGreaterThan(60);
  expect(s.engine.db.prepare(`SELECT COUNT(*) AS n FROM tax_records WHERE kind = 'adjustment' AND json_extract(payload, '$.reconcilesSaleItemId') IS NOT NULL`).get()).toEqual({ n: 1 });
});
