import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { makeShop, type TestShop } from '../helpers';
import { admin, GHS, mkPlan, subscribe } from '../billing/helpers';
import { mansoraExpenseId } from '../../apps/desktop/src/core/mansora-expenses';
import { parseStatementAmount, parseStatementDate, readStatementRows, suggestStatementMapping } from '../../apps/desktop/src/core/statements';

let cloud: Cloud;
let shop: TestShop;
const today = () => new Date().toISOString().slice(0, 10);
const file = (text: string, name = 'statement.csv') => ({ fileName: name, contentBase64: Buffer.from(text).toString('base64') });

beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Statement Mart');
  shop = await makeShop({ fetch: flakyNetwork().fetch, apiUrl: cloud.url, code: client.code });
});
afterAll(() => cloud.close());

describe('reading statement files', () => {
  it('reads Ghanaian statement dates and amounts', () => {
    expect(parseStatementDate('14/11/2026')).toBe('2026-11-14');
    expect(parseStatementDate('2026-11-14 09:12')).toBe('2026-11-14');
    expect(parseStatementDate('14-Nov-2026')).toBe('2026-11-14');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementAmount('1,250.50')).toBe(125050);
    expect(parseStatementAmount('(45.00)')).toBe(-4500);
    expect(parseStatementAmount('GHS 20')).toBe(2000);
    expect(parseStatementAmount('-0.005')).toBe(-1);
    expect(parseStatementAmount('abc')).toBeNull();
  });
});

