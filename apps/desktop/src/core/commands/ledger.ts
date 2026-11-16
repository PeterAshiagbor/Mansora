import { z } from 'zod';
import { fail } from '@mansora/domain';
import { defineCommands, empty, zId, zMoney, zText, type Ctx } from '../engine';
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

export const ledgerCommands = defineCommands({
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
