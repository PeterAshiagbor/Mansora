/**
 * Bank and Mobile Money statements (owner request 2026-11-14).
 *
 * The owner uploads a statement exported from their bank or Mobile Money wallet (CSV or Excel). Each line is read,
 * and Mansora suggests what it is:
 *  - money in that matches a recorded sale payment or debt repayment (by reference, or by amount and date): confirm;
 *  - money out that matches an expense already recorded: link it;
 *  - other money out: record it as an expense, with a category guessed from the description;
 *  - a payment to a supplier: not an expense (stock bought is recorded under Receive stock), so it is left to the owner.
 * Nothing is written until lines are accepted, one by one or all at once. A line already imported before is marked as
 * a duplicate, and the same file cannot be imported twice.
 */
import { createHash } from 'node:crypto';
import { isCalendarDate } from '@mansora/domain';

export const STATEMENT_FIELDS = ['date', 'description', 'reference', 'amount_in', 'amount_out', 'amount', 'direction', 'balance_before', 'balance_after', 'fees', 'levy', 'from_name', 'to_name'] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];
export type StatementMapping = Partial<Record<StatementField, string>>;

const ALIASES: Record<StatementField, string[]> = {
  date: ['date', 'transaction date', 'txn date', 'trans date', 'value date', 'posting date', 'date/time', 'date time', 'booking date'],
  description: ['description', 'narration', 'narrative', 'details', 'particulars', 'remarks', 'memo', 'transaction details', 'from/to', 'counterparty'],
  // Earlier names win: on an MTN statement the transaction ID (F_ID, the number in the customer's SMS) is the
  // reference a cashier types at the till; REF is the sender's own note.
  reference: ['transaction id', 'financial transaction id', 'f_id', 'f id', 'fid', 'txn id', 'trans id', 'external transaction id', 'reference', 'ref', 'ref no', 'reference number', 'id', 'receipt', 'receipt no', 'cheque number'],
  amount_in: ['credit', 'credits', 'money in', 'amount in', 'deposit', 'deposits', 'cr', 'paid in', 'received', 'inflow'],
  amount_out: ['debit', 'debits', 'money out', 'amount out', 'withdrawal', 'withdrawals', 'dr', 'paid out', 'sent', 'outflow'],
  amount: ['amount', 'value', 'transaction amount', 'amount (ghs)', 'amount ghs'],
  direction: ['type', 'transaction type', 'trans. type', 'trans type', 'direction', 'dr/cr', 'cr/dr'],
  balance_before: ['bal before', 'balance before', 'opening balance', 'bal. before'],
  balance_after: ['bal after', 'balance after', 'closing balance', 'bal. after', 'balance', 'running balance'],
  fees: ['fees', 'fee', 'charges', 'charge'],
  levy: ['e-levy', 'e levy', 'elevy', 'levy', 'tax'],
  from_name: ['from name', 'sender', 'sender name', 'from'],
  to_name: ['to name', 'recipient', 'recipient name', 'beneficiary', 'to'],
};

export function suggestStatementMapping(headers: string[]): StatementMapping {
  const out: StatementMapping = {};
  const used = new Set<string>();
  for (const f of STATEMENT_FIELDS) {
    for (const alias of ALIASES[f]) {
      const hit = headers.find((h) => !used.has(h) && h.trim().toLowerCase() === alias);
      if (hit) { out[f] = hit; used.add(hit); break; }
    }
  }
  // A running balance alone cannot tell money in from money out without the balance before it.
  if (out.balance_after && !out.balance_before && /^(balance|running balance)$/i.test(out.balance_after.trim())) delete out.balance_after;
  return out;
}

