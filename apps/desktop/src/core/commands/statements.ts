import { z } from 'zod';
import { fail } from '@mansora/domain';
import { defineCommands, empty, zId, zText, type Ctx } from '../engine';
import { fileHash, readTable } from '../importer';
import { guessCategory, lineFingerprint, normaliseRef, readStatementRows, STATEMENT_FIELDS, suggestStatementMapping, type StatementRow } from '../statements';

const zFile = z.object({ fileName: zText(200), contentBase64: z.string().max(15_000_000) });
const zMapping = z.partialRecord(z.enum(STATEMENT_FIELDS), z.string().max(200));
const zSource = z.enum(['bank', 'momo']);

type Suggestion =
  | { kind: 'confirm'; matchType: 'payment' | 'repayment'; matchId: string; label: string; strength: 'reference' | 'amount' }
  | { kind: 'linked'; matchId: string; label: string }
  | { kind: 'expense'; category: string }
  | { kind: 'supplier'; supplier: string }
  | { kind: 'unmatched' };

const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Work out what a line most likely is, from what is already recorded in the shop. */
function suggest(ctx: Ctx, source: 'bank' | 'momo', r: StatementRow, taken: Set<string>): Suggestion {
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
  if (recorded.length >= 1) { taken.add(recorded[0].id); return { kind: 'linked', matchId: recorded[0].id, label: `${recorded[0].category}: ${recorded[0].description}` }; }
  const text = `${r.description ?? ''} ${r.reference ?? ''}`.toLowerCase();
  const supplier = (ctx.all(`SELECT name FROM suppliers`) as any[]).find((s) => s.name.trim().length >= 3 && text.includes(s.name.trim().toLowerCase()));
  if (supplier) return { kind: 'supplier', supplier: supplier.name };
  return { kind: 'expense', category: guessCategory(r.description) };
}

async function readFile(input: { fileName: string; contentBase64: string }) {
  const content = Buffer.from(input.contentBase64, 'base64');
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
      const rows = needsMapping ? [] : readStatementRows(table, mapping).map((r) => ({ ...r, duplicate: !!(r.date && !r.errors.length && ctx.get(`SELECT 1 FROM statement_lines WHERE fingerprint = ?`, lineFingerprint(input.source, r))) }));
      const already = ctx.get(`SELECT created_at FROM statement_imports WHERE file_hash = ?`, fileHash(content)) as { created_at: string } | undefined;
      return { headers, mapping, needsMapping, rows, alreadyImportedAt: already?.created_at ?? null };
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
      let duplicates = 0;
      for (const r of rows) {
        const fingerprint = lineFingerprint(input.source, r);
        const duplicate = !!ctx.get(`SELECT 1 FROM statement_lines WHERE fingerprint = ?`, fingerprint);
        if (duplicate) duplicates++;
        const s = duplicate ? null : suggest(ctx, input.source, r, taken);
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

  'statement.list': {
    perm: 'expense.manage',
    input: empty,
    run: (ctx) => ctx.all(`SELECT i.*, u.name AS imported_by_name,
        SUM(l.status = 'pending') AS pending, SUM(l.status = 'accepted') AS accepted, SUM(l.status = 'ignored') AS ignored, SUM(l.status = 'duplicate') AS duplicates,
        SUM(l.amount_in) AS total_in, SUM(l.amount_out) AS total_out
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
      for (const lineId of input.lineIds) {
        const l = ctx.get(`SELECT l.*, i.source FROM statement_lines l JOIN statement_imports i ON i.id = l.import_id WHERE l.id = ?`, lineId) as any;
        if (!l || l.status !== 'pending') { skipped.push(lineId); continue; }
        const s = l.suggestion ? JSON.parse(l.suggestion) as Suggestion : null;
        const chosen = input.categories?.[lineId];
        let matchType: string | null = null, matchId: string | null = null, category: string | null = null;
        if (s?.kind === 'confirm' && !chosen) { matchType = s.matchType; matchId = s.matchId; }
        else if (s?.kind === 'linked' && !chosen) { matchType = 'expense'; matchId = s.matchId; }
        else if (l.amount_out > 0 && (chosen || s?.kind === 'expense')) {
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
