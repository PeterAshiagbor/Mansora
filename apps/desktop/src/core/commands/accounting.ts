import { fail, sum, zDateRange } from '@mansora/domain';
import { dayBounds, defineCommands, type Ctx } from '../engine';
import { toXlsx } from '../importer';

/**
 * Audit F08: an accountant-ready journal. Mansora is an operational sub-ledger, not a general ledger: this export
 * turns each day's sales, refunds, stock, cash, debt and tax records into balanced double-entry journals on a
 * default chart of accounts, so an accountant can post them to their own books (or Xero / QuickBooks). It is not a
 * set of financial statements. Records that need an accountant's judgement are listed separately, never guessed.
 */
export const CHART: Record<string, string> = {
  '1000': 'Cash in till', '1010': 'Mobile Money wallet', '1020': 'Card settlements receivable', '1030': 'Bank', '1040': 'Cash transfers (banked or to owner)',
  '1100': 'Trade receivables (customer credit)', '1200': 'Inventory', '1300': 'Input VAT, NHIL and GETFund recoverable',
  '2000': 'Trade payables (suppliers)', '2100': 'Output VAT payable', '2110': 'NHIL payable', '2120': 'GETFund payable', '2190': 'Payments to GRA (allocate to VAT, NHIL, GETFund)',
  '3000': 'Opening balances (equity)', '4000': 'Sales (excluding VAT and levies)', '5000': 'Cost of goods sold',
  '5100': 'Inventory losses and gains', '5110': 'Cash short and over', '5120': 'Bad debts written off', '6000': 'Operating expenses',
};
const METHOD_ACCOUNT: Record<string, string> = { cash: '1000', momo: '1010', card: '1020', bank: '1030', credit: '1100' };

interface Line { account: string; debit: number; credit: number; memo: string }
interface Entry { date: string; entry: string; source: string; lines: Line[] }

function entryOf(date: string, entry: string, source: string, raw: { account: string; amount: number; memo?: string }[]): Entry | null {
  // Positive amounts are debits, negative are credits. Zero lines are dropped.
  const lines = raw.filter((l) => l.amount !== 0).map((l) => ({ account: l.account, debit: l.amount > 0 ? l.amount : 0, credit: l.amount < 0 ? -l.amount : 0, memo: l.memo ?? '' }));
  if (!lines.length) return null;
  const d = sum(lines.map((l) => l.debit)), c = sum(lines.map((l) => l.credit));
  if (d !== c) fail('JOURNAL_UNBALANCED', `Journal ${entry} for ${date} does not balance (${d} against ${c}). Contact Mansora support.`);
  return { date, entry, source, lines };
}