describe('importing a statement and accepting lines (owner request 2026-11-14)', () => {
  let importId = '';
  it('suggests a match for money in, an expense for money out, and leaves supplier payments to the owner', async () => {
    await shop.run(shop.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.milk, quantity: 2 }], tenders: [{ method: 'momo', amount: 2500, reference: 'MP2611140001' }] });
    await shop.run(shop.owner, 'supplier.save', { name: 'Kofi Wholesale' });
    const d = today().split('-').reverse().join('/');
    const csv = ['Date,Description,Reference,Credit,Debit',
      `${d},Payment received,MP2611140001,25.00,`,
      `${d},ECG prepaid power,TX-9,,30.00`,
      `${d},Transfer to Kofi Wholesale,TX-10,,100.00`,
      `${d},Unknown deposit,TX-11,99.00,`,
      `not a date,Broken line,TX-12,,5.00`].join('\n');
    const p = await shop.run(shop.owner, 'statement.preview', { ...file(csv), source: 'momo' });
    expect(p.needsMapping).toBe(false);
    expect(p.rows.filter((r: any) => r.errors.length)).toHaveLength(1);
    await expect(shop.run(shop.cashier, 'statement.preview', { ...file(csv), source: 'momo' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const r = await shop.run(shop.owner, 'statement.import', { ...file(csv), source: 'momo', mapping: p.mapping });
    expect(r).toMatchObject({ lines: 4, duplicates: 0 });
    // The import's audit entry is queued for the cloud like every other change.
    expect(shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE type = 'statement.import'`).get()).toEqual({ n: 1 });
    importId = r.id;
    const { lines } = await shop.run(shop.owner, 'statement.lines', { importId });
    const kinds = lines.map((l: any) => l.suggestion.kind);
    expect(kinds).toEqual(['confirm', 'expense', 'supplier', 'unmatched']);
    expect(lines[0].suggestion).toMatchObject({ matchType: 'payment', strength: 'reference' });
    expect(lines[1].suggestion).toMatchObject({ category: 'Electricity' });
    await expect(shop.run(shop.owner, 'statement.import', { ...file(csv), source: 'momo', mapping: p.mapping })).rejects.toMatchObject({ code: 'ALREADY_IMPORTED' });
  });

  it('accepts all suggested lines at once, then one line with a chosen category, and ignores another', async () => {
    const { lines } = await shop.run(shop.owner, 'statement.lines', { importId });
    const all = await shop.run(shop.owner, 'statement.accept', { lineIds: lines.map((l: any) => l.id) });
    expect(all).toMatchObject({ accepted: 2, expenses: 1 });
    expect(all.skipped).toHaveLength(2);
    const power = shop.engine.db.prepare(`SELECT * FROM expenses WHERE category = 'Electricity'`).get() as any;
    expect(power).toMatchObject({ amount: 3000, payment_method: 'momo', description: 'ECG prepaid power', receipt_reference: 'TX-9' });

    const supplierLine = lines.find((l: any) => l.suggestion.kind === 'supplier');
    await shop.run(shop.owner, 'statement.accept', { lineIds: [supplierLine.id], categories: { [supplierLine.id]: 'Supplies' } });
    const unknown = lines.find((l: any) => l.suggestion.kind === 'unmatched');
    expect(await shop.run(shop.owner, 'statement.ignore', { lineIds: [unknown.id] })).toEqual({ ignored: 1 });
    const [list] = await shop.run(shop.owner, 'statement.list');
    expect(list).toMatchObject({ pending: 0, accepted: 3, ignored: 1 });
  });

  it('marks lines seen in an earlier statement as duplicates, and reads a single signed amount column', async () => {
    const d = today();
    const csv = ['Date,Description,Transaction ID,Amount,Type', `${d},ECG prepaid power,TX-9,-30.00,Payment`, `${d},Airtime purchase,TX-20,-5.00,Payment`, `${d},Taxi to market,TX-21,-12.00,Payment`].join('\n');
    await shop.run(shop.owner, 'expense.create', { id: randomUUID(), category: 'Transport', description: 'Taxi', amount: 1200, expenseDate: d, paymentMethod: 'momo' });
    const p = await shop.run(shop.owner, 'statement.preview', { ...file(csv, 'second.csv'), source: 'momo' });
    expect(p.mapping).toMatchObject({ date: 'Date', reference: 'Transaction ID', amount: 'Amount', direction: 'Type' });
    const r = await shop.run(shop.owner, 'statement.import', { ...file(csv, 'second.csv'), source: 'momo', mapping: p.mapping });
    expect(r).toMatchObject({ lines: 3, duplicates: 1 });
    const { lines } = await shop.run(shop.owner, 'statement.lines', { importId: r.id });
    // The same ECG transaction appears again in the newer statement: a duplicate, never recorded twice.
    expect(lines.map((l: any) => l.status)).toEqual(['duplicate', 'pending', 'pending']);
    expect(lines[1].suggestion).toMatchObject({ kind: 'expense', category: 'Airtime & data' });
    // A line for an expense already entered by hand that day links to it instead of creating a second one.
    expect(lines[2].suggestion.kind).toBe('linked');
  });

  it('records bank expenses with the bank payment method', async () => {
    await shop.run(shop.owner, 'expense.create', { id: randomUUID(), category: 'Rent', description: 'Shop rent', amount: 50000, expenseDate: today(), paymentMethod: 'bank' });
    expect((shop.engine.db.prepare(`SELECT payment_method FROM expenses WHERE description = 'Shop rent'`).get() as any).payment_method).toBe('bank');
  });
});

describe('MTN Mobile Money statement layout', () => {
  // The columns of an MTN MoMo statement: amounts carry no sign; the balance shows which way money moved.
  const header = ['TRANSACTION DATE', 'FROM ACCT', 'FROM NAME', 'FROM NO.', 'TRANS. TYPE', 'AMOUNT', 'FEES', 'E-LEVY', 'BAL BEFORE', 'BAL AFTER', 'TO NO.', 'TO NAME', 'TO ACCT', 'F_ID', 'REF', 'OVA'];
  const table = [header,
    ['2026-11-10 09:14:02', 'FRI:233241112222/MSISDN', 'AMA MENSAH', '233241112222', 'TRANSFER', '45.00', '0.00', '0.00', '120.00', '165.00', '233249990000', 'MANSORA TSB', 'FRI:233249990000/MSISDN', '61234567890', 'soap', ''],
    ['2026-11-10 16:40:51', 'FRI:233249990000/MSISDN', 'MANSORA TSB', '233249990000', 'TRANSFER', '500.00', '0.00', '5.00', '165.00', '-340.00', '233201234567', 'KOFI WHOLESALE', 'FRI:233201234567/MSISDN', '61234567999', 'stock', ''],
    ['2026-11-11 08:02:10', 'FRI:233249990000/MSISDN', 'MANSORA TSB', '233249990000', 'PAYMENT', '30.00', '0.30', '0.00', '400.00', '369.70', '', 'ECG PREPAID', '', '61234568000', '', ''],
  ];
  it('finds the columns, reads direction from the balance, uses the transaction ID, and separates fees and E-Levy', () => {
    const mapping = suggestStatementMapping(header);
    expect(mapping).toMatchObject({ date: 'TRANSACTION DATE', amount: 'AMOUNT', direction: 'TRANS. TYPE', reference: 'F_ID', balance_before: 'BAL BEFORE', balance_after: 'BAL AFTER', fees: 'FEES', levy: 'E-LEVY', from_name: 'FROM NAME', to_name: 'TO NAME' });
    const rows = readStatementRows(table, mapping);
    expect(rows.map((r) => [r.lineNo, r.date, r.description, r.reference, r.amountIn, r.amountOut])).toEqual([
      [2, '2026-11-10', 'TRANSFER AMA MENSAH', '61234567890', 4500, 0],
      [3, '2026-11-10', 'TRANSFER KOFI WHOLESALE', '61234567999', 0, 50000],
      [3, '2026-11-10', 'Charges (E-Levy) on line 3', '61234567999', 0, 500],
      [4, '2026-11-11', 'PAYMENT ECG PREPAID', '61234568000', 0, 3000],
      [4, '2026-11-11', 'Charges (fees) on line 4', '61234568000', 0, 30],
    ]);
    expect(rows.every((r) => !r.errors.length)).toBe(true);
  });
  it('does not treat a lone running balance as a direction', () => {
    expect(suggestStatementMapping(['Date', 'Description', 'Debit', 'Credit', 'Balance']).balance_after).toBeUndefined();
  });
});

describe('statement review fixes', () => {
  it('reads "Payment received" as money in, rejects bare numbers as dates, and keeps two identical genuine lines', async () => {
    expect(parseStatementDate('12')).toBeNull();
    const d = today();
    const csv = ['Date,Description,Amount,Type', `${d},From customer,25.00,Payment Received`, `${d},ATM withdrawal,100.00,Debit`, `${d},ATM withdrawal,100.00,Debit`, `12,Total,225.00,`].join('\n');
    const p = await shop.run(shop.owner, 'statement.preview', { ...file(csv, 'review.csv'), source: 'bank' });
    const good = p.rows.filter((r: any) => !r.errors.length);
    expect(good.map((r: any) => [r.amountIn, r.amountOut])).toEqual([[2500, 0], [0, 10000], [0, 10000]]);
    const r = await shop.run(shop.owner, 'statement.import', { ...file(csv, 'review.csv'), source: 'bank', mapping: p.mapping });
    expect(r).toMatchObject({ lines: 3, duplicates: 0 });
    // The same two withdrawals in a later statement are recognised as the same two transactions.
    const again = await shop.run(shop.owner, 'statement.import', { ...file(csv + '\n', 'review-again.csv'), source: 'bank', mapping: p.mapping });
    expect(again).toMatchObject({ duplicates: 3 });
    const [latest] = await shop.run(shop.owner, 'statement.list');
    expect(latest).toMatchObject({ total_in: 0, total_out: 0 }); // duplicates are not counted again
  });

  it('links a refund paid out by Mobile Money instead of suggesting a new expense', async () => {
    const sale = await shop.run(shop.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.soap, quantity: 1 }], tenders: [{ method: 'momo', amount: 500, reference: 'MP-R1' }] });
    const full = await shop.run(shop.owner, 'sale.get', { id: sale.id });
    await shop.run(shop.manager, 'refund.create', { id: randomUUID(), saleId: sale.id, reason: 'Damaged', payoutMethod: 'momo', lines: [{ saleItemId: full.items[0].id, quantity: 1, restock: false }] });
    const csv = ['Date,Description,Debit', `${today()},Refund to customer,5.00`].join('\n');
    const p = await shop.run(shop.owner, 'statement.preview', { ...file(csv, 'refund.csv'), source: 'momo' });
    const r = await shop.run(shop.owner, 'statement.import', { ...file(csv, 'refund.csv'), source: 'momo', mapping: p.mapping });
    const { lines } = await shop.run(shop.owner, 'statement.lines', { importId: r.id });
    expect(lines[0].suggestion).toMatchObject({ kind: 'linked', matchType: 'refund' });
  });

  it('links to an expense typed in by hand after the import instead of recording it again', async () => {
    const before = (shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as any).n;
    const d = today();
    const csv = ['Date,Description,Reference,Debit', `${d},Water bill,W-1,61.00`].join('\n');
    const p = await shop.run(shop.owner, 'statement.preview', { ...file(csv, 'water.csv'), source: 'bank' });
    const imp = await shop.run(shop.owner, 'statement.import', { ...file(csv, 'water.csv'), source: 'bank', mapping: p.mapping });
    const line = (await shop.run(shop.owner, 'statement.lines', { importId: imp.id })).lines[0];
    expect(line.suggestion.kind).toBe('expense');
    await shop.run(shop.owner, 'expense.create', { id: randomUUID(), category: 'Water', description: 'GWCL', amount: 6100, expenseDate: d, paymentMethod: 'bank' });
    const r = await shop.run(shop.owner, 'statement.accept', { lineIds: [line.id] });
    expect(r).toMatchObject({ accepted: 1, expenses: 0 });
    expect((shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as any).n).toBe(before + 1);
  });
});

describe('payments to Mansora appear in the shop\'s expenses', () => {
  it('records each payment once, as a Mansora subscription expense, after a sync', async () => {
    const tenantId = shop.engine.meta('tenant_id')!;
    const plan = await mkPlan(cloud, { price: GHS(199) });
    const s = await subscribe(cloud, tenantId, plan);
    let invoiceId = s.invoiceId;
    if (!invoiceId) invoiceId = (await cloud.db.platform((q) => q(`SELECT id FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenantId])))[0].id;
    const pay = await admin(cloud).post(`/invoices/${invoiceId}/payment`, { amount: GHS(199), method: 'momo', reference: 'MOMO-123' });
    expect(pay.status).toBe(200);
    await shop.run(shop.owner, 'sync.run', {});
    const rows = shop.engine.db.prepare(`SELECT * FROM expenses WHERE category = 'Mansora subscription'`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: GHS(199), payment_method: 'momo' });
    expect(rows[0].description).toContain('Mansora Sales & Stock subscription');
    const [paymentId] = (await cloud.db.platform((q) => q(`SELECT id FROM billing_payments WHERE tenant_id = $1`, [tenantId]))).map((r: any) => r.id);
    expect(rows[0].id).toBe(mansoraExpenseId(paymentId));
    await shop.run(shop.owner, 'sync.run', {});
    expect(shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM expenses WHERE category = 'Mansora subscription'`).get()).toEqual({ n: 1 });
  });
});
