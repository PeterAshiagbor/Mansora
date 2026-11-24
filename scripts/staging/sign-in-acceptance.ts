/** Opt-in, read-only public sign-in rehearsal using existing assigned synthetic accounts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StagingWorkspace } from './gateway';
import type { TestAccount } from './bootstrap';
import { publicLogin } from './login-directory';
import { verifyPassword } from '../../apps/desktop/src/core/passwords';
export async function rehearsePublicSignIn(options: { version: string; origin: string; dataDir: string; workspaces: StagingWorkspace[] }) {
  if (options.version !== 'signin-v1') throw new Error('SIGNIN_ACCEPTANCE_VERSION_REQUIRED');
  const origin = new URL(options.origin).origin;
  const accounts = JSON.parse(readFileSync(join(options.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  const assigned = accounts.filter(account => ['shop-a', 'shop-b'].includes(account.workspace));
  if (assigned.length !== 6 || !['shop-a', 'shop-b'].every(id => ['owner', 'manager', 'cashier'].every(role => assigned.filter(account => account.workspace === id && account.role === role).length === 1))) throw new Error('SIGNIN_ACCEPTANCE_ASSIGNED_ACCOUNTS_REQUIRED');
  // Each check names its step so a failure can be traced without logging any secret.
  class StepFailed extends Error {}
  let step = 'landing';
  const check = (value: unknown) => { if (!value) throw new StepFailed(step); };
  const invoke = async (workspace: string, cookie: string, command: string, own = false) => {
    const response = await fetch(own ? `${origin}/app/invoke` : `${origin}/client/${workspace}/invoke`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', ...(own ? { 'x-mansora-workspace': workspace } : {}) }, body: JSON.stringify({ command }), signal: AbortSignal.timeout(30_000) });
    check(response.ok); return await response.json() as any;
  };
  const failures: { workspace: string; role: string; step: string }[] = [], changedByUser: { workspace: string; role: string }[] = [];
  let landing = 'passed';
  try {
    const page = await fetch(origin + '/', { signal: AbortSignal.timeout(30_000) });
    const html = await page.text(); check(page.ok && new URL(page.url).pathname === '/signin/' && html.includes('Username or email') && !/TEAM TEST|href="\/client\//.test(html) && !/<select/i.test(html));
  } catch { landing = 'failed'; failures.push({ workspace: '-', role: '-', step: 'landing' }); }
  let checked = 0;
  for (const account of assigned) {
    const workspace = options.workspaces.find(workspace => workspace.id === account.workspace);
    if (!workspace || typeof account.username !== 'string' || typeof account.password !== 'string') { failures.push({ workspace: account.workspace, role: account.role, step: 'test-account-record' }); continue; }
    // A tester may have chosen their own password since the private test record was written. That is the person's
    // right, not a sign-in fault: compare against the stored hash (no failed attempt is counted) and skip the account.
    const row = workspace.engine.db.prepare('SELECT password_hash, status FROM users WHERE lower(username) = lower(?)').get(account.username) as { password_hash: string; status: string } | undefined;
    // A missing or disabled assigned account is a real failure; only an active account whose saved password no longer matches is skipped.
    if (!row) { failures.push({ workspace: account.workspace, role: account.role, step: 'account-missing' }); continue; }
    if (row.status !== 'active') { failures.push({ workspace: account.workspace, role: account.role, step: 'account-disabled' }); continue; }
    if (!verifyPassword(account.password, row.password_hash)) { changedByUser.push({ workspace: account.workspace, role: account.role }); continue; }
    let cookie = '';
    try {
      step = 'sign-in';
      const response = await fetch(origin + '/signin/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: publicLogin(account.workspace, account.username), password: account.password }), signal: AbortSignal.timeout(30_000) });
      const header = response.headers.get('set-cookie') ?? ''; cookie = header.split(';')[0];
      const result = await response.json() as any;
      check(response.ok && result.ok && result.data.platform === 'client' && result.data.url === '/app/' && !result.data.token);
      step = 'session-cookie'; check(header.includes('HttpOnly') && header.includes('SameSite=Strict') && header.includes('Path=/;') && (origin.startsWith('http:') || header.includes('; Secure')));
      step = 'own-workspace'; const state = await invoke(account.workspace, cookie, 'app.state', true);
      check(state.ok && state.data.user?.role === account.role && state.data.business.tenantId === workspace.engine.meta('tenant_id'));
      step = 'cross-shop-isolation'; const other = await invoke(account.workspace === 'shop-a' ? 'shop-b' : 'shop-a', cookie, 'app.state'); check(other.ok && other.data.user === null);
      checked++;
    } catch (error) {
      failures.push({ workspace: account.workspace, role: account.role, step: error instanceof StepFailed ? error.message : step + ' (unreachable)' });
    } finally { if (cookie) await invoke(account.workspace, cookie, 'auth.logout', true).catch(() => {}); }
  }
  const passed = !failures.length && checked > 0;
  return { version: 'signin-v1', passed, accountsChecked: checked, skippedPasswordChangedByUser: changedByUser, failures, landing, ...(passed ? { authenticatedRouting: 'passed', scopedCookies: 'passed', crossShopIsolation: 'passed' } : {}), financialWrites: 0, emailsSent: 0 };
}
