/**
 * One-time team-test operation (owner request, 2026-11-14): reset every test login and email the new details.
 *
 * Testers reported that their passwords did not work. For every test shop this gives each active login
 * (owner, manager, cashier) a new random password, creates a missing manager or cashier login, clears any
 * sign-in lockout, and sends the shop owner's address one email listing the shop address, each username and
 * each password. It also creates or resets the administrator account named in STAGING_ADMIN_EMAIL and emails
 * its sign-in details.
 *
 * This deliberately departs from decision D-37 (passwords are never emailed) for **test accounts only**, at the
 * owner's request. Real client shops never run this: it is limited to team-test mode.
 *
 * Runs once per operation id. A shop is marked done only after its email is accepted, so a failed send is
 * retried with fresh passwords on the next start, and a completed one is never repeated.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailAdapter } from '../../apps/api/src/email';
import type { Query } from '../../apps/api/src/db';
import { hashPassword } from '../../apps/api/src/security';
import type { TestAccount } from './bootstrap';
import type { StagingWorkspace } from './gateway';

export const PASSWORD_RESET_OPERATION = '2026-11-14-password-reset';
const ROLE_ORDER = ['owner', 'manager', 'cashier'];
const ROLE_TEXT: Record<string, string> = {
  owner: 'Can do everything: staff, settings, reports and profit, exports, backups and billing.',
  manager: 'Runs the shop day to day: sales, refunds, stock, purchases, customers, expenses and reports.',
  cashier: 'Sells and opens and closes their own shift. Needs a manager or owner for discounts, refunds and credit.',
};

/** Easy to read aloud and type: no 0/O, 1/l/I. 14 characters, about 70 bits. */
export function readablePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

interface Journal { id: string; sent: Record<string, string> }
function save(path: string, value: unknown) {
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); chmodSync(path, 0o600);
}

