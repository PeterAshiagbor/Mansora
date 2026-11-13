import { z } from 'zod';
import { fail, grossMarginBps, sum } from '@mansora/domain';
import { dayBounds, defineCommands, empty, zRange, type Ctx } from '../engine';
import { dailySummary, sendSummary, summarySettings, SUMMARY_KEYS } from '../summary';

/**
 * Report definitions (also documented in docs/architecture/report-definitions.md):
 *   Gross sales  = sum of sale totals completed in the period (after discounts)
 *   Refunds      = sum of refund amounts created in the period
 *   Net sales    = gross sales - refunds
 *   COGS         = cost of items sold - cost of refunded items returned to stock
 *   Gross profit = net sales - COGS       (expenses are reported separately, never netted)
 */
function v(ctx: Ctx, sql: string, ...params: unknown[]): number {
  return (ctx.get(sql, ...params) as { v: number }).v;
}

function salesTotals(ctx: Ctx, from: string, to: string, cashierId?: string) {
  const c = cashierId ? 'AND cashier_id = ?' : '';
  const p = cashierId ? [from, to, cashierId] : [from, to];
  const gross = v(ctx, `SELECT COALESCE(SUM(total), 0) AS v FROM sales WHERE created_at >= ? AND created_at < ? ${c}`, ...p);
  const count = v(ctx, `SELECT COUNT(*) AS v FROM sales WHERE created_at >= ? AND created_at < ? ${c}`, ...p);
  const discounts = v(ctx, `SELECT COALESCE(SUM(discount_total), 0) AS v FROM sales WHERE created_at >= ? AND created_at < ? ${c}`, ...p);
  const refunds = cashierId
    ? v(ctx, `SELECT COALESCE(SUM(r.amount), 0) AS v FROM refunds r JOIN sales s ON s.id = r.sale_id WHERE r.created_at >= ? AND r.created_at < ? AND s.cashier_id = ?`, ...p)
    : v(ctx, `SELECT COALESCE(SUM(amount), 0) AS v FROM refunds WHERE created_at >= ? AND created_at < ?`, from, to);
  return { gross, count, discounts, refunds, net: gross - refunds };
}

function paymentBreakdown(ctx: Ctx, from: string, to: string) {
  return {
    sales: ctx.all(`SELECT p.method, SUM(p.amount) AS total, COUNT(*) AS count FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY p.method ORDER BY 2 DESC`, from, to),
    refundPayouts: ctx.all(`SELECT payout_method AS method, SUM(payout_amount) AS total, COUNT(*) AS count FROM refunds WHERE payout_amount > 0 AND created_at >= ? AND created_at < ? GROUP BY 1`, from, to),
    refundCreditReductions: v(ctx, `SELECT COALESCE(SUM(credit_reduction), 0) AS v FROM refunds WHERE created_at >= ? AND created_at < ?`, from, to),
    repayments: ctx.all(`SELECT method, SUM(amount) AS total, COUNT(*) AS count FROM credit_repayments WHERE created_at >= ? AND created_at < ? GROUP BY 1`, from, to),
    splitPaymentSales: v(ctx, `SELECT COUNT(*) AS v FROM (SELECT p.sale_id FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY p.sale_id HAVING COUNT(*) > 1)`, from, to),
  };
}

function byProduct(ctx: Ctx, from: string, to: string) {
  const sold = ctx.all(
    `SELECT i.product_id, MAX(i.product_name) AS name, SUM(i.quantity) AS qty, SUM(i.line_total) AS revenue, SUM(i.quantity * i.cost_snapshot) AS cogs
     FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY i.product_id`,
    from, to,
  );
  const refunded = ctx.all(
    `SELECT ri.product_id, MAX(i.product_name) AS name, SUM(ri.quantity) AS qty, SUM(ri.amount) AS amount, SUM(CASE WHEN ri.restocked = 1 THEN ri.quantity * i.cost_snapshot ELSE 0 END) AS cogs
     FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id JOIN sale_items i ON i.id = ri.sale_item_id
     WHERE r.created_at >= ? AND r.created_at < ? GROUP BY ri.product_id`,
    from, to,
  );
  const map = new Map<string, { productId: string; name: string; quantity: number; revenue: number; cogs: number }>();
  for (const s of sold) map.set(s.product_id, { productId: s.product_id, name: s.name, quantity: s.qty, revenue: s.revenue, cogs: s.cogs });
  for (const r of refunded) {
    const e = map.get(r.product_id) ?? { productId: r.product_id, name: r.name, quantity: 0, revenue: 0, cogs: 0 };
    e.quantity -= r.qty;
    e.revenue -= r.amount;
    e.cogs -= r.cogs;
    map.set(r.product_id, e);
  }
  return [...map.values()].map((e) => ({ ...e, grossProfit: e.revenue - e.cogs, marginBps: grossMarginBps(e.revenue, e.cogs) }));
}