export function buildJournal(ctx: Ctx, from: string, to: string) {
  const [fromTs, toTs] = dayBounds({ from, to });
  const entries: Entry[] = [];
  const add = (e: Entry | null) => { if (e) entries.push(e); };
  const tax = (col: string, k: string) => `COALESCE(json_extract(${col}, '$.${k}'), 0)`;
  const days = new Set<string>();

  // Sales: payments received and credit given = sales net of tax + output taxes.
  const sales = ctx.all(`SELECT substr(s.created_at, 1, 10) AS day,
      SUM(i.line_total - ${tax('i.tax_snapshot', 'vat')} - ${tax('i.tax_snapshot', 'nhil')} - ${tax('i.tax_snapshot', 'getfund')}) AS base,
      SUM(${tax('i.tax_snapshot', 'vat')}) AS vat, SUM(${tax('i.tax_snapshot', 'nhil')}) AS nhil, SUM(${tax('i.tax_snapshot', 'getfund')}) AS getfund, SUM(i.quantity * i.cost_snapshot) AS cost
    FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY 1`, fromTs, toTs);
  const pays = ctx.all(`SELECT substr(s.created_at, 1, 10) AS day, p.method, SUM(p.amount) AS amount FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY 1, 2`, fromTs, toTs);
  for (const s of sales) {
    days.add(s.day);
    add(entryOf(s.day, `SALES-${s.day}`, 'Sales', [
      ...pays.filter((p) => p.day === s.day).map((p) => ({ account: METHOD_ACCOUNT[p.method], amount: p.amount, memo: `Sales by ${p.method}` })),
      { account: '4000', amount: -s.base }, { account: '2100', amount: -s.vat }, { account: '2110', amount: -s.nhil }, { account: '2120', amount: -s.getfund },
    ]));
    add(entryOf(s.day, `COGS-${s.day}`, 'Cost of goods sold', [{ account: '5000', amount: s.cost }, { account: '1200', amount: -s.cost }]));
  }

  // Refunds: reverse the sale's net value and taxes; pay back or reduce credit; return goods or record the loss.
  const refunds = ctx.all(`SELECT substr(r.created_at, 1, 10) AS day,
      SUM(ri.amount - ${tax('ri.tax_snapshot', 'vat')} - ${tax('ri.tax_snapshot', 'nhil')} - ${tax('ri.tax_snapshot', 'getfund')}) AS base,
      SUM(${tax('ri.tax_snapshot', 'vat')}) AS vat, SUM(${tax('ri.tax_snapshot', 'nhil')}) AS nhil, SUM(${tax('ri.tax_snapshot', 'getfund')}) AS getfund,
      SUM(CASE WHEN ri.restocked = 1 THEN ri.quantity * i.cost_snapshot ELSE 0 END) AS restocked, SUM(CASE WHEN ri.restocked = 0 THEN ri.quantity * i.cost_snapshot ELSE 0 END) AS lost
    FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id JOIN sale_items i ON i.id = ri.sale_item_id WHERE r.created_at >= ? AND r.created_at < ? GROUP BY 1`, fromTs, toTs);
  const payouts = ctx.all(`SELECT substr(created_at, 1, 10) AS day, payout_method AS method, SUM(payout_amount) AS payout FROM refunds WHERE payout_amount > 0 AND created_at >= ? AND created_at < ? GROUP BY 1, 2`, fromTs, toTs);
  const reductions = ctx.all(`SELECT substr(created_at, 1, 10) AS day, SUM(credit_reduction) AS v FROM refunds WHERE created_at >= ? AND created_at < ? GROUP BY 1`, fromTs, toTs);
  for (const r of refunds) {
    days.add(r.day);
    add(entryOf(r.day, `REFUNDS-${r.day}`, 'Refunds (credit notes)', [
      { account: '4000', amount: r.base }, { account: '2100', amount: r.vat }, { account: '2110', amount: r.nhil }, { account: '2120', amount: r.getfund },
      ...payouts.filter((p) => p.day === r.day).map((p) => ({ account: METHOD_ACCOUNT[p.method], amount: -p.payout, memo: `Refund paid by ${p.method}` })),
      { account: '1100', amount: -(reductions.find((x) => x.day === r.day)?.v ?? 0), memo: 'Refund taken off customer credit' },
    ]));
    add(entryOf(r.day, `RETURNS-${r.day}`, 'Returned goods', [{ account: '1200', amount: r.restocked, memo: 'Returned to stock' }, { account: '5100', amount: r.lost, memo: 'Returns not put back in stock' }, { account: '5000', amount: -(r.restocked + r.lost) }]));
  }

  // Customer repayments and write-offs.
  for (const r of ctx.all(`SELECT substr(created_at, 1, 10) AS day, method, SUM(amount) AS amount FROM credit_repayments WHERE created_at >= ? AND created_at < ? GROUP BY 1, 2`, fromTs, toTs)) {
    add(entryOf(r.day, `REPAY-${r.day}-${r.method}`, 'Customer repayments', [{ account: METHOD_ACCOUNT[r.method], amount: r.amount }, { account: '1100', amount: -r.amount }]));
  }
  for (const w of ctx.all<{ record_date: string; reference: string; payload: string }>(`SELECT record_date, reference, payload FROM ledger_records WHERE kind = 'credit_writeoff' AND record_date >= ? AND record_date <= ?`, from, to)) {
    const amount = Number(JSON.parse(w.payload).amount) || 0;
    add(entryOf(w.record_date, w.reference, 'Debt written off', [{ account: '5120', amount }, { account: '1100', amount: -amount }]));
  }

  // Purchases (at the cost entered, which excludes recoverable tax for VAT-registered shops) and input tax claims.
  for (const p of ctx.all(`SELECT substr(received_at, 1, 10) AS day, SUM(total_cost) AS cost FROM purchases WHERE received_at >= ? AND received_at < ? GROUP BY 1`, fromTs, toTs)) {
    add(entryOf(p.day, `PURCHASES-${p.day}`, 'Goods received', [{ account: '1200', amount: p.cost }, { account: '2000', amount: -p.cost, memo: 'Allocate to supplier invoices and payments' }]));
  }
  for (const t of ctx.all(`SELECT tax_date, reference, payload FROM tax_records WHERE kind = 'input' AND tax_date >= ? AND tax_date <= ?`, from, to)) {
    const d = JSON.parse(t.payload), amount = sum(['vat', 'nhil', 'getfund'].map((k) => Number(d[k]) || 0));
    add(entryOf(t.tax_date, `INPUT-${t.reference}`, 'Input tax claimed', [{ account: '1300', amount }, { account: '2000', amount: -amount, memo: `Supplier ${d.supplierTin ?? ''} invoice ${t.reference}` }]));
  }

  // Stock written in or off outside sales and purchases.
  for (const m of ctx.all(`SELECT substr(occurred_at, 1, 10) AS day, type, SUM(quantity_delta * unit_cost) AS value FROM inventory_movements
      WHERE type IN ('OPENING_STOCK', 'DAMAGE', 'STOCK_COUNT_ADJUSTMENT', 'MANUAL_CORRECTION') AND occurred_at >= ? AND occurred_at < ? GROUP BY 1, 2`, fromTs, toTs)) {
    const other = m.type === 'OPENING_STOCK' ? '3000' : '5100';
    add(entryOf(m.day, `STOCK-${m.day}-${m.type}`, m.type === 'OPENING_STOCK' ? 'Opening stock' : 'Stock written off or found', [{ account: '1200', amount: m.value }, { account: other, amount: -m.value }]));
  }

  // Expenses by category and how they were paid.
  for (const e of ctx.all(`SELECT expense_date AS day, category, payment_method AS method, SUM(amount) AS amount FROM expenses WHERE expense_date >= ? AND expense_date <= ? GROUP BY 1, 2, 3`, from, to)) {
    add(entryOf(e.day, `EXP-${e.day}-${e.category}-${e.method}`, 'Expenses', [{ account: '6000', amount: e.amount, memo: e.category }, { account: METHOD_ACCOUNT[e.method], amount: -e.amount }]));
  }

  // Till cash movements and shift differences.
  for (const c of ctx.all(`SELECT substr(created_at, 1, 10) AS day, direction, SUM(amount) AS amount FROM shift_cash_movements WHERE created_at >= ? AND created_at < ? GROUP BY 1, 2`, fromTs, toTs)) {
    const v = c.direction === 'in' ? c.amount : -c.amount;
    add(entryOf(c.day, `TILL-${c.day}-${c.direction}`, 'Cash put in or taken out of the till', [{ account: '1000', amount: v }, { account: '1040', amount: -v }]));
  }
  for (const v of ctx.all(`SELECT substr(closed_at, 1, 10) AS day, SUM(variance) AS variance FROM shifts WHERE closed_at >= ? AND closed_at < ? AND variance IS NOT NULL GROUP BY 1`, fromTs, toTs)) {
    add(entryOf(v.day, `CASHDIFF-${v.day}`, 'Cash short or over at shift close', [{ account: '1000', amount: v.variance }, { account: '5110', amount: -v.variance }]));
  }

  // Payments to GRA.
  for (const t of ctx.all(`SELECT tax_date, reference, payload FROM tax_records WHERE kind = 'payment' AND tax_date >= ? AND tax_date <= ?`, from, to)) {
    const d = JSON.parse(t.payload), amount = Number(d.amount) || 0;
    add(entryOf(t.tax_date, `GRA-${t.reference}`, `Payment to GRA for ${d.period ?? 'unstated period'}`, [{ account: '2190', amount }, { account: '1030', amount: -amount }]));
  }

  const review = ctx.all(`SELECT tax_date, kind, reference, payload FROM tax_records WHERE kind IN ('withholding', 'adjustment', 'opening_credit') AND tax_date >= ? AND tax_date <= ? ORDER BY tax_date`, from, to);
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entry < b.entry ? -1 : 1));
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) for (const l of e.lines) { const t = totals.get(l.account) ?? { debit: 0, credit: 0 }; t.debit += l.debit; t.credit += l.credit; totals.set(l.account, t); }
  const trial = Object.keys(CHART).filter((k) => totals.has(k)).map((k) => ({ account: k, name: CHART[k], ...totals.get(k)!, net: totals.get(k)!.debit - totals.get(k)!.credit }));
  return { from, to, entries, trial, debits: sum(trial.map((t) => t.debit)), credits: sum(trial.map((t) => t.credit)), review };
}

