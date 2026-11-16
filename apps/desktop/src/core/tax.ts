import { addTax, defaultTaxConfig, fail, mulDivRound, priceCart, sum, taxCart, taxConfigSchema, taxAmount, refundTax, type VatFeaturePolicy, type TaxClass, type TaxSnapshot } from '@mansora/domain';
import { addMonths, eligibleInputBps } from './tax-controls';
import type { Ctx } from './engine';

function rawTaxConfig(ctx: Ctx, date: string) {
  const row = ctx.get("SELECT payload FROM tax_configs WHERE effective_date <= ? ORDER BY effective_date DESC, COALESCE(json_extract(payload,'$.revision'),0) DESC, created_at DESC, id DESC LIMIT 1",date);
  return row ? taxConfigSchema.parse(JSON.parse(row.payload)) : defaultTaxConfig();
}
function triggerApplies(ctx: Ctx, trigger: any, date: string) {
  if (trigger.effectiveDate > date) return false;
  if (trigger.trigger !== 'forecast') return true;
  // The general forward test is assessed at month end. A forecast withdrawn before then is not sticky liability.
  const end = new Date(trigger.effectiveDate + 'T00:00:00Z'); end.setUTCDate(0);
  const config = rawTaxConfig(ctx,end.toISOString().slice(0,10));
  return config.forecast > config.threshold && (config.supplyType === 'goods' || (config.serviceThresholdConfirmed && !!config.serviceThresholdDate && config.serviceThresholdDate <= end.toISOString().slice(0,10)));
}
export function taxConfig(ctx: Ctx, date = ctx.now().slice(0,10)) {
  const config = rawTaxConfig(ctx,date);
  if (config.automatic) {
    const trigger = ctx.all("SELECT payload FROM tax_records WHERE kind = 'registration_trigger' AND tax_date <= ? ORDER BY tax_date, created_at, id",date).map(r=>JSON.parse(r.payload)).find(t=>triggerApplies(ctx,t,date));
    if (trigger && (!config.registered || !config.registrationDate || trigger.effectiveDate < config.registrationDate)) return { ...config, registered: true, registrationDate: trigger.effectiveDate };
  }
  return config;
}
export const registeredOn = (config: ReturnType<typeof taxConfig>, date: string) => config.registered && !!config.registrationDate && config.registrationDate <= date;
export function vatFeature(ctx: Ctx): VatFeaturePolicy {
  return JSON.parse(ctx.setting('platform_vat_feature') ?? '{"enabled":true,"revision":0,"events":[]}');
}
export function collectionTaxConfig(ctx: Ctx) {
  const config = taxConfig(ctx);
  return vatFeature(ctx).enabled ? config : { ...config, registered:false };
}
export function quoteSale(ctx: Ctx, lines: { productId: string; quantity: number; discount: number }[], discount: number) {
  const config = taxConfig(ctx), feature = vatFeature(ctx), date = ctx.now().slice(0, 10);
  if (date < '2026-01-01') fail('TAX_PERIOD_UNSUPPORTED', 'Configure historical VAT rules before recording sales before 2026');
  const products = lines.map(l => {
    const p = ctx.get('SELECT * FROM products WHERE id = ? AND active = 1', l.productId);
    if (!p) fail('PRODUCT_UNAVAILABLE', 'A product in the basket is no longer available');
    if (feature.enabled && config.registered && config.registrationDate! <= date && !config.tin) fail('VAT_PROFILE_REQUIRED', 'VAT is legally due. Record the business TIN and registration details in Ghana VAT settings before issuing invoices.');
    if (feature.enabled && config.registered && config.registrationDate! <= date && !p.tax_class) fail('TAX_CLASS_REQUIRED', `Choose a VAT classification for ${p.name} in Products`);
    return p;
  });
  const cart = priceCart(lines.map((l, i) => ({ ...l, unitPrice: products[i].selling_price })), discount);
  const priced = taxCart(cart, products.map(p => (p.tax_class ?? 'standard') as TaxClass), collectionTaxConfig(ctx), date);
  return { ...priced, snapshots: priced.snapshots.map((t, i) => ({ ...t, classificationVerified: !!products[i].tax_class, ...(!feature.enabled ? { platformVatSuppressed:true, platformPolicyRevision:feature.revision, legalConfig:config } : {}) })), config };
}
export const monthsBefore = (date: string, months: number) => addMonths(date, -months);
export function taxStatus(ctx: Ctx) {
  const date = ctx.now().slice(0, 10), config = taxConfig(ctx);
  const rows = ctx.all('SELECT s.created_at, i.line_total, i.tax_snapshot FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at >= ? AND s.created_at <= ?', monthsBefore(date, 12) + 'T00:00:00.000Z', ctx.now());
  const returns = ctx.all('SELECT r.created_at, i.amount AS line_total, i.tax_snapshot FROM refund_items i JOIN refunds r ON r.id = i.refund_id WHERE r.created_at >= ? AND r.created_at <= ?', monthsBefore(date, 12) + 'T00:00:00.000Z', ctx.now());
  const external = ctx.all("SELECT * FROM tax_records WHERE kind IN ('turnover','external_sale') AND tax_date >= ? AND tax_date <= ?", monthsBefore(date, 12), date);
  const windows = [1, 3, 6, 12].map(months => {
    const start = monthsBefore(date, months);
    const cutoff = start + 'T23:59:59.999Z';
    const value = (r: any) => {
      const t = r.tax_snapshot ? JSON.parse(r.tax_snapshot) as TaxSnapshot : null;
      return t ? ['standard', 'zero'].includes(t.classification) ? t.base : 0 : r.line_total;
    };
    const local = sum([...rows.filter(r => r.created_at >= cutoff).map(value), ...returns.filter(r => r.created_at >= cutoff).map(r => -value(r))]);
    const total = sum([local, ...external.filter(r => r.tax_date + 'T00:00:00.000Z' >= cutoff).filter(r => !external.some(x => x.kind === 'external_sale' && JSON.parse(x.payload).reconcilesTurnoverId === r.id)).map(r => { const d = JSON.parse(r.payload); return ['exempt','outside'].includes(d.classification) ? 0 : d.base; })]);
    const limit = mulDivRound(config.threshold, months, 12);
    return { months, start, total, threshold: limit, exceeded: total > limit, near: BigInt(total) * 10000n >= BigInt(limit) * BigInt(config.alertBps) };
  });
  const annual = windows[3];
  const threeMonthForecast = windows[1].exceeded && sum([windows[1].total, config.forecastNineMonths]) > config.threshold;
  const amendmentReviewRequired = config.supplyType !== 'goods' && (!config.serviceThresholdConfirmed || !config.serviceThresholdDate || !config.serviceThresholdAuthority || config.serviceThresholdDate > date);
  const requiresReview = amendmentReviewRequired || threeMonthForecast || config.mandatoryRegistration || annual.exceeded || config.forecast > config.threshold || windows.some(w => w.exceeded) || (config.supplyType !== 'goods' && !config.serviceThresholdConfirmed);
  const registered = config.registered && !!config.registrationDate && config.registrationDate <= date;
  return { config, feature:vatFeature(ctx), registered, amendmentReviewRequired, windows, annual, forecast: config.forecast, requiresReview, near: windows.some(w => w.near),
    legacyLines: rows.filter(r => !r.tax_snapshot || JSON.parse(r.tax_snapshot).classificationVerified === false).length,
    /** Lines with no tax snapshot at all (recorded before VAT support): their value cannot be verified. */
    unverifiedLines: rows.filter(r => !r.tax_snapshot).length,
    /** Lines from products without a VAT class: counted as taxable, which is the conservative reading. */
    unclassifiedLines: rows.filter(r => r.tax_snapshot && JSON.parse(r.tax_snapshot).classificationVerified === false).length,
    unclassified: ctx.get('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND tax_class IS NULL')!.n,
    pendingTrigger: ctx.all("SELECT payload FROM tax_records WHERE kind = 'registration_trigger' ORDER BY tax_date LIMIT 1").map(r => JSON.parse(r.payload))[0] ?? null,
    message: !vatFeature(ctx).enabled ? 'VAT collection is disabled by Mansora. Legal liability continues; historical exposure is retained for reconciliation. Ask your Mansora administrator to enable the feature.' : amendmentReviewRequired ? 'Service VAT amendment needs confirmation. Ask the owner to obtain the enacted commencement date or written GRA clarification, then record the date and source in Tax settings. Existing VAT obligations continue.' : registered ? 'VAT is applied automatically from the legal effective date. Complete GRA registration if still pending.' : requiresReview ? 'VAT registration review required. Confirm the legal effective date; threshold alerts do not create a registration.' : windows.some(w => w.near) ? 'Approaching a VAT turnover band. Review forecast turnover and prepare registration.' : 'Monitoring taxable turnover. Add sales from other branches and channels.' };
}

