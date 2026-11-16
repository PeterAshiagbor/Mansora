import { addTax, defaultTaxConfig, fail, mulDivRound, priceCart, sum, taxCart, taxConfigSchema, type TaxClass, type TaxSnapshot } from '@mansora/domain';
import type { Ctx } from './engine';

export function taxConfig(ctx: Ctx, date = ctx.now().slice(0, 10)) {
  const row = ctx.get('SELECT payload FROM tax_configs WHERE effective_date <= ? ORDER BY effective_date DESC, created_at DESC, rowid DESC LIMIT 1', date);
  const config = row ? taxConfigSchema.parse(JSON.parse(row.payload)) : defaultTaxConfig();
  if (config.automatic && !config.registered) {
    const trigger = ctx.all("SELECT payload FROM tax_records WHERE kind = 'registration_trigger' AND tax_date <= ? ORDER BY tax_date", date)
      .map(r => JSON.parse(r.payload)).find(t => t.effectiveDate <= date);
    if (trigger) return { ...config, registered: true, registrationDate: trigger.effectiveDate };
  }
  return config;
}
export function quoteSale(ctx: Ctx, lines: { productId: string; quantity: number; discount: number }[], discount: number) {
  const config = taxConfig(ctx), date = ctx.now().slice(0, 10);
  if (date < '2026-01-01') fail('TAX_PERIOD_UNSUPPORTED', 'Configure historical VAT rules before recording sales before 2026');
  const products = lines.map(l => {
    const p = ctx.get('SELECT * FROM products WHERE id = ? AND active = 1', l.productId);
    if (!p) fail('PRODUCT_UNAVAILABLE', 'A product in the basket is no longer available');
    if (config.registered && config.registrationDate! <= date && !config.tin) fail('VAT_PROFILE_REQUIRED', 'VAT is legally due. Record the business TIN and registration details in Ghana VAT settings before issuing invoices.');
    if (config.registered && config.registrationDate! <= date && !p.tax_class) fail('TAX_CLASS_REQUIRED', `Choose a VAT classification for ${p.name} in Products`);
    return p;
  });
  const cart = priceCart(lines.map((l, i) => ({ ...l, unitPrice: products[i].selling_price })), discount);
  const priced = taxCart(cart, products.map(p => (p.tax_class ?? 'standard') as TaxClass), config, date);
  return { ...priced, snapshots: priced.snapshots.map((t, i) => ({ ...t, classificationVerified: !!products[i].tax_class })), config };
}
export function monthsBefore(date: string, months: number) {
  const d = new Date(date + 'T00:00:00Z');
  const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const max = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, max)); return d.toISOString().slice(0, 10);
}
export function taxStatus(ctx: Ctx) {
  const date = ctx.now().slice(0, 10), config = taxConfig(ctx);
  const rows = ctx.all('SELECT s.created_at, i.line_total, i.tax_snapshot FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at >= ? AND s.created_at < ?', monthsBefore(date, 12) + 'T00:00:00.000Z', date + 'T23:59:59.999Z');
  const returns = ctx.all('SELECT r.created_at, i.amount AS line_total, i.tax_snapshot FROM refund_items i JOIN refunds r ON r.id = i.refund_id WHERE r.created_at >= ? AND r.created_at <= ?', monthsBefore(date, 12) + 'T00:00:00.000Z', ctx.now());
  const external = ctx.all("SELECT * FROM tax_records WHERE kind = 'turnover' AND tax_date >= ? AND tax_date <= ?", monthsBefore(date, 12), date);
  const windows = [1, 3, 6, 12].map(months => {
    const start = monthsBefore(date, months);
    const cutoff = start + ctx.now().slice(10);
    const value = (r: any) => {
      const t = r.tax_snapshot ? JSON.parse(r.tax_snapshot) as TaxSnapshot : null;
      return t ? ['standard', 'zero'].includes(t.classification) ? t.base : 0 : r.line_total;
    };
    const local = sum([...rows.filter(r => r.created_at >= cutoff).map(value), ...returns.filter(r => r.created_at >= cutoff).map(r => -value(r))]);
    const total = sum([local, ...external.filter(r => r.tax_date + 'T00:00:00.000Z' >= cutoff).map(r => JSON.parse(r.payload).base)]);
    const limit = mulDivRound(config.threshold, months, 12);
    return { months, start, total, threshold: limit, exceeded: total > limit, near: BigInt(total) * 10000n >= BigInt(limit) * BigInt(config.alertBps) };
  });
  const annual = windows[3];
  const threeMonthForecast = windows[1].exceeded && sum([windows[1].total, config.forecastNineMonths]) > config.threshold;
  const amendmentReviewRequired = config.supplyType !== 'goods' && (!config.serviceThresholdConfirmed || !config.serviceThresholdDate || !config.serviceThresholdAuthority || config.serviceThresholdDate > date);
  const requiresReview = amendmentReviewRequired || threeMonthForecast || config.mandatoryRegistration || annual.exceeded || config.forecast > config.threshold || windows.some(w => w.exceeded) || (config.supplyType !== 'goods' && !config.serviceThresholdConfirmed);
  const registered = config.registered && !!config.registrationDate && config.registrationDate <= date;
  return { config, registered, amendmentReviewRequired, windows, annual, forecast: config.forecast, requiresReview, near: windows.some(w => w.near),
    legacyLines: rows.filter(r => !r.tax_snapshot || JSON.parse(r.tax_snapshot).classificationVerified === false).length,
    /** Lines with no tax snapshot at all (recorded before VAT support): their value cannot be verified. */
    unverifiedLines: rows.filter(r => !r.tax_snapshot).length,
    /** Lines from products without a VAT class: counted as taxable, which is the conservative reading. */
    unclassifiedLines: rows.filter(r => r.tax_snapshot && JSON.parse(r.tax_snapshot).classificationVerified === false).length,
    unclassified: ctx.get('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND tax_class IS NULL')!.n,
    pendingTrigger: ctx.all("SELECT payload FROM tax_records WHERE kind = 'registration_trigger' ORDER BY tax_date LIMIT 1").map(r => JSON.parse(r.payload))[0] ?? null,
    message: amendmentReviewRequired ? 'Service VAT amendment needs confirmation. Ask the owner to obtain the enacted commencement date or written GRA clarification, then record the date and source in Tax settings. Existing VAT obligations continue.' : registered ? 'VAT is applied automatically from the legal effective date. Complete GRA registration if still pending.' : requiresReview ? 'VAT registration review required. Confirm the legal effective date; threshold alerts do not create a registration.' : windows.some(w => w.near) ? 'Approaching a VAT turnover band. Review forecast turnover and prepare registration.' : 'Monitoring taxable turnover. Add sales from other branches and channels.' };
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
  const filings = ctx.all("SELECT tax_date, reference, payload FROM tax_records WHERE kind = 'filing' ORDER BY tax_date").map((r) => ({ month: r.tax_date.slice(0, 7), reference: r.reference, payable: Number(JSON.parse(r.payload).payable) || 0 }));
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
  const config = taxConfig(ctx, to > ctx.now().slice(0, 10) ? ctx.now().slice(0, 10) : end.toISOString().slice(0, 10));
  const [fromTs, toTs] = [from + 'T00:00:00.000Z', to + 'T00:00:00.000Z'];
  // Only the chosen month's lines are loaded; earlier months are summed in SQL (audit F16).
  const sales = ctx.all(`SELECT s.id, s.receipt_no AS reference, s.created_at AS date, s.tax_snapshot AS invoice_tax, i.product_name, i.tax_snapshot, i.line_total FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at >= ? AND s.created_at < ? ORDER BY s.created_at, s.rowid, i.rowid`, fromTs, toTs);
  const refunds = ctx.all(`SELECT r.id, r.refund_no AS reference, r.created_at AS date, s.receipt_no AS original_reference, i.tax_snapshot, i.amount AS line_total FROM refund_items i JOIN refunds r ON r.id = i.refund_id JOIN sales s ON s.id = r.sale_id WHERE r.created_at >= ? AND r.created_at < ? ORDER BY r.created_at, r.rowid, i.rowid`, fromTs, toTs);
  const records = ctx.all('SELECT * FROM tax_records WHERE tax_date < ? ORDER BY tax_date, created_at, rowid', to).map(r => ({ ...r, data: JSON.parse(r.payload) }));
  const j = (k: string, col = 'i.tax_snapshot') => `COALESCE(SUM(json_extract(${col}, '$.${k}')), 0)`;
  const movements: { month: string; vat: number; nhil: number; getfund: number }[] = [
    ...ctx.all(`SELECT substr(s.created_at, 1, 7) AS month, ${j('vat')} AS vat, ${j('nhil')} AS nhil, ${j('getfund')} AS getfund FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at < ? AND i.tax_snapshot IS NOT NULL GROUP BY 1`, fromTs),
    ...ctx.all(`SELECT substr(r.created_at, 1, 7) AS month, -${j('vat')} AS vat, -${j('nhil')} AS nhil, -${j('getfund')} AS getfund FROM refund_items i JOIN refunds r ON r.id = i.refund_id WHERE r.created_at < ? AND i.tax_snapshot IS NOT NULL GROUP BY 1`, fromTs),
  ];
  for (const r of records) if (['input', 'withholding', 'adjustment', 'opening_credit'].includes(r.kind)) {
    movements.push({ month: r.tax_date.slice(0, 7), ...Object.fromEntries(components.map(k => [k, (r.kind === 'adjustment' ? 1 : -1) * (r.data[k] ?? 0)])) } as any);
  }
  const priorMonths = [...new Set(movements.map(r => r.month).filter(m => m < month))].sort();
  const carry = { vat: 0, nhil: 0, getfund: 0 };
  for (const m of priorMonths) for (const k of components) carry[k] = Math.max(0, carry[k] - sum(movements.filter(r => r.month === m).map(r => r[k])));
  const selectedSales = sales, selectedRefunds = refunds;
  const output = addTax(selectedSales.filter(r => r.tax_snapshot).map(r => JSON.parse(r.tax_snapshot)));
  const reversed = addTax(selectedRefunds.filter(r => r.tax_snapshot).map(r => JSON.parse(r.tax_snapshot)));
  const currentRecords = records.filter(r => r.tax_date.slice(0, 7) === month);
  const buckets = components.map(k => {
    const inputs = sum(currentRecords.filter(r => r.kind === 'input' || r.kind === 'opening_credit').map(r => r.data[k] ?? 0));
    const withholding = sum(currentRecords.filter(r => r.kind === 'withholding').map(r => r.data[k] ?? 0));
    const adjustments = sum(currentRecords.filter(r => r.kind === 'adjustment').map(r => r.data[k] ?? 0));
    const balance = sum([output[k], -reversed[k], adjustments, -inputs, -withholding, -carry[k]]);
    return { tax: k, output: output[k], reversals: reversed[k], inputs, withholding, adjustments, broughtForward: carry[k], payable: Math.max(0, balance), carriedForward: Math.max(0, -balance) };
  });
  const classification = ['standard', 'zero', 'exempt', 'outside'].map(kind => ({ classification: kind, base: sum([
    ...selectedSales.filter(r => r.tax_snapshot && JSON.parse(r.tax_snapshot).classification === kind).map(r => JSON.parse(r.tax_snapshot).base),
    ...selectedRefunds.filter(r => r.tax_snapshot && JSON.parse(r.tax_snapshot).classification === kind).map(r => -JSON.parse(r.tax_snapshot).base),
  ]) }));
  const payable = sum(buckets.map(b => b.payable));
  // Payments are matched to the return period they settle, not to the month they were made in (audit F05).
  const paymentRows = taxPayments(ctx).filter((p) => p.period === month);
  const payments = sum(paymentRows.map((p) => p.amount));
  const warnings = ['Working papers for review and filing through GRA. This is not an E-VAT-certified invoice or an electronically submitted return.', 'Confirm the last working day of the following month against Ghana public holidays and GRA notices.'];
  if ([...selectedSales, ...selectedRefunds].some(r => !r.tax_snapshot || JSON.parse(r.tax_snapshot).classificationVerified === false)) warnings.push('Legacy transactions lack VAT snapshots. Reconcile them before filing; no historical tax has been invented.');
  if (!config.registered) warnings.push('Business is not configured as VAT registered for this period.');
  if (ctx.get<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND tax_class IS NULL')!.n) warnings.push('Some active products still need tax classification.');
  if (paymentRows.some((p) => p.allocatedByDate)) warnings.push('Some GRA payments were recorded without a return period and are matched by payment date. Check they belong to this return.');
  // Audit F09: goods received while registered with no linked input claim. Either the supplier invoice carried no
  // recoverable tax, or the claim has not been recorded (or the tax was wrongly included in the stock cost).
  const unclaimed = config.registered ? ctx.all(`SELECT p.id, p.reference, p.received_at, p.total_cost FROM purchases p WHERE p.received_at >= ? AND p.received_at < ?
    AND NOT EXISTS (SELECT 1 FROM tax_records t WHERE t.kind = 'input' AND json_extract(t.payload, '$.purchaseId') = p.id) ORDER BY p.received_at`, fromTs, toTs) : [];
  if (unclaimed.length) warnings.push(`${unclaimed.length} purchase(s) this month have no input-tax claim linked. Confirm the supplier invoices carried no recoverable VAT, or record the claim; stock costs must exclude recoverable tax.`);
  const deadline = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0));
  while ([0, 6].includes(deadline.getUTCDay())) deadline.setUTCDate(deadline.getUTCDate() - 1);
  return { month, config, classification, buckets, output, reversed, payable, payments, outstanding: Math.max(0, payable - payments), paymentRows,
    arrears: taxArrears(ctx), unclaimedPurchases: unclaimed,
    deadlineBeforeHolidayCheck: deadline.toISOString().slice(0, 10), warnings,
    sales: selectedSales, refunds: selectedRefunds, records: currentRecords, allRecords: records };
}