/** Cedis text to pesewas, keeping the sign. Accepts "1,250.50", "GHS 20", "(45.00)" and "-45". */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim().replace(/^(GHS|GH₵|GH¢|GHC|₵|¢)\s*/i, '').replace(/,/g, '').replace(/\s/g, '');
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const decimals = (m[2] ?? '').padEnd(3, '0');
  const value = Number(m[1]) * 100 + Number(decimals.slice(0, 2)) + (Number(decimals[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
/** Statement dates in the forms Ghanaian banks and MoMo use. Day comes before month (31/10/2026). */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  else if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[A-Za-z]*[\s-,]+(\d{2,4})/.exec(s)) && MONTHS[m[2].toLowerCase()]) [d, mo, y] = [Number(m[1]), MONTHS[m[2].toLowerCase()], Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  else {
    // Excel cells read as dates arrive as full date strings ("Sat Nov 14 2026 …"); anything shorter is not a date.
    if (!/[A-Za-z]{3}/.test(s) || !/\d{4}/.test(s)) return null;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const dt = new Date(t);
    [y, mo, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
  }
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return isCalendarDate(iso) ? iso : null;
}

// Money-in words are checked first, so 'Payment received' or 'Transfer from' is money in, not out.
const IN_WORDS = /\b(credit|cr|in|received|receive|deposit\w*|cash[ _]?in|incoming|transfer from|refund(ed)? to you|reversal)\b/i;
const OUT_WORDS = /\b(debit|dr|out|sent|send|payment|paid|withdraw\w*|transfer to|cash[ _]?out|purchase|bill)\b/i;

export interface StatementRow {
  lineNo: number; date: string | null; description: string | null; reference: string | null;
  amountIn: number; amountOut: number; errors: string[];
}

/**
 * Mobile Money statements (MTN's among them) list every amount as a plain number. Whether it came in or went out
 * shows in the balance: up is money in, down is money out. Fees and E-Levy are charged on top of the amount sent;
 * they become a line of their own, so a supplier paid GHS 500 still matches GHS 500.
 */

export function readStatementRows(table: string[][], mapping: StatementMapping): StatementRow[] {
  const headers = table[0] ?? [];
  const col = (f: StatementField) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const get = (cells: string[], f: StatementField) => { const i = col(f); return i >= 0 ? (cells[i] ?? '').trim() : ''; };
  const out: StatementRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const errors: string[] = [];
    const lineNo = i + 2;
    const date = parseStatementDate(get(cells, 'date'));
    if (!date) errors.push('The date could not be read');
    let amountIn = 0, amountOut = 0;
    const before = col('balance_before') >= 0 ? parseStatementAmount(get(cells, 'balance_before')) : null;
    const after = col('balance_after') >= 0 ? parseStatementAmount(get(cells, 'balance_after')) : null;
    const balanceSays = before != null && after != null && get(cells, 'balance_before') !== '' && get(cells, 'balance_after') !== '' && after !== before ? (after > before ? 'in' : 'out') : null;
    if (col('amount_in') >= 0 || col('amount_out') >= 0) {
      const a = parseStatementAmount(get(cells, 'amount_in')), b = parseStatementAmount(get(cells, 'amount_out'));
      if (a == null || b == null) errors.push('An amount could not be read');
      else { amountIn = Math.abs(a); amountOut = Math.abs(b); }
    } else {
      const v = parseStatementAmount(get(cells, 'amount'));
      if (v == null) errors.push('The amount could not be read');
      else {
        const dir = get(cells, 'direction');
        const isOut = balanceSays ? balanceSays === 'out' : v < 0 || (!IN_WORDS.test(dir) && OUT_WORDS.test(dir));
        if (isOut) amountOut = Math.abs(v); else amountIn = Math.abs(v);
      }
    }
    if (!errors.length && amountIn === 0 && amountOut === 0) errors.push('No amount on this line');
    if (amountIn > 0 && amountOut > 0) errors.push('A line cannot be both money in and money out');
    let description = get(cells, 'description') || null;
    if (!description) {
      // No description column: say what it was and who was on the other side, as the statement shows it.
      const who = amountIn > 0 ? get(cells, 'from_name') : get(cells, 'to_name');
      description = [get(cells, 'direction'), who].filter(Boolean).join(' ').replace(/_/g, ' ') || null;
    }
    const reference = get(cells, 'reference') || null;
    out.push({ lineNo, date, description, reference, amountIn, amountOut, errors });
    const fee = parseStatementAmount(get(cells, 'fees')), levy = parseStatementAmount(get(cells, 'levy'));
    const charges = Math.abs(fee ?? 0) + Math.abs(levy ?? 0);
    if (!errors.length && charges > 0) {
      const parts = [fee ? 'fees' : '', levy ? 'E-Levy' : ''].filter(Boolean).join(' and ');
      out.push({ lineNo, date, description: `Charges (${parts}) on line ${lineNo}`, reference, amountIn: 0, amountOut: charges, errors: [] });
    }
  });
  return out;
}

export const normaliseRef = (r: string | null | undefined) => (r ?? '').replace(/[\s-]/g, '').toUpperCase();

/**
 * Identifies a transaction across statements. `occurrence` counts identical lines within one file, so two genuine
 * same-day withdrawals of the same amount are two transactions, while the same pair in a later statement is not new.
 */
export function lineFingerprint(source: string, r: { date: string | null; amountIn: number; amountOut: number; reference: string | null; description: string | null }, occurrence = 1): string {
  return createHash('sha256').update([source, r.date, r.amountIn, r.amountOut, normaliseRef(r.reference), (r.description ?? '').trim().toLowerCase(), occurrence].join('|')).digest('hex');
}

/** Fingerprints for a whole file, numbering identical lines 1, 2, 3… in file order. */
export function fileFingerprints(source: string, rows: { date: string | null; amountIn: number; amountOut: number; reference: string | null; description: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => { const base = lineFingerprint(source, r, 0); const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return lineFingerprint(source, r, n); });
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/mansora/i, 'Mansora subscription'],
  [/\b(ecg|electric\w*|prepaid power|power)\b/i, 'Electricity'],
  [/\b(gwcl|water)\b/i, 'Water'],
  [/\b(rent|landlord)\b/i, 'Rent'],
  [/\b(airtime|data bundle|bundle|internet|wifi)\b/i, 'Airtime & data'],
  [/\b(uber|bolt|yango|taxi|trotro|transport|fuel|petrol|diesel|okada)\b/i, 'Transport'],
  [/\b(salary|salaries|wage|wages|staff pay)\b/i, 'Salaries'],
  [/\b(repair|mechanic|maintenance)\b/i, 'Repairs'],
  [/\b(charge|charges|fee|fees|levy|e-levy|commission|sms alert|cot|tax)\b/i, 'Bank charges'],
];
export function guessCategory(description: string | null): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(description ?? '')) return cat;
  return 'Other';
}