export async function resetTestLogins(options: {
  id?: string; dataDir: string; origin: string; workspaces: StagingWorkspace[]; email: EmailAdapter;
  adminEmail?: string; platform?: <T>(fn: (q: Query) => Promise<T>) => Promise<T>; now?: () => Date;
}) {
  const { id, dataDir, workspaces, email } = options;
  const result = { shopsSent: 0, shopsSkipped: 0, waiting: 0, adminSent: false, disabled: false, failureReasons: [] as string[] };
  if (!id || id === 'off') return { ...result, disabled: true };
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('STAGING_PASSWORD_RESET_ID must be an explicit operation identifier.');
  if (!email.configured()) return { ...result, waiting: workspaces.length, failureReasons: ['RESEND_NOT_CONFIGURED'] };
  const accountsPath = join(dataDir, 'test-accounts.json'), journalPath = join(dataDir, 'password-reset.json'), registryPath = join(dataDir, 'workspaces.json');
  const accounts: TestAccount[] = existsSync(accountsPath) ? JSON.parse(readFileSync(accountsPath, 'utf8')) : [];
  const registry: { id: string; ownerEmail?: string; ownerUsername?: string }[] = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : [];
  let journal: Journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : { id, sent: {} };
  if (journal.id !== id) journal = { id, sent: {} };
  const now = options.now ?? (() => new Date());
  const origin = new URL(options.origin).origin;
  const reasons = new Set<string>();

  for (const workspace of workspaces) {
    const key = `shop:${workspace.id}`;
    if (journal.sent[key]) { result.shopsSkipped++; continue; }
    const owned = accounts.find((a) => a.workspace === workspace.id && a.role === 'owner');
    const to = owned?.email ?? registry.find((r) => r.id === workspace.id)?.ownerEmail;
    if (!to) { result.waiting++; reasons.add('NO_OWNER_EMAIL'); continue; }
    const engine = workspace.engine;
    const ownerRow = engine.db.prepare(`SELECT id FROM users WHERE role = 'owner' AND status = 'active'`).get() as { id: string } | undefined;
    if (!ownerRow) { result.waiting++; reasons.add('OWNER_MISSING'); continue; }
    const token = engine.createSession(ownerRow.id);
    const logins: { role: string; username: string; password: string }[] = [];
    try {
      // The fixed team-test shops always have one manager and one cashier login; recreate any that is missing.
      if (owned) {
        for (const role of ['manager', 'cashier']) {
          const list = await engine.execute(token, 'staff.list', {});
          if (list.some((u: any) => u.role === role && u.status === 'active')) continue;
          const taken = list.find((u: any) => u.username === role);
          const password = readablePassword();
          if (taken) await engine.execute(token, 'staff.save', { id: taken.id, name: taken.name, username: taken.username, role, status: 'active', permissions: taken.permissions, password });
          else await engine.execute(token, 'staff.save', { name: `Test ${role}`, username: role, role, status: 'active', password });
        }
      }
      const list = await engine.execute(token, 'staff.list', {});
      // The owner goes last: resetting the owner's password ends the owner's sessions, including this one.
      const active = list.filter((u: any) => u.status === 'active').sort((a: any, b: any) => Number(a.id === ownerRow.id) - Number(b.id === ownerRow.id));
      for (const user of active) {
        const password = readablePassword();
        // Saving a password also clears failed attempts and any lockout, and signs that person out elsewhere.
        await engine.execute(token, 'staff.save', { id: user.id, name: user.name, username: user.username, role: user.role, status: user.status, permissions: user.permissions, password });
        logins.push({ role: user.role, username: user.username, password });
      }
    } catch (e: any) {
      result.waiting++; reasons.add(typeof e?.code === 'string' ? `RESET_${e.code}` : 'RESET_FAILED'); continue;
    } finally { try { engine.endSession(token); } catch { /* already ended by the owner's reset */ } }
    logins.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.username.localeCompare(b.username));

    // Keep the operator's private record of the fixed test accounts truthful.
    if (owned) {
      for (const l of logins) {
        const existing = accounts.find((a) => a.workspace === workspace.id && a.username === l.username);
        if (existing) existing.password = l.password; else accounts.push({ workspace: workspace.id, username: l.username, role: l.role, password: l.password });
      }
      save(accountsPath, accounts);
    }

    const shop = engine.meta('business_name') || workspace.label;
    try {
      await email.send({
        to, subject: `New sign-in details for ${shop} (Mansora test shop)`, idempotencyKey: `mansora-password-reset/${id}/${workspace.id}`,
        body: [
          'Hello,', '',
          `All passwords for your test shop "${shop}" have been reset. Earlier passwords and sign-in codes no longer work.`, '',
          `Shop address: ${origin}/client/${workspace.id}/`, '',
          ...logins.flatMap((l) => [
            `${l.role[0].toUpperCase()}${l.role.slice(1)}`,
            `  Username: ${l.username}${l.role === 'owner' ? `   (you can also type ${to})` : ''}`,
            `  Password: ${l.password}`,
            `  ${ROLE_TEXT[l.role] ?? ''}`, '',
          ]),
          'Type the password exactly as shown, including the dashes. It is case sensitive.',
          'Each person can change their own password after signing in.', '',
          'This is a test environment. Use sample data only, and do not forward this email.',
        ].join('\n'),
      });
      journal.sent[key] = now().toISOString(); save(journalPath, journal); result.shopsSent++;
    } catch { result.waiting++; reasons.add('SHOP_EMAIL_NOT_SENT'); }
  }

  // The administrator named by the owner: create the account, or reset its password, then email the details.
  const adminEmail = options.adminEmail?.trim().toLowerCase();
  if (adminEmail && options.platform && !journal.sent['admin']) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) reasons.add('ADMIN_EMAIL_INVALID');
    else {
      const password = readablePassword();
      try {
        await options.platform(async (q) => {
          const [existing] = await q(`SELECT id FROM admins WHERE email = $1`, [adminEmail]);
          if (existing) {
            await q(`UPDATE admins SET password_hash = $2, status = 'active' WHERE id = $1`, [existing.id, hashPassword(password)]);
            await q(`DELETE FROM admin_sessions WHERE admin_id = $1`, [existing.id]);
          } else {
            await q(`INSERT INTO admins (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`, [randomUUID(), adminEmail, adminEmail.split('@')[0], hashPassword(password)]);
          }
          await q(`UPDATE admin_invitations SET used_at = now() WHERE email = $1 AND used_at IS NULL`, [adminEmail]);
        });
        await email.send({
          to: adminEmail, subject: 'Your Mansora administrator sign-in', idempotencyKey: `mansora-password-reset/${id}/admin`,
          body: [
            'Hello,', '',
            'You are a Mansora administrator. Administrators manage client shops, onboarding, billing and support.', '',
            `Administration dashboard: ${origin}/admin/`,
            `Email: ${adminEmail}`,
            `Password: ${password}`, '',
            'Type the password exactly as shown, including the dashes. After signing in, set up two-factor authentication under Account security,',
            'and change your password.', '',
            'This is a test environment. Do not forward this email.',
          ].join('\n'),
        });
        journal.sent['admin'] = now().toISOString(); save(journalPath, journal); result.adminSent = true;
      } catch { reasons.add('ADMIN_NOT_SENT'); }
    }
  }
  result.failureReasons = [...reasons];
  return result;
}