/** Section 8: liability starts in the period after the registration requirement arose.
 * Persist the first trigger; falling turnover never silently deregisters a business. */
export function recordRegistrationTrigger(ctx: Ctx) {
  const c = taxConfig(ctx);
  if (!c.automatic || c.registered || ctx.get("SELECT 1 FROM tax_records WHERE kind = 'registration_trigger'")) return;
  const status = taxStatus(ctx);
  const annual = status.annual.exceeded;
  const threeMonthForecast = status.windows[1].exceeded && sum([status.windows[1].total, c.forecastNineMonths]) > c.threshold;
  const forecast = c.forecast > c.threshold;
  // Shorter guideline bands alone do not prove the statutory forecast condition.
  if (!annual && !threeMonthForecast && !forecast) return;
  if (c.supplyType !== 'goods' && (!c.serviceThresholdConfirmed || !c.serviceThresholdDate || !c.serviceThresholdAuthority || c.serviceThresholdDate > ctx.now().slice(0, 10))) return;
  // Audit F06: only history with no snapshot at all blocks the automatic decision. Unclassified products are normal
  // for an unregistered shop; they count as taxable (conservative) and the trigger asks for classification review.
  if (status.unverifiedLines) return; // an unverified historical series must be reconciled first
  const date = ctx.now().slice(0, 10);
  const next = new Date(date.slice(0, 7) + '-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
  const effectiveDate = next.toISOString().slice(0, 10);
  const deadline = annual || threeMonthForecast ? new Date(ctx.now()) : new Date(next);
  deadline.setUTCDate(deadline.getUTCDate() + (annual || threeMonthForecast ? 30 : 29));
  const applicationDueDate = deadline.toISOString().slice(0, 10);
  const id = ctx.id();
  ctx.insert('tax_records', { id, kind: 'registration_trigger', tax_date: date, reference: 'Automatic VAT registration obligation', payload: JSON.stringify({ effectiveDate, applicationDueDate, trigger: annual ? 'annual_turnover' : threeMonthForecast ? 'three_months_plus_nine_month_forecast' : 'forecast', annual: status.annual.total, forecast: c.forecast, forecastNineMonths: c.forecastNineMonths, threshold: c.threshold, reason: 'Act 1151 sections 6 and 8; application due within 30 days of the relevant period. Complete registration and invoice setup.', classificationReview: status.unclassifiedLines > 0, unclassifiedLines: status.unclassifiedLines, unclassifiedProducts: status.unclassified }), created_by: ctx.user.id, created_at: ctx.now() });
  ctx.audit('tax_record', id, { effectiveDate, annual: status.annual.total }, 'tax.registration_triggered');
}