export const reportCommands = defineCommands({
  'report.dashboard': {
    perm: 'auth',
    input: empty,
    run: (ctx) => {
      const today = ctx.now().slice(0, 10);
      const [dFrom, dTo] = dayBounds({ from: today, to: today });
      const [mFrom] = dayBounds({ from: `${today.slice(0, 7)}-01`, to: today });
      const all = ctx.can('report.sales');
      const mine = all ? undefined : ctx.user.id;
      return {
        scope: all ? 'business' : 'own',
        today: salesTotals(ctx, dFrom, dTo, mine),
        month: salesTotals(ctx, mFrom, dTo, mine),
        payments: all ? paymentBreakdown(ctx, dFrom, dTo).sales : null,
        lowStock: ctx.can('stock.view')
          ? ctx.all(`SELECT p.id, p.name, b.quantity, p.reorder_level FROM products p JOIN stock_balances b ON b.product_id = p.id WHERE p.active = 1 AND b.quantity <= p.reorder_level ORDER BY b.quantity LIMIT 10`)
          : null,
        outstandingCredit: ctx.can('credit.repayment') || all ? v(ctx, 'SELECT COALESCE(SUM(outstanding_balance), 0) AS v FROM credit_accounts') : null,
        recent: ctx.all(
          `SELECT s.id, s.receipt_no, s.created_at, s.total, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id
           ${mine ? 'WHERE s.cashier_id = ?' : ''} ORDER BY s.created_at DESC, s.rowid DESC LIMIT 8`,
          ...(mine ? [mine] : []),
        ),
      };
    },
  },

  'report.sales': {
    perm: 'report.sales',
    input: zRange,
    run: (ctx, input) => {
      const [from, to] = dayBounds(input);
      const daily = ctx.all(
        `SELECT day, SUM(count) AS count, SUM(gross) AS gross, SUM(discounts) AS discounts, SUM(refunds) AS refunds, SUM(gross) - SUM(refunds) AS net FROM (
           SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count, SUM(total) AS gross, SUM(discount_total) AS discounts, 0 AS refunds FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY 1
           UNION ALL
           SELECT substr(created_at, 1, 10), 0, 0, 0, SUM(amount) FROM refunds WHERE created_at >= ? AND created_at < ? GROUP BY 1
         ) GROUP BY day ORDER BY day`,
        from, to, from, to,
      );
      const monthly = ctx.all(
        `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS count, SUM(total) AS gross FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY 1 ORDER BY 1`,
        from, to,
      );
      const products = byProduct(ctx, from, to).map(({ cogs, grossProfit, marginBps, ...p }) => p).sort((a, b) => b.revenue - a.revenue);
      return {
        totals: salesTotals(ctx, from, to),
        daily,
        monthly,
        byProduct: products,
        bestSellers: [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
        byCashier: ctx.all(`SELECT u.name AS cashier, COUNT(*) AS count, SUM(s.total) AS gross, SUM(s.discount_total) AS discounts FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.created_at >= ? AND s.created_at < ? GROUP BY s.cashier_id ORDER BY 3 DESC`, from, to),
        payments: paymentBreakdown(ctx, from, to),
      };
    },
  },

  'report.profit': {
    perm: 'report.profit',
    input: zRange,
    run: (ctx, input) => {
      const [from, to] = dayBounds(input);
      const products = byProduct(ctx, from, to).sort((a, b) => b.grossProfit - a.grossProfit);
      const revenue = sum(products.map((p) => p.revenue));
      const cogs = sum(products.map((p) => p.cogs));
      return {
        revenue,
        cogs,
        grossProfit: revenue - cogs,
        marginBps: grossMarginBps(revenue, cogs),
        byProduct: products,
        // Reported alongside, deliberately not subtracted: this is not a net-profit statement.
        expenses: v(ctx, 'SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date >= ? AND expense_date <= ?', input.from, input.to),
      };
    },
  },

  /**
   * End-of-day check for money that should be in the mobile money wallet or card
   * settlement: every non-cash sale payment, credit repayment and refund payout,
   * with references, so the owner can tick them against the provider statement.
   * Staff without sales reports see only what they recorded themselves.
   */
  'report.wallet': {
    // Report viewers need not be allowed to sell, and sellers need not see reports: either permission opens it.
    perm: 'auth',
    input: zRange,
    run: (ctx, input) => {
      if (!ctx.can('report.sales') && !ctx.can('sale.create')) fail('PERMISSION_DENIED', 'You do not have permission to do this', { permission: 'report.sales' });
      const [from, to] = dayBounds(input);
      const own = !ctx.can('report.sales');
      const me = ctx.user.id;
      const sales = ctx.all(
        `SELECT 'sale' AS kind, s.created_at AS at, s.receipt_no AS number, p.method, p.amount, p.reference, u.name AS staff, c.name AS customer
         FROM payments p JOIN sales s ON s.id = p.sale_id JOIN users u ON u.id = s.cashier_id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE p.method IN ('momo', 'card') AND s.created_at >= ? AND s.created_at < ? ${own ? 'AND s.cashier_id = ?' : ''}`,
        from, to, ...(own ? [me] : []),
      );
      const repayments = ctx.all(
        `SELECT 'repayment' AS kind, r.created_at AS at, NULL AS number, r.method, r.amount, r.reference, u.name AS staff, c.name AS customer
         FROM credit_repayments r JOIN users u ON u.id = r.received_by JOIN customers c ON c.id = r.customer_id
         WHERE r.method IN ('momo', 'card') AND r.created_at >= ? AND r.created_at < ? ${own ? 'AND r.received_by = ?' : ''}`,
        from, to, ...(own ? [me] : []),
      );
      const refunds = ctx.all(
        `SELECT 'refund' AS kind, r.created_at AS at, r.refund_no AS number, r.payout_method AS method, -r.payout_amount AS amount, NULL AS reference, u.name AS staff, c.name AS customer
         FROM refunds r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.requested_by LEFT JOIN customers c ON c.id = s.customer_id
         WHERE r.payout_method IN ('momo', 'card') AND r.payout_amount > 0 AND r.created_at >= ? AND r.created_at < ? ${own ? 'AND r.requested_by = ?' : ''}`,
        from, to, ...(own ? [me] : []),
      );
      const entries = [...sales, ...repayments, ...refunds].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const byMethod = ['momo', 'card'].map((method) => {
        const rows = entries.filter((e) => e.method === method);
        const received = sum(rows.filter((e) => e.amount > 0).map((e) => e.amount));
        const refunded = sum(rows.filter((e) => e.amount < 0).map((e) => -e.amount));
        return { method, count: rows.length, received, refunded, net: received - refunded, missingReference: rows.filter((e) => e.amount > 0 && !e.reference).length };
      });
      // The same transaction ID on two receipts is the classic sign of a reused or fake payment message.
      const seen = new Map<string, number>();
      for (const e of entries) if (e.reference) { const key = String(e.reference).replace(/\s+/g, '').toUpperCase(); seen.set(key, (seen.get(key) ?? 0) + 1); }
      const duplicateReferences = [...seen].filter(([, n]) => n > 1).map(([reference, count]) => ({ reference, count }));
      return { scope: own ? 'own' : 'business', entries, byMethod, duplicateReferences };
    },
  },

  /** Daily closing summary email (C33). Owner only: it sends the business's figures to an inbox. */
  'summary.settings': {
    perm: 'settings.manage',
    input: empty,
    run: (ctx) => ({ ...summarySettings(ctx.engine), preview: ctx.user.role === 'owner' ? dailySummary(ctx.engine, ctx.now().slice(0, 10)) : null }),
  },
  'summary.save': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({ email: z.string().trim().toLowerCase().email().max(160).nullable(), hour: z.number().int().min(0).max(23) }),
    run: (ctx, input) => {
      if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can turn the daily summary email on or off');
      ctx.engine.setMeta(SUMMARY_KEYS.email, input.email);
      ctx.engine.setMeta(SUMMARY_KEYS.hour, String(input.hour));
      ctx.audit('business', null, { dailySummary: input.email ? 'on' : 'off', hour: input.hour }, 'summary.save');
      return summarySettings(ctx.engine);
    },
  },
  'summary.sendTest': {
    perm: 'settings.manage',
    async: true,
    input: empty,
    run: async (ctx) => {
      if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can send the daily summary');
      const { email } = summarySettings(ctx.engine);
      if (!email) fail('EMAIL_REQUIRED', 'Save an email address for the summary first');
      try { await sendSummary(ctx.engine, email, ctx.now().slice(0, 10)); }
      catch (e: any) { fail(e.code ?? 'SUMMARY_FAILED', e.message); }
      return { sentTo: email };
    },
  },

  'report.stock': {
    perm: 'report.stock',
    input: zRange,
    run: (ctx, input) => {
      const [from, to] = dayBounds(input);
      const cost = ctx.can('product.cost');
      const onHand = ctx.all(
        `SELECT p.id, p.name, p.sku, c.name AS category, b.quantity, p.reorder_level, b.average_cost, MAX(b.quantity, 0) * b.average_cost AS value
         FROM products p JOIN stock_balances b ON b.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY p.name`,
      );
      const moves = (types: string[]) =>
        ctx.all(
          `SELECT m.occurred_at, m.type, p.name AS product, m.quantity_delta, m.unit_cost, m.reason, u.name AS actor FROM inventory_movements m
           JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.actor_id
           WHERE m.type IN (${types.map(() => '?').join(',')}) AND m.occurred_at >= ? AND m.occurred_at < ? ORDER BY m.occurred_at DESC`,
          ...types, from, to,
        );
      const strip = (rows: any[], keys: string[]) => (cost ? rows : rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)))));
      return {
        onHand: strip(onHand, ['average_cost', 'value']),
        valuation: cost ? sum(onHand.map((r) => r.value)) : null,
        lowStock: onHand.filter((r) => r.quantity <= r.reorder_level).map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, reorder_level: r.reorder_level })),
        damages: strip(moves(['DAMAGE']), ['unit_cost']),
        adjustments: strip(moves(['STOCK_COUNT_ADJUSTMENT', 'MANUAL_CORRECTION']), ['unit_cost']),
        movementSummary: ctx.all(`SELECT type, COUNT(*) AS count, SUM(quantity_delta) AS quantity FROM inventory_movements WHERE occurred_at >= ? AND occurred_at < ? GROUP BY type`, from, to),
      };
    },
  },
});
