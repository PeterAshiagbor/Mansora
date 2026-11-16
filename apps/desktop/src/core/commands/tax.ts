import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fail, mulDivRound, taxConfigSchema, zCalendarDate } from '@mansora/domain';
import { defineCommands, empty, zId, zMoney, zText, type Ctx } from '../engine';
import { monthsBefore, quoteSale, recordRegistrationTrigger, taxConfig, taxPayments as taxPaymentsList, taxStatus, vatReport } from '../tax';
import { toXlsx } from '../importer';
import { requireOpenPeriod } from '../periods';

const zMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export function requireTaxPeriodOpen(ctx: Ctx, date: string) {
  if (ctx.get("SELECT 1 FROM tax_records WHERE kind = 'filing' AND substr(tax_date, 1, 7) >= ?", date.slice(0, 7))) fail('TAX_PERIOD_CLOSED', 'This date is in or before a filed VAT period. Record a documented adjustment in an open period.');
}
function owner(ctx: Ctx) {
  if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner may edit tax settings or tax records');
}
function insertRecord(ctx: Ctx, input: { id: string; kind: string; date: string; reference: string }, data: unknown) {
  const existing = ctx.get('SELECT id FROM tax_records WHERE id = ?', input.id);
  if (existing) return { id: existing.id, duplicate: true };
  if (input.kind !== 'payment') requireTaxPeriodOpen(ctx, input.date);
  if (input.kind !== 'payment' && input.kind !== 'filing') requireOpenPeriod(ctx, input.date);
  ctx.insert('tax_records', { id: input.id, kind: input.kind, tax_date: input.date, reference: input.reference, payload: JSON.stringify(data), created_by: ctx.user.id, created_at: ctx.now() });
  ctx.audit('tax_record', input.id, { kind: input.kind, reference: input.reference, date: input.date });
  return { id: input.id };
}
const recordInput = z.object({
  id: zId, kind: z.enum(['input', 'withholding', 'adjustment', 'turnover', 'opening_credit', 'payment']), date: zCalendarDate,
  reference: zText(120), reason: zText(400), supplierTin: z.string().trim().max(80).default(''),
  invoiceDate: zCalendarDate.optional(), purchaseId: zId.optional(),
  base: zMoney.default(0), vat: z.number().int().safe().default(0), nhil: z.number().int().safe().default(0), getfund: z.number().int().safe().default(0),
  amount: zMoney.default(0), eligibleBps: z.number().int().min(0).max(10000).default(10000), evidenceConfirmed: z.literal(true),
  /** For a payment: the VAT return month it settles (audit F05). Defaults to the month before the payment date. */
  period: zMonth.optional(),
});

