import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MONTH, YEAR, seedFixture } from './fixture';
import { REPORT_INDEX_CANDIDATES } from './candidates';
const directory = mkdtempSync(join(tmpdir(), 'mansora-perf-fixture-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
it('seeds consistent sales, payments, costs, stock and foreign keys without changing command results', async () => {
  const f = seedFixture(join(directory, 'fixture'), { products: 30, sales: 120, customers: 20 });
  try {
    const db = f.engine.db;
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n).toBe(120);
    expect((db.prepare('SELECT COUNT(*) AS n FROM sale_items').get() as any).n).toBe(360);
    expect((db.prepare('SELECT SUM(amount) AS n FROM payments').get() as any).n).toBe(f.expected.revenue);
    expect((db.prepare('SELECT SUM(quantity) AS n FROM stock_balances').get() as any).n).toBe(f.expected.stockUnits);
    expect((db.prepare('SELECT SUM(quantity_delta) AS n FROM inventory_movements').get() as any).n).toBe(f.expected.stockUnits);
    const report = await f.engine.execute(f.token, 'report.sales', YEAR);
    expect(report.totals).toMatchObject({ count: 120, gross: f.expected.revenue, refunds: 0 });
    expect((await f.engine.execute(f.token, 'report.sales', MONTH)).totals.count).toBe(f.salesByMonth[0]);
    expect(await f.engine.execute(f.token, 'report.profit', YEAR)).toMatchObject({ revenue: f.expected.revenue, cogs: f.expected.cogs, grossProfit: f.expected.revenue - f.expected.cogs });
    const sale = await f.engine.execute(f.token, 'sale.complete', { id: crypto.randomUUID(), lines: f.productIds.slice(0, 3).map((productId) => ({ productId, quantity: 1 })), tenders: [{ method: 'cash', amount: 1500 }] });
    expect(sale.receiptNo).toBe('R-000121');
    expect(sale.total).toBe(1500);
  } finally { f.engine.db.close(); }
});

it('the experimental report indexes preserve sales/profit/list results', async () => {
  const f = seedFixture(join(directory, 'index-comparison'), { products: 30, sales: 120, customers: 20, candidateIndexes: true });
  try {
    const reports = async () => ({
      sales: await f.engine.execute(f.token, 'report.sales', YEAR),
      profit: await f.engine.execute(f.token, 'report.profit', YEAR),
      history: await f.engine.execute(f.token, 'sale.list', { from: '2025-01-01', to: '2025-01-31' }),
    });
    const indexed = await reports();
    f.engine.db.exec('DROP INDEX sales_report_cover; DROP INDEX sale_items_report_cover; DROP INDEX payments_report_cover;');
    expect(await reports()).toEqual(indexed);
    f.engine.db.exec(REPORT_INDEX_CANDIDATES);
    expect(await reports()).toEqual(indexed);
  } finally { f.engine.db.close(); }
});
