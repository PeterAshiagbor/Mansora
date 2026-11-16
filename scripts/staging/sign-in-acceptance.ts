/** Opt-in, read-only public sign-in rehearsal using existing assigned synthetic accounts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StagingWorkspace } from './gateway';
import type { TestAccount } from './bootstrap';
import { publicLogin } from './login-directory';
export async function rehearsePublicSignIn(options: { version: string; origin: string; dataDir: string; workspaces: StagingWorkspace[] }) {
  if (options.version !== 'signin-v1') throw new Error('SIGNIN_ACCEPTANCE_VERSION_REQUIRED');
  const origin = new URL(options.origin).origin;
  const accounts = JSON.parse(readFileSync(join(options.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  const assigned = accounts.filter(account => ['shop-a', 'shop-b'].includes(account.workspace));
  if (assigned.length !== 6 || !['shop-a', 'shop-b'].every(id => ['owner', 'manager', 'cashier'].every(role => assigned.filter(account => account.workspace === id && account.role === role).length === 1))) throw new Error('SIGNIN_ACCEPTANCE_ASSIGNED_ACCOUNTS_REQUIRED');
  const check = (value: unknown) => { if (!value) throw new Error('SIGNIN_ACCEPTANCE_ASSERTION_FAILED'); };
  const invoke = async (workspace: string, cookie: string, command: string) => {
    const response = await fetch(`${origin}/client/${workspace}/invoke`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ command }), signal: AbortSignal.timeout(30_000) });
    check(response.ok); return await response.json() as any;
  };
  const landing = await fetch(origin + '/', { signal: AbortSignal.timeout(30_000) });
  const html = await landing.text(); check(landing.ok && new URL(landing.url).pathname === '/signin/' && html.includes('Username or email') && !/TEAM TEST|href="\/client\//.test(html));
  let checked = 0;
  for (const account of assigned) {
    const workspace = options.workspaces.find(workspace => workspace.id === account.workspace);
    check(workspace && typeof account.username === 'string' && typeof account.password === 'string');
    let cookie = '';
    try {
      const response = await fetch(origin + '/signin/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: publicLogin(account.workspace, account.username), password: account.password }), signal: AbortSignal.timeout(30_000) });
      const header = response.headers.get('set-cookie') ?? ''; cookie = header.split(';')[0];
      const result = await response.json() as any;
      check(response.ok && result.ok && result.data.platform === 'client' && result.data.url === `/client/${account.workspace}/` && !result.data.token);
      check(header.includes('HttpOnly') && header.includes('SameSite=Strict') && header.includes(`Path=/client/${account.workspace}/`) && (origin.startsWith('http:') || header.includes('; Secure')));
      const state = await invoke(account.workspace, cookie, 'app.state');
      check(state.ok && state.data.user?.role === account.role && state.data.business.tenantId === workspace!.engine.meta('tenant_id'));
      const other = await invoke(account.workspace === 'shop-a' ? 'shop-b' : 'shop-a', cookie, 'app.state'); check(other.ok && other.data.user === null);
      checked++;
    } finally { if (cookie) await invoke(account.workspace, cookie, 'auth.logout').catch(() => {}); }
  }
  return { version: 'signin-v1', accountsChecked: checked, landing: 'passed', authenticatedRouting: 'passed', scopedCookies: 'passed', crossShopIsolation: 'passed', financialWrites: 0, emailsSent: 0 };
}