type Component = 'vat' | 'nhil' | 'getfund';
const components: Component[] = ['vat', 'nhil', 'getfund'];
const monthOf = (r: { tax_date: string; data: any }) => (/^\d{4}-\d{2}$/.test(String(r.data?.period ?? '')) ? String(r.data.period) : r.tax_date.slice(0, 7));

/** Payments to GRA, each allocated to the return period it settles (audit F05). Older records without a period
 *  are allocated by payment date, as before, and flagged so the owner can see them. */
export function taxPayments(ctx: Ctx) {
  return ctx.all("SELECT * FROM tax_records WHERE kind = 'payment' ORDER BY tax_date, created_at, rowid").map((r) => {
    const data = JSON.parse(r.payload);
    return { id: r.id, reference: r.reference, paidOn: r.tax_date, amount: Number(data.amount) || 0, period: monthOf({ tax_date: r.tax_date, data }), allocatedByDate: !data.period };
  });
}

/** Filed returns with what was payable, what has been paid against each, and what is still owed. */
export function taxArrears(ctx: Ctx) {
  const payments = taxPayments(ctx);
  // R16-04: an amended return supersedes the original for its month; only the latest filing is owed.
  const latest = new Map<string, { month: string; reference: string; payable: number }>();
  for (const r of ctx.all("SELECT tax_date, reference, payload FROM tax_records WHERE kind = 'filing' ORDER BY tax_date, COALESCE(json_extract(payload,'$.sequence'),0), created_at, id"))
    latest.set(r.tax_date.slice(0, 7), { month: r.tax_date.slice(0, 7), reference: r.reference, payable: Number(JSON.parse(r.payload).payable) || 0 });
  const filings = [...latest.values()];
  const rows = filings.map((f) => {
    const paid = sum(payments.filter((p) => p.period === f.month).map((p) => p.amount));
    return { ...f, paid, outstanding: Math.max(0, f.payable - paid), overpaid: Math.max(0, paid - f.payable) };
  });
  const filed = new Set(filings.map((f) => f.month));
  const unmatched = payments.filter((p) => !filed.has(p.period));
  return { rows, outstanding: sum(rows.map((r) => r.outstanding)), overpaid: sum(rows.map((r) => r.overpaid)), unmatchedPayments: unmatched };
}

