/**
 * Regression tests for the November 2026 financial audit (findings F02-F17). Every expected value is worked out
 * by hand from the inputs, never read back from the engine's own reports.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defaultTaxConfig, validateEventRows } from '../../packages/domain/src';
import { chunkRows, EVENT_ROW_BUDGET } from '../../apps/desktop/src/core';
import { stockAsAt } from '../../apps/desktop/src/core/commands/reports';
import { Ctx } from '../../apps/desktop/src/core/engine';
import { expectCode, MANAGER, makeShop, stockOf, uuid, type TestShop } from '../helpers';

let clock = new Date('2026-10-10T10:00:00.000Z');
const now = () => clock;
const at = (iso: string) => { clock = new Date(iso); };
let shop: TestShop;
afterEach(() => shop?.engine.db.close());

async function open(iso = '2026-10-10T10:00:00.000Z') {
  at(iso);
  shop = await makeShop({ now });
  shop.engine.setMeta('lock_minutes', '100000000'); // the clock jumps between months in these tests
  return shop;
}
async function registerVat(s: TestShop, pricing: 'inclusive' | 'exclusive' = 'inclusive') {
  await s.run(s.owner, 'tax.configure', { ...defaultTaxConfig(), effectiveDate: '2026-01-01', registered: true, registrationDate: '2026-01-01', tin: 'C0000000001', vatNumber: 'V0001', pricing, reason: 'Registered' });
  for (const id of Object.values(s.products)) {
    const p = s.engine.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    await s.run(s.owner, 'product.save', { id, name: p.name, sellingPrice: p.selling_price, taxClass: 'standard' });
  }
}
const cashSale = (s: TestShop, productId: string, quantity: number, amount: number) =>
  s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId, quantity }], tenders: [{ method: 'cash', amount }] });

describe('F02 losses are reported beside gross profit', () => {
  it('values damage, count shortages, unsellable returns, cash shortages and debt write-offs', async () => {
    const s = await open('2026-11-05T09:00:00.000Z');
    // Sale: 2 rice at 80.00 = 160.00 revenue, cost 2 x 60.00 = 120.00 -> gross profit 40.00.
    await cashSale(s, s.products.rice, 2, 16_000);
    await s.run(s.owner, 'stock.adjust', { productId: s.products.rice, type: 'DAMAGE', delta: -5, reason: 'Water damage' }); // 5 x 60.00 = 300.00
    await s.run(s.owner, 'stock.count', { lines: [{ productId: s.products.milk, counted: 40 }] }); // 10 x 9.00 = 90.00 missing
    at('2026-11-05T18:00:00.000Z');
    await s.run(s.cashier, 'shift.close', { countedCash: 10_000 + 16_000 - 1500, notes: 'Short' }); // short 15.00
    const p = await s.run(s.owner, 'report.profit', { from: '2026-11-01', to: '2026-11-30' });
    expect(p.grossProfit).toBe(4000);
    expect(p.losses).toMatchObject({ damage: 30_000, stockCount: 9000, corrections: 0, unsellableReturns: 0, cashShortOver: 1500, debtWrittenOff: 0, total: 40_500 });
    expect(p.grossProfitAfterLosses).toBe(4000 - 40_500);
  });

  it('values stock at the end of a past day by replaying movements', async () => {
    const s = await open('2026-11-05T09:00:00.000Z');
    // Rice: 20 opening at 60.00. On 6 Nov receive 10 at 72.00 -> average (20x60 + 10x72)/30 = 64.00.
    at('2026-11-06T09:00:00.000Z');
    await s.run(s.owner, 'purchase.receive', { id: uuid(), reference: 'INV-1', items: [{ productId: s.products.rice, quantity: 10, unitCost: 7200 }] });
    at('2026-11-07T09:00:00.000Z');
    await cashSale(s, s.products.rice, 5, 40_000);
    const ctx = new Ctx(s.engine, 'test', null);
    const end5 = stockAsAt(ctx, '2026-11-05').rows.find((r) => r.productId === s.products.rice)!;
    const end6 = stockAsAt(ctx, '2026-11-06').rows.find((r) => r.productId === s.products.rice)!;
    expect(end5).toMatchObject({ quantity: 20, averageCost: 6000, value: 120_000 });
    expect(end6).toMatchObject({ quantity: 30, averageCost: 6400, value: 192_000 });
    // Replay up to today equals the live valuation.
    const live = await s.run(s.owner, 'report.stock', { from: '2026-11-01', to: '2026-11-07' });
    expect(live.asAt.valuation).toBe(live.valuation);
  });
});

describe('F03 sync payloads always meet the contract', () => {
  it('a stock count adjusting 300 products produces only valid, bounded events', async () => {
    const s = await open('2026-11-11T10:00:00.000Z');
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) ids.push((await s.run(s.owner, 'product.save', { name: `Item ${i}`, sellingPrice: 100, costPrice: 50, openingStock: 10 })).id);
    const before = (s.engine.db.prepare('SELECT MAX(seq) AS m FROM outbox').get() as any).m;
    await s.run(s.owner, 'stock.count', { lines: ids.map((productId) => ({ productId, counted: 9 })) });
    const events = s.engine.db.prepare('SELECT payload FROM outbox WHERE seq > ?').all(before) as any[];
    let movements = 0;
    for (const e of events) { const rows = JSON.parse(e.payload).rows; expect(() => validateEventRows(rows)).not.toThrow(); movements += rows.inventory_movements?.length ?? 0; }
    expect(movements).toBe(300);
  });

  it('splits large commands and keeps every row', () => {
    const rows = { inventory_movements: Array.from({ length: 2500 }, (_, i) => ({ i })), audit_logs: [{ a: 1 }] };
    const chunks = chunkRows(rows as any);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => Object.values(c).flat().length <= EVENT_ROW_BUDGET)).toBe(true);
    expect(chunks.flatMap((c) => Object.values(c).flat()).length).toBe(2501);
  });

  it('repairs an event refused by the server and queues valid replacements', async () => {
    const s = await open('2026-11-11T10:00:00.000Z');
    const big = { id: uuid(), actor_id: null, action: 'stock.count', entity_type: 'stock_count', entity_id: uuid(), detail: JSON.stringify({ x: 'y'.repeat(25_000) }), occurred_at: clock.toISOString() };
    s.engine.db.prepare(`INSERT INTO outbox (id, type, payload, occurred_at, status, last_error) VALUES (?, 'stock.count', ?, ?, 'rejected', 'audit_logs.0.detail: Too big')`).run(uuid(), JSON.stringify({ rows: { audit_logs: [big] } }), clock.toISOString());
    expect((await s.run(s.owner, 'sync.status', {})).rejected).toBe(1);
    await expectCode(s.run(s.manager, 'sync.repairRejected', {}), 'PERMISSION_DENIED');
    const r = await s.run(s.owner, 'sync.repairRejected', {});
    expect(r).toMatchObject({ repaired: 1, queued: 1, stillFailing: [] });
    expect((await s.run(s.owner, 'sync.status', {})).rejected).toBe(0);
    const resent = s.engine.db.prepare(`SELECT payload FROM outbox WHERE type = 'stock.count.resend'`).get() as any;
    expect(() => validateEventRows(JSON.parse(resent.payload).rows)).not.toThrow();
  });
});

describe('F07 accounting periods and clock', () => {
  it('a closed month refuses backdated records; reopening is recorded', async () => {
    const s = await open('2026-10-31T17:00:00.000Z'); // the cashier's shift is opened in October
    at('2026-11-02T09:00:00.000Z');
    await expectCode(s.run(s.owner, 'period.close', { id: uuid(), month: '2026-11', note: 'too early' }), 'PERIOD_NOT_ENDED');
    await expectCode(s.run(s.manager, 'period.close', { id: uuid(), month: '2026-10', note: 'x' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.owner, 'period.close', { id: uuid(), month: '2026-10', note: 'Checked' }), 'OPEN_SHIFTS');
  });

  it('closes, blocks, reopens, and rejects future expenses', async () => {
    const s = await open('2026-11-02T09:00:00.000Z');
    await s.run(s.cashier, 'shift.close', { countedCash: 10_000 });
    await s.run(s.owner, 'period.close', { id: uuid(), month: '2026-10', note: 'Checked with accountant' });
    expect((await s.run(s.owner, 'period.status', {})).closedThrough).toBe('2026-10');
    const expense = (date: string) => s.run(s.owner, 'expense.create', { id: uuid(), category: 'Rent', description: 'Rent', amount: 50_000, expenseDate: date, paymentMethod: 'bank' });
    await expectCode(expense('2026-10-15'), 'PERIOD_CLOSED');
    await expectCode(expense('2026-09-15'), 'PERIOD_CLOSED');
    await expectCode(expense('2027-06-30'), 'INVALID_DATE');
    await expense('2026-11-01');
    await s.run(s.owner, 'period.reopen', { id: uuid(), month: '2026-10', reason: 'Accountant found a missing invoice' });
    expect((await s.run(s.owner, 'period.status', {})).closedThrough).toBe('2026-09');
    await expense('2026-10-15');
    expect(() => s.engine.db.prepare('DELETE FROM ledger_records').run()).toThrow();
  });

  it('refuses sales when the clock goes back past the last transaction, until the owner confirms it', async () => {
    const s = await open('2026-11-12T10:00:00.000Z');
    await cashSale(s, s.products.soap, 1, 500);
    at('2026-08-01T10:00:00.000Z');
    await expectCode(cashSale(s, s.products.soap, 1, 500), 'CLOCK_BEHIND');
    at('2026-11-12T10:03:00.000Z'); // within tolerance of the last transaction is fine
    at('2026-11-12T09:58:00.000Z');
    await cashSale(s, s.products.soap, 1, 500);
    at('2026-11-12T08:00:00.000Z'); // fast clock corrected by two hours
    await expectCode(cashSale(s, s.products.soap, 1, 500), 'CLOCK_BEHIND');
    await s.run(s.owner, 'clock.acknowledge', { reason: 'Clock was two hours fast' });
    await cashSale(s, s.products.soap, 1, 500);
    expect((s.engine.db.prepare(`SELECT COUNT(*) AS n FROM ledger_records WHERE kind = 'clock_override'`).get() as any).n).toBe(1);
  });
});

describe('F05 VAT payments are matched to the return they settle', () => {
  it('a November payment of October tax clears October; arrears follow filed returns', async () => {
    const s = await open('2026-10-10T10:00:00.000Z');
    await registerVat(s);
    // 3 rice at 80.00 inclusive = 240.00; tax = 240 - 240/1.2 = 40.00.
    await cashSale(s, s.products.rice, 3, 24_000);
    at('2026-11-20T10:00:00.000Z');
    await s.run(s.owner, 'tax.file', { id: uuid(), month: '2026-10', reference: 'GRA-ACK-1', reason: 'Filed', reviewed: true, fiscalEvidenceConfirmed: true, submittedDate: '2026-11-20' });
    let oct = await s.run(s.owner, 'tax.report', { month: '2026-10' });
    expect(oct.payable).toBe(4000);
    expect(oct.arrears).toMatchObject({ outstanding: 4000 });
    await s.run(s.owner, 'tax.record', { id: uuid(), kind: 'payment', date: '2026-11-20', reference: 'GRA-PAY-1', reason: 'October return', amount: 2500, evidenceConfirmed: true }); // defaults to October
    oct = await s.run(s.owner, 'tax.report', { month: '2026-10' });
    expect(oct).toMatchObject({ payments: 2500, outstanding: 1500 });
    expect(oct.arrears.rows[0]).toMatchObject({ month: '2026-10', payable: 4000, paid: 2500, outstanding: 1500 });
    expect((await s.run(s.owner, 'tax.report', { month: '2026-11' })).payments).toBe(0);
    await expectCode(s.run(s.owner, 'tax.record', { id: uuid(), kind: 'payment', date: '2026-11-20', reference: 'GRA-PAY-2', reason: 'x', amount: 100, period: '2026-12', evidenceConfirmed: true }), 'INVALID_PERIOD');
  });
});

describe('F06 automatic VAT registration trigger', () => {
  it('fires for an unregistered goods shop whose products are not classified', async () => {
    const s = await open('2026-11-10T10:00:00.000Z');
    const big = (await s.run(s.owner, 'product.save', { name: 'Generator', sellingPrice: 80_000_000, costPrice: 1, openingStock: 3 })).id;
    await s.run(s.owner, 'shift.open', { openingFloat: 0 });
    await s.run(s.owner, 'sale.complete', { id: uuid(), lines: [{ productId: big, quantity: 1 }], tenders: [{ method: 'card', amount: 80_000_000 }] });
    const trig = s.engine.db.prepare(`SELECT payload FROM tax_records WHERE kind = 'registration_trigger'`).all() as any[];
    expect(trig.length).toBe(1);
    expect(JSON.parse(trig[0].payload)).toMatchObject({ effectiveDate: '2026-12-01', classificationReview: true });
  });
});

describe('F09 / F10 purchases', () => {
  it('records input tax once with the goods receipt, at net cost', async () => {
    const s = await open('2026-11-03T10:00:00.000Z');
    await registerVat(s);
    // Supplier invoice: 10 soap at 3.33 net = 33.30; VAT 15% = 5.00 (4.995 rounded by supplier), NHIL 0.83, GETFund 0.83.
    const id = uuid();
    await s.run(s.owner, 'purchase.receive', { id, reference: 'SUP-9', items: [{ productId: s.products.soap, quantity: 10, unitCost: 333 }], inputTax: { supplierTin: 'S-TIN', invoiceDate: '2026-11-01', vat: 500, nhil: 83, getfund: 83, evidenceConfirmed: true } });
    const nov = await s.run(s.owner, 'tax.report', { month: '2026-11' });
    expect(nov.buckets.map((b: any) => b.inputs)).toEqual([500, 83, 83]);
    expect(nov.unclaimedPurchases.length).toBe(0);
    expect((s.engine.db.prepare('SELECT total_cost FROM purchases WHERE id = ?').get(id) as any).total_cost).toBe(3330);
    await expectCode(s.run(s.owner, 'tax.record', { id: uuid(), kind: 'input', date: '2026-11-03', invoiceDate: '2026-11-01', reference: 'SUP-9-again', supplierTin: 'S-TIN', purchaseId: id, base: 3330, vat: 500, nhil: 83, getfund: 83, evidenceConfirmed: true, reason: 'double claim' }), 'DUPLICATE_TAX_INVOICE');
    // A receipt without a claim is flagged in the VAT papers.
    await s.run(s.owner, 'purchase.receive', { id: uuid(), reference: 'SUP-10', items: [{ productId: s.products.soap, quantity: 1, unitCost: 333 }] });
    expect((await s.run(s.owner, 'tax.report', { month: '2026-11' })).unclaimedPurchases.length).toBe(1);
  });

  it('refuses the same supplier invoice twice unless a reason is given', async () => {
    const s = await open('2026-11-03T10:00:00.000Z');
    const receive = (extra = {}) => s.run(s.owner, 'purchase.receive', { id: uuid(), reference: 'INV-77', items: [{ productId: s.products.soap, quantity: 10, unitCost: 333 }], ...extra });
    await receive();
    await expectCode(receive(), 'DUPLICATE_PURCHASE');
    expect(stockOf(s.engine, s.products.soap)).toBe(40);
    await receive({ duplicateReason: 'Supplier reused the waybill number for a second delivery' });
    expect(stockOf(s.engine, s.products.soap)).toBe(50);
  });
});

describe('F11 / F12 / F17 till and debt controls', () => {
  it('needs approval for a reused MoMo reference, counts blind, ages and writes off debt', async () => {
    const s = await open('2026-11-06T10:00:00.000Z');
    const cust = (await s.run(s.owner, 'customer.save', { name: 'Kwame Test', phone: '0244000001' })).id;
    const approver = { username: MANAGER.username, password: MANAGER.password };
    // 105.00 sale: MoMo 30.00 + credit 50.00 + cash 25.00 (50.00 tendered, 25.00 change).
    const sale = await s.run(s.cashier, 'sale.complete', { id: uuid(), customerId: cust, dueDate: '2026-11-10', approver, lines: [{ productId: s.products.rice, quantity: 1 }, { productId: s.products.milk, quantity: 2 }],
      tenders: [{ method: 'momo', amount: 3000, reference: 'MP123' }, { method: 'credit', amount: 5000 }, { method: 'cash', amount: 5000 }] });
    expect(sale.change).toBe(2500);
    await expectCode(s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 1 }], tenders: [{ method: 'momo', amount: 500, reference: 'mp 123' }] }), 'REFERENCE_ALREADY_USED');
    const cur = await s.run(s.cashier, 'shift.current', {});
    expect(cur.totals).toMatchObject({ blind: true, expectedCash: null });
    const closed = await s.run(s.cashier, 'shift.close', { countedCash: 12_000 });
    expect(closed).toMatchObject({ expectedCash: 12_500, variance: -500 }); // float 100.00 + cash 25.00
    // Debt 50.00 due 10 Nov. On 20 Dec it is 40 days overdue.
    at('2026-12-20T10:00:00.000Z');
    let credit = await s.run(s.owner, 'credit.list', {});
    expect(credit.aging).toEqual({ current: 0, d1_30: 0, d31_60: 5000, d61_90: 0, d90plus: 0 });
    const acc = credit.accounts[0];
    await expectCode(s.run(s.manager, 'credit.writeOff', { id: uuid(), creditAccountId: acc.id, amount: 2000, reason: 'x' }), 'PERMISSION_DENIED');
    await s.run(s.owner, 'credit.writeOff', { id: uuid(), creditAccountId: acc.id, amount: 2000, reason: 'Customer moved away; partial recovery unlikely' });
    credit = await s.run(s.owner, 'credit.list', {});
    expect(credit.totalOutstanding).toBe(3000);
    expect(credit.writtenOff).toBe(2000);
    expect((await s.run(s.owner, 'report.profit', { from: '2026-12-01', to: '2026-12-31' })).losses.debtWrittenOff).toBe(2000);
  });
});

describe('F13 report bases are labelled', () => {
  it('reports tax-inclusive takings and tax-exclusive net sales for the same sale', async () => {
    const s = await open('2026-11-05T10:00:00.000Z');
    await registerVat(s, 'exclusive');
    await s.run(s.owner, 'shift.open', { openingFloat: 0 });
    // Rice 80.00 less 10.00 discount = 70.00 base + 20% = 84.00.
    await s.run(s.owner, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 1, discount: 1000 }], tenders: [{ method: 'cash', amount: 8400 }] });
    const r = await s.run(s.owner, 'report.sales', { from: '2026-11-01', to: '2026-11-30' });
    expect(r.totals).toMatchObject({ net: 8400, tax: 1400, netExclTax: 7000 });
    expect((await s.run(s.owner, 'report.profit', { from: '2026-11-01', to: '2026-11-30' })).revenue).toBe(7000);
  });
});

describe('F08 accountant journal export', () => {
  it('balances every journal and ties to the profit, credit and till figures', async () => {
    const s = await open('2026-11-04T09:00:00.000Z');
    await registerVat(s);
    const approver = { username: MANAGER.username, password: MANAGER.password };
    const cust = (await s.run(s.owner, 'customer.save', { name: 'Ama Retail', phone: '0244000002', tin: 'C0012345678' })).id;
    // Sale 1: 2 rice at 80.00 incl. = 160.00 cash. Sale 2: 1 milk 12.50 on credit.
    await cashSale(s, s.products.rice, 2, 16_000);
    const credit = await s.run(s.cashier, 'sale.complete', { id: uuid(), customerId: cust, approver, lines: [{ productId: s.products.milk, quantity: 1 }], tenders: [{ method: 'credit', amount: 1250 }] });
    const sale = await s.run(s.owner, 'sale.get', { id: credit.id });
    await s.run(s.owner, 'shift.open', { openingFloat: 0 });
    await s.run(s.owner, 'refund.create', { id: uuid(), saleId: credit.id, reason: 'Dented', lines: [{ saleItemId: sale.items[0].id, quantity: 1, restock: false }] });
    await s.run(s.owner, 'stock.adjust', { productId: s.products.soap, type: 'DAMAGE', delta: -3, reason: 'Wet' }); // 3 x 3.33 = 9.99
    await s.run(s.owner, 'expense.create', { id: uuid(), category: 'Transport', description: 'Delivery', amount: 700, expenseDate: '2026-11-04', paymentMethod: 'cash', paidFromTill: true });
    at('2026-11-04T18:00:00.000Z');
    await s.run(s.cashier, 'shift.close', { countedCash: 10_000 + 16_000 - 200 }); // 2.00 short
    const j = await s.run(s.owner, 'accounting.journal', { from: '2026-11-01', to: '2026-11-30' });
    expect(j.debits).toBe(j.credits);
    for (const e of j.entries) expect(e.lines.reduce((t: number, l: any) => t + l.debit - l.credit, 0)).toBe(0);
    const net = (a: string) => j.trial.find((t: any) => t.account === a)?.net ?? 0;
    const profit = await s.run(s.owner, 'report.profit', { from: '2026-11-01', to: '2026-11-30' });
    expect(-net('4000')).toBe(profit.revenue);          // sales less refunds, excluding tax
    expect(net('5000')).toBe(profit.cogs);
    expect(net('5100')).toBe(profit.losses.damage + profit.losses.unsellableReturns);
    expect(net('5110')).toBe(profit.losses.cashShortOver);
    expect(net('1100')).toBe(0);                        // 12.50 credit given, fully reduced by the refund
    expect(net('1000')).toBe(16_000 - 700 - 200);       // cash sales - till expense - shortage
    expect(-(net('2100') + net('2110') + net('2120'))).toBe((await s.run(s.owner, 'tax.report', { month: '2026-11' })).payable);
    // F15: the business customer's TIN is on the receipt; the refund has its own credit note.
    expect((await s.run(s.owner, 'sale.receipt', { id: credit.id })).html).toContain('C0012345678');
    const refundId = (s.engine.db.prepare('SELECT id FROM refunds').get() as any).id;
    const note = await s.run(s.owner, 'refund.document', { id: refundId });
    expect(note.html).toContain('CREDIT NOTE'); expect(note.html).toContain(sale.sale.receipt_no); expect(note.html).toContain('Not issued through GRA E-VAT');
    const file = await s.run(s.owner, 'accounting.journalExport', { from: '2026-11-01', to: '2026-11-30' });
    expect(Buffer.from(file.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK');
  });
});

describe('F21 stock count started before sales', () => {
  it('does not count sales made during the count as missing stock', async () => {
    const s = await open('2026-11-08T09:00:00.000Z');
    at('2026-11-08T09:05:00.000Z');
    const startedAt = clock.toISOString();
    at('2026-11-08T09:10:00.000Z');
    await cashSale(s, s.products.milk, 2, 2500); // 50 -> 48 while counting
    at('2026-11-08T09:20:00.000Z');
    await s.run(s.owner, 'stock.count', { startedAt, lines: [{ productId: s.products.milk, counted: 50 }] }); // shelf had 50 at the start
    expect(stockOf(s.engine, s.products.milk)).toBe(48);
    expect((s.engine.db.prepare(`SELECT COUNT(*) AS n FROM inventory_movements WHERE type = 'STOCK_COUNT_ADJUSTMENT'`).get() as any).n).toBe(0);
  });
});

describe('F08 supplier payables', () => {
  it('tracks credit purchases by age, takes part payments from the till and ties to the journal', async () => {
    const s = await open('2026-11-02T09:00:00.000Z');
    await registerVat(s);
    const supplier = (await s.run(s.owner, 'supplier.save', { name: 'Makola Wholesale' })).id;
    // 20 soap at 3.33 net = 66.60, plus input tax 10.00 + 1.67 + 1.67 = 13.34 -> invoice 79.94, due 12 Nov.
    const pid = uuid();
    await expectCode(s.run(s.owner, 'purchase.receive', { id: uuid(), reference: 'MW-1', onCredit: true, items: [{ productId: s.products.soap, quantity: 20, unitCost: 333 }] }), 'SUPPLIER_REQUIRED');
    await s.run(s.owner, 'purchase.receive', { id: pid, supplierId: supplier, reference: 'MW-1', onCredit: true, dueDate: '2026-11-12', items: [{ productId: s.products.soap, quantity: 20, unitCost: 333 }],
      inputTax: { supplierTin: 'MW-TIN', invoiceDate: '2026-11-01', vat: 1000, nhil: 167, getfund: 167, evidenceConfirmed: true } });
    // A purchase paid on receipt is not a payable.
    await s.run(s.owner, 'purchase.receive', { id: uuid(), supplierId: supplier, reference: 'MW-2', items: [{ productId: s.products.soap, quantity: 1, unitCost: 333 }] });
    let p = await s.run(s.owner, 'payable.list', {});
    expect(p.totalOutstanding).toBe(7994);
    expect(p.open.length).toBe(1);
    await expectCode(s.run(s.cashier, 'payable.list', {}), 'PERMISSION_DENIED');
    // Owner pays 30.00 cash from the till; expected cash falls by 30.00.
    await s.run(s.owner, 'shift.open', { openingFloat: 5000 });
    await expectCode(s.run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: pid, amount: 8000, method: 'bank' }), 'INVALID_AMOUNT');
    await s.run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: pid, amount: 3000, method: 'cash', paidFromTill: true });
    expect((await s.run(s.owner, 'shift.current', {})).totals.expectedCash).toBe(5000 - 3000);
    at('2026-11-20T09:00:00.000Z'); // 8 days overdue
    p = await s.run(s.owner, 'payable.list', {});
    expect(p.aging).toEqual({ current: 0, d1_30: 4994, d31_60: 0, d61_90: 0, d90plus: 0 });
    await s.run(s.owner, 'supplier.pay', { id: uuid(), purchaseId: pid, amount: 4994, method: 'bank', reference: 'TRF-88' });
    expect((await s.run(s.owner, 'payable.list', {})).totalOutstanding).toBe(0);
    const j = await s.run(s.owner, 'accounting.journal', { from: '2026-11-01', to: '2026-11-30' });
    expect(j.debits).toBe(j.credits);
    // 2000 trade payables: credited 66.60 + 13.34 (credit purchase), debited 79.94 paid, so nothing is owed, matching
    // payable.list. The 3.33 purchase paid at receipt sits in 2010 for allocation to cash or bank (R16-05).
    expect(j.trial.find((t: any) => t.account === '2000')?.net ?? 0).toBe(0);
    expect(j.trial.find((t: any) => t.account === '2010').net).toBe(-333);
  });
});

describe('F01 E-VAT submission pipeline', () => {
  it('queues every VAT document atomically, submits in order, retries and stamps receipts', async () => {
    const { setEvatProvider, testProvider } = await import('../../apps/desktop/src/core/evat');
    const s = await open('2026-11-05T09:00:00.000Z');
    await registerVat(s);
    await expectCode(s.run(s.owner, 'evat.configure', { mode: 'live', reason: 'go live' }), 'GRA_ONBOARDING_REQUIRED');
    await expectCode(s.run(s.manager, 'evat.configure', { mode: 'test', reason: 'x' }), 'PERMISSION_DENIED');
    await s.run(s.owner, 'evat.configure', { mode: 'test', reason: 'Training before GRA onboarding' });
    // Offline: the provider cannot be reached. Two sales queue; nothing is lost and order is kept.
    let online = false;
    setEvatProvider(s.engine, { id: 'test', submit: (d, h) => (online ? testProvider.submit(d, h) : Promise.reject(new Error('GRA unreachable'))) });
    const a = await cashSale(s, s.products.rice, 1, 8000);
    const b = await cashSale(s, s.products.milk, 2, 2500);
    let r = await s.run(s.owner, 'evat.run', {});
    expect(r).toMatchObject({ accepted: 0, pending: 2, error: 'GRA unreachable' });
    expect((await s.run(s.cashier, 'sale.receipt', { id: a.id })).html).toContain('E-VAT submission pending');
    at('2026-11-06T10:00:00.000Z');
    expect((await s.run(s.owner, 'evat.status', {})).downtimeNoticeRequired).toBe(true);
    online = true;
    r = await s.run(s.owner, 'evat.run', {});
    expect(r).toMatchObject({ accepted: 2, pending: 0 });
    const rows = s.engine.db.prepare(`SELECT document_no, status, fiscal_id, payload FROM evat_submissions ORDER BY created_at`).all() as any[];
    expect(rows.map((x) => x.document_no)).toEqual(['R-000001', 'R-000002']);
    // Document totals come from the immutable snapshots: rice 80.00 incl. = base 66.67, VAT 10.00, NHIL 1.67, GETFund 1.66 (allocated).
    expect(JSON.parse(rows[0].payload).totals).toEqual({ base: 6667, vat: 1000, nhil: 167, getfund: 166, total: 8000 });
    const receipt = (await s.run(s.cashier, 'sale.receipt', { id: a.id })).html;
    expect(receipt).toContain(rows[0].fiscal_id); expect(receipt).toContain('not valid for tax'); expect(receipt).toContain('Not issued through GRA E-VAT');
    expect(() => s.engine.db.prepare(`UPDATE evat_submissions SET fiscal_id = 'X'`).run()).toThrow(/immutable/);
    // A refund queues a credit note referencing the original invoice.
    const sale = await s.run(s.owner, 'sale.get', { id: b.id });
    await s.run(s.owner, 'shift.open', { openingFloat: 0 });
    await s.run(s.owner, 'refund.create', { id: uuid(), saleId: b.id, reason: 'Dented', lines: [{ saleItemId: sale.items[0].id, quantity: 1 }] });
    const cn = s.engine.db.prepare(`SELECT payload FROM evat_submissions WHERE document_type = 'credit_note'`).get() as any;
    expect(JSON.parse(cn.payload)).toMatchObject({ type: 'credit_note', number: 'RF-000001', originalNumber: 'R-000002', totals: { total: 1250 } });
    // Rejection is recorded and can be sent again by the owner.
    setEvatProvider(s.engine, { id: 'test', submit: async () => ({ status: 'rejected', reason: 'Invalid buyer TIN' }) });
    expect(await s.run(s.owner, 'evat.run', {})).toMatchObject({ rejected: 1 });
    const rejected = (await s.run(s.owner, 'evat.status', {})).rejectedDocuments[0];
    setEvatProvider(s.engine, null);
    await s.run(s.owner, 'evat.retry', { id: rejected.id });
    expect(await s.run(s.owner, 'evat.run', {})).toMatchObject({ accepted: 1, pending: 0 });
    // Every outbox event carrying submissions meets the sync contract.
    for (const e of s.engine.db.prepare('SELECT payload FROM outbox').all() as any[]) expect(() => validateEventRows(JSON.parse(e.payload).rows)).not.toThrow();
  });

  it('queues nothing for an unregistered shop or when E-VAT is off, and never half a sale', async () => {
    const s = await open('2026-11-05T09:00:00.000Z');
    s.engine.setMeta('evat_mode', 'test');
    await cashSale(s, s.products.soap, 1, 500);
    expect((s.engine.db.prepare('SELECT COUNT(*) AS n FROM evat_submissions').get() as any).n).toBe(0);
  });
});
