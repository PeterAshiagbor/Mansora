import { z } from 'zod';
import { fail } from '@mansora/domain';
import { defineCommands, empty, zId, zMoney, zOptText, zText, type Ctx } from '../engine';
import { requireOpenShift } from '../stock';
import { closedThrough, requireOpenPeriod } from '../periods';

const zMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
function ownerOnly(ctx: Ctx, what: string) {
  if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', `Only the owner can ${what}`);
}
function record(ctx: Ctx, kind: string, date: string, reference: string, payload: Record<string, unknown>, id = ctx.id()) {
  ctx.insert('ledger_records', { id, kind, record_date: date, reference, payload: JSON.stringify(payload), created_by: ctx.user.id, created_at: ctx.now() });
  ctx.audit('ledger_record', id, { kind, reference, ...payload }, `ledger.${kind}`);
  return id;
}

/**
 * Audit F08: supplier payables. A purchase received on credit is owed at its cost plus any input tax recorded on the
 * same supplier invoice, less supplier payments recorded against it.
 */
export function payables(ctx: Ctx) {
  const today = ctx.now().slice(0, 10);
  const paid = new Map<string, number>();
  for (const r of ctx.all<{ payload: string }>(`SELECT payload FROM ledger_records WHERE kind = 'supplier_payment'`)) {
    const p = JSON.parse(r.payload); paid.set(p.purchaseId, (paid.get(p.purchaseId) ?? 0) + (Number(p.amount) || 0));
  }
  const rows = ctx.all(`SELECT p.id, p.reference, p.received_at, p.due_date, p.total_cost, p.supplier_id, s.name AS supplier_name,
      COALESCE((SELECT json_extract(t.payload, '$.originalTaxes.vat') + json_extract(t.payload, '$.originalTaxes.nhil') + json_extract(t.payload, '$.originalTaxes.getfund')
        FROM tax_records t WHERE t.kind = 'input' AND json_extract(t.payload, '$.purchaseId') = p.id LIMIT 1), 0) AS tax
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'on_credit' ORDER BY p.received_at`).map((r: any) => {
    const owed = r.total_cost + r.tax, settled = paid.get(r.id) ?? 0, outstanding = Math.max(0, owed - settled);
    const days = r.due_date ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 86_400_000) : 0;
    return { ...r, owed, paid: settled, outstanding, daysOverdue: Math.max(0, days), bucket: days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus' };
  });
  const open = rows.filter((r) => r.outstanding > 0);
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 } as Record<string, number>;
  for (const r of open) aging[r.bucket] += r.outstanding;
  const bySupplier = [...new Set(open.map((r) => r.supplier_id))].map((id) => ({ supplierId: id, supplier: open.find((r) => r.supplier_id === id)!.supplier_name, outstanding: open.filter((r) => r.supplier_id === id).reduce((t, r) => t + r.outstanding, 0) }));
  return { rows, open, aging, bySupplier, totalOutstanding: open.reduce((t, r) => t + r.outstanding, 0) };
}