/** Evidence schedule. Captured snapshots, never today's rates, drive both returns and credit notes. */
export function vatReport(ctx: Ctx, month: string) {
  const from = month + '-01', next = new Date(from + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
  const to = next.toISOString().slice(0, 10);
  const end = new Date(next); end.setUTCDate(end.getUTCDate() - 1);
  const reportDate = to > ctx.now().slice(0,10) ? ctx.now().slice(0,10) : end.toISOString().slice(0,10);
  const config = taxConfig(ctx,reportDate);
  const sales = ctx.all(`SELECT i.id AS sale_item_id, s.id, s.receipt_no AS reference, s.created_at AS date, s.tax_snapshot AS invoice_tax, i.product_name, i.tax_snapshot, i.line_total FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at < ? ORDER BY s.created_at, s.rowid, i.rowid`, to + 'T00:00:00.000Z');
  const refunds = ctx.all(`SELECT i.id AS refund_item_id, i.sale_item_id, s.created_at AS sale_date, r.id, r.refund_no AS reference, r.created_at AS date, s.receipt_no AS original_reference, i.tax_snapshot, i.amount AS line_total FROM refund_items i JOIN refunds r ON r.id = i.refund_id JOIN sales s ON s.id = r.sale_id WHERE r.created_at < ? ORDER BY r.created_at, r.rowid, i.rowid`, to + 'T00:00:00.000Z');
  const records = ctx.all("SELECT * FROM tax_records WHERE tax_date < ? ORDER BY tax_date, COALESCE(json_extract(payload,'$.sequence'),0), created_at, id", to).map(r => ({ ...r, data: JSON.parse(r.payload) }));
  for (const r of records.filter(r => r.kind === 'external_sale')) {
    const d = r.data;
    const t = { base: d.base, vat: d.vat, nhil: d.nhil, getfund: d.getfund, total: sum([d.base,d.vat,d.nhil,d.getfund]), classification: d.classification, classificationVerified: true, registered: d.registeredAtSupply ?? registeredOn(taxConfig(ctx,r.tax_date),r.tax_date) };
    sales.push({ id: r.id, reference: r.reference, date: r.tax_date + 'T00:00:00.000Z', product_name: 'External sale: ' + d.reason, invoice_tax: null, tax_snapshot: JSON.stringify(t), line_total: t.total });
  }
  const reconciledLines = new Map(records.filter(r=>r.kind==='adjustment' && r.data.reconcilesSaleItemId && r.data.reconciledSale).map(r=>[r.data.reconcilesSaleItemId,r.data.reconciledSale]));
  // Derive exposure from the legal configuration captured at supply, never rewrite an invoice or invent collection.
  const historicalExposure: any[] = [];
  const exposureLines = new Map<string,any>(), exposureRefunds = new Map<string,any>();
  const originalByLine = new Map(sales.filter(r=>r.sale_item_id).map(r=>[r.sale_item_id,r]));
  for (const r of sales) {
    const t = r.tax_snapshot && JSON.parse(r.tax_snapshot);
    if (!t?.platformVatSuppressed || !t.classificationVerified || reconciledLines.has(r.sale_item_id)) continue;
    const expected = taxAmount(r.line_total,t.classification,t.legalConfig?.registered ? t.legalConfig : taxConfig(ctx,r.date.slice(0,10)),r.date.slice(0,10));
    exposureLines.set(r.sale_item_id,expected);
    if (expected.vat || expected.nhil || expected.getfund) historicalExposure.push({sourceId:r.sale_item_id,reference:r.reference,date:r.date.slice(0,10),kind:'sale',policyRevision:t.platformPolicyRevision,base:expected.base,...Object.fromEntries(components.map(k=>[k,expected[k]-t[k]]))});
  }
  const refunded = new Map<string,number>();
  for (const r of refunds) {
    const original = originalByLine.get(r.sale_item_id), t = original?.tax_snapshot && JSON.parse(original.tax_snapshot);
    if (!t?.platformVatSuppressed || !t.classificationVerified || reconciledLines.has(r.sale_item_id)) continue;
    const expected=taxAmount(original.line_total,t.classification,t.legalConfig?.registered ? t.legalConfig : taxConfig(ctx,original.date.slice(0,10)),original.date.slice(0,10));
    const previous=refunded.get(r.sale_item_id) ?? 0; refunded.set(r.sale_item_id,previous+r.line_total);
    const prior=mulDivRound(previous,expected.total,original.line_total), cumulative=mulDivRound(previous+r.line_total,expected.total,original.line_total);
    const reversal=refundTax(expected,prior,cumulative-prior), actual=r.tax_snapshot ? JSON.parse(r.tax_snapshot) : {vat:0,nhil:0,getfund:0};
    exposureRefunds.set(r.refund_item_id,{...reversal,classification:t.classification});
    if (reversal.vat || reversal.nhil || reversal.getfund) historicalExposure.push({sourceId:r.refund_item_id,reference:r.reference,date:r.date.slice(0,10),kind:'refund',policyRevision:t.platformPolicyRevision,base:-reversal.base,...Object.fromEntries(components.map(k=>[k,-reversal[k]+actual[k]]))});
  }
  const classificationOf = (r: any) => reconciledLines.get(r.sale_item_id) ?? exposureLines.get(r.sale_item_id) ?? (r.tax_snapshot ? JSON.parse(r.tax_snapshot) : null);
  const movements: { month: string; vat: number; nhil: number; getfund: number }[] = [];
  for (const [rows, sign] of [[sales, 1], [refunds, -1]] as const) for (const r of rows) {
    const t = r.tax_snapshot ? JSON.parse(r.tax_snapshot) : null;
    if (t) movements.push({ month: r.date.slice(0, 7), vat: sign * t.vat, nhil: sign * t.nhil, getfund: sign * t.getfund });
  }
  for (const r of records) if (['input', 'withholding', 'adjustment', 'opening_credit'].includes(r.kind)) {
    movements.push({ month: r.tax_date.slice(0, 7), ...Object.fromEntries(components.map(k => [k, (r.kind === 'adjustment' ? 1 : -1) * (r.data[k] ?? 0)])) } as any);
  }
  for (const e of historicalExposure) movements.push({month:e.date.slice(0,7),vat:e.vat,nhil:e.nhil,getfund:e.getfund});
  const priorMonths = [...new Set(movements.map(r => r.month).filter(m => m < month))].sort();
  const carry = { vat: 0, nhil: 0, getfund: 0 };
  for (const m of priorMonths) for (const k of components) carry[k] = Math.max(0, carry[k] - sum(movements.filter(r => r.month === m).map(r => r[k])));
  const selectedSales = sales.filter(r => r.date.slice(0, 7) === month), selectedRefunds = refunds.filter(r => r.date.slice(0, 7) === month);
  const output = addTax(selectedSales.filter(r => r.tax_snapshot).map(r => JSON.parse(r.tax_snapshot)));
  const reversed = addTax(selectedRefunds.filter(r => r.tax_snapshot).map(r => JSON.parse(r.tax_snapshot)));
  const currentRecords = records.filter(r => r.tax_date.slice(0, 7) === month);
  const buckets = components.map(k => {
    const inputs = sum(currentRecords.filter(r => r.kind === 'input' || r.kind === 'opening_credit').map(r => r.data[k] ?? 0));
    const withholding = sum(currentRecords.filter(r => r.kind === 'withholding').map(r => r.data[k] ?? 0));
    const adjustments = sum(currentRecords.filter(r => r.kind === 'adjustment').map(r => r.data[k] ?? 0));
    const exposure = sum(historicalExposure.filter(e=>e.date.slice(0,7)===month).map(e=>e[k]));
    const balance = sum([output[k], exposure, -reversed[k], adjustments, -inputs, -withholding, -carry[k]]);
    return { tax: k, output: output[k], historicalExposure:exposure, reversals: reversed[k], inputs, withholding, adjustments, broughtForward: carry[k], payable: Math.max(0, balance), carriedForward: Math.max(0, -balance) };
  });
  const classification = ['standard', 'zero', 'exempt', 'outside'].map(kind => ({ classification: kind, base: sum([
    ...selectedSales.filter(r => classificationOf(r)?.classification === kind).map(r => classificationOf(r).base),
    ...selectedRefunds.filter(r => (exposureRefunds.get(r.refund_item_id) ?? (r.tax_snapshot && JSON.parse(r.tax_snapshot)))?.classification === kind).map(r => -(exposureRefunds.get(r.refund_item_id) ?? JSON.parse(r.tax_snapshot)).base),
  ]) }));
  const payable = sum(buckets.map(b => b.payable));
  // Payments are matched to the return period they settle, not to the month they were made in (audit F05).
  const paymentRows = taxPayments(ctx).filter((p) => p.period === month);
  const payments = sum(paymentRows.map((p) => p.amount));
  const blockers: string[] = [];
  if (!vatFeature(ctx).enabled) blockers.push('Mansora has disabled the VAT collection feature. Enable it and reconcile historical liability before recording a filing.');
  if (historicalExposure.length) blockers.push('Historical VAT liability from disabled collection affects this return or its prior balances. Reconcile original periods and fiscal documents before filing; estimated exposure is not tax collected.');
  if (!registeredOn(config,reportDate) || !config.tin) blockers.push('Confirm VAT registration and the business TIN for this period.');
  if ([...selectedSales,...selectedRefunds].some(r => !reconciledLines.has(r.sale_item_id) && (!r.tax_snapshot || JSON.parse(r.tax_snapshot).classificationVerified === false))) blockers.push('Reconcile legacy/unclassified financial transactions before filing.');
  if (selectedSales.some(r => {
    if (!r.tax_snapshot || reconciledLines.has(r.sale_item_id)) return false;
    const t = JSON.parse(r.tax_snapshot), c = taxConfig(ctx,r.date.slice(0,10));
    return registeredOn(c,r.date.slice(0,10)) && t.classification === 'standard' && !t.registered;
  })) blockers.push('Sales were recorded without VAT after the legal effective date. Reconcile the original period with documented corrections before filing.');
  if (selectedRefunds.some(r => {
    const t = r.tax_snapshot && JSON.parse(r.tax_snapshot);
    return t && t.classification === 'standard' && !t.registered && registeredOn(taxConfig(ctx,r.sale_date.slice(0,10)),r.sale_date.slice(0,10));
  })) blockers.push('Historical refund tax is unreconciled for a sale subject to VAT. Obtain original-period GRA review; do not deduct invented credit-note tax.');
  const reconciled = new Set(records.filter(r => r.kind === 'external_sale').map(r => r.data.reconcilesTurnoverId));
  if (currentRecords.some(r => r.kind === 'turnover' && registeredOn(taxConfig(ctx,r.tax_date),r.tax_date) && !reconciled.has(r.id))) blockers.push('External taxable turnover is missing from the VAT output schedule; reconcile it as an external sale.');
  for (const r of records.filter(r => r.kind === 'input')) {
    const d = r.data, accrued = d.accrualDate ?? d.invoiceDate;
    if (!accrued || !d.base || r.tax_date > addMonths(accrued,6)) { blockers.push('An input credit affecting this return has missing evidence or exceeds the exact six-month claim limit: ' + r.reference); continue; }
    try { eligibleInputBps({ eligibleBps: d.eligibleBps ?? 10000, attribution: d.attribution ?? 'direct_taxable', inputCategory: d.inputCategory ?? 'ordinary', exceptionConfirmed: d.exceptionConfirmed ?? false, financialInstitution: d.financialInstitution ?? false }); }
    catch { blockers.push('A blocked input category affects this return: ' + r.reference); }
  }
  const warnings = ['Working papers for review and filing through GRA. This is not an E-VAT-certified invoice or an electronically submitted return.', 'Confirm the last working day of the following month against Ghana public holidays and GRA notices.'];
  if ([...selectedSales, ...selectedRefunds].some(r => !r.tax_snapshot || JSON.parse(r.tax_snapshot).classificationVerified === false)) warnings.push('Legacy transactions lack VAT snapshots. Reconcile them before filing; no historical tax has been invented.');
  if (!config.registered) warnings.push('Business is not configured as VAT registered for this period.');
  if (ctx.get<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND tax_class IS NULL')!.n) warnings.push('Some active products still need tax classification.');
  if (paymentRows.some((p) => p.allocatedByDate)) warnings.push('Some GRA payments were recorded without a return period and are matched by payment date. Check they belong to this return.');
  // Audit F09: goods received while registered with no linked input claim. Either the supplier invoice carried no
  // recoverable tax, or the claim has not been recorded (or the tax was wrongly included in the stock cost).
  const [fromTs, toTs] = [from + 'T00:00:00.000Z', to + 'T00:00:00.000Z'];
  const unclaimed = config.registered ? ctx.all(`SELECT p.id, p.reference, p.received_at, p.total_cost FROM purchases p WHERE p.received_at >= ? AND p.received_at < ?
    AND NOT EXISTS (SELECT 1 FROM tax_records t WHERE t.kind = 'input' AND json_extract(t.payload, '$.purchaseId') = p.id) ORDER BY p.received_at`, fromTs, toTs) : [];
  if (unclaimed.length) warnings.push(`${unclaimed.length} purchase(s) this month have no input-tax claim linked. Confirm the supplier invoices carried no recoverable VAT, or record the claim; stock costs must exclude recoverable tax.`);
  const deadline = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0));
  while ([0, 6].includes(deadline.getUTCDay())) deadline.setUTCDate(deadline.getUTCDate() - 1);
  return { month, config, classification, buckets, output, reversed, payable, payments, outstanding: Math.max(0, payable - payments), paymentRows,
    arrears: taxArrears(ctx), unclaimedPurchases: unclaimed,
    historicalExposure:historicalExposure.filter(e=>e.date.slice(0,7)===month), feature:vatFeature(ctx),
    blockers, deadlineBeforeHolidayCheck: deadline.toISOString().slice(0, 10), warnings,
    sales: selectedSales, refunds: selectedRefunds, records: currentRecords, allRecords: records };
}

