import { z } from 'zod';
import { fail } from '@mansora/domain';
import { defineCommands, empty, zId, zText, type Ctx } from '../engine';
import { fileHash, readTable, toCsv, toXlsx } from '../importer';
import { fileFingerprints, guessCategory, isStatementHeader, normaliseRef, parseStatementDate, readStatementRows, STATEMENT_FIELDS, suggestStatementMapping, type StatementRow } from '../statements';
import { readPdfTable } from '../pdf-table';
import { tablePdf } from '../pdf-write';

const zFile = z.object({ fileName: zText(200), contentBase64: z.string().max(15_000_000) });
const zMapping = z.partialRecord(z.enum(STATEMENT_FIELDS), z.string().max(200));
const zSource = z.enum(['bank', 'momo']);

type Suggestion =
  | { kind: 'confirm'; matchType: 'payment' | 'repayment'; matchId: string; label: string; strength: 'reference' | 'amount' }
  | { kind: 'linked'; matchType: 'expense' | 'refund'; matchId: string; label: string }
  | { kind: 'expense'; category: string }
  | { kind: 'supplier'; supplier: string }
  | { kind: 'unmatched' };

const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Work out what a line most likely is, from what is already recorded in the shop. */
type Row = Pick<StatementRow, 'date' | 'description' | 'reference' | 'amountIn' | 'amountOut'>;
function suggest(ctx: Ctx, source: 'bank' | 'momo', r: Row, taken: Set<string>, suppliers: string[]): Suggestion {
  const ref = normaliseRef(r.reference);
  const from = addDays(r.date!, -1), to = addDays(r.date!, 2);
  const free = (id: string) => !taken.has(id) && !ctx.get(`SELECT 1 FROM statement_lines WHERE match_id = ? AND status = 'accepted'`, id);
  if (r.amountIn > 0) {
    const methods = source === 'momo' ? ['momo'] : ['card', 'momo'];
    const sales = ctx.all(`SELECT p.id, p.amount, p.reference, s.receipt_no, substr(s.created_at, 1, 10) AS day FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.method IN (${methods.map(() => '?').join(',')}) AND p.amount = ?`, ...methods, r.amountIn) as any[];
    const repaid = ctx.all(`SELECT r.id, r.amount, r.reference, c.name, substr(r.created_at, 1, 10) AS day FROM credit_repayments r JOIN customers c ON c.id = r.customer_id
      WHERE r.method IN (${methods.map(() => '?').join(',')}) AND r.amount = ?`, ...methods, r.amountIn) as any[];
    const candidates = [
      ...sales.map((p) => ({ type: 'payment' as const, id: p.id, ref: normaliseRef(p.reference), day: p.day, label: `Sale ${p.receipt_no}` })),
      ...repaid.map((p) => ({ type: 'repayment' as const, id: p.id, ref: normaliseRef(p.reference), day: p.day, label: `Debt repayment from ${p.name}` })),
    ].filter((c) => free(c.id));
    const byRef = ref ? candidates.filter((c) => c.ref && (c.ref === ref || ref.includes(c.ref) || c.ref.includes(ref))) : [];
    const byDay = candidates.filter((c) => c.day >= from && c.day <= to);
    const pick = byRef.length === 1 ? { c: byRef[0], strength: 'reference' as const } : byDay.length === 1 ? { c: byDay[0], strength: 'amount' as const } : null;
    if (pick) { taken.add(pick.c.id); return { kind: 'confirm', matchType: pick.c.type, matchId: pick.c.id, label: pick.c.label, strength: pick.strength }; }
    return { kind: 'unmatched' };
  }
  const method = source === 'bank' ? 'bank' : 'momo';
  const recorded = (ctx.all(`SELECT id, category, description FROM expenses WHERE amount = ? AND payment_method = ? AND expense_date >= ? AND expense_date <= ?`, r.amountOut, method, addDays(r.date!, -2), to) as any[]).filter((e) => free(e.id));
  if (recorded.length >= 1) { taken.add(recorded[0].id); return { kind: 'linked', matchType: 'expense', matchId: recorded[0].id, label: `${recorded[0].category}: ${recorded[0].description}` }; }
  // A refund paid back to a customer already reduced sales: it must never become an expense as well.
  const payout = source === 'momo' ? ['momo'] : ['momo', 'card'];
  const refunds = (ctx.all(`SELECT f.id, f.refund_no FROM refunds f WHERE f.payout_method IN (${payout.map(() => '?').join(',')}) AND f.payout_amount = ? AND substr(f.created_at, 1, 10) >= ? AND substr(f.created_at, 1, 10) <= ?`,
    ...payout, r.amountOut, addDays(r.date!, -2), to) as any[]).filter((f) => free(f.id));
  if (refunds.length >= 1) { taken.add(refunds[0].id); return { kind: 'linked', matchType: 'refund', matchId: refunds[0].id, label: `Refund ${refunds[0].refund_no}` }; }
  const text = `${r.description ?? ''} ${r.reference ?? ''}`.toLowerCase();
  const supplier = suppliers.find((name) => name.trim().length >= 3 && text.includes(name.trim().toLowerCase()));
  if (supplier) return { kind: 'supplier', supplier };
  return { kind: 'expense', category: guessCategory(r.description) };
}

