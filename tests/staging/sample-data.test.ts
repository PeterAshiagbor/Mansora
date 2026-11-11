import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { seedTestWorkspaces } from '../../scripts/staging/sample-data';
import { CASHIER, MANAGER, OWNER, makeShop, tempDir, type TestShop } from '../helpers';

let shops: TestShop[];
const dataDir = tempDir(), version = 'retail-v1', mode = 'team-test';
const workspaces = () => shops.map((shop, index) => ({ id: `shop-${index ? 'b' : 'a'}`, label: 'Team test', engine: shop.engine }));
const seed = () => seedTestWorkspaces({ dataDir, mode, version, workspaces: workspaces() });
beforeAll(async () => {
  shops = [await makeShop(), await makeShop()];
  writeFileSync(join(dataDir, 'test-accounts.json'), JSON.stringify(shops.flatMap((_, index) => [OWNER, MANAGER, CASHIER].map((account, role) => ({ workspace: `shop-${index ? 'b' : 'a'}`, username: account.username, password: account.password, role: ['owner', 'manager', 'cashier'][role] })))), { mode: 0o600 });
});
afterAll(() => { for (const shop of shops ?? []) shop.engine.db.close(); });

it('requires explicit test-only enablement and never starts on an unsupported version or mode', async () => {
  expect(await seedTestWorkspaces({ dataDir, workspaces: [] })).toMatchObject({ disabled: true });
  for (const settings of [{ mode: 'production', version }, { mode, version: 'retail-v2' }]) await expect(seedTestWorkspaces({ dataDir, workspaces: workspaces(), ...settings })).rejects.toThrow(/explicit team-test/);
});

it('resumes a committed-but-unacknowledged sale without duplication and populates every role in both businesses', async () => {
  const engine = shops[0].engine, execute = engine.execute.bind(engine);
  let interrupted = false;
  const spy = vi.spyOn(engine, 'execute').mockImplementation(async (token, command, input) => {
    const result = await execute(token, command, input);
    if (command === 'sale.complete' && !interrupted) { interrupted = true; throw new Error('Synthetic interruption after committed sale'); }
    return result;
  });
  try { await expect(seed()).rejects.toThrow('Synthetic interruption'); } finally { spy.mockRestore(); }
  expect(engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toMatchObject({ n: 1 });
  expect(await seed()).toMatchObject({ prepared: 2, preserved: 0 });
  for (const shop of shops) {
    expect(shop.engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toMatchObject({ n: 10 });
    expect(shop.engine.db.prepare('SELECT COUNT(*) AS n FROM purchases').get()).toMatchObject({ n: 2 });
    expect(shop.engine.db.prepare('SELECT COUNT(*) AS n FROM expenses').get()).toMatchObject({ n: 3 });
    const rows = await shop.run(shop.owner, 'product.list', { search: 'SAMPLE ·' });
    expect(rows).toHaveLength(8); expect(rows.some((r: any) => r.quantity === 0)).toBe(true);
    const range = { from: '2020-01-01', to: '2099-12-31' };
    const sales = await shop.run(shop.owner, 'report.sales', range);
    expect(sales.totals.count).toBe(10); expect(sales.byCashier).toHaveLength(3);
    expect(sales.payments.sales.map((r: any) => r.method).sort()).toEqual(['card', 'cash', 'credit', 'momo']);
    expect((await shop.run(shop.owner, 'credit.list')).totalOutstanding).toBe(6000);
    const cashierSales = await shop.run(shop.cashier, 'sale.list', range);
    expect(cashierSales.rows ?? cashierSales).toHaveLength(3);
    const csv = await shop.run(shop.cashier, 'export.table', { title: 'My sample sales', format: 'csv', columns: ['Receipt', 'Amount'], rows: (cashierSales.rows ?? cashierSales).map((row: any) => [row.receipt_no, row.total]) });
    expect(Buffer.from(csv.contentBase64, 'base64').toString()).toContain('Receipt');
    expect((await shop.run(shop.cashier, 'product.list', { search: 'SAMPLE ·' }))[0]).not.toHaveProperty('cost_price');
    await expect(shop.run(shop.cashier, 'report.profit', range)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(shop.run(shop.cashier, 'export.business', { format: 'json' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  }
  if (process.platform !== 'win32') expect(statSync(join(dataDir, 'sample-data-shop-a.json')).mode & 0o777).toBe(0o600);
});

it('keeps records editable, exports actual data, supports analysis and preserves tester additions/changes on restart', async () => {
  const shop = shops[0], other = shops[1];
  const sample = (await shop.run(shop.owner, 'product.list', { search: 'TEAM-DEMO-V1-1' }))[0];
  await shop.run(shop.owner, 'product.save', { id: sample.id, name: 'Tester edited rice', sku: sample.sku, sellingPrice: 9000, costPrice: sample.cost_price, categoryId: sample.category_id, reorderLevel: 5 });
  await shop.run(shop.owner, 'product.save', { name: 'Tester added item', sellingPrice: 300, costPrice: 100, openingStock: 5 });
  const output = await shop.run(shop.owner, 'export.business', { format: 'json' });
  const json = JSON.parse(Buffer.from(output.contentBase64, 'base64').toString());
  expect(json.data.sales).toHaveLength(10); expect(json.data.products.some((p: any) => p.name === 'Tester added item')).toBe(true);
  expect(JSON.stringify(json)).not.toContain(OWNER.password); expect(JSON.stringify(json)).not.toContain('password_hash');
  const excel = await shop.run(shop.owner, 'export.business', { format: 'xlsx' });
  expect(Buffer.from(excel.contentBase64, 'base64').subarray(0, 2).toString()).toBe('PK');
  expect((await shop.run(shop.owner, 'report.profit', { from: '2020-01-01', to: '2099-12-31' })).revenue).toBeGreaterThan(0);
  expect(await seed()).toMatchObject({ prepared: 0, preserved: 2 });
  expect((await shop.run(shop.owner, 'product.lookup', { code: sample.sku })).name).toBe('Tester edited rice');
  expect(await other.run(other.owner, 'product.lookup', { code: sample.sku })).not.toMatchObject({ id: sample.id });
  expect(await other.run(other.owner, 'product.list', { search: 'Tester added item' })).toEqual([]);
  expect(JSON.parse(readFileSync(join(dataDir, 'sample-data-shop-a.json'), 'utf8')).complete).toBe(true);
});

it('refuses a journal copied from another tenant without changing business records', async () => {
  const source = readFileSync(join(dataDir, 'sample-data-shop-a.json'), 'utf8');
  const target = join(dataDir, 'sample-data-shop-b.json'), original = readFileSync(target, 'utf8');
  const before = shops[1].engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get();
  writeFileSync(target, source);
  try { await expect(seed()).rejects.toThrow('does not match this test business'); }
  finally { writeFileSync(target, original); }
  expect(shops[1].engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual(before);
});
