import { z } from 'zod';
import { cashVariance, EXPENSE_METHODS, expectedCash, fail, isOvernightShift, SETTLEMENT_METHODS, zCalendarDate } from '@mansora/domain';
import { dayBounds, defineCommands, empty, likeContains, zApprover, zId, zMoney, zOptText, zRange, zText, type Ctx } from '../engine';
import { checkReferences, openShift, requireOpenShift } from '../stock';
import { requireOpenPeriod } from '../periods';

/** The last nine digits of a Ghanaian number, so 024 123 4567 and +233 24 123 4567 count as the same phone. */
export const phoneKey = (phone: string | null | undefined) => { const d = (phone ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };

/** Live cash position of a shift, straight from the transaction records. */
export function shiftTotals(ctx: Ctx, shift: any) {
  const one = (sql: string) => (ctx.get(sql, shift.id) as { v: number }).v;
  const parts = {
    openingFloat: shift.opening_float as number,
    cashSales: one(`SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND p.method = 'cash'`),
    cashRepayments: one(`SELECT COALESCE(SUM(amount), 0) AS v FROM credit_repayments WHERE shift_id = ? AND method = 'cash'`),
    cashRefunds: one(`SELECT COALESCE(SUM(payout_amount), 0) AS v FROM refunds WHERE shift_id = ? AND payout_method = 'cash'`),
    // Cash paid out of the till: expenses, and supplier invoices paid from the till (audit F08).
    cashExpenses: one(`SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ? AND payment_method = 'cash'`)
      + one(`SELECT COALESCE(SUM(json_extract(payload, '$.amount')), 0) AS v FROM ledger_records WHERE kind = 'supplier_payment' AND json_extract(payload, '$.shiftId') = ?`),
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

/**
 * Audit F12: blind cash count. While a shift is open, staff without shift review rights do not see how much cash the
 * till should hold, so the count cannot be made to match it. The expected figure and difference appear after closing.
 */
const BLIND_KEYS = ['cashSales', 'cashRepayments', 'cashRefunds', 'cashExpenses', 'cashIn', 'cashOut', 'expectedCash'] as const;
function blindTotals(ctx: Ctx, shift: any, totals: ReturnType<typeof shiftTotals>) {
  if (shift.status !== 'open' || ctx.can('shift.review')) return { ...totals, blind: false };
  const out: Record<string, unknown> = { ...totals, blind: true };
  for (const k of BLIND_KEYS) out[k] = null;
  return out;
}

export const peopleCommands = defineCommands({
  'customer.list': {
    perm: 'sale.create',
    input: z.object({ search: z.string().max(80).optional() }),
    run: (ctx, input) => {
      const text = (input.search ?? '').trim();
      const q = likeContains(text);
      // Phone numbers match however they are written: "024 111 2222", "0241112222" and "+233 24 111 2222".
      let digits = /^[+\d][\d\s()-]*$/.test(text) ? text.replace(/\D/g, '') : '';
      if (digits.startsWith('233')) digits = digits.slice(3);
      else if (digits.startsWith('0')) digits = digits.slice(1);
      return ctx.all(
        `SELECT c.*, COALESCE((SELECT SUM(outstanding_balance) FROM credit_accounts a WHERE a.customer_id = c.id), 0) AS outstanding
         FROM customers c WHERE c.active = 1 AND (c.name LIKE ? ESCAPE '\\' OR COALESCE(c.phone, '') LIKE ? ESCAPE '\\'
           OR (? <> '' AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.phone, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE '%' || ? || '%'))
         ORDER BY c.name LIMIT 500`,
        q, q, digits, digits,
      );
    },
  },
  /**
   * Add a new customer while selling (owner request 2026-11-14): the same details as the Customers page. Anyone who
   * makes sales can add one at the till (a cashier may sell on credit with a manager's approval, and needs the
   * customer to do it); editing existing customers stays with customer.manage. A phone number already on another
   * customer is refused, so the same person is not added twice.
   */
  'customer.add': {
    perm: 'sale.create',
    mutates: true,
    input: z.object({ tin: zOptText(80), address: zOptText(300), name: zText(120), phone: zOptText(40), email: z.string().trim().email().max(160).or(z.literal('')).nullish().transform((v) => v || null), notes: zOptText(500) }),
    run: (ctx, input) => {
      const key = phoneKey(input.phone);
      if (key) {
        const same = (ctx.all(`SELECT id, name, phone FROM customers WHERE active = 1 AND phone IS NOT NULL`) as any[]).find((c) => phoneKey(c.phone) === key);
        if (same) fail('DUPLICATE_CUSTOMER', `${same.name} already has this phone number. Choose them from the list instead.`, { id: same.id, name: same.name });
      }
      const now = ctx.now();
      const id = ctx.id();
      ctx.insert('customers', { id, tin: input.tin, address: input.address, name: input.name, phone: input.phone, email: input.email, notes: input.notes, active: 1, created_at: now, updated_at: now });
      ctx.audit('customer', id, { name: input.name, active: true, addedAtSale: true });
      return { id, name: input.name, phone: input.phone };
    },
  },
  'customer.save': {
    perm: 'customer.manage',
    mutates: true,
    input: z.object({ tin: z.string().trim().max(80).nullable().optional(), address: z.string().trim().max(300).nullable().optional(), id: zId.optional(), name: zText(120), phone: zOptText(40), email: z.string().trim().email().max(160).or(z.literal('')).nullish().transform((v) => v || null), notes: zOptText(500), active: z.boolean().default(true) }),
    run: (ctx, input) => {
      const now = ctx.now();
      const id = input.id ?? ctx.id();
      const prior = input.id ? ctx.get('SELECT tin, address FROM customers WHERE id = ?',input.id) : null;
      const row = { tin: input.tin === undefined ? prior?.tin ?? null : input.tin || null, address: input.address === undefined ? prior?.address ?? null : input.address || null, name: input.name, phone: input.phone, email: input.email, notes: input.notes, active: input.active ? 1 : 0, updated_at: now };
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
        // Audit F17: outstanding debt by days past its due date (no due date counts as current).
        aging: (() => {
          const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
          for (const r of ctx.all<{ due_date: string | null; outstanding_balance: number }>(`SELECT due_date, outstanding_balance FROM credit_accounts WHERE status = 'open' AND outstanding_balance > 0`)) {
            const days = r.due_date ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 86_400_000) : 0;
            const k = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
            buckets[k] += r.outstanding_balance;
          }
          return buckets;
        })(),
        writtenOff: ctx.all<{ payload: string }>(`SELECT payload FROM ledger_records WHERE kind = 'credit_writeoff'`).reduce((t, r) => t + (Number(JSON.parse(r.payload).amount) || 0), 0),
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
    input: z.object({ id: zId, creditAccountId: zId, amount: zMoney, method: z.enum(SETTLEMENT_METHODS), reference: zOptText(80), approver: zApprover }),
    run: (ctx, input) => {
      if (ctx.get('SELECT 1 FROM credit_repayments WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      const acc = ctx.get('SELECT * FROM credit_accounts WHERE id = ?', input.creditAccountId);
      if (!acc) fail('NOT_FOUND', 'Credit record not found');
      if (input.amount <= 0) fail('INVALID_AMOUNT', 'Enter a repayment amount');
      requireOpenPeriod(ctx, ctx.now());
      if (input.amount > acc.outstanding_balance) fail('REPAYMENT_TOO_LARGE', 'The repayment is more than the amount outstanding', { outstanding: acc.outstanding_balance });
      const referenceApprovedBy = input.method === 'cash' ? null : checkReferences(ctx, [input.reference], input.approver);
      const shift = input.method === 'cash' ? requireOpenShift(ctx, 'receiving cash') : openShift(ctx);
      const now = ctx.now();
      ctx.insert('credit_repayments', {
        id: input.id, credit_account_id: acc.id, customer_id: acc.customer_id, amount: input.amount, method: input.method, reference: input.reference,
        shift_id: shift?.id ?? null, received_by: ctx.user.id, created_at: now,
      });
      const outstanding = acc.outstanding_balance - input.amount;
      ctx.update('credit_accounts', acc.id, { outstanding_balance: outstanding, status: outstanding === 0 ? 'settled' : 'open', updated_at: now });
      ctx.audit('credit_account', acc.id, { repaymentId: input.id, amount: input.amount, method: input.method, outstanding, ...(referenceApprovedBy ? { referenceReuseApprovedBy: referenceApprovedBy } : {}) });
      return { id: input.id, outstanding };
    },
  },

  'expense.list': {
    perm: 'expense.manage',
    input: zRange,
    run: (ctx, input) => {
      dayBounds(input); // refuses a reversed range rather than showing an empty month
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
      id: zId, category: zText(60), description: zText(300), amount: zMoney, expenseDate: zCalendarDate,
      paymentMethod: z.enum(EXPENSE_METHODS), receiptReference: zOptText(80), paidFromTill: z.boolean().default(false),
    }),
    run: (ctx, input) => {
      if (ctx.get('SELECT 1 FROM expenses WHERE id = ?', input.id)) return { id: input.id, duplicate: true };
      if (input.amount <= 0) fail('INVALID_AMOUNT', 'Enter an expense amount');
      if (input.paidFromTill && input.paymentMethod !== 'cash') fail('INVALID_INPUT', 'Only cash expenses can be paid from the till');
      // Audit F07: an expense cannot be dated in the future, or in a closed month.
      if (input.expenseDate > ctx.now().slice(0, 10)) fail('INVALID_DATE', 'An expense cannot be dated in the future');
      requireOpenPeriod(ctx, input.expenseDate);
      if (input.paidFromTill && input.expenseDate !== ctx.now().slice(0, 10)) fail('INVALID_DATE', 'Cash paid from the till today must be dated today');
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
      return shift ? { shift, totals: blindTotals(ctx, shift, shiftTotals(ctx, shift)), overnight: isOvernightShift(shift.opened_at, ctx.now()) } : null;
    },
  },
  /** Every shift still open, for the owner and managers: who, since when, and whether it was left open overnight. */
  'shift.openList': {
    perm: 'shift.review',
    input: empty,
    run: (ctx) => {
      const now = ctx.now();
      return ctx.all(`SELECT s.id, s.opened_at, s.opening_float, u.name AS cashier_name, u.username FROM shifts s JOIN users u ON u.id = s.cashier_id WHERE s.status = 'open' ORDER BY s.opened_at`)
        .map((r: any) => ({ ...r, overnight: isOvernightShift(r.opened_at, now) }));
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
    input: z.object({ direction: z.enum(['in', 'out']), amount: zMoney, reason: zText(200), approver: zApprover }),
    run: (ctx, input) => {
      const shift = requireOpenShift(ctx, 'recording a cash movement');
      if (input.amount <= 0) fail('INVALID_AMOUNT', 'Enter an amount');
      requireOpenPeriod(ctx, ctx.now());
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
      return rows.map((s) => ({ ...s, totals: blindTotals(ctx, s, shiftTotals(ctx, s)) }));
    },
  },
  /**
   * An owner or manager closes a shift that someone else left open (they went home, or their login was replaced),
   * counting the cash in that till. Recorded against the person who closed it, with their reason.
   */
  'shift.closeFor': {
    perm: 'shift.review',
    mutates: true,
    input: z.object({ shiftId: zId, countedCash: zMoney, reason: zText(300) }),
    run: (ctx, input) => {
      const shift = ctx.get(`SELECT s.*, u.name AS cashier_name FROM shifts s JOIN users u ON u.id = s.cashier_id WHERE s.id = ?`, input.shiftId);
      if (!shift) fail('NOT_FOUND', 'Shift not found');
      if (shift.status !== 'open') fail('SHIFT_NOT_OPEN', 'This shift is already closed');
      if (shift.cashier_id === ctx.user.id) fail('INVALID_INPUT', 'Close your own shift from Your open shift');
      const totals = shiftTotals(ctx, shift);
      const variance = cashVariance(totals.expectedCash, input.countedCash);
      const notes = `Closed by ${ctx.user.name} for ${shift.cashier_name}: ${input.reason}`;
      ctx.update('shifts', shift.id, { status: 'closed', closed_at: ctx.now(), expected_cash: totals.expectedCash, counted_cash: input.countedCash, variance, notes });
      ctx.audit('shift', shift.id, { ...totals, countedCash: input.countedCash, variance, closedFor: shift.cashier_id, reason: input.reason });
      return { id: shift.id, expectedCash: totals.expectedCash, countedCash: input.countedCash, variance };
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
