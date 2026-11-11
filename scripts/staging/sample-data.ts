/** Additive, explicitly enabled team-test data. Never resets a business or changes permissions. */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestAccount } from './bootstrap';
import type { StagingWorkspace } from './gateway';

interface Pack { version: 'retail-v1'; workspace: string; tenantId: string; date: string; ids: Record<string, string>; complete?: boolean }
function save(path: string, pack: Pack) {
  writeFileSync(path + '.pending', JSON.stringify(pack, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); chmodSync(path, 0o600);
}
function stableId(tenant: string, name: string) {
  const hex = createHash('sha256').update(`mansora-retail-v1/${tenant}/${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function seedTestWorkspaces(options: { mode?: string; version?: string; dataDir: string; workspaces: StagingWorkspace[] }) {
  if (!options.version) return { disabled: true, prepared: 0, preserved: 0 };
  if (options.mode !== 'team-test' || options.version !== 'retail-v1') throw new Error('Sample data requires explicit team-test mode and the supported retail-v1 pack.');
  if (!options.workspaces.length || options.workspaces.some(w => !/^[a-z0-9][a-z0-9-]{1,40}$/.test(w.id)) || new Set(options.workspaces.map(w => w.id)).size !== options.workspaces.length) throw new Error('Sample data requires distinct registered test workspaces.');
  const accounts = JSON.parse(readFileSync(join(options.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  let prepared = 0, preserved = 0;
  for (const workspace of options.workspaces) {
    // Dynamic client workspaces are not sample businesses. Never seed them implicitly.
    if (!accounts.some(a => a.workspace === workspace.id && a.role === 'owner')) continue;
    const { engine } = workspace;
    const state = await engine.execute(null, 'app.state');
    const tenantId = state.business.tenantId;
    if (!engine.activated || !tenantId) throw new Error('Sample workspace must already be activated.');
    const path = join(options.dataDir, `sample-data-${workspace.id}.json`);
    const pack: Pack = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 'retail-v1', workspace: workspace.id, tenantId, date: new Date().toISOString().slice(0, 10), ids: {} };
    if (pack.version !== 'retail-v1' || pack.workspace !== workspace.id || pack.tenantId !== tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(pack.date) || !pack.ids) throw new Error('Sample-data journal does not match this test business; preserve it for review.');
    if (pack.complete) { preserved++; continue; }
    save(path, pack);
    const owner = accounts.filter(a => a.workspace === workspace.id && a.role === 'owner');
    if (owner.length !== 1) throw new Error('A single assigned test owner is required.');
    const token = (await engine.execute(null, 'auth.login', { username: owner[0].username, password: owner[0].password })).token;
    const run = (name: string, input: unknown = {}) => engine.execute(token, name, input);
    const remember = async (key: string, find: () => Promise<any>, create: () => Promise<any>) => {
      if (pack.ids[key]) return pack.ids[key];
      const row = await find() ?? await create();
      pack.ids[key] = row.id; save(path, pack); return row.id as string;
    };
    try {
      if ((await engine.execute(token, 'app.state')).user.role !== 'owner') throw new Error('Sample-data credentials must match the recorded owner role.');
      const categories: string[] = [];
      for (const label of ['Groceries', 'Household', 'Stationery']) {
        const name = `SAMPLE · ${label}`;
        categories.push(await remember(`category/${label}`, async () => (await run('category.list')).find((r: any) => r.name === name), () => run('category.save', { name })));
      }
      const products: { id: string; price: number; cost: number }[] = [];
      const items: [string, number, number, number, number][] = [
        ['Rice 5kg', 8000, 5800, 60, 0], ['Maize flour 1kg', 2000, 1350, 80, 0], ['Milk tin', 1250, 900, 100, 0],
        ['Soap bar', 700, 420, 80, 1], ['Bottled water', 500, 300, 120, 0], ['Cooking oil 2L', 4500, 3200, 50, 0],
        ['Notebook — low stock', 1800, 1100, 3, 2], ['Sugar 1kg — reorder', 1600, 1050, 0, 0],
      ];
      for (const [index, [label, price, cost, stock, category]] of items.entries()) {
        const sku = `TEAM-DEMO-V1-${index + 1}`;
        const id = await remember(`product/${index}`, async () => {
          const row = await run('product.lookup', { code: sku });
          if (row && !row.name.startsWith('SAMPLE · ')) throw new Error('A sample SKU conflicts with an existing product; no existing product was changed.');
          return row;
        }, () => run('product.save', { name: `SAMPLE · ${label}`, sku, sellingPrice: price, costPrice: cost, openingStock: stock, reorderLevel: 5, categoryId: categories[category] }));
        products.push({ id, price, cost });
      }
      const customers: string[] = [];
      for (const label of ['Adom School', 'Akwaaba Cafe', 'Neighbourhood customer']) {
        const name = `SAMPLE · ${label}`;
        customers.push(await remember(`customer/${label}`, async () => (await run('customer.list', { search: name })).find((r: any) => r.name === name), () => run('customer.save', { name, notes: 'Fictional team-test customer. Add your own sample records freely.' })));
      }
      const suppliers: string[] = [];
      for (const label of ['Market Wholesale', 'Local Supplies']) {
        const name = `SAMPLE · ${label}`;
        suppliers.push(await remember(`supplier/${label}`, async () => (await run('supplier.list')).find((r: any) => r.name === name), () => run('supplier.save', { name, notes: 'Fictional team-test supplier; no external order or payment.' })));
      }
      for (let index = 0; index < 2; index++) await run('purchase.receive', { id: stableId(tenantId, `purchase/${index}`), supplierId: suppliers[index], reference: `SAMPLE-V1-PURCHASE-${index + 1}`, items: [{ productId: products[index].id, quantity: 10, unitCost: products[index].cost }] });
      for (const [index, category] of ['Transport', 'Utilities', 'Packaging'].entries()) await run('expense.create', { id: stableId(tenantId, `expense/${index}`), category: `SAMPLE · ${category}`, description: 'Fictional sample expense — no real payment', amount: [2500, 4500, 1200][index], expenseDate: pack.date, paymentMethod: 'momo', paidFromTill: false });
      for (const role of ['owner', 'manager', 'cashier']) {
        const assigned = accounts.filter(a => a.workspace === workspace.id && a.role === role);
        if (assigned.length !== 1) throw new Error('Each registered owner, manager and cashier needs a distinct test account.');
        const session = (await engine.execute(null, 'auth.login', { username: assigned[0].username, password: assigned[0].password })).token;
        try {
          if ((await engine.execute(session, 'app.state')).user.role !== role) throw new Error('Sample account role mismatch; permissions were not changed.');
          if (!(await engine.execute(session, 'shift.current'))) await engine.execute(session, 'shift.open', { openingFloat: 10000 });
          for (let index = 0; index < 3; index++) {
            const product = products[index + (role === 'cashier' ? 2 : 0)], quantity = index + 1;
            await engine.execute(session, 'sale.complete', { id: stableId(tenantId, `sale/${role}/${index}`), customerId: customers[index], lines: [{ productId: product.id, quantity }], tenders: [{ method: ['cash', 'momo', 'card'][index], amount: product.price * quantity, reference: `SAMPLE-V1-${role}-${index + 1}` }] });
          }
        } finally { engine.endSession(session); }
      }
      const creditId = stableId(tenantId, 'sale/credit');
      await run('sale.complete', { id: creditId, customerId: customers[0], lines: [{ productId: products[0].id, quantity: 1 }], tenders: [{ method: 'credit', amount: products[0].price }], dueDate: pack.date });
      const credit = (await run('sale.get', { id: creditId })).credit;
      await run('credit.repay', { id: stableId(tenantId, 'credit/repayment'), creditAccountId: credit.id, amount: 2000, method: 'momo', reference: 'SAMPLE-V1-PART-REPAYMENT' });
      pack.complete = true; save(path, pack); prepared++;
    } finally { engine.endSession(token); }
  }
  return { disabled: false, prepared, preserved };
}