export const accountingCommands = defineCommands({
  'accounting.journal': {
    perm: 'data.export',
    input: zDateRange(),
    run: (ctx, input) => buildJournal(ctx, input.from, input.to),
  },
  'accounting.journalExport': {
    perm: 'data.export',
    async: true,
    input: zDateRange(),
    run: async (ctx, input) => {
      const j = buildJournal(ctx, input.from, input.to);
      const ghs = (n: number) => (n ? n / 100 : '');
      const buffer = await toXlsx([
        { name: 'Journal', rows: [['Date', 'Entry', 'Source', 'Account', 'Account name', 'Debit GHS', 'Credit GHS', 'Memo'], ...j.entries.flatMap((e) => e.lines.map((l) => [e.date, e.entry, e.source, l.account, CHART[l.account], ghs(l.debit), ghs(l.credit), l.memo]))] },
        { name: 'Period totals', rows: [['Account', 'Account name', 'Debits GHS', 'Credits GHS', 'Net GHS (debit positive)'], ...j.trial.map((t) => [t.account, t.name, t.debit / 100, t.credit / 100, t.net / 100]), ['', 'Total', j.debits / 100, j.credits / 100, (j.debits - j.credits) / 100]] },
        { name: 'Chart of accounts', rows: [['Account', 'Name'], ...Object.entries(CHART)] },
        { name: 'For accountant review', rows: [['Date', 'Kind', 'Reference', 'Details'], ...j.review.map((r: any) => [r.tax_date, r.kind, r.reference, r.payload])] },
        { name: 'Notes', rows: [
          ['Mansora journal export', `${input.from} to ${input.to}`], ['Business', ctx.setting('business_name') ?? ''],
          ['Basis', 'Daily summary journals from immutable Mansora records. Every journal balances. These are not financial statements.'],
          ['Sales', 'Net of VAT, NHIL and GETFund from each line\'s tax snapshot. Credit given is posted to trade receivables.'],
          ['Stock', 'Moving-average cost. Purchases are posted to trade payables; match them to supplier invoices and payments.'],
          ['Cash transfers', 'Cash taken out of or put into the till is posted to account 1040; allocate to bank deposits or owner drawings.'],
          ['GRA payments', 'Posted to 2190; allocate against VAT, NHIL and GETFund payable when the return is settled.'],
          ['Review sheet', 'VAT withholding certificates, tax adjustments and opening credits need the accountant\'s treatment and are not journalised.'],
        ] },
      ]);
      ctx.tx(() => { ctx.audit('business', null, { from: input.from, to: input.to, entries: j.entries.length }, 'accounting.journal_exported'); });
      return { fileName: `Mansora-journal-${input.from}-to-${input.to}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: buffer.toString('base64') };
    },
  },
});
