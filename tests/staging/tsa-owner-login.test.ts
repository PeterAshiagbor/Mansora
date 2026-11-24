import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assignTsaOwnerLogin } from '../../scripts/staging/tsa-owner-login';
import { loadLoginAliases } from '../../scripts/staging/accounts';
import { makeShop, OWNER, tempDir } from '../helpers';

it('assigns only the authorised TSA owner, preserving password, records and later username edits', async () => {
  const a = await makeShop(), b = await makeShop(), dataDir = tempDir();
  try {
    const path = join(dataDir, 'test-accounts.json');
    writeFileSync(path, JSON.stringify([{ ...OWNER, role: 'owner', workspace: 'shop-a', email: 'priscillawoven06@gmail.com' }]));
    const workspaces = [{ id: 'shop-a', label: 'TSA', engine: a.engine }, { id: 'shop-b', label: 'TSB', engine: b.engine }];
    const hash = (a.engine.db.prepare("SELECT password_hash FROM users WHERE role='owner'").get() as any).password_hash;
    expect(await assignTsaOwnerLogin({ dataDir, workspaces })).toMatchObject({ assigned: true, username: 'tsa.owner', loginVerified: true });
    expect((a.engine.db.prepare("SELECT password_hash FROM users WHERE role='owner'").get() as any).password_hash).toBe(hash);
    expect((b.engine.db.prepare("SELECT username FROM users WHERE role='owner'").get() as any).username).toBe(OWNER.username);
    expect(JSON.parse(readFileSync(path, 'utf8'))[0]).toMatchObject({ username: 'tsa.owner', password: OWNER.password });
    expect(loadLoginAliases(dataDir, workspaces)['shop-a']['priscillawoven06@gmail.com']).toBe('tsa.owner');
    expect(await assignTsaOwnerLogin({ dataDir, workspaces })).toMatchObject({ preserved: true });
    const user = (await a.run(a.owner, 'staff.list')).find((u: any) => u.role === 'owner');
    await a.run(a.owner, 'staff.save', { ...user, username: 'later.owner' });
    expect(await assignTsaOwnerLogin({ dataDir, workspaces })).toMatchObject({ preserved: true });
    expect((a.engine.db.prepare("SELECT username FROM users WHERE role='owner'").get() as any).username).toBe('later.owner');
  } finally { a.engine.db.close(); b.engine.db.close(); }
});
it('does not rename an ordinary workspace or a different recorded owner', async () => {
  const a = await makeShop(), dataDir = tempDir();
  try {
    writeFileSync(join(dataDir, 'test-accounts.json'), JSON.stringify([{ ...OWNER, role: 'owner', workspace: 'shop-a', email: 'other@example.test' }]));
    expect(await assignTsaOwnerLogin({ dataDir, workspaces: [{ id: 'shop-a', label: 'TSA', engine: a.engine }] })).toMatchObject({ skipped: true });
    expect((a.engine.db.prepare("SELECT username FROM users WHERE role='owner'").get() as any).username).toBe(OWNER.username);
  } finally { a.engine.db.close(); }
});
