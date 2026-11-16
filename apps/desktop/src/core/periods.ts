import { fail } from '@mansora/domain';
import type { Ctx, Engine } from './engine';

/**
 * Month-end close (audit F07). The owner closes a finished month; nothing can then be dated in it or any earlier
 * month. A reopening is its own immutable record, so the history of closes and reopenings is never rewritten.
 */
export function closedThrough(ctx: Pick<Ctx, 'all'>): string | null {
  const rows = ctx.all<{ kind: string; payload: string }>(`SELECT kind, payload FROM ledger_records WHERE kind IN ('period_close','period_reopen') ORDER BY created_at, rowid`);
  let through = null as string | null;
  for (const r of rows) {
    const month = String(JSON.parse(r.payload).month ?? '');
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (r.kind === 'period_close') through = through === null || month > through ? month : through;
    else if (through && month <= through) through = previousMonth(month);
  }
  return through;
}

export function previousMonth(month: string): string | null {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.getUTCFullYear() < 2000 ? null : d.toISOString().slice(0, 7);
}

/** Refuse a record dated in a closed month. `date` is YYYY-MM-DD or an ISO timestamp. */
export function requireOpenPeriod(ctx: Pick<Ctx, 'all'>, date: string): void {
  const through = closedThrough(ctx);
  if (through && date.slice(0, 7) <= through) fail('PERIOD_CLOSED', `${date.slice(0, 7)} is in a closed accounting period (closed through ${through}). Record a correction dated in an open month, or ask the owner to reopen the month.`, { closedThrough: through });
}

/**
 * Commands that create dated financial records. They are refused when the computer's clock has gone backwards
 * past the newest record already made (a changed date can otherwise place sales in an earlier period), and each
 * success moves the high-water mark forward.
 */
export const FINANCIAL_COMMANDS = new Set([
  'sale.complete', 'refund.create', 'expense.create', 'purchase.receive', 'stock.adjust', 'stock.count', 'credit.repay', 'credit.writeOff',
  'shift.open', 'shift.close', 'shift.closeFor', 'shift.cashMovement', 'tax.record', 'tax.file', 'product.save', 'import.commit',
]);
/** Normal clock adjustments (time-server corrections) are tolerated. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

export function checkClock(engine: Engine, command: string): void {
  if (!FINANCIAL_COMMANDS.has(command)) return;
  const last = engine.meta('last_financial_at');
  if (!last) return;
  const behind = Date.parse(last) - engine.now().getTime();
  if (behind > CLOCK_TOLERANCE_MS) {
    fail('CLOCK_BEHIND', `This computer's date and time (${engine.now().toISOString().slice(0, 16).replace('T', ' ')}) is earlier than the last recorded transaction (${last.slice(0, 16).replace('T', ' ')}). Correct the date and time in Windows. If the clock is now right, the owner can confirm it in Settings.`, { lastRecordedAt: last });
  }
}

export function stampClock(engine: Engine, command: string): void {
  if (!FINANCIAL_COMMANDS.has(command)) return;
  const now = engine.now().toISOString();
  const last = engine.meta('last_financial_at');
  if (!last || now > last) engine.setMeta('last_financial_at', now);
}