export const ledgerCommands = defineCommands({
  'payable.list': {
    perm: 'purchase.manage',
    input: empty,
    run: (ctx) => {
      ctx.require('product.cost'); // supplier amounts reveal cost prices
      return payables(ctx);
    },
  },
  /** Pay a supplier invoice bought on credit, in full or in part. Cash from the till reduces the cashier's expected cash. */
  'supplier.pay': {
    perm: 'purchase.manage',
    mutates: true,
    input: z.object({ id: zId, purchaseId: zId, amount: zMoney, method: z.enum(['cash', 'momo', 'card', 'bank']), reference: zOptText(80), paidFromTill: z.boolean().default(false) }),
    run: (ctx, input) => {
      ctx.require('expense.manage');
      if (ctx.get('SELECT 1 FROM ledger_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      requireOpenPeriod(ctx, ctx.now());
      if (input.paidFromTill && input.method !== 'cash') fail('INVALID_INPUT', 'Only cash can be paid from the till');
      const row = payables(ctx).rows.find((r) => r.id === input.purchaseId);
      if (!row) fail('NOT_FOUND', 'That purchase was not bought on credit');
      if (input.amount <= 0 || input.amount > row.outstanding) fail('INVALID_AMOUNT', 'The payment must be more than zero and no more than the amount still owed', { outstanding: row.outstanding });
      const shift = input.paidFromTill ? requireOpenShift(ctx, 'paying a supplier from the till') : null;
      record(ctx, 'supplier_payment', ctx.now().slice(0, 10), input.reference ?? `Supplier payment ${row.reference ?? ''}`.trim(), {
        purchaseId: row.id, supplierId: row.supplier_id, amount: input.amount, method: input.method, reference: input.reference, shiftId: shift?.id ?? null,
      }, input.id);
      return { id: input.id, outstanding: row.outstanding - input.amount };
    },
  },
  'period.status': {
    perm: 'report.profit',
    input: empty,
    run: (ctx) => ({
      closedThrough: closedThrough(ctx),
      history: ctx.all(`SELECT l.id, l.kind, l.record_date, l.reference, l.payload, l.created_at, u.name AS created_by_name FROM ledger_records l JOIN users u ON u.id = l.created_by
        WHERE l.kind IN ('period_close','period_reopen') ORDER BY l.created_at DESC LIMIT 100`),
    }),
  },
  /** Close a finished month: nothing can afterwards be dated in it or earlier. */
  'period.close': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({ id: zId, month: zMonth, note: zText(400) }),
    run: (ctx, input) => {
      ownerOnly(ctx, 'close an accounting month');
      if (ctx.get('SELECT 1 FROM ledger_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      if (input.month >= ctx.now().slice(0, 7)) fail('PERIOD_NOT_ENDED', 'A month can only be closed after it has ended');
      const through = closedThrough(ctx);
      if (through && input.month <= through) fail('PERIOD_ALREADY_CLOSED', `Months up to ${through} are already closed`);
      const end = `${input.month}-31T23:59:59.999Z`;
      const open = ctx.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE status = 'open' AND opened_at <= ?`, end)!.n;
      if (open) fail('OPEN_SHIFTS', `Close the ${open} cashier shift(s) still open from this month before closing it`);
      return { id: record(ctx, 'period_close', `${input.month}-01`, `Close ${input.month}`, { month: input.month, note: input.note }, input.id), closedThrough: input.month };
    },
  },
  'period.reopen': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({ id: zId, month: zMonth, reason: zText(400) }),
    run: (ctx, input) => {
      ownerOnly(ctx, 'reopen an accounting month');
      if (ctx.get('SELECT 1 FROM ledger_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      const through = closedThrough(ctx);
      if (!through || input.month > through) fail('PERIOD_NOT_CLOSED', 'That month is not closed');
      return { id: record(ctx, 'period_reopen', `${input.month}-01`, `Reopen ${input.month}`, { month: input.month, reason: input.reason }, input.id), closedThrough: closedThrough(ctx) };
    },
  },
  /**
   * The computer's clock was fast and has been corrected backwards. The owner confirms the current time is right;
   * the confirmation is recorded and new transactions are allowed again from now.
   */
  'clock.acknowledge': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({ reason: zText(300) }),
    run: (ctx, input) => {
      ownerOnly(ctx, 'confirm the computer clock');
      const previous = ctx.setting('last_financial_at') ?? null;
      requireOpenPeriod(ctx, ctx.now());
      const id = record(ctx, 'clock_override', ctx.now().slice(0, 10), 'Clock confirmed', { previousLatest: previous, confirmedAt: ctx.now(), reason: input.reason });
      ctx.engine.setMeta('last_financial_at', ctx.now());
      return { id };
    },
  },
  /** Write off customer debt that will not be collected. Owner only; shown as a loss beside gross profit. */
  'credit.writeOff': {
    perm: 'credit.repayment',
    mutates: true,
    input: z.object({ id: zId, creditAccountId: zId, amount: zMoney, reason: zText(400) }),
    run: (ctx, input) => {
      ownerOnly(ctx, 'write off customer debt');
      if (ctx.get('SELECT 1 FROM ledger_records WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      requireOpenPeriod(ctx, ctx.now());
      const acc = ctx.get('SELECT * FROM credit_accounts WHERE id = ?', input.creditAccountId);
      if (!acc) fail('NOT_FOUND', 'Credit record not found');
      if (input.amount <= 0 || input.amount > acc.outstanding_balance) fail('INVALID_AMOUNT', 'The write-off must be more than zero and no more than the amount outstanding', { outstanding: acc.outstanding_balance });
      const outstanding = acc.outstanding_balance - input.amount;
      ctx.update('credit_accounts', acc.id, { outstanding_balance: outstanding, status: outstanding === 0 ? 'settled' : 'open', updated_at: ctx.now() });
      record(ctx, 'credit_writeoff', ctx.now().slice(0, 10), `Write-off ${acc.id.slice(0, 8)}`, { creditAccountId: acc.id, customerId: acc.customer_id, saleId: acc.sale_id, amount: input.amount, reason: input.reason }, input.id);
      return { id: input.id, outstanding };
    },
  },
});
