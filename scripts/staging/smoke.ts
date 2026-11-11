import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void smokeStaging().catch(() => { console.error('Staging smoke check failed. No credentials or payloads are logged.'); process.exitCode = 1; });
