/**
 * R16-04: automatic VAT registration proven from actual POS sales only. No `tax.configure registered: true`, no
 * external-turnover record and no manual trigger is used. One synthetic shop trades from October 2026 to January 2027:
 *
 *   October  refunds net out of turnover; exempt sales never count; zero-rated sales do; taxable turnover reaches
 *            exactly GHS 750,000.00 (not over: section 6 says "exceeds"); one 1-pesewa sale on 31 October crosses it.
 *   November liability commences on 1 November (section 8: the next period), never on the crossing day; checkout
 *            stops until the TIN is recorded; standard, zero-rated and exempt sales; an input claim; a credit note.
 *   December November is filed and paid in two parts (arrears); a refund of a November sale lands in December and
 *            leaves the filed return untouched; prior-return netting is refused; a GRA-authorised amendment refiles
 *            November and arrears follow the latest filing only. Mansora switches VAT collection off and on again.
 *   January  the switched-off sale is exposure in December (its original period), blocks filing until reconciled with
 *            an authorised original-period adjustment, and is never shown as tax collected.
 *
 * Every expected figure below is computed by hand from Ghana's inclusive rates (VAT 15%, NHIL 2.5%, GETFund 2.5% of
 * the base, so a GHS 120.00 shelf price is base 100.00 + VAT 15.00 + NHIL 2.50 + GETFund 2.50), not by the engine.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defaultTaxConfig } from '../../packages/domain/src';
import { CASHIER, expectCode, login, makeShop, MANAGER, OWNER, uuid, type TestShop } from '../helpers';

let shop: TestShop | undefined;
afterEach(() => shop?.engine.db.close());

const THRESHOLD = 75_000_000; // GHS 750,000.00 in pesewas
const OWNER_APPROVAL = { username: OWNER.username, password: OWNER.password };

describe('R16-04 automatic VAT registration from real POS sales', () => {
  it('crosses the exact boundary, commences at month end and carries through returns, refunds, payments and corrections', async () => {
    let clock = new Date('2026-10-01T08:00:00.000Z');
    const s = (shop = await makeShop({ now: () => clock }));
    const run = s.run;
    /** Move the computer's clock forward and sign everyone in again (sessions do not survive a date change). */
    const at = async (iso: string) => {
      clock = new Date(iso);
      s.owner = await login(s.engine, OWNER); s.manager = await login(s.engine, MANAGER); s.cashier = await login(s.engine, CASHIER);
    };
    const product = async (name: string, price: number, taxClass: 'standard' | 'zero' | 'exempt', stock = 10) =>
      (await run(s.owner, 'product.save', { name, sellingPrice: price, costPrice: 1, openingStock: stock, taxClass })).id as string;
    const generator = await product('Generator 20kVA', 70_000_000, 'standard');
    const cocoa = await product('Cocoa export lot', 5_000_000, 'zero');
    const books = await product('School textbooks', 10_000_000, 'exempt');
    const sweet = await product('Penny sweet', 1, 'standard');
    const fan = await product('Standing fan', 12_000, 'standard');
    // The starter products from makeShop are classified too, so nothing is "unclassified" at filing time.
    for (const [id, name, price] of [[s.products.rice, 'Rice 5kg', 8000], [s.products.milk, 'Milk tin', 1250], [s.products.soap, 'Soap bar', 500]] as const)
      await run(s.owner, 'product.save', { id, name, sellingPrice: price, taxClass: 'standard' });
    const sell = (productId: string, quantity = 1, price = 0) =>
      run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId, quantity }], tenders: [{ method: 'cash', amount: Math.max(price * quantity, 1) * 2 }] });
    const lineOf = async (saleId: string) => (await run(s.cashier, 'sale.get', { id: saleId })).items[0];
    const refund = async (saleId: string, quantity = 1) =>
      run(s.cashier, 'refund.create', { id: uuid(), saleId, reason: 'Synthetic customer return', approver: OWNER_APPROVAL, lines: [{ saleItemId: (await lineOf(saleId)).id, quantity }] });
    const status = () => run(s.owner, 'tax.status');
    const triggers = () => s.engine.db.prepare(`SELECT tax_date, payload FROM tax_records WHERE kind = 'registration_trigger'`).all() as any[];

    // ── October: below the line ──────────────────────────────────────────────────────────────────────────────
    await at('2026-10-03T10:00:00.000Z');
    const returned = await sell(cocoa, 1, 5_000_000);
    expect((await status()).annual.total).toBe(5_000_000);
    await at('2026-10-04T10:00:00.000Z');
    await refund(returned.id);
    expect((await status()).annual.total).toBe(0); // a return takes the supply back out of turnover

    await at('2026-10-10T10:00:00.000Z');
    await sell(books, 1, 10_000_000);
    expect((await status()).annual.total).toBe(0); // exempt supplies never count towards the threshold

    await at('2026-10-15T10:00:00.000Z');
    await sell(cocoa, 1, 5_000_000);       // zero-rated: counts
    const big = await sell(generator, 1, 70_000_000);
    const atLine = await status();
    expect(atLine.annual.total).toBe(THRESHOLD); // exactly GHS 750,000.00
    expect(atLine.annual.exceeded).toBe(false);  // the Act says "exceeds"; equal is not over
    expect(atLine.pendingTrigger).toBeNull();
    expect(atLine.registered).toBe(false);
    expect(JSON.parse((await lineOf(big.id)).tax_snapshot)).toMatchObject({ vat: 0, nhil: 0, getfund: 0, registered: false });

    // One pesewa over, on the last day of the month.
    await at('2026-10-31T21:30:00.000Z');
    const crossing = await sell(sweet, 1, 1);
    expect(JSON.parse((await lineOf(crossing.id)).tax_snapshot).vat).toBe(0); // no VAT on the crossing sale itself
    const over = await status();
    expect(over.annual.total).toBe(THRESHOLD + 1);
    expect(over.annual.exceeded).toBe(true);
    expect(triggers()).toHaveLength(1);
    expect(over.pendingTrigger).toMatchObject({
      trigger: 'annual_turnover', requirementDate: '2026-10-31', effectiveDate: '2026-11-01', applicationDueDate: '2026-11-30',
      annual: THRESHOLD + 1, threshold: THRESHOLD, classificationReview: false,
    });
    expect(over.registered).toBe(false); // not before 1 November
    // The trigger was raised by the cashier's sale, not by anyone editing tax settings.
    const raised = s.engine.db.prepare(`SELECT a.actor_id, u.role FROM audit_logs a JOIN users u ON u.id = a.actor_id WHERE a.action = 'tax.registration_triggered'`).all() as any[];
    expect(raised).toEqual([{ actor_id: expect.any(String), role: 'cashier' }]);
    expect((await run(s.cashier, 'sale.quote', { lines: [{ productId: fan, quantity: 1 }] })).tax.vat).toBe(0);
    // Later sales the same night do not create a second obligation.
    await sell(sweet, 1, 1);
    expect(triggers()).toHaveLength(1);

    // ── November: registered from the first day of the next period ───────────────────────────────────────────
    await at('2026-11-01T08:00:00.000Z');
    const current = await run(s.owner, 'tax.current');
    expect(current).toMatchObject({ registered: true, registrationDate: '2026-11-01' });
    await expectCode(run(s.cashier, 'sale.quote', { lines: [{ productId: fan, quantity: 1 }] }), 'VAT_PROFILE_REQUIRED');
    await expectCode(sell(fan, 1, 12_000), 'VAT_PROFILE_REQUIRED');
    // Recording the TIN is not a registration shortcut: the setting itself stays "automatic, not registered".
    await run(s.owner, 'tax.configure', { ...defaultTaxConfig(), effectiveDate: '2026-11-01', tin: 'C0000750001', vatNumber: 'V-SYNTH-1', reason: 'TIN recorded after the automatic obligation' });
    const configs = (s.engine.db.prepare('SELECT payload FROM tax_configs').all() as any[]).map((r) => JSON.parse(r.payload));
    expect(configs.every((c) => c.registered === false && c.automatic === true)).toBe(true);

    await at('2026-11-02T10:00:00.000Z');
    const fans = await sell(fan, 2, 12_000);               // inclusive GHS 240.00: base 200, VAT 30, NHIL 5, GETFund 5
    expect(JSON.parse((await lineOf(fans.id)).tax_snapshot)).toMatchObject({ classification: 'standard', base: 20_000, vat: 3000, nhil: 500, getfund: 500, registered: true });
    const zero = await sell(cocoa, 1, 5_000_000);
    expect(JSON.parse((await lineOf(zero.id)).tax_snapshot)).toMatchObject({ classification: 'zero', base: 5_000_000, vat: 0, nhil: 0, getfund: 0 });
    const exempt = await sell(books, 1, 10_000_000);
    expect(JSON.parse((await lineOf(exempt.id)).tax_snapshot)).toMatchObject({ classification: 'exempt', vat: 0, nhil: 0, getfund: 0 });

    await at('2026-11-03T10:00:00.000Z');
    // Supplier invoice: base 40.00 + VAT 6.00 + NHIL 1.00 + GETFund 1.00, used for taxable sales.
    await run(s.owner, 'tax.record', { id: uuid(), kind: 'input', date: '2026-11-03', reference: 'SUP-INV-77', reason: 'Fan stock supplier invoice', supplierTin: 'C0000000777', invoiceDate: '2026-11-03', base: 4000, vat: 600, nhil: 100, getfund: 100, evidenceConfirmed: true });
    await at('2026-11-04T10:00:00.000Z');
    await refund(fans.id, 1);                                 // credit note: base 100, VAT 15, NHIL 2.50, GETFund 2.50

    // ── December: file, pay, correct ────────────────────────────────────────────────────────────────────────────
    await at('2026-12-05T09:00:00.000Z');
    const nov = await run(s.owner, 'tax.report', { month: '2026-11' });
    expect(nov.blockers).toEqual([]);
    const bucket = (r: any, tax: string) => r.buckets.find((b: any) => b.tax === tax);
    expect(bucket(nov, 'vat')).toMatchObject({ output: 3000, reversals: 1500, inputs: 600, broughtForward: 0, payable: 900, historicalExposure: 0 });
    expect(bucket(nov, 'nhil')).toMatchObject({ output: 500, reversals: 250, inputs: 100, payable: 150 });
    expect(bucket(nov, 'getfund')).toMatchObject({ output: 500, reversals: 250, inputs: 100, payable: 150 });
    expect(nov.payable).toBe(1200);
    expect(Object.fromEntries(nov.classification.map((c: any) => [c.classification, c.base]))).toEqual({ standard: 10_000, zero: 5_000_000, exempt: 10_000_000, outside: 0 });
    // October was below the line: its return shows nothing payable and no exposure.
    const oct = await run(s.owner, 'tax.report', { month: '2026-10' });
    expect(oct.payable).toBe(0); expect(oct.historicalExposure).toEqual([]);

    const firstFiling = uuid();
    await run(s.owner, 'tax.file', { id: firstFiling, month: '2026-11', reference: 'GRA-RET-2026-11', reason: 'November return submitted', reviewed: true, fiscalEvidenceConfirmed: true, submittedDate: '2026-12-05' });
    await run(s.owner, 'tax.record', { id: uuid(), kind: 'payment', date: '2026-12-05', reference: 'GRA-PAY-1', reason: 'Part payment', amount: 500, period: '2026-11', evidenceConfirmed: true });
    let arrears = (await run(s.owner, 'tax.report', { month: '2026-12' })).arrears;
    expect(arrears.outstanding).toBe(700);
    expect(arrears.rows).toEqual([expect.objectContaining({ month: '2026-11', payable: 1200, paid: 500, outstanding: 700 })]);

    // A later refund of a November sale belongs to December; the filed return is not rewritten.
    await at('2026-12-07T10:00:00.000Z');
    await refund(fans.id, 1);
    const novAgain = await run(s.owner, 'tax.report', { month: '2026-11' });
    expect(novAgain.payable).toBe(1200);
    const decEarly = await run(s.owner, 'tax.report', { month: '2026-12' });
    expect(bucket(decEarly, 'vat')).toMatchObject({ reversals: 1500, payable: 0, carriedForward: 1500 });
    // Netting a November error into December, or backdating evidence into the filed month, is refused.
    await expectCode(run(s.owner, 'tax.record', { id: uuid(), kind: 'adjustment', date: '2026-12-07', reference: 'ADJ-NOV', reason: 'Missed November output', legalAuthority: 'Owner decision', originalPeriod: '2026-11', vat: 100, evidenceConfirmed: true }), 'TAX_ADJUSTMENT_REVIEW_REQUIRED');
    await expectCode(run(s.owner, 'tax.record', { id: uuid(), kind: 'input', date: '2026-11-20', reference: 'LATE-INV', reason: 'Late invoice', supplierTin: 'C0000000778', invoiceDate: '2026-11-20', base: 1000, vat: 150, nhil: 25, getfund: 25, evidenceConfirmed: true }), 'TAX_PERIOD_CLOSED');

    // GRA authorises an amendment: November reopens, the missed output is recorded in November, and it is refiled.
    await at('2026-12-08T10:00:00.000Z');
    await run(s.owner, 'tax.reopen', { id: uuid(), filingId: firstFiling, month: '2026-11', applicationDate: '2026-12-08', approvalReference: 'GRA-AMD-11', legalAuthority: 'Act 1151 s.63 amendment approval', reason: 'Missed output on a manual invoice', approvalConfirmed: true });
    await run(s.owner, 'tax.record', { id: uuid(), kind: 'adjustment', date: '2026-11-30', reference: 'ADJ-NOV-1', reason: 'Manual invoice omitted from POS', legalAuthority: 'GRA-AMD-11', vat: 300, nhil: 50, getfund: 50, evidenceConfirmed: true });
    const amended = await run(s.owner, 'tax.report', { month: '2026-11' });
    expect(amended.payable).toBe(1600);
    await run(s.owner, 'tax.file', { id: uuid(), month: '2026-11', reference: 'GRA-RET-2026-11-A1', reason: 'Amended November return', reviewed: true, fiscalEvidenceConfirmed: true, submittedDate: '2026-12-08' });
    arrears = (await run(s.owner, 'tax.report', { month: '2026-12' })).arrears;
    // Only the latest filing for a month is owed; the superseded GHS 12.00 return is not counted again.
    expect(arrears.rows.filter((r: any) => r.month === '2026-11')).toEqual([expect.objectContaining({ reference: 'GRA-RET-2026-11-A1', payable: 1600, paid: 500, outstanding: 1100, overpaid: 0 })]);
    expect(arrears.outstanding).toBe(1100);
    await run(s.owner, 'tax.record', { id: uuid(), kind: 'payment', date: '2026-12-08', reference: 'GRA-PAY-2', reason: 'Balance', amount: 1100, period: '2026-11', evidenceConfirmed: true });
    expect(((await run(s.owner, 'tax.report', { month: '2026-12' })).arrears).outstanding).toBe(0);

    // Mansora switches VAT collection off, a sale goes through without VAT, then collection is switched back on.
    await at('2026-12-10T10:00:00.000Z');
    s.engine.setMeta('platform_vat_feature', JSON.stringify({ enabled: false, revision: 1, events: [{ revision: 1, id: uuid(), enabled: false, reason: 'Synthetic admin switch-off', occurredAt: clock.toISOString(), adminName: 'Synthetic admin' }] }));
    expect((await status()).registered).toBe(true); // the legal obligation does not switch off
    const suppressed = await sell(fan, 1, 12_000);
    const suppressedLine = await lineOf(suppressed.id);
    expect(JSON.parse(suppressedLine.tax_snapshot)).toMatchObject({ vat: 0, platformVatSuppressed: true, platformPolicyRevision: 1 });
    await at('2026-12-11T10:00:00.000Z');
    s.engine.setMeta('platform_vat_feature', JSON.stringify({ enabled: true, revision: 2, events: [] }));
    const back = await sell(fan, 1, 12_000);
    expect(JSON.parse((await lineOf(back.id)).tax_snapshot).vat).toBe(1500);

    // ── January: exposure stays in December, its original period ──────────────────────────────────────────────
    await at('2027-01-05T09:00:00.000Z');
    const dec = await run(s.owner, 'tax.report', { month: '2026-12' });
    expect(dec.historicalExposure).toEqual([expect.objectContaining({ sourceId: suppressedLine.id, kind: 'sale', date: '2026-12-10', base: 10_000, vat: 1500, nhil: 250, getfund: 250, policyRevision: 1 })]);
    expect(bucket(dec, 'vat')).toMatchObject({ output: 1500, historicalExposure: 1500, reversals: 1500 });
    expect(dec.output.vat).toBe(1500); // only the VAT actually charged on receipts; exposure is not "collected"
    expect(dec.blockers.join(' ')).toMatch(/Historical VAT liability/);
    await expectCode(run(s.owner, 'tax.file', { id: uuid(), month: '2026-12', reference: 'GRA-RET-2026-12', reason: 'December', reviewed: true, fiscalEvidenceConfirmed: true, submittedDate: '2027-01-05' }), 'VAT_RECONCILIATION_REQUIRED');
    expect((await run(s.owner, 'tax.report', { month: '2026-11' })).historicalExposure).toEqual([]); // November untouched

    await run(s.owner, 'tax.record', { id: uuid(), kind: 'adjustment', date: '2026-12-10', reference: 'ADJ-DEC-SUPP', reason: 'Output on the sale made while collection was switched off', legalAuthority: 'Act 1151 inclusive-price output on the original supply', reconcilesSaleItemId: suppressedLine.id, vat: 1500, nhil: 250, getfund: 250, evidenceConfirmed: true });
    const decFixed = await run(s.owner, 'tax.report', { month: '2026-12' });
    expect(decFixed.blockers).toEqual([]);
    expect(decFixed.historicalExposure).toEqual([]);
    // Output 15.00 (receipt) + 15.00 (reconciled adjustment) - 15.00 (December credit note) = VAT 15.00 payable.
    expect(bucket(decFixed, 'vat')).toMatchObject({ output: 1500, adjustments: 1500, reversals: 1500, payable: 1500 });
    expect(decFixed.payable).toBe(2000);
    await run(s.owner, 'tax.file', { id: uuid(), month: '2026-12', reference: 'GRA-RET-2026-12', reason: 'December return', reviewed: true, fiscalEvidenceConfirmed: true, submittedDate: '2027-01-05' });
    expect(((await run(s.owner, 'tax.report', { month: '2026-12' })).arrears).outstanding).toBe(2000);
    // The original receipt is never rewritten.
    expect(JSON.parse((await lineOf(suppressed.id)).tax_snapshot).vat).toBe(0);
  });

  it('commences on the first of the next month when the line is crossed on the first day of a month', async () => {
    let clock = new Date('2026-11-01T00:30:00.000Z');
    const s = (shop = await makeShop({ now: () => clock }));
    const big = (await s.run(s.owner, 'product.save', { name: 'Tractor', sellingPrice: 75_000_001, openingStock: 1, taxClass: 'standard' })).id;
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: big, quantity: 1 }], tenders: [{ method: 'cash', amount: 75_000_001 }] });
    expect((await s.run(s.owner, 'tax.status')).pendingTrigger).toMatchObject({ requirementDate: '2026-11-01', effectiveDate: '2026-12-01', applicationDueDate: '2026-12-01' });
    clock = new Date('2026-11-30T23:59:00.000Z');
    expect((await s.run(await login(s.engine, OWNER), 'tax.current')).registered).toBe(false);
    clock = new Date('2026-12-01T00:00:00.000Z');
    expect((await s.run(await login(s.engine, OWNER), 'tax.current')).registrationDate).toBe('2026-12-01');
  });
});