/** Marks a practice statement made by Mansora, so the screen can warn before anything is accepted from it. */
export const PRACTICE_MARK = 'MANSORA PRACTICE';
const MTN_HEADER = ['TRANSACTION DATE', 'FROM ACCT', 'FROM NAME', 'FROM NO.', 'TRANS. TYPE', 'AMOUNT', 'FEES', 'E-LEVY', 'BAL BEFORE', 'BAL AFTER', 'TO NO.', 'TO NAME', 'TO ACCT', 'F_ID', 'REF', 'OVA'];
const cedis = (p: number) => (p / 100).toFixed(2);

/**
 * A practice Mobile Money statement in MTN's layout, built from this shop's own Mobile Money sales of the last 14
 * days plus typical shop spending (power, airtime, transport, a supplier, the Mansora subscription) and one deposit
 * nothing matches. Used to try the import in a test shop; every line is marked MANSORA PRACTICE.
 */
function practiceStatement(ctx: Ctx): string[][] {
  const shop = String(ctx.setting('business_name') ?? 'MY SHOP').toUpperCase().slice(0, 40);
  const wallet = '233240000000';
  const now = Date.parse(ctx.now());
  const stamp = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  let fid = 61000000000 + (now % 1_000_000) * 100;
  const events: { t: number; type: string; amount: number; fee: number; inbound: boolean; name: string; number: string; ref?: string }[] = [];
  const sales = ctx.all(`SELECT p.amount, p.reference, s.created_at FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.method = 'momo' AND s.created_at >= ? ORDER BY s.created_at LIMIT 15`, new Date(now - 14 * 86_400_000).toISOString()) as any[];
  const payers = ['AMA MENSAH', 'KOJO BOATENG', 'ABENA OWUSU', 'YAW DARKO', 'EFUA ASARE'];
  sales.forEach((p, i) => events.push({ t: Date.parse(p.created_at) + 60_000, type: 'TRANSFER', amount: p.amount, fee: 0, inbound: true, name: payers[i % payers.length], number: `23324${String(1000000 + i * 7919).slice(0, 7)}`, ref: p.reference || undefined }));
  const supplier = (ctx.get(`SELECT name FROM suppliers ORDER BY name LIMIT 1`) as any)?.name ?? 'WHOLESALE SUPPLIER';
  const day = (n: number, h: number) => now - n * 86_400_000 + h * 3_600_000 - 12 * 3_600_000;
  events.push(
    { t: day(6, 2), type: 'PAYMENT', amount: 5000, fee: 50, inbound: false, name: 'ECG PREPAID', number: '' },
    { t: day(5, 1), type: 'DEBIT', amount: 1000, fee: 0, inbound: false, name: 'AIRTIME TOPUP', number: '' },
    { t: day(4, 3), type: 'TRANSFER', amount: 40000, fee: 300, inbound: false, name: String(supplier).toUpperCase(), number: '233201234567' },
    { t: day(3, 4), type: 'PAYMENT', amount: 2500, fee: 0, inbound: false, name: 'BOLT GHANA TRANSPORT', number: '' },
    { t: day(2, 2), type: 'PAYMENT', amount: 12900, fee: 0, inbound: false, name: 'MANSORA CONSULTING', number: '' },
    { t: day(1, 5), type: 'TRANSFER', amount: 6000, fee: 0, inbound: true, name: 'KWAME ASANTE', number: '233551234567' },
  );
  events.sort((a, b) => a.t - b.t);
  let balance = 85000;
  const rows = events.map((e) => {
    const before = balance;
    balance = e.inbound ? balance + e.amount : balance - e.amount - e.fee;
    const from = e.inbound ? [`FRI:${e.number || '233200000000'}/MSISDN`, e.name, e.number] : [`FRI:${wallet}/MSISDN`, shop, wallet];
    const to = e.inbound ? [wallet, shop, `FRI:${wallet}/MSISDN`] : [e.number, e.name, e.number ? `FRI:${e.number}/MSISDN` : ''];
    fid += 137;
    return [stamp(e.t), ...from, e.type, cedis(e.amount), cedis(e.fee), '0.00', cedis(before), cedis(balance), ...to, e.ref ?? String(fid), PRACTICE_MARK, ''];
  });
  return [MTN_HEADER, ...rows];
}