/** Section 8: liability starts in the period after the registration requirement arose.
 * Persist the first trigger; falling turnover never silently deregisters a business. */
export function recordRegistrationTrigger(ctx: Ctx, reviewHistory = false) {
  const c = taxConfig(ctx);
  if (!c.automatic || (!reviewHistory && registeredOn(c,ctx.now().slice(0,10)))) return;
  const status = taxStatus(ctx);
  let annual = status.annual.exceeded;
  const threeMonthForecast = status.windows[1].exceeded && sum([status.windows[1].total, c.forecastNineMonths]) > c.threshold;
  const forecast = c.forecast > c.threshold;
  if (c.supplyType !== 'goods' && (!c.serviceThresholdConfirmed || !c.serviceThresholdDate || !c.serviceThresholdAuthority || c.serviceThresholdDate > ctx.now().slice(0, 10))) return;
  // Audit F06: only history with no tax snapshot at all blocks the automatic decision. Unclassified products are
  // normal for an unregistered shop; they count as taxable (the conservative reading) and the trigger asks for review.
  if (status.unverifiedLines) return;
  const facts = ctx.all(`SELECT s.created_at AS at, i.tax_snapshot FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at <= ?`, ctx.now())
    .filter(r => r.tax_snapshot).map(r => ({ date: r.at.slice(0, 10), tax: JSON.parse(r.tax_snapshot) }))
    .filter(r => ['standard','zero'].includes(r.tax.classification)).map(r => ({ date: r.date, value: r.tax.base }));
  const external = ctx.all("SELECT * FROM tax_records WHERE kind IN ('turnover','external_sale') AND tax_date <= ? ORDER BY tax_date", ctx.now().slice(0,10));
  const reconciled = new Set(external.filter(r => r.kind === 'external_sale').map(r => JSON.parse(r.payload).reconcilesTurnoverId));
  for (const r of external) { const d = JSON.parse(r.payload); if (!['exempt','outside'].includes(d.classification) && !reconciled.has(r.id)) facts.push({ date: r.tax_date, value: d.base }); }
  for (const r of ctx.all('SELECT r.created_at AS at, i.tax_snapshot FROM refund_items i JOIN refunds r ON r.id = i.refund_id WHERE r.created_at <= ?', ctx.now())) {
    const t = r.tax_snapshot && JSON.parse(r.tax_snapshot); if (t && ['standard','zero'].includes(t.classification)) facts.push({ date: r.at.slice(0,10), value: -t.base });
  }
  facts.sort((a,b) => a.date.localeCompare(b.date));
  let date = ctx.now().slice(0,10), left = 0, running = 0, crossing: string | null = null;
  for (let right = 0; right < facts.length; right++) {
    const f = facts[right]; running = sum([running, f.value]);
    const cutoff = monthsBefore(f.date, 12);
    while (left <= right && facts[left].date <= cutoff) running = sum([running, -facts[left++].value]);
    if (facts[right + 1]?.date === f.date) continue;
    if (c.supplyType !== 'goods' && f.date < c.serviceThresholdDate!) continue;
    if (running > c.threshold) { crossing = f.date; break; }
  }
  if (crossing) { annual = true; date = crossing; }
  if (!annual && !threeMonthForecast && !forecast) return;
  const next = new Date(date.slice(0, 7) + '-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
  const effectiveDate = next.toISOString().slice(0,10);
  if (c.registered && c.registrationDate && c.registrationDate <= effectiveDate) return;
  const triggerKind = annual ? 'annual_turnover' : threeMonthForecast ? 'three_months_plus_nine_month_forecast' : 'forecast';
  if (ctx.all("SELECT payload FROM tax_records WHERE kind = 'registration_trigger'").some(r => { const t=JSON.parse(r.payload); return (t.trigger !== 'forecast' && t.effectiveDate <= effectiveDate) || (t.trigger === triggerKind && t.effectiveDate === effectiveDate); })) return;

  const deadline = annual || threeMonthForecast ? new Date(date + 'T00:00:00Z') : new Date(next);
  deadline.setUTCDate(deadline.getUTCDate() + (annual || threeMonthForecast ? 30 : 29));
  const applicationDueDate = deadline.toISOString().slice(0,10), id = ctx.id();
  ctx.insert('tax_records', { id, kind: 'registration_trigger', tax_date: date, reference: 'Automatic VAT registration obligation', payload: JSON.stringify({ effectiveDate, requirementDate: date, detectedDate: ctx.now().slice(0,10), applicationDueDate, classificationReview: status.unclassifiedLines > 0, unclassifiedLines: status.unclassifiedLines, unclassifiedProducts: status.unclassified, trigger: triggerKind, annual: status.annual.total, forecast: c.forecast, forecastNineMonths: c.forecastNineMonths, threshold: c.threshold, reason: 'Act 1151 sections 6 and 8. A backdated discovery does not postpone the original legal effective date.' }), created_by: ctx.user.id, created_at: ctx.now() });
  ctx.audit('tax_record', id, { effectiveDate, requirementDate: date }, 'tax.registration_triggered');
}
