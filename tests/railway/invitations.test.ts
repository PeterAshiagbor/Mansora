import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { loadWorkspaces, type StagingConfig } from '../../scripts/staging/config';
import { inviteTesters } from '../../scripts/staging/invitations';
import { readableTestPassword } from '../../scripts/staging/passphrase';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

describe('private, restart-safe readable tester invitations', () => {
  let cloud: Cloud, config: StagingConfig, workspaces: ReturnType<typeof loadWorkspaces>;
  const emails = ['first@example.test', 'second@example.test'];
  const original = [readableTestPassword(), readableTestPassword()];
  const read = () => JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  const owners = () => read().filter(a => a.role === 'owner');
  beforeAll(async () => {
    cloud = await startCloud();
    config = { origin: 'https://app.example.test', apiUrl: cloud.url, dataDir: tempDir(), key: randomBytes(32).toString('hex'), clientDir: tempDir(), adminDir: tempDir() };
    await provisionStaging(config, ADMIN, emails, original); workspaces = loadWorkspaces(config);
  });
  afterAll(async () => { for (const w of workspaces ?? []) w.engine.db.close(); await cloud?.close(); });
  const options = () => ({ id: 'test-invitation-1', dataDir: config.dataDir, origin: config.origin, workspaces });
  it('generates distinct copyable word passphrases meeting the existing 24-character requirement', () => {
    const values = Array.from({ length: 100 }, readableTestPassword);
    expect(new Set(values).size).toBe(100);
    expect(values.every(v => v.length >= 24 && /^[a-z]+(?:-[a-z]+){4}-\d{4}$/.test(v))).toBe(true);
  });
  it('keeps existing passwords when email is unconfigured or rejects the invitation', async () => {
    const send = vi.fn(async () => { throw new Error('private provider diagnostic'); });
    expect(await inviteTesters({ ...options(), email: { configured: () => false, send } })).toMatchObject({ activated: 0, waiting: 2 });
    expect(send).not.toHaveBeenCalled();
    expect(await inviteTesters({ ...options(), email: { configured: () => true, send } })).toMatchObject({ activated: 0, waiting: 2 });
    expect(owners().map(a => a.password)).toEqual(original);
    expect(readFileSync(join(config.dataDir, 'tester-invitations.json'), 'utf8')).not.toContain('private provider diagnostic');
  });
  it('emails each owner only their own workspace and activates the readable credentials once', async () => {
    const sent: any[] = [];
    const send = vi.fn(async (message: any) => { sent.push(message); return { id: 'provider-' + sent.length }; });
    expect(await inviteTesters({ ...options(), email: { configured: () => true, send } })).toMatchObject({ accepted: 2, activated: 2, waiting: 0 });
    expect(sent).toHaveLength(2);
    const accounts = owners();
    for (const [i, account] of accounts.entries()) {
      const message = sent.find(m => m.to === account.email);
      expect(message.body).toContain(`/client/${account.workspace}/#email=`);
      expect(message.body).toContain(account.password);
      expect(message.body).not.toContain(accounts[1 - i].password);
      expect(account.password).not.toBe(original[i]);
      expect(account.provisionedPasswordHash).toHaveLength(64);
      const engine = workspaces.find(w => w.id === account.workspace)!.engine;
      const login = await engine.execute(null, 'auth.login', account); expect(login.user.role).toBe('owner'); engine.endSession(login.token);
    }
    expect(await inviteTesters({ ...options(), email: { configured: () => true, send } })).toMatchObject({ activated: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    if (process.platform !== 'win32') expect(statSync(join(config.dataDir, 'tester-invitations.json')).mode & 0o777).toBe(0o600);
  });
  it('preserves rotated accounts on provisioning restart and still refuses an uncoordinated password-variable change', async () => {
    expect(await provisionStaging(config, ADMIN, emails, original)).toEqual({ existing: true });
    await expect(provisionStaging(config, ADMIN, emails, [readableTestPassword(), original[1]])).rejects.toThrow('passwords changed');
  });
  it('recovers a crash between password commit and private manifest update without another email', async () => {
    const current = owners()[0], replacement = readableTestPassword();
    const engine = workspaces.find(w => w.id === current.workspace)!.engine;
    const session = await engine.execute(null, 'auth.login', current);
    await engine.execute(session.token, 'auth.changePassword', { current: current.password, next: replacement }); engine.endSession(session.token);
    const second = owners()[1];
    writeFileSync(join(config.dataDir, 'tester-invitations.json'), JSON.stringify({ id: 'crash-recovery-test', invitations: [{ workspace: current.workspace, username: current.username, email: current.email, password: replacement, messageId: 'already-accepted' }, { ...second, messageId: 'second-accepted', activatedAt: new Date().toISOString() }] }));
    chmodSync(join(config.dataDir, 'tester-invitations.json'), 0o600);
    const send = vi.fn();
    expect(await inviteTesters({ ...options(), id: 'crash-recovery-test', email: { configured: () => true, send } })).toMatchObject({ activated: 2, waiting: 0 });
    expect(send).not.toHaveBeenCalled(); expect(owners()[0].password).toBe(replacement);
    expect(await provisionStaging(config, ADMIN, emails, original)).toEqual({ existing: true });
  });
});
