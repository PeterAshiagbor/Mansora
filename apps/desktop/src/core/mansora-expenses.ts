import { createHash } from 'node:crypto';
import type { SyncPullResult } from '@mansora/domain';
import type { Engine } from './engine';

export const MANSORA_EXPENSE_CATEGORY = 'Mansora subscription';
const METHOD: Record<string, string> = { momo: 'momo', card: 'card', bank: 'bank', cash: 'cash', other: 'bank' };

/** A stable expense id for a payment to Mansora, so the same payment is never recorded twice, on any laptop. */
export function mansoraExpenseId(paymentId: string): string {
  const h = createHash('sha256').update(`mansora-payment:${paymentId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Record the shop's payments to Mansora as its own expenses (category "Mansora subscription"), after a sync.
 * Recorded under the owner, with the receipt number as the reference; nothing is taken from the till.
 */
export async function recordMansoraPayments(engine: Engine, payments: SyncPullResult['mansoraPayments']): Promise<number> {
  if (!payments?.length || !engine.activated) return 0;
  const exists = engine.db.prepare('SELECT 1 FROM expenses WHERE id = ?');
  const todo = payments.filter((p) => p.amount > 0 && !exists.get(mansoraExpenseId(p.id)));
  if (!todo.length) return 0;
  const owner = engine.db.prepare(`SELECT id FROM users WHERE role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1`).get() as { id: string } | undefined;
  if (!owner) return 0;
  const token = engine.createSession(owner.id);
  let recorded = 0;
  try {
    for (const p of todo) {
      await engine.execute(token, 'expense.create', {
        id: mansoraExpenseId(p.id), category: MANSORA_EXPENSE_CATEGORY,
        description: `Mansora Sales & Stock subscription, receipt ${p.receiptNumber}${p.invoices ? ` for invoice ${p.invoices}` : ''} (recorded automatically)`.slice(0, 300),
        amount: p.amount, expenseDate: p.receivedAt.slice(0, 10), paymentMethod: METHOD[p.method] ?? 'bank', receiptReference: p.receiptNumber.slice(0, 80),
      });
      recorded++;
    }
  } finally { try { engine.endSession(token); } catch { /* already ended */ } }
  return recorded;
}
