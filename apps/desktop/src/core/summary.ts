import { formatGHS } from '@mansora/domain';
import type { Engine } from './engine';

/**
 * The owner's daily closing summary (C33). Opt-in: nothing is sent until the owner records an
 * address. It never includes costs or profit. Mansora's server sends it immediately and keeps
 * only a delivery record with the figures removed.
 */
export const SUMMARY_KEYS = { email: 'daily_summary_email', hour: 'daily_summary_hour', sentFor: 'daily_summary_sent_for' } as const;
const money = (p: number) => formatGHS(p);
const one = (engine: Engine, sql: string, ...p: unknown[]) => (engine.db.prepare(sql).get(...p) as any) ?? {};
const all = (engine: Engine, sql: string, ...p: unknown[]) => engine.db.prepare(sql).all(...p) as any[];

export function summarySettings(engine: Engine) {
  const hour = Number(engine.meta(SUMMARY_KEYS.hour) ?? 21);
  return { email: engine.meta(SUMMARY_KEYS.email) || null, hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 21, lastSentFor: engine.meta(SUMMARY_KEYS.sentFor) || null };
}

/** Plain-text summary for one day (Ghana time = UTC). */
export function dailySummary(engine: Engine, day: string): { subject: string; text: string } {
  const from = `${day}T00:00:00.000Z`;
  const next = new Date(from); next.setUTCDate(next.getUTCDate() + 1);
  const to = next.toISOString();
  const shop = engine.meta('business_name') || 'Your shop';
  const s = one(engine, `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS gross, COALESCE(SUM(discount_total), 0) AS discounts FROM sales WHERE created_at >= ? AND created_at < ?`, from, to);
  const r = one(engine, `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM refunds WHERE created_at >= ? AND created_at < ?`, from, to);
  const pay = all(engine, `SELECT p.method, SUM(p.amount) AS total FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY p.method ORDER BY 2 DESC`, from, to);
  const shifts = all(engine, `SELECT u.name, sh.variance FROM shifts sh JOIN users u ON u.id = sh.cashier_id WHERE sh.closed_at >= ? AND sh.closed_at < ? ORDER BY sh.closed_at`, from, to);
  const low = all(engine, `SELECT p.name, b.quantity FROM products p JOIN stock_balances b ON b.product_id = p.id WHERE p.active = 1 AND b.quantity <= p.reorder_level ORDER BY b.quantity, p.name LIMIT 6`);
  const lowCount = one(engine, `SELECT COUNT(*) AS n FROM products p JOIN stock_balances b ON b.product_id = p.id WHERE p.active = 1 AND b.quantity <= p.reorder_level`).n ?? 0;
  const credit = one(engine, `SELECT COALESCE(SUM(outstanding_balance), 0) AS owed, COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN outstanding_balance ELSE 0 END), 0) AS overdue FROM credit_accounts WHERE status = 'open'`, day);
  const noRef = one(engine, `SELECT COUNT(*) AS n FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.method IN ('momo', 'card') AND (p.reference IS NULL OR p.reference = '') AND s.created_at >= ? AND s.created_at < ?`, from, to).n ?? 0;
  const label: Record<string, string> = { cash: 'Cash', momo: 'Mobile money', card: 'Card', credit: 'On credit' };
  const short = shifts.filter((x) => (x.variance ?? 0) < 0);
  const lines = [
    `${shop}: closing summary for ${day}`, '',
    `Net sales: ${money(s.gross - r.total)} from ${s.n} ${s.n === 1 ? 'sale' : 'sales'}`,
    `Refunds: ${r.n ? `${money(r.total)} (${r.n})` : 'none'}`,
    `Discounts given: ${s.discounts ? money(s.discounts) : 'none'}`,
    ...(pay.length ? ['', 'Payments taken:', ...pay.map((p) => `  ${label[p.method] ?? p.method}: ${money(p.total)}`)] : []),
    ...(noRef ? [`  ${noRef} mobile money or card ${noRef === 1 ? 'payment has' : 'payments have'} no transaction ID. Check them in Reports, Mobile money check.`] : []),
    '', shifts.length ? `Shifts closed: ${shifts.length}${short.length ? `. Cash short: ${short.map((x) => `${x.name} ${money(-x.variance)}`).join(', ')}` : ', no cash shortages'}` : 'No shifts were closed today.',
    '', lowCount ? `Low stock: ${lowCount} ${lowCount === 1 ? 'product' : 'products'} at or below reorder level${low.length ? ` (${low.map((x) => `${x.name}: ${x.quantity}`).join(', ')}${lowCount > low.length ? ', …' : ''})` : ''}` : 'Stock: nothing at or below reorder level.',
    `Customer credit owed: ${money(credit.owed)}${credit.overdue ? `, of which ${money(credit.overdue)} is overdue` : ''}`,
    '', 'Figures are from the shop till and exclude costs and profit. Open Reports for the full picture.',
    'You receive this because the owner turned on the daily summary in Settings. Turn it off there at any time.',
  ];
  return { subject: `${shop}: ${money(s.gross - r.total)} net sales on ${day}`, text: lines.join('\n') };
}

/** Send through Mansora's server. Throws on failure; the caller decides whether to retry later. */
export async function sendSummary(engine: Engine, to: string, day: string): Promise<void> {
  const { subject, text } = dailySummary(engine, day);
  let res: Response;
  try {
    res = await engine.fetch(`${engine.meta('api_url')}/v1/devices/daily-summary`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.meta('device_token')}` },
      body: JSON.stringify({ to, subject, body: text, day }), signal: AbortSignal.timeout(30_000),
    });
  } catch { throw Object.assign(new Error('Sending the summary needs an internet connection.'), { code: 'OFFLINE' }); }
  if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw Object.assign(new Error(body.message ?? 'The summary could not be sent.'), { code: body.code ?? 'SUMMARY_FAILED' }); }
}

/** Called after each successful sync: sends today's summary once, after the chosen hour. */
export async function maybeSendDailySummary(engine: Engine): Promise<boolean> {
  const { email, hour, lastSentFor } = summarySettings(engine);
  if (!email || !engine.activated) return false;
  const now = engine.now();
  const day = now.toISOString().slice(0, 10);
  if (lastSentFor === day || now.getUTCHours() < hour) return false;
  await sendSummary(engine, email, day);
  engine.setMeta(SUMMARY_KEYS.sentFor, day);
  return true;
}
