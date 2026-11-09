import { z } from 'zod';
import { cashVariance, expectedCash, fail, SETTLEMENT_METHODS } from '@mansora/domain';
import { dayBounds, defineCommands, empty, zId, zMoney, zOptText, zRange, zText, type Ctx } from '../engine';
import { openShift, requireOpenShift } from '../stock';

/** Live cash position of a shift, straight from the transaction records. */
export function shiftTotals(ctx: Ctx, shift: any) {
  const one = (sql: string) => (ctx.get(sql, shift.id) as { v: number }).v;
  const parts = {
    openingFloat: shift.opening_float as number,
    cashSales: one(`SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND p.method = 'cash'`),
    cashRepayments: one(`SELECT COALESCE(SUM(amount), 0) AS v FROM credit_repayments WHERE shift_id = ? AND method = 'cash'`),
    cashRefunds: one(`SELECT COALESCE(SUM(payout_amount), 0) AS v FROM refunds WHERE shift_id = ? AND payout_method = 'cash'`),
    cashExpenses: one(`SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ? AND payment_method = 'cash'`),
    cashIn: one(`SELECT COALESCE(SUM(amount), 0) AS v FROM shift_cash_movements WHERE shift_id = ? AND direction = 'in'`),
    cashOut: one(`SELECT COALESCE(SUM(amount), 0) AS v FROM shift_cash_movements WHERE shift_id = ? AND direction = 'out'`),
  };
  return {
    ...parts,
    expectedCash: expectedCash(parts),
    nonCashSales: one(`SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND p.method <> 'cash'`),
    salesCount: one('SELECT COUNT(*) AS v FROM sales WHERE shift_id = ?'),
    salesTotal: one('SELECT COALESCE(SUM(total), 0) AS v FROM sales WHERE shift_id = ?'),
  };
}

