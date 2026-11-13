import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadWorkspaces, type StagingConfig } from '../../scripts/staging/config';
import { ROLE_LOGINS_OPERATION, sendRoleLogins } from '../../scripts/staging/role-logins';
import { readableTestPassword } from '../../scripts/staging/passphrase';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

describe('C55: one-time role logins for every tester', () => {
  let cloud: Cloud, config: StagingConfig, workspaces: ReturnType<typeof loadWorkspaces>;
  const emails = ['first@example.test', 'second@example.test'];
  const sent: any[] = [];
  const adapter = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: `m${sent.length}` }; }) };
  const accounts = () => JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  beforeAll(async () => {
    cloud = await startCloud();
    cloud.billing.email = adapter; // staff codes travel engine -> device API -> this adapter, as on Railway
    config = { origin: 'https://app.example.test', apiUrl: cloud.url, dataDir: tempDir(), key: randomBytes(32).toString('hex'), clientDir: tempDir(), adminDir: tempDir() };
    await provisionStaging(config, ADMIN, emails, [readableTestPassword(), readableTestPassword()]);
    workspaces = loadWorkspaces(config);
  });
  afterAll(async () => { for (const w of workspaces ?? []) w.engine.db.close(); await cloud?.close(); });
  const run = (email = adapter, id = ROLE_LOGINS_OPERATION) => sendRoleLogins({ id, dataDir: config.dataDir, origin: config.origin, workspaces, email });

  it('waits without sending or changing anything when email is not configured, and can be switched off', async () => {
    expect(await run({ configured: () => false, send: vi.fn() } as any)).toMatchObject({ sent: 0, waiting: 6, failureReasons: ['RESEND_NOT_CONFIGURED'] });
    expect(await run(adapter, 'off')).toMatchObject({ disabled: true });
    expect(sent).toHaveLength(0);
  });

  it('sends each tester a summary plus working manager and cashier codes for their own shop only, without touching owner passwords', async () => {
    const before = accounts().filter((a) => a.role === 'owner').map((a) => a.password);
    expect(await run()).toMatchObject({ sent: 6, waiting: 0, failureReasons: [] });
    expect(sent).toHaveLength(6);
    for (const owner of accounts().filter((a) => a.role === 'owner')) {
      const mine = sent.filter((m) => m.to === owner.email);
      expect(mine).toHaveLength(3);
      const summary = mine.find((m) => m.subject.includes('three ways to sign in'));
      expect(summary.body).toContain(`/client/${owner.workspace}/`);
      expect(summary.body).not.toContain(owner.password); // no passwords in email
      const engine = workspaces.find((w) => w.id === owner.workspace)!.engine;
      for (const role of ['manager', 'cashier']) {
        const staff = accounts().find((a) => a.workspace === owner.workspace && a.role === role)!;
        expect(summary.body).toContain(`username ${staff.username}`);
        const codeMail = mine.find((m) => m.body.includes(`Username: ${staff.username}`));
        const code = /code: ([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(codeMail.body)![1];
        await engine.execute(null, 'auth.acceptInvite', { username: staff.username, code, newPassword: `${role}-tester-chose-1` });
        const login = await engine.execute(null, 'auth.login', { username: staff.username, password: `${role}-tester-chose-1` });
        expect(login.user.role).toBe(role);
        engine.endSession(login.token);
      }
      // The owner still signs in with the passphrase they already have.
      const ownerLogin = await engine.execute(null, 'auth.login', { username: owner.username, password: owner.password });
      expect(ownerLogin.user.role).toBe('owner'); engine.endSession(ownerLogin.token);
    }
    expect(accounts().filter((a) => a.role === 'owner').map((a) => a.password)).toEqual(before);
  });

  it('never repeats an email on restart, and a new operation id sends again', async () => {
    expect(await run()).toMatchObject({ sent: 0, skipped: 6 });
    expect(sent).toHaveLength(6);
    expect(await run(adapter, 'next-role-logins-run')).toMatchObject({ sent: 6 });
    expect(sent).toHaveLength(12);
  });
});
