import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stagingConfig } from './config';
import type { TestAccount } from './bootstrap';
export async function smokeStaging() {
  const config = stagingConfig(), base = process.env.STAGING_SMOKE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4500}`;
  const accounts = JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  const account = (role: string, workspace = 'shop-a') => { const a = accounts.find(a => a.workspace === workspace && a.role === role); if (!a) throw new Error('Required test account missing'); return a; };
  const call = async (a: TestAccount, cookie: string | null, command: string, input: unknown = {}) => {
    const r = await fetch(`${base}/client/${a.workspace}/invoke`, { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ command, input }) });
    return { status: r.status, body: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null };
  };
  const check = (ok: unknown, name: string) => { if (!ok) throw new Error(name); console.log('PASS ' + name); };
  const owner = account('owner'), cashier = account('cashier');
  const own = await call(owner, null, 'auth.login', { username: owner.username, password: owner.password });
  const cash = await call(cashier, null, 'auth.login', { username: cashier.username, password: cashier.password });
  check(own.body.ok && cash.body.ok && own.cookie && cash.cookie && own.cookie !== cash.cookie, 'independent test logins');
  check(!('token' in own.body.data), 'engine token is not returned to browser');
  check((await call(owner, own.cookie, 'app.state')).body.data.user.role === 'owner', 'cashier login does not replace owner session');
  let rows = (await call(owner, own.cookie, 'product.list', { search: 'STAGING-SMOKE' })).body.data;
  if (!rows.length && !process.argv.includes('--existing')) {
    const saved = await call(owner, own.cookie, 'product.save', { name: 'STAGING-SMOKE test record', sku: 'STAGING-SMOKE', sellingPrice: 200, costPrice: 100, openingStock: 3 }); check(saved.body.ok, 'real test record saved');
    rows = (await call(owner, own.cookie, 'product.list', { search: 'STAGING-SMOKE' })).body.data;
  }
  check(rows.length === 1 && rows[0].cost_price === 100, 'saved records persist across service restart');
  const template = await call(owner, own.cookie, 'import.template', { format: 'xlsx' });
  check(template.body.ok && template.body.data.contentBase64.length > 0, 'bundled Excel template writer works');
  const preview = await call(owner, own.cookie, 'import.preview', { fileName: template.body.data.fileName, contentBase64: template.body.data.contentBase64 });
  check(preview.body.ok && Array.isArray(preview.body.data.rows), 'bundled Excel upload parser works');
  const visible = (await call(cashier, cash.cookie, 'product.list', { search: 'STAGING-SMOKE' })).body.data;
  check(visible.length === 1 && !('cost_price' in visible[0]), 'shared records retain cashier cost restrictions');
  check(!(await call(cashier, cash.cookie, 'product.save', { name: 'Denied', sellingPrice: 1, costPrice: 1 })).body.ok, 'cashier write permission enforced');
  const other = account('owner', 'shop-b'); check(!(await call(other, own.cookie, 'product.list')).body.ok, 'workspace cookie cannot cross business boundary');
  await call(owner, own.cookie, 'auth.logout'); check((await call(cashier, cash.cookie, 'app.state')).body.data.user.role === 'cashier', 'owner logout does not end cashier session');
  await call(cashier, cash.cookie, 'auth.logout');
  if (process.env.STAGING_SAMPLE_DATA_VERSION === 'retail-v1') {
    for (const tester of accounts.filter(a => a.role === 'owner')) {
      const login = await call(tester, null, 'auth.login', { username: tester.username, password: tester.password });
      check(login.body.ok && login.cookie, 'sample-data owner authentication');
      const products = await call(tester, login.cookie, 'product.list', { search: 'TEAM-DEMO-V1-' });
      check(products.body.ok && products.body.data.length === 8, 'eight editable sample products per business');
      const report = await call(tester, login.cookie, 'report.sales', { from: '2000-01-01', to: '2099-12-31' });
      check(report.body.ok && report.body.data.totals.count === 10 && report.body.data.byCashier.length === 3, 'sample sales and analysis for all three roles without duplicate seeding');
      const exported = await call(tester, login.cookie, 'export.business', { format: 'json' });
      const data = exported.body.ok ? JSON.parse(Buffer.from(exported.body.data.contentBase64, 'base64').toString()).data : null;
      check(data?.sales.length === 10 && data?.purchases.length === 2 && data?.expenses.length === 3, 'actual sample records remain exportable');
      await call(tester, login.cookie, 'auth.logout');
    }
  }
  for (const named of accounts.filter(a => a.email)) {
    const login = await call(named, null, 'auth.login', { username: named.email!.toUpperCase(), password: named.password });
    check(login.body.ok && login.cookie && (await call(named, login.cookie, 'app.state')).body.data.user.role === 'owner', 'assigned tester email login and role');
    await call(named, login.cookie, 'auth.logout');
  }
}