async function readFile(input: { fileName: string; contentBase64: string }) {
  const content = Buffer.from(input.contentBase64, 'base64');
  // Mobile Money statements arrive as PDF; banks usually offer Excel or CSV.
  if (/\.pdf$/i.test(input.fileName)) return { content, table: await readPdfTable(content, { isHeader: isStatementHeader, isDate: (c) => !!parseStatementDate(c) }) };
  return { content, table: await readTable(input.fileName, content) };
}

export const statementCommands = defineCommands({
  /** Read a statement file and show how its lines will be understood. Saves nothing. */
  'statement.preview': {
    perm: 'expense.manage',
    async: true,
    input: zFile.extend({ source: zSource, mapping: zMapping.optional() }),
    run: async (ctx, input) => {
      const { content, table } = await readFile(input);
      const headers = table[0] ?? [];
      const mapping = input.mapping ?? suggestStatementMapping(headers);
      const needsMapping = !mapping.date || !(mapping.amount || mapping.amount_in || mapping.amount_out);
      const read = needsMapping ? [] : readStatementRows(table, mapping);
      const prints = fileFingerprints(input.source, read);
      const rows = read.map((r, i) => ({ ...r, duplicate: !!(r.date && !r.errors.length && ctx.get(`SELECT 1 FROM statement_lines WHERE fingerprint = ?`, prints[i])) }));
      const already = ctx.get(`SELECT created_at FROM statement_imports WHERE file_hash = ?`, fileHash(content)) as { created_at: string } | undefined;
      const practice = table.some((cells) => cells.some((c) => c.trim().toUpperCase() === PRACTICE_MARK));
      return { headers, mapping, needsMapping, rows, practice, alreadyImportedAt: already?.created_at ?? null };
    },
  },

  /** Save a statement's lines with a suggestion for each. Lines with errors are left out; repeated lines are marked. */
  'statement.import': {
    perm: 'expense.manage',
    async: true,
    input: zFile.extend({ source: zSource, mapping: zMapping, accountName: zText(80).optional() }),
    run: async (ctx, input) => {
      const { content, table } = await readFile(input);
      const hash = fileHash(content);
      if (ctx.get(`SELECT 1 FROM statement_imports WHERE file_hash = ?`, hash)) fail('ALREADY_IMPORTED', 'This statement file was already imported');
      const rows = readStatementRows(table, input.mapping).filter((r) => !r.errors.length);
      if (!rows.length) fail('NOTHING_TO_IMPORT', 'No line in this file could be read. Check the column matching.');
      return ctx.tx(() => {
      const id = ctx.id();
      ctx.insert('statement_imports', { id, source: input.source, account_name: input.accountName ?? null, file_name: input.fileName, file_hash: hash, line_count: rows.length, imported_by: ctx.user.id, created_at: ctx.now() });
      const taken = new Set<string>();
      const suppliers = (ctx.all(`SELECT name FROM suppliers`) as any[]).map((x) => String(x.name));
      const prints = fileFingerprints(input.source, rows);
      let duplicates = 0;
      for (const [i, r] of rows.entries()) {
        const fingerprint = prints[i];
        const duplicate = !!ctx.get(`SELECT 1 FROM statement_lines WHERE fingerprint = ?`, fingerprint);
        if (duplicate) duplicates++;
        const s = duplicate ? null : suggest(ctx, input.source, r, taken, suppliers);
        ctx.insert('statement_lines', {
          id: ctx.id(), import_id: id, line_no: r.lineNo, txn_date: r.date, description: r.description, reference: r.reference,
          amount_in: r.amountIn, amount_out: r.amountOut, fingerprint, status: duplicate ? 'duplicate' : 'pending', suggestion: s ? JSON.stringify(s) : null,
          match_type: null, match_id: null, category: s?.kind === 'expense' ? s.category : null, decided_by: null, decided_at: null,
        });
      }
      ctx.audit('statement_import', id, { source: input.source, lines: rows.length, duplicates });
      return { id, lines: rows.length, duplicates };
      });
    },
  },

  /** A practice MTN Mobile Money statement for trying the import (see practiceStatement). */
  'statement.sample': {
    perm: 'expense.manage',
    async: true,
    input: z.object({ format: z.enum(['csv', 'xlsx', 'pdf']) }),
    run: async (ctx, input) => {
      const rows = practiceStatement(ctx);
      const name = 'mansora-practice-momo-statement';
      if (input.format === 'pdf') {
        return { fileName: `${name}.pdf`, mime: 'application/pdf', contentBase64: tablePdf(`Mobile Money statement (practice) - ${PRACTICE_MARK}`, rows).toString('base64') };
      }
      return input.format === 'csv'
        ? { fileName: `${name}.csv`, mime: 'text/csv', contentBase64: Buffer.from(toCsv(rows)).toString('base64') }
        : { fileName: `${name}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: (await toXlsx([{ name: 'Statement', rows }])).toString('base64') };
    },
  },

  'statement.list': {
    perm: 'expense.manage',
    input: empty,
    run: (ctx) => ctx.all(`SELECT i.*, u.name AS imported_by_name,
        SUM(l.status = 'pending') AS pending, SUM(l.status = 'accepted') AS accepted, SUM(l.status = 'ignored') AS ignored, SUM(l.status = 'duplicate') AS duplicates,
        SUM(CASE WHEN l.status <> 'duplicate' THEN l.amount_in ELSE 0 END) AS total_in, SUM(CASE WHEN l.status <> 'duplicate' THEN l.amount_out ELSE 0 END) AS total_out
      FROM statement_imports i JOIN users u ON u.id = i.imported_by LEFT JOIN statement_lines l ON l.import_id = i.id GROUP BY i.id ORDER BY i.created_at DESC LIMIT 100`),
  },

  'statement.lines': {
    perm: 'expense.manage',
    input: z.object({ importId: zId }),
    run: (ctx, input) => {
      const imp = ctx.get(`SELECT * FROM statement_imports WHERE id = ?`, input.importId);
      if (!imp) fail('NOT_FOUND', 'Statement not found');
      const lines = (ctx.all(`SELECT * FROM statement_lines WHERE import_id = ? ORDER BY line_no`, input.importId) as any[])
        .map((l) => ({ ...l, suggestion: l.suggestion ? JSON.parse(l.suggestion) : null }));
      return { import: imp, lines };
    },
  },

  /**
   * Accept lines. A confirmation links money in to the sale or repayment it matches; money out becomes an expense
   * (with the suggested category, or one chosen for that line), or is linked to the expense already recorded.
   * Supplier payments and unmatched money in need a category chosen before they can be accepted as an expense.
   */
  'statement.accept': {
    perm: 'expense.manage',
    mutates: true,
    input: z.object({ lineIds: z.array(zId).min(1).max(2000), categories: z.record(z.string(), zText(60)).optional() }),
    run: (ctx, input) => {
      let accepted = 0, expenses = 0; const skipped: string[] = [];
      const taken = new Set<string>();
      const suppliers = (ctx.all(`SELECT name FROM suppliers`) as any[]).map((x) => String(x.name));
      for (const lineId of input.lineIds) {
        const l = ctx.get(`SELECT l.*, i.source FROM statement_lines l JOIN statement_imports i ON i.id = l.import_id WHERE l.id = ?`, lineId) as any;
        if (!l || l.status !== 'pending') { skipped.push(lineId); continue; }
        // Work the suggestion out again now: since the import, another line may have claimed the same payment or
        // expense, or the expense may have been typed in by hand. Accepting must never record anything twice.
        const s = suggest(ctx, l.source, { date: l.txn_date, description: l.description, reference: l.reference, amountIn: l.amount_in, amountOut: l.amount_out }, taken, suppliers);
        ctx.update('statement_lines', lineId, { suggestion: JSON.stringify(s) });
        const chosen = input.categories?.[lineId];
        let matchType: string | null = null, matchId: string | null = null, category: string | null = null;
        if (s.kind === 'confirm' && !chosen) { matchType = s.matchType; matchId = s.matchId; }
        else if (s.kind === 'linked') { matchType = s.matchType; matchId = s.matchId; }
        else if (l.amount_out > 0 && (chosen || s.kind === 'expense')) {
          category = chosen ?? (s as { category: string }).category;
          const expenseId = ctx.id();
          ctx.insert('expenses', {
            id: expenseId, category, description: (l.description || `${l.source === 'bank' ? 'Bank' : 'Mobile Money'} statement line ${l.line_no}`).slice(0, 300),
            amount: l.amount_out, expense_date: l.txn_date, payment_method: l.source === 'bank' ? 'bank' : 'momo', receipt_reference: l.reference ? String(l.reference).slice(0, 80) : null,
            shift_id: null, created_by: ctx.user.id, created_at: ctx.now(),
          });
          ctx.audit('expense', expenseId, { category, amount: l.amount_out, fromStatementLine: lineId });
          matchType = 'expense'; matchId = expenseId; expenses++;
        } else { skipped.push(lineId); continue; }
        ctx.update('statement_lines', lineId, { status: 'accepted', match_type: matchType, match_id: matchId, category, decided_by: ctx.user.id, decided_at: ctx.now() });
        accepted++;
      }
      ctx.audit('statement_accept', null, { accepted, expenses, skipped: skipped.length });
      return { accepted, expenses, skipped };
    },
  },

  'statement.ignore': {
    perm: 'expense.manage',
    mutates: true,
    input: z.object({ lineIds: z.array(zId).min(1).max(2000) }),
    run: (ctx, input) => {
      let ignored = 0;
      for (const lineId of input.lineIds) {
        const l = ctx.get(`SELECT status FROM statement_lines WHERE id = ?`, lineId) as any;
        if (!l || l.status !== 'pending') continue;
        ctx.update('statement_lines', lineId, { status: 'ignored', decided_by: ctx.user.id, decided_at: ctx.now() });
        ignored++;
      }
      return { ignored };
    },
  },
});
