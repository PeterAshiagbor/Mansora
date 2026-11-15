import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fail, TAX_CLASSES, taxAmount, taxConfigSchema, zCalendarDate } from '@mansora/domain';
import { defineCommands, empty, zId, zMoney, zText, type Ctx } from '../engine';
import { addMonths, claimTaxes, eligibleInputBps, evidenceKey } from '../tax-controls';
import { monthsBefore, quoteSale, recordRegistrationTrigger, registeredOn, taxConfig, taxStatus, vatReport } from '../tax';
import { toXlsx } from '../importer';

const zMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
function taxPeriodStates(ctx: Ctx) {
  const states = new Map<string, string>();
  for (const r of ctx.all("SELECT kind, tax_date FROM tax_records WHERE kind IN ('filing','period_reopened') ORDER BY COALESCE(json_extract(payload,'$.sequence'),0), created_at, id")) states.set(r.tax_date.slice(0,7), r.kind);
  return states;
}
export function requireTaxPeriodOpen(ctx: Ctx, date: string) {
  if ([...taxPeriodStates(ctx)].some(([month,state]) => state === 'filing' && month >= date.slice(0,7))) fail('TAX_PERIOD_CLOSED', 'This date is in or before a filed VAT period. Obtain GRA amendment authority; do not net a prior-return error into a later month.');
}
function owner(ctx: Ctx) {
  if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner may edit tax settings or tax records');
}
function insertRecord(ctx: Ctx, input: { id: string; kind: string; date: string; reference: string }, data: unknown) {
  const existing = ctx.get('SELECT id FROM tax_records WHERE id = ?', input.id);
  if (existing) return { id: existing.id, duplicate: true };
  if (input.kind !== 'payment') requireTaxPeriodOpen(ctx, input.date);
  ctx.insert('tax_records', { id: input.id, kind: input.kind, tax_date: input.date, reference: input.reference, payload: JSON.stringify({ ...(data as object), sequence: Number(ctx.get("SELECT COALESCE(MAX(json_extract(payload,'$.sequence')),0) AS n FROM tax_records")!.n) + 1 }), created_by: ctx.user.id, created_at: ctx.now() });
  ctx.audit('tax_record', input.id, { kind: input.kind, reference: input.reference, date: input.date });
  return { id: input.id };
}
const recordInput = z.object({
  id: zId, kind: z.enum(['input', 'withholding', 'adjustment', 'turnover', 'opening_credit', 'payment', 'external_sale']), date: zCalendarDate,
  reference: zText(120), reason: zText(400), supplierTin: z.string().trim().max(80).default(''),
  invoiceDate: zCalendarDate.optional(), accrualDate: zCalendarDate.optional(), accrualBasis: z.string().trim().max(400).default(''), purchaseId: zId.optional(),
  reconcilesSaleItemId: zId.optional(), classification: z.enum(TAX_CLASSES).default('standard'), reconcilesTurnoverId: zId.optional(),
  attribution: z.enum(['direct_taxable','residual_mixed','exempt','private']).default('direct_taxable'),
  inputCategory: z.enum(['ordinary','services','capital','vehicle','entertainment','membership']).default('ordinary'),
  exceptionConfirmed: z.boolean().default(false), financialInstitution: z.boolean().default(false), onHandAtRegistration: z.boolean().default(false),
  legalAuthority: z.string().trim().max(400).default(''), originalPeriod: zMonth.optional(),
  base: zMoney.default(0), vat: z.number().int().safe().default(0), nhil: z.number().int().safe().default(0), getfund: z.number().int().safe().default(0),
  amount: zMoney.default(0), eligibleBps: z.number().int().min(0).max(10000).default(10000), evidenceConfirmed: z.literal(true),
});
export const taxCommands = defineCommands({
  'tax.current': { perm: 'sale.create', input: empty, run: ctx => taxConfig(ctx) },
  'tax.status': { perm: 'report.sales', input: empty, run: ctx => taxStatus(ctx) },
  'tax.history': { perm: 'settings.manage', input: empty, run: ctx => ctx.all("SELECT * FROM tax_configs ORDER BY effective_date DESC, COALESCE(json_extract(payload,'$.revision'),0) DESC, created_at DESC, id DESC") },
  'tax.configure': {
    perm: 'settings.manage', mutates: true, input: taxConfigSchema,
    run: (ctx, config) => {
      owner(ctx);
      if (config.supplyType !== 'goods' && config.serviceThresholdConfirmed && (!config.serviceThresholdDate || !config.serviceThresholdAuthority)) fail('SERVICE_RULE_EVIDENCE_REQUIRED', 'Record the amendment commencement date and the GRA or enacted-law source before confirming the service threshold');
      if (config.effectiveDate < '2026-01-01') fail('TAX_PERIOD_UNSUPPORTED', 'This rule set supports periods from January 2026');
      if (config.registered && (!config.registrationDate || !config.tin)) fail('VAT_REGISTRATION_REQUIRED', 'Enter the TIN and legal effective date; add the VAT registration number when issued');
      const prior = taxConfig(ctx, config.effectiveDate);
      if ((config.vatBps !== 1500 || config.nhilBps !== 250 || config.getfundBps !== 250 || config.threshold !== 75000000) && !config.ruleOverrideAuthority) fail('TAX_RULE_AUTHORITY_REQUIRED', 'Non-standard rates or thresholds require the applicable legal/GRA authority');
      if (prior.registered && !config.registered && !config.automatic && !config.deregistrationAuthority) fail('DEREGISTRATION_AUTHORITY_REQUIRED', 'Record the effective GRA cancellation/authority before disabling a VAT obligation');
      requireTaxPeriodOpen(ctx, config.effectiveDate);
      const id = ctx.id();
      const revision = Number(ctx.get("SELECT COALESCE(MAX(json_extract(payload,'$.revision')),0) AS n FROM tax_configs")!.n) + 1;
      ctx.insert('tax_configs', { id, effective_date: config.effectiveDate, payload: JSON.stringify({ ...config, revision }), created_by: ctx.user.id, created_at: ctx.now() });
      recordRegistrationTrigger(ctx,true);
      ctx.audit('tax_config', id, { ...config, revision });
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
      if (input.kind !== 'payment') requireTaxPeriodOpen(ctx,input.date);
      const now = ctx.now().slice(0, 10);
      if (input.date > now || input.date < '2026-01-01') fail('INVALID_TAX_DATE', 'Use a tax date from January 2026 through today');
      if (input.kind !== 'adjustment' && [input.vat, input.nhil, input.getfund].some(v => v < 0)) fail('INVALID_AMOUNT', 'Credits cannot be negative; record a documented adjustment instead');
      if (!['turnover','payment','external_sale'].includes(input.kind)) {
        const c = taxConfig(ctx, input.date);
        if (!c.registered || !c.registrationDate || c.registrationDate > input.date) fail('VAT_REGISTRATION_REQUIRED', 'Record the applicable VAT registration before claiming credits or adjustments');
      }
      if (input.kind === 'input') {
        if (!input.supplierTin || !input.invoiceDate || !input.base) fail('TAX_EVIDENCE_REQUIRED', 'Enter the supplier TIN, invoice date and tax-exclusive purchase value');
        const c = taxConfig(ctx,input.date);
        const firstAccrual = input.invoiceDate < c.registrationDate! ? c.registrationDate! : input.invoiceDate;
        const accrued = input.accrualDate ?? firstAccrual;
        if (accrued < firstAccrual || (accrued > firstAccrual && !input.accrualBasis)) fail('INPUT_ACCRUAL_EVIDENCE_REQUIRED','A later accrual date needs evidence of when the deduction actually accrued');
        if (input.invoiceDate > input.date || accrued < input.invoiceDate || accrued > input.date || input.date > addMonths(accrued, 6)) fail('INPUT_CREDIT_PERIOD', 'Input credit must be claimed within six calendar months of the evidenced accrual date');
        if (input.invoiceDate < c.registrationDate!) {
          const lookback = input.inputCategory === 'capital' ? 6 : 4;
          if (!input.onHandAtRegistration || !['ordinary','capital'].includes(input.inputCategory) || input.invoiceDate < monthsBefore(c.registrationDate!, lookback) || input.date.slice(0,7) !== c.registrationDate!.slice(0,7)) fail('PRE_REGISTRATION_INPUT', 'Pre-registration credits require eligible stock/capital goods on hand and the first effective registration period (section 51)');
        }
        const duplicate = ctx.all("SELECT payload, reference FROM tax_records WHERE kind = 'input'").some(r => evidenceKey(r.reference) === evidenceKey(input.reference) && evidenceKey(JSON.parse(r.payload).supplierTin) === evidenceKey(input.supplierTin));
        if (duplicate) fail('DUPLICATE_TAX_INVOICE', 'This supplier invoice has already been recorded');
        if (input.purchaseId && !ctx.get('SELECT 1 FROM purchases WHERE id = ?', input.purchaseId)) fail('NOT_FOUND', 'Purchase not found');
        eligibleInputBps(input);
      }
      if (input.kind === 'adjustment' && (!input.legalAuthority || (input.originalPeriod && input.originalPeriod !== input.date.slice(0,7)))) fail('TAX_ADJUSTMENT_REVIEW_REQUIRED', 'Record the legal adjustment basis. Prior-return corrections require the GRA-authorised amendment workflow, not netting into a later month');
      let reconciledSale: unknown;
      if (input.reconcilesSaleItemId) {
        if (input.kind !== 'adjustment' || !input.legalAuthority) fail('TAX_ADJUSTMENT_REVIEW_REQUIRED','A sale-line reconciliation requires an authorised original-period adjustment');
        const item = ctx.get('SELECT i.*, s.created_at FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.id = ?',input.reconcilesSaleItemId);
        if (!item || item.created_at.slice(0,7) !== input.date.slice(0,7)) fail('INVALID_RECONCILIATION','Choose an original sale line in this adjustment period');
        if (ctx.all("SELECT payload FROM tax_records WHERE kind='adjustment'").some(r=>JSON.parse(r.payload).reconcilesSaleItemId===item.id)) fail('DUPLICATE_TAX_EVIDENCE','This sale line already has a reconciliation');
        const c = taxConfig(ctx,item.created_at.slice(0,10)), original = item.tax_snapshot ? JSON.parse(item.tax_snapshot) : null;
        if (!registeredOn(c,item.created_at.slice(0,10)) || c.pricing !== 'inclusive' || original?.registered) fail('HISTORICAL_INVOICE_REVIEW_REQUIRED','This correction requires separate invoice/receivable and GRA review; do not invent historical collection');
        const corrected = taxAmount(item.line_total,input.classification,c,item.created_at.slice(0,10));
        if (['vat','nhil','getfund'].some(k=>input[k as 'vat'] !== corrected[k as 'vat']-(original?.[k]??0))) fail('EXTERNAL_TAX_MISMATCH','Correction amounts must reconcile exactly to the legal treatment of the original inclusive sale');
        reconciledSale = { ...corrected,classificationVerified:true };
      }
      if (input.kind === 'opening_credit' && ctx.get("SELECT 1 FROM tax_records WHERE kind = 'opening_credit'")) fail('DUPLICATE_OPENING_CREDIT', 'Opening credit has already been recorded; use an evidenced correction instead');
      if (input.kind === 'external_sale') {
        if (!input.base) fail('INVALID_AMOUNT', 'Enter the external sale value excluding taxes');
        if (ctx.all("SELECT reference FROM tax_records WHERE kind = 'external_sale'").some(r => evidenceKey(r.reference) === evidenceKey(input.reference))) fail('DUPLICATE_TAX_EVIDENCE', 'This external invoice has already been recorded');
        if (input.reconcilesTurnoverId) {
          const original = ctx.get("SELECT * FROM tax_records WHERE id = ? AND kind = 'turnover'", input.reconcilesTurnoverId);
          if (!original || original.tax_date !== input.date || JSON.parse(original.payload).base !== input.base || ctx.all("SELECT payload FROM tax_records WHERE kind = 'external_sale'").some(r => JSON.parse(r.payload).reconcilesTurnoverId === original.id)) fail('INVALID_RECONCILIATION', 'Link one unreconciled turnover entry with the same date and value');
        }
      }
      if (input.kind === 'external_sale') {
        const expected = taxAmount(input.base, input.classification, { ...taxConfig(ctx, input.date), pricing: 'exclusive' }, input.date);
        if (['vat','nhil','getfund'].some(k => input[k as 'vat'] !== expected[k as 'vat'])) fail('EXTERNAL_TAX_MISMATCH', 'External invoice taxes do not reconcile to the configured legal treatment; review the invoice before recording output tax');
      }
      if (input.kind === 'turnover' && registeredOn(taxConfig(ctx,input.date),input.date)) fail('EXTERNAL_SALE_REQUIRED', 'Registered external supplies belong in the VAT output schedule; use External sale, not threshold-only turnover');
      if (['withholding', 'opening_credit', 'payment'].includes(input.kind) && ctx.all('SELECT reference FROM tax_records WHERE kind = ?',input.kind).some(r => evidenceKey(r.reference) === evidenceKey(input.reference))) fail('DUPLICATE_TAX_EVIDENCE', 'This tax evidence reference has already been recorded');
      if (input.kind === 'withholding' && (input.nhil || input.getfund)) fail('INVALID_WITHHOLDING', 'VAT withholding certificates offset VAT, not NHIL or GETFund');
      if (input.kind === 'payment' && !input.amount) fail('INVALID_AMOUNT', 'Enter the amount paid to GRA');
      if (input.kind === 'turnover' && (input.vat || input.nhil || input.getfund)) fail('INVALID_TURNOVER', 'External turnover must exclude VAT and levies');
      const data = { ...input, originalTaxes: { vat: input.vat, nhil: input.nhil, getfund: input.getfund }, vat: input.vat, nhil: input.nhil, getfund: input.getfund };
      if (reconciledSale) Object.assign(data,{reconciledSale});
      if (input.kind === 'external_sale') { const t = taxAmount(input.base,input.classification,{...taxConfig(ctx,input.date),pricing:'exclusive'},input.date); Object.assign(data,{registeredAtSupply:t.registered,rates:t.rates}); }
      if (input.kind === 'input') Object.assign(data, claimTaxes(input, eligibleInputBps(input)), { appliedEligibleBps: eligibleInputBps(input), accrualDate: input.accrualDate ?? (input.invoiceDate! < taxConfig(ctx,input.date).registrationDate! ? taxConfig(ctx,input.date).registrationDate : input.invoiceDate) });
      const result = insertRecord(ctx, input, data);
      if (['turnover','external_sale'].includes(input.kind)) recordRegistrationTrigger(ctx,true);
      return result;
    },
  },
  'tax.report': { perm: 'report.sales', input: z.object({ month: zMonth }), run: (ctx, input) => vatReport(ctx, input.month) },
  'tax.export': {
    perm: 'report.sales', async: true, input: z.object({ month: zMonth }),
    run: async (ctx, input) => {
      const r = vatReport(ctx, input.month);
      const buffer = await toXlsx([
        { name: 'Return summary', rows: [ ['Ghana VAT working papers', r.month], ['Business', ctx.setting('business_name')], ['TIN', r.config.tin], ['VAT number', r.config.vatNumber], ['Tax', 'Recorded output', 'Historical exposure', 'Refund reversals', 'Input credits', 'Withholding', 'Adjustments', 'Brought forward', 'Payable', 'Carried forward'], ...r.buckets.map(b => [b.tax, ...[b.output, b.historicalExposure, b.reversals, b.inputs, b.withholding, b.adjustments, b.broughtForward, b.payable, b.carriedForward].map(n => n / 100)]), ['Due before holiday check', r.deadlineBeforeHolidayCheck], ...r.warnings.map(w => ['Review', w]), ...r.blockers.map(w => ['FILING BLOCKED',w]) ] },
        { name: 'Mansora VAT feature history', rows: [['Revision','Changed at','Administrator','Enabled','Reason'],...r.feature.events.map(e=>[e.revision,e.occurredAt,e.adminName,e.enabled,e.reason])] },
        { name: 'Backdated VAT exposure', rows: [['Date','Source ID','Reference','Type','Policy revision','Base GHS','VAT GHS','NHIL GHS','GETFund GHS'],...r.historicalExposure.map(e=>[e.date,e.sourceId,e.reference,e.kind,e.policyRevision,e.base/100,e.vat/100,e.nhil/100,e.getfund/100])] },
        { name: 'Supply classifications', rows: [['Classification', 'Net base GHS'], ...r.classification.map(c => [c.classification, c.base / 100])] },
        { name: 'Sales', rows: [['Receipt', 'Date', 'Product', 'Tax class', 'Base GHS', 'VAT GHS', 'NHIL GHS', 'GETFund GHS', 'Total GHS', 'Invoice identity snapshot'], ...r.sales.map(s => { const t = s.tax_snapshot ? JSON.parse(s.tax_snapshot) : null; return [s.reference, s.date, s.product_name, t?.classification ?? 'legacy-unverified', ...[t?.base, t?.vat, t?.nhil, t?.getfund, s.line_total].map(n => n == null ? '' : n / 100), s.invoice_tax]; })] },
        { name: 'Credit notes', rows: [['Credit note', 'Original receipt', 'Date', 'Base GHS', 'VAT GHS', 'NHIL GHS', 'GETFund GHS', 'Total GHS'], ...r.refunds.map(s => { const t = s.tax_snapshot ? JSON.parse(s.tax_snapshot) : null; return [s.reference, s.original_reference, s.date, ...[t?.base, t?.vat, t?.nhil, t?.getfund, s.line_total].map(n => n == null ? '' : n / 100)]; })] },
        { name: 'Input credit schedule', rows: [['Record ID','Supplier TIN','Invoice','Invoice date','Accrual date','Claim date','Base GHS','Invoice VAT','Invoice NHIL','Invoice GETFund','Applied eligible %','Claimed VAT','Claimed NHIL','Claimed GETFund','Category','Attribution','Evidence'], ...r.records.filter(v=>v.kind==='input').map(v=>[v.id,v.data.supplierTin,v.reference,v.data.invoiceDate,v.data.accrualDate,v.tax_date,v.data.base/100,...['vat','nhil','getfund'].map(k=>(v.data.originalTaxes?.[k] ?? v.data[k])/100),(v.data.appliedEligibleBps ?? v.data.eligibleBps)/100,...['vat','nhil','getfund'].map(k=>v.data[k]/100),v.data.inputCategory ?? 'legacy-review',v.data.attribution ?? 'legacy-review',v.data.reason])] },
        { name: 'Credits payments and filings', rows: [['ID','Type','Tax period/date','Reference','VAT credit GHS','Payment GHS','Recorded at','Reason or authority'], ...r.allRecords.filter(v=>['withholding','payment','filing','period_reopened'].includes(v.kind)).map(v=>[v.id,v.kind,v.tax_date,v.reference,(v.data.vat ?? 0)/100,(v.data.amount ?? 0)/100,v.created_at,v.data.legalAuthority ?? v.data.reason])] },
        { name: 'Input and other evidence', rows: [['ID', 'Kind', 'Tax date', 'Reference', 'Evidence and amounts in pesewas'], ...r.allRecords.map(s => [s.id, s.kind, s.tax_date, s.reference, s.payload])] },
      ]);
      return { fileName: `Ghana-VAT-${input.month}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: buffer.toString('base64') };
    },
  },
  'tax.reopen': {
    perm: 'settings.manage', mutates: true,
    input: z.object({ id: zId, filingId: zId, month: zMonth, applicationDate: zCalendarDate, originalSubmissionDate: zCalendarDate.optional(), submissionEvidence: z.string().trim().max(400).optional(), approvalReference: zText(120), legalAuthority: zText(400), reason: zText(400), approvalConfirmed: z.literal(true) }),
    run: (ctx,input) => {
      owner(ctx);
      if (ctx.get('SELECT 1 FROM tax_records WHERE id = ?',input.id)) return { id: input.id, duplicate: true };
      const original = ctx.get("SELECT * FROM tax_records WHERE id = ? AND kind = 'filing' AND substr(tax_date,1,7) = ?",input.filingId,input.month);
      if (!original) fail('NOT_FOUND','Original filed return not found');
      const latest = ctx.get("SELECT id FROM tax_records WHERE kind = 'filing' AND substr(tax_date,1,7) = ? ORDER BY COALESCE(json_extract(payload,'$.sequence'),0) DESC, created_at DESC, id DESC LIMIT 1",input.month);
      if (latest?.id !== input.filingId) fail('STALE_FILING_REFERENCE','GRA amendment authority must identify the latest filed version for this period');
      const data = JSON.parse(original.payload);
      if (!data.submittedDate && (!input.originalSubmissionDate || !input.submissionEvidence)) fail('SUBMISSION_EVIDENCE_REQUIRED','The old record lacks the actual GRA submission date; provide the acknowledgement date and evidence, not the date entered in Mansora');
      const submitted = data.submittedDate ?? input.originalSubmissionDate;
      if (input.applicationDate < submitted || input.applicationDate > addMonths(submitted,3) || input.applicationDate > ctx.now().slice(0,10)) fail('AMENDMENT_APPLICATION_PERIOD','Section 63 applications must be made within three months of original submission; other routes need separate GRA/legal review');
      const states = taxPeriodStates(ctx);
      if (states.get(input.month) !== 'filing') fail('TAX_PERIOD_OPEN','This period is not currently filed');
      if ([...states].some(([month,state]) => state === 'filing' && month > input.month)) fail('AMENDMENT_ORDER','Reopen later filed periods first so their carry-forward credits can be reconciled');
      const sequence = Number(ctx.get("SELECT COALESCE(MAX(json_extract(payload,'$.sequence')),0) AS n FROM tax_records")!.n) + 1;
      ctx.insert('tax_records',{ id: input.id, kind: 'period_reopened', tax_date: input.month + '-01', reference: input.approvalReference, payload: JSON.stringify({ ...input, sequence }), created_by: ctx.user.id, created_at: ctx.now() });
      ctx.audit('tax_record',input.id,{ month: input.month, filingId: input.filingId, approvalReference: input.approvalReference },'tax.period_reopened');
      return { id: input.id };
    },
  },
  'tax.file': {
    perm: 'settings.manage', mutates: true,
    input: z.object({ id: zId, month: zMonth, reference: zText(120), reason: zText(400), reviewed: z.literal(true), fiscalEvidenceConfirmed: z.literal(true), submittedDate: zCalendarDate }),
    run: (ctx, input) => {
      owner(ctx);
      if (ctx.get('SELECT 1 FROM tax_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      if (input.month >= ctx.now().slice(0, 7)) fail('TAX_PERIOD_OPEN', 'Wait until the VAT month has ended before recording a filed return');
      if (input.month < '2026-01') fail('TAX_PERIOD_UNSUPPORTED', 'The VAT working papers support periods from January 2026');
      const submittedDate = input.submittedDate;
      if (submittedDate > ctx.now().slice(0,10) || submittedDate <= input.month + '-31') fail('INVALID_TAX_DATE', 'Use the actual GRA submission date after the period ended');
      if ([...taxPeriodStates(ctx)].some(([month,state]) => state === 'period_reopened' && month < input.month)) fail('AMENDMENT_ORDER', 'Reconcile and refile earlier reopened periods before later returns');
      const report = vatReport(ctx, input.month);
      if (report.blockers.length) fail('VAT_RECONCILIATION_REQUIRED', report.blockers.join(' '));
      const snapshot = { month: report.month, config: report.config, classification: report.classification, buckets: report.buckets, payable: report.payable, warnings: report.warnings, sourceIds: [...new Set([...report.sales, ...report.refunds, ...report.records].map(r => r.id))] };
      const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      // Keep a compact financial snapshot in sync; detailed schedules can always be exported separately.
      const { sourceIds, ...financial } = snapshot;
      return insertRecord(ctx, { id: input.id, kind: 'filing', date: input.month + '-01', reference: input.reference }, { ...financial, sourceCount: sourceIds.length, hash, submittedDate, fiscalEvidenceConfirmed: true, reason: input.reason, reviewed: true });
    },
  },
});
