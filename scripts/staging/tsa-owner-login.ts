/** Owner-authorised, one-time username assignment for the existing synthetic TSA account. */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { TestAccount } from './bootstrap';
import type { StagingWorkspace } from './gateway';
import { usernameTaken } from './login-directory';

export async function assignTsaOwnerLogin(options: { dataDir: string; workspaces: StagingWorkspace[] }) {
  const path = join(options.dataDir, 'test-accounts.json');
  if (!existsSync(path)) return { skipped: true };
  const accounts = JSON.parse(readFileSync(path, 'utf8')) as TestAccount[];
  const assigned = accounts.filter(a => a.workspace === 'shop-a' && a.role === 'owner' && a.email?.trim().toLowerCase() === 'priscillawoven06@gmail.com');
  if (assigned.length !== 1) return { skipped: true };
  const workspace = options.workspaces.find(w => w.id === 'shop-a');
  if (!workspace) return { skipped: true };
  const engine = workspace.engine, key = 'tsa_owner_username_2026_11_19', username = 'tsa.owner';
  if (engine.meta(key) === 'complete') return { preserved: true };
  const owners = engine.db.prepare("SELECT id, username FROM users WHERE role = 'owner' AND status = 'active'").all() as { id: string; username: string }[];
  if (owners.length !== 1) throw new Error('TSA_OWNER_ASSIGNMENT_REQUIRES_ONE_ACTIVE_OWNER');
  const owner = owners[0];
  if (owner.username !== assigned[0].username && owner.username !== username) throw new Error('TSA_OWNER_IDENTITY_REVIEW_REQUIRED');
  if (usernameTaken(options.workspaces, workspace.id, owner.id, username)) throw new Error('TSA_OWNER_USERNAME_TAKEN');
  const token = engine.createSession(owner.id);
  try {
    const users = await engine.execute(token, 'staff.list', {});
    const user = users.find((u: any) => u.id === owner.id);
    // Omit password: staff.save retains its existing hash and records the authorised edit.
    await engine.execute(token, 'staff.save', { id: user.id, name: user.name, username, role: user.role, status: user.status, permissions: user.permissions });
    assigned[0].username = username;
    writeFileSync(path + '.pending', JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
    renameSync(path + '.pending', path);
    let loginVerified = false;
    try {
      const login = await engine.execute(null, 'auth.login', { username, password: assigned[0].password });
      engine.endSession(login.token); loginVerified = true;
    } catch { /* The owner may have changed the password since its private demo record was saved. */ }
    engine.setMeta(key, 'complete');
    return { assigned: true, workspace: 'shop-a', username, publicLogin: username + '@shop-a', passwordPreserved: true, loginVerified };
  } finally { engine.endSession(token); }
}