/** Checks shared by input-tax claims recorded on their own and those recorded with a goods receipt (audit F09). */
export function checkInputClaim(ctx: Ctx, input: { date: string; reference: string; supplierTin: string; invoiceDate?: string; purchaseId?: string }) {
  if (!input.supplierTin || !input.invoiceDate) fail('TAX_EVIDENCE_REQUIRED', 'Enter the supplier TIN and supplier invoice date');
  if (input.invoiceDate > input.date || input.invoiceDate < monthsBefore(input.date.slice(0, 7) + '-01', 6)) fail('INPUT_CREDIT_PERIOD', 'Check the six-month input-credit time limit and invoice date');
  const duplicate = ctx.all("SELECT payload, reference FROM tax_records WHERE kind = 'input' AND reference = ?", input.reference).some(r => String(JSON.parse(r.payload).supplierTin).toLowerCase() === input.supplierTin.toLowerCase());
  if (duplicate) fail('DUPLICATE_TAX_INVOICE', 'This supplier invoice has already been recorded');
  if (input.purchaseId) {
    if (!ctx.get('SELECT 1 FROM purchases WHERE id = ?', input.purchaseId)) fail('NOT_FOUND', 'Purchase not found');
    if (ctx.get("SELECT 1 FROM tax_records WHERE kind = 'input' AND json_extract(payload, '$.purchaseId') = ?", input.purchaseId)) fail('DUPLICATE_TAX_INVOICE', 'An input-tax claim is already linked to this purchase');
  }
}
export const taxCommands = defineCommands({
  'tax.current': { perm: 'sale.create', input: empty, run: ctx => taxConfig(ctx) },
  'tax.status': { perm: 'report.sales', input: empty, run: ctx => taxStatus(ctx) },
  'tax.history': { perm: 'settings.manage', input: empty, run: ctx => ctx.all('SELECT * FROM tax_configs ORDER BY effective_date DESC, created_at DESC, rowid DESC') },
  'tax.configure': {
    perm: 'settings.manage', mutates: true, input: taxConfigSchema,
    run: (ctx, config) => {
      owner(ctx);
      if (config.supplyType !== 'goods' && config.serviceThresholdConfirmed && (!config.serviceThresholdDate || !config.serviceThresholdAuthority)) fail('SERVICE_RULE_EVIDENCE_REQUIRED', 'Record the amendment commencement date and the GRA or enacted-law source before confirming the service threshold');
      if (config.effectiveDate < '2026-01-01') fail('TAX_PERIOD_UNSUPPORTED', 'This rule set supports periods from January 2026');
      if (config.registered && (!config.registrationDate || !config.tin)) fail('VAT_REGISTRATION_REQUIRED', 'Enter the TIN and legal effective date; add the VAT registration number when issued');
      requireTaxPeriodOpen(ctx, config.effectiveDate);
      const id = ctx.id();
      ctx.insert('tax_configs', { id, effective_date: config.effectiveDate, payload: JSON.stringify(config), created_by: ctx.user.id, created_at: ctx.now() });
      recordRegistrationTrigger(ctx);
      ctx.audit('tax_config', id, config);
      return { id };
    },
  },
  'sale.quote': {
    perm: 'sale.create',
    input: z.object({ lines: z.array(z.object({ productId: zId, quantity: z.number().int().positive().safe(), discount: zMoney.default(0) })).max(500), cartDiscount: zMoney.default(0) }),
    run: (ctx, input) => input.lines.length ? quoteSale(ctx, input.lines, input.cartDiscount) : null,
  },
  'tax.record': {
    perm: 'settings.manage', mutates: true, input: recordInput,
    run: (ctx, input) => {
      owner(ctx);
      if (ctx.get('SELECT 1 FROM tax_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      const now = ctx.now().slice(0, 10);
      if (input.date > now || input.date < '2026-01-01') fail('INVALID_TAX_DATE', 'Use a tax date from January 2026 through today');
      if (input.kind !== 'adjustment' && [input.vat, input.nhil, input.getfund].some(v => v < 0)) fail('INVALID_AMOUNT', 'Credits cannot be negative; record a documented adjustment instead');
      if (input.kind !== 'turnover' && input.kind !== 'payment') {
        const c = taxConfig(ctx, input.date);
        if (!c.registered || !c.registrationDate || c.registrationDate > input.date) fail('VAT_REGISTRATION_REQUIRED', 'Record the applicable VAT registration before claiming credits or adjustments');
      }
      if (input.kind === 'input') checkInputClaim(ctx, input);
      if (input.kind === 'payment') {
        const period = input.period ?? monthsBefore(input.date.slice(0, 7) + '-01', 1).slice(0, 7);
        if (period > input.date.slice(0, 7)) fail('INVALID_PERIOD', 'A payment cannot settle a return for a month after the payment date');
        input.period = period;
      }
      if (['withholding', 'opening_credit', 'payment'].includes(input.kind) && ctx.get('SELECT 1 FROM tax_records WHERE kind = ? AND reference = ?', input.kind, input.reference)) fail('DUPLICATE_TAX_EVIDENCE', 'This tax evidence reference has already been recorded');
      if (input.kind === 'withholding' && (input.nhil || input.getfund)) fail('INVALID_WITHHOLDING', 'VAT withholding certificates offset VAT, not NHIL or GETFund');
      if (input.kind === 'payment' && !input.amount) fail('INVALID_AMOUNT', 'Enter the amount paid to GRA');
      if (input.kind === 'turnover' && (input.vat || input.nhil || input.getfund)) fail('INVALID_TURNOVER', 'External turnover must exclude VAT and levies');
      const data = { ...input, originalTaxes: { vat: input.vat, nhil: input.nhil, getfund: input.getfund }, vat: input.vat, nhil: input.nhil, getfund: input.getfund };
      if (input.kind === 'input') for (const k of ['vat', 'nhil', 'getfund'] as const) data[k] = mulDivRound(input[k], input.eligibleBps, 10000);
      const result = insertRecord(ctx, input, data);
      if (input.kind === 'turnover') recordRegistrationTrigger(ctx);
      return result;
    },
  },
  'tax.report': { perm: 'report.sales', input: z.object({ month: zMonth }), run: (ctx, input) => vatReport(ctx, input.month) },
  'tax.export': {
    perm: 'report.sales', async: true, input: z.object({ month: zMonth }),
    run: async (ctx, input) => {
      const r = vatReport(ctx, input.month);
      const buffer = await toXlsx([
        { name: 'Return summary', rows: [ ['Ghana VAT working papers', r.month], ['Business', ctx.setting('business_name')], ['TIN', r.config.tin], ['VAT number', r.config.vatNumber], ['Tax', 'Output', 'Refund reversals', 'Input credits', 'Withholding', 'Adjustments', 'Brought forward', 'Payable', 'Carried forward'], ...r.buckets.map(b => [b.tax, ...[b.output, b.reversals, b.inputs, b.withholding, b.adjustments, b.broughtForward, b.payable, b.carriedForward].map(n => n / 100)]), ['Due before holiday check', r.deadlineBeforeHolidayCheck], ...r.warnings.map(w => ['Review', w]) ] },
        { name: 'Supply classifications', rows: [['Classification', 'Net base GHS'], ...r.classification.map(c => [c.classification, c.base / 100])] },
        { name: 'Sales', rows: [['Receipt', 'Date', 'Product', 'Tax class', 'Base GHS', 'VAT GHS', 'NHIL GHS', 'GETFund GHS', 'Total GHS', 'Invoice identity snapshot'], ...r.sales.map(s => { const t = s.tax_snapshot ? JSON.parse(s.tax_snapshot) : null; return [s.reference, s.date, s.product_name, t?.classification ?? 'legacy-unverified', ...[t?.base, t?.vat, t?.nhil, t?.getfund, s.line_total].map(n => n == null ? '' : n / 100), s.invoice_tax]; })] },
        { name: 'Credit notes', rows: [['Credit note', 'Original receipt', 'Date', 'Base GHS', 'VAT GHS', 'NHIL GHS', 'GETFund GHS', 'Total GHS'], ...r.refunds.map(s => { const t = s.tax_snapshot ? JSON.parse(s.tax_snapshot) : null; return [s.reference, s.original_reference, s.date, ...[t?.base, t?.vat, t?.nhil, t?.getfund, s.line_total].map(n => n == null ? '' : n / 100)]; })] },
        { name: 'Filed returns and payments', rows: [['Return month', 'Filing reference', 'Payable GHS', 'Paid GHS', 'Still owed GHS'], ...r.arrears.rows.map(x => [x.month, x.reference, x.payable / 100, x.paid / 100, x.outstanding / 100]), [], ['Payment reference', 'Paid on', 'Return month settled', 'GHS', 'Matched by'], ...taxPaymentsList(ctx).map(p => [p.reference, p.paidOn, p.period, p.amount / 100, p.allocatedByDate ? 'payment date (no period recorded)' : 'return period'])] },
        { name: 'Input and other evidence', rows: [['ID', 'Kind', 'Tax date', 'Reference', 'Evidence and amounts in pesewas'], ...r.allRecords.map(s => [s.id, s.kind, s.tax_date, s.reference, s.payload])] },
      ]);
      return { fileName: `Ghana-VAT-${input.month}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: buffer.toString('base64') };
    },
  },
  'tax.file': {
    perm: 'settings.manage', mutates: true,
    input: z.object({ id: zId, month: zMonth, reference: zText(120), reason: zText(400), reviewed: z.literal(true) }),
    run: (ctx, input) => {
      owner(ctx);
      if (ctx.get('SELECT 1 FROM tax_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      if (input.month >= ctx.now().slice(0, 7)) fail('TAX_PERIOD_OPEN', 'Wait until the VAT month has ended before recording a filed return');
      const report = vatReport(ctx, input.month);
      const snapshot = { month: report.month, config: report.config, classification: report.classification, buckets: report.buckets, payable: report.payable, warnings: report.warnings, sourceIds: [...new Set([...report.sales, ...report.refunds, ...report.records].map(r => r.id))] };
      const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      // Keep a compact financial snapshot in sync; detailed schedules can always be exported separately.
      const { sourceIds, ...financial } = snapshot;
      return insertRecord(ctx, { id: input.id, kind: 'filing', date: input.month + '-01', reference: input.reference }, { ...financial, sourceCount: sourceIds.length, hash, reason: input.reason, reviewed: true });
    },
  },
});
