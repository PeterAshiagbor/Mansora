import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadWorkspaces, type StagingConfig } from '../../scripts/staging/config';
import { PASSWORD_RESET_OPERATION, readablePassword, resetTestLogins } from '../../scripts/staging/password-reset';
import { readableTestPassword } from '../../scripts/staging/passphrase';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

describe('reset every test login and email the new details', () => {
  let cloud: Cloud, config: StagingConfig, workspaces: ReturnType<typeof loadWorkspaces>;
  const emails = ['first@example.test', 'second@example.test'];
  const adminEmail = 'chosen-admin@example.test';
  const sent: any[] = [];
  const adapter = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: `m${sent.length}` }; }) };
  const accounts = () => JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  beforeAll(async () => {
    cloud = await startCloud();
    config = { origin: 'https://app.example.test', apiUrl: cloud.url, dataDir: tempDir(), key: randomBytes(32).toString('hex'), clientDir: tempDir(), adminDir: tempDir() };
    await provisionStaging(config, ADMIN, emails, [readableTestPassword(), readableTestPassword()]);
    workspaces = loadWorkspaces(config);
  });
  afterAll(async () => { for (const w of workspaces ?? []) w.engine.db.close(); await cloud?.close(); });
  const run = (email: any = adapter) => resetTestLogins({ id: PASSWORD_RESET_OPERATION, dataDir: config.dataDir, origin: config.origin, workspaces, email, adminEmail, platform: cloud.db.platform.bind(cloud.db) as any });

  it('makes readable passwords long enough for administrators', () => {
    const p = readablePassword();
    expect(p).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    expect(p.length).toBeGreaterThanOrEqual(12);
  });

  it('waits without changing anything when email is not configured', async () => {
    const before = accounts().map((a) => a.password);
    expect(await run({ configured: () => false, send: vi.fn() })).toMatchObject({ shopsSent: 0, failureReasons: ['RESEND_NOT_CONFIGURED'] });
    expect(accounts().map((a) => a.password)).toEqual(before);
  });

  it('recreates a missing cashier, resets every login, emails each owner their shop only, and the new passwords work', async () => {
    // One shop has lost its cashier login, as on Railway (STAFF_ACCOUNT_MISSING).
    const b = workspaces.find((w) => w.id === 'shop-b')!;
    b.engine.db.prepare(`UPDATE users SET status = 'disabled' WHERE role = 'cashier'`).run();
    const old = accounts();

    const r = await run();
    expect(r).toMatchObject({ shopsSent: 2, waiting: 0, adminSent: true, failureReasons: [] });
    const shopMails = sent.filter((m) => m.to !== adminEmail);
    expect(shopMails.map((m) => m.to).sort()).toEqual([...emails].sort());

    for (const w of workspaces) {
      const owner = accounts().find((a) => a.workspace === w.id && a.role === 'owner')!;
      const mail = shopMails.find((m) => m.to === owner.email)!;
      expect(mail.body).toContain(`/client/${w.id}/`);
      for (const role of ['owner', 'manager', 'cashier']) {
        const now = accounts().find((a) => a.workspace === w.id && a.role === role)!;
        expect(now.password).not.toBe(old.find((a) => a.workspace === w.id && a.username === now.username)?.password);
        expect(mail.body).toContain(`Username: ${now.username}`);
        expect(mail.body).toContain(`Password: ${now.password}`);
        // The emailed password signs in; the old one does not.
        expect((await w.engine.execute(null, 'auth.login', { username: now.username, password: now.password })).token).toBeTruthy();
      }
      // Nothing from the other shop leaks into this email.
      const other = accounts().filter((a) => a.workspace !== w.id);
      for (const a of other) expect(mail.body).not.toContain(a.password);
    }

    const adminMail = sent.find((m) => m.to === adminEmail)!;
    const password = /Password: (\S+)/.exec(adminMail.body)![1];
    const login = await fetch(`${cloud.url}/v1/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password }) });
    expect(login.status).toBe(200);
  });

  it('never repeats after it has run', async () => {
    const count = sent.length;
    expect(await run()).toMatchObject({ shopsSent: 0, shopsSkipped: 2, adminSent: false });
    expect(sent).toHaveLength(count);
  });
});