export const peopleCommands = defineCommands({
  'customer.list': {
    perm: 'sale.create',
    input: z.object({ search: z.string().max(80).optional() }),
    run: (ctx, input) => {
      const q = `%${(input.search ?? '').trim()}%`;
      return ctx.all(
        `SELECT c.*, COALESCE((SELECT SUM(outstanding_balance) FROM credit_accounts a WHERE a.customer_id = c.id), 0) AS outstanding
         FROM customers c WHERE c.active = 1 AND (c.name LIKE ? OR COALESCE(c.phone, '') LIKE ?) ORDER BY c.name LIMIT 500`,
        q, q,
      );
    },
  },
  'customer.save': {
    perm: 'customer.manage',
    mutates: true,
    input: z.object({ id: zId.optional(), name: zText(120), phone: zOptText(40), email: z.string().trim().email().max(160).or(z.literal('')).nullish().transform((v) => v || null), notes: zOptText(500), active: z.boolean().default(true) }),
    run: (ctx, input) => {
      const now = ctx.now();
      const id = input.id ?? ctx.id();
      const row = { name: input.name, phone: input.phone, email: input.email, notes: input.notes, active: input.active ? 1 : 0, updated_at: now };
      if (input.id) ctx.update('customers', id, row);
      else ctx.insert('customers', { id, ...row, created_at: now });
      ctx.audit('customer', id, { name: input.name, active: input.active });
      return { id };
    },
  },
  'customer.get': {
    perm: 'customer.manage',
    input: z.object({ id: zId }),
    run: (ctx, input) => ({
      customer: ctx.get('SELECT * FROM customers WHERE id = ?', input.id),
      sales: ctx.all('SELECT id, receipt_no, created_at, total FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200', input.id),
      credit: ctx.all('SELECT a.*, s.receipt_no FROM credit_accounts a JOIN sales s ON s.id = a.sale_id WHERE a.customer_id = ? ORDER BY a.created_at DESC', input.id),
      repayments: ctx.all('SELECT r.*, u.name AS received_by_name FROM credit_repayments r JOIN users u ON u.id = r.received_by WHERE r.customer_id = ? ORDER BY r.created_at DESC', input.id),
    }),
  },

  'credit.list': {
    perm: 'credit.repayment',
    input: z.object({ status: z.enum(['open', 'all']).default('open') }),
    run: (ctx, input) => {
      const today = ctx.now().slice(0, 10);
      const accounts = ctx.all(
        `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, s.receipt_no,
                CASE WHEN a.status = 'open' AND a.due_date IS NOT NULL AND a.due_date < ? THEN 1 ELSE 0 END AS overdue
         FROM credit_accounts a JOIN customers c ON c.id = a.customer_id JOIN sales s ON s.id = a.sale_id
         ${input.status === 'open' ? `WHERE a.status = 'open'` : ''} ORDER BY a.created_at DESC LIMIT 1000`,
        today,
      );
      return {
        accounts,
        totalOutstanding: (ctx.get(`SELECT COALESCE(SUM(outstanding_balance), 0) AS v FROM credit_accounts`) as any).v as number,
        totalOverdue: (ctx.get(`SELECT COALESCE(SUM(outstanding_balance), 0) AS v FROM credit_accounts WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ?`, today) as any).v as number,
        recentRepayments: ctx.all(
          `SELECT r.*, c.name AS customer_name, u.name AS received_by_name FROM credit_repayments r
           JOIN customers c ON c.id = r.customer_id JOIN users u ON u.id = r.received_by ORDER BY r.created_at DESC LIMIT 50`,
        ),
      };
    },
  },
  /** A repayment reduces an existing credit balance. It is never a new sale. */
  'credit.repay': {
    perm: 'credit.repayment',
    mutates: true,
    input: z.object({ id: zId, creditAccountId: zId, amount: zMoney, method: z.enum(SETTLEMENT_METHODS), reference: zOptText(80) }),
    run: (ctx, input) => {
      if (ctx.get('SELECT 1 FROM credit_repayments WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      const acc = ctx.get('SELECT * FROM credit_accounts WHERE id = ?', input.creditAccountId);
      if (!acc) fail('NOT_FOUND', 'Credit record not found');
      if (input.amount <= 0) fail('INVALID_AMOUNT', 'Enter a repayment amount');
      if (input.amount > acc.outstanding_balance) fail('REPAYMENT_TOO_LARGE', 'The repayment is more than the amount outstanding', { outstanding: acc.outstanding_balance });
      const shift = input.method === 'cash' ? requireOpenShift(ctx, 'receiving cash') : openShift(ctx);
      const now = ctx.now();
      ctx.insert('credit_repayments', {
        id: input.id, credit_account_id: acc.id, customer_id: acc.customer_id, amount: input.amount, method: input.method, reference: input.reference,
        shift_id: shift?.id ?? null, received_by: ctx.user.id, created_at: now,
      });
      const outstanding = acc.outstanding_balance - input.amount;
      ctx.update('credit_accounts', acc.id, { outstanding_balance: outstanding, status: outstanding === 0 ? 'settled' : 'open', updated_at: now });
      ctx.audit('credit_account', acc.id, { repaymentId: input.id, amount: input.amount, method: input.method, outstanding });
      return { id: input.id, outstanding };
    },
  },

  'expense.list': {
    perm: 'expense.manage',
    input: zRange,
    run: (ctx, input) => {
      const rows = ctx.all(
        `SELECT e.*, u.name AS created_by_name FROM expenses e JOIN users u ON u.id = e.created_by
         WHERE e.expense_date >= ? AND e.expense_date <= ? ORDER BY e.expense_date DESC, e.created_at DESC`,
        input.from, input.to,
      );
      const group = (col: string) => ctx.all(`SELECT ${col} AS key, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE expense_date >= ? AND expense_date <= ? GROUP BY 1 ORDER BY 2 DESC`, input.from, input.to);
      return { rows, byCategory: group('category'), byMethod: group('payment_method'), byMonth: group('substr(expense_date, 1, 7)'), total: rows.reduce((a, r) => a + r.amount, 0) };
    },
  },
  'expense.create': {
    perm: 'expense.manage',
    mutates: true,
    input: z.object({
      id: zId, category: zText(60), description: zText(300), amount: zMoney, expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      paymentMethod: z.enum(SETTLEMENT_METHODS), receiptReference: zOptText(80), paidFromTill: z.boolean().default(false),
    }),
    run: (ctx, input) => {
      if (ctx.get('SELECT 1 FROM expenses WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      if (input.amount <= 0) fail('INVALID_AMOUNT', 'Enter an expense amount');
      if (input.paidFromTill && input.paymentMethod !== 'cash') fail('INVALID_INPUT', 'Only cash expenses can be paid from the till');
      // Only cash taken from the till affects the cashier's expected cash.
      const shift = input.paidFromTill ? requireOpenShift(ctx, 'paying an expense from the till') : null;
      ctx.insert('expenses', {
        id: input.id, category: input.category, description: input.description, amount: input.amount, expense_date: input.expenseDate,
        payment_method: input.paymentMethod, receipt_reference: input.receiptReference, shift_id: shift?.id ?? null, created_by: ctx.user.id, created_at: ctx.now(),
      });
      ctx.audit('expense', input.id, { category: input.category, amount: input.amount, paidFromTill: input.paidFromTill });
      return { id: input.id };
    },
  },

  'shift.current': {
    perm: 'shift.own',
    input: empty,
    run: (ctx) => {
      const shift = openShift(ctx);
      return shift ? { shift, totals: shiftTotals(ctx, shift) } : null;
    },
  },
  'shift.open': {
    perm: 'shift.own',
    mutates: true,
    input: z.object({ openingFloat: zMoney }),
    run: (ctx, input) => {
      if (openShift(ctx)) fail('SHIFT_ALREADY_OPEN', 'You already have an open shift');
      const id = ctx.id();
      ctx.insert('shifts', { id, cashier_id: ctx.user.id, status: 'open', opening_float: input.openingFloat, opened_at: ctx.now() });
      ctx.audit('shift', id, { openingFloat: input.openingFloat });
      return { id };
    },
  },
  /** Pay-in / pay-out of till cash that is not a sale (e.g. banking cash, adding change). Needs a supervisor. */
  'shift.cashMovement': {
    perm: 'shift.own',
    mutates: true,
    input: z.object({ direction: z.enum(['in', 'out']), amount: zMoney, reason: zText(200), approver: z.object({ username: z.string(), password: z.string() }).nullish() }),
    run: (ctx, input) => {
      const shift = requireOpenShift(ctx, 'recording a cash movement');
      if (input.amount <= 0) fail('INVALID_AMOUNT', 'Enter an amount');
      const authorisedBy = ctx.authorise('shift.review', input.approver);
      const id = ctx.id();
      ctx.insert('shift_cash_movements', { id, shift_id: shift.id, direction: input.direction, amount: input.amount, reason: input.reason, authorised_by: authorisedBy, created_at: ctx.now() });
      ctx.audit('shift', shift.id, { cashMovementId: id, direction: input.direction, amount: input.amount, reason: input.reason, authorisedBy });
      return { id };
    },
  },
  'shift.close': {
    perm: 'shift.own',
    mutates: true,
    input: z.object({ countedCash: zMoney, notes: zOptText(500) }),
    run: (ctx, input) => {
      const shift = requireOpenShift(ctx, 'closing it');
      const totals = shiftTotals(ctx, shift);
      const variance = cashVariance(totals.expectedCash, input.countedCash);
      ctx.update('shifts', shift.id, { status: 'closed', closed_at: ctx.now(), expected_cash: totals.expectedCash, counted_cash: input.countedCash, variance, notes: input.notes });
      ctx.audit('shift', shift.id, { ...totals, countedCash: input.countedCash, variance });
      return { id: shift.id, expectedCash: totals.expectedCash, countedCash: input.countedCash, variance };
    },
  },
  'shift.list': {
    perm: 'shift.own',
    input: zRange,
    run: (ctx, input) => {
      const [from, to] = dayBounds(input);
      const mine = ctx.can('shift.review') ? '' : 'AND s.cashier_id = ?';
      const rows = ctx.all(
        `SELECT s.*, u.name AS cashier_name, r.name AS reviewed_by_name FROM shifts s JOIN users u ON u.id = s.cashier_id LEFT JOIN users r ON r.id = s.reviewed_by
         WHERE s.opened_at >= ? AND s.opened_at < ? ${mine} ORDER BY s.opened_at DESC`,
        ...(mine ? [from, to, ctx.user.id] : [from, to]),
      );
      return rows.map((s) => ({ ...s, totals: shiftTotals(ctx, s) }));
    },
  },
  'shift.review': {
    perm: 'shift.review',
    mutates: true,
    input: z.object({ id: zId, reviewNotes: zOptText(500) }),
    run: (ctx, input) => {
      const shift = ctx.get('SELECT * FROM shifts WHERE id = ?', input.id);
      if (!shift) fail('NOT_FOUND', 'Shift not found');
      if (shift.status !== 'closed') fail('INVALID_STATE', 'Only a closed shift that has not been signed off can be reviewed');
      if (shift.cashier_id === ctx.user.id && ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'You cannot sign off your own shift');
      ctx.update('shifts', shift.id, { status: 'reviewed', reviewed_by: ctx.user.id, reviewed_at: ctx.now(), review_notes: input.reviewNotes });
      ctx.audit('shift', shift.id, { variance: shift.variance, reviewNotes: input.reviewNotes });
      return { id: shift.id };
    },
  },
});
