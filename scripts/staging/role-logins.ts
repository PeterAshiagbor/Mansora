/**
 * One-time team-test operation (C55): tell each tester about every role in their shop.
 *
 * Each tester receives one summary email (owner login, what each role can do), then the
 * shop's manager and cashier logins as one-time sign-in codes through the ordinary
 * `staff.invite` command (C53), sent to the same tester address. Owner passwords are not
 * changed: testers keep their current passphrase and can reset it from the sign-in page.
 *
 * Runs once per operation id and records each completed send in a private journal,
 * so restarts and redeploys never repeat an email.
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailAdapter } from '../../apps/api/src/email';
import type { TestAccount } from './bootstrap';
import type { StagingWorkspace } from './gateway';

export const ROLE_LOGINS_OPERATION = '2026-11-13-role-logins';
const STAFF_ROLES = ['manager', 'cashier'] as const;
interface Journal { id: string; sent: Record<string, string> }
function save(path: string, value: Journal) {
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); chmodSync(path, 0o600);
}

export async function sendRoleLogins(options: { id?: string; dataDir: string; origin: string; workspaces: StagingWorkspace[]; email: EmailAdapter; now?: () => Date }) {
  const { id, dataDir, workspaces, email } = options;
  const result = { sent: 0, skipped: 0, waiting: 0, disabled: false, failureReasons: [] as string[] };
  if (!id || id === 'off') return { ...result, disabled: true };
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('STAGING_ROLE_LOGINS_ID must be an explicit operation identifier.');
  const accountsPath = join(dataDir, 'test-accounts.json'), journalPath = join(dataDir, 'role-logins.json');
  if (!existsSync(accountsPath)) return { ...result, disabled: true };
  const accounts = JSON.parse(readFileSync(accountsPath, 'utf8')) as TestAccount[];
  const owners = accounts.filter((a) => a.role === 'owner' && a.email);
  const plan = owners.flatMap((o) => ['summary', ...STAFF_ROLES].map((step) => ({ owner: o, step })));
  if (!email.configured()) return { ...result, waiting: plan.length, failureReasons: ['RESEND_NOT_CONFIGURED'] };
  let journal: Journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : { id, sent: {} };
  if (journal.id !== id) journal = { id, sent: {} };
  const now = options.now ?? (() => new Date());
  const origin = new URL(options.origin).origin;
  const reasons = new Set<string>();

  for (const owner of owners) {
    const workspace = workspaces.find((w) => w.id === owner.workspace);
    if (!workspace) { result.waiting += 3; reasons.add('WORKSPACE_MISSING'); continue; }
    const engine = workspace.engine;
    const ownerRow = engine.db.prepare(`SELECT id FROM users WHERE role = 'owner' AND status = 'active'`).get() as { id: string } | undefined;
    if (!ownerRow) { result.waiting += 3; reasons.add('OWNER_MISSING'); continue; }
    const shop = engine.meta('business_name') || 'your test shop';
    const staff = STAFF_ROLES.map((role) => accounts.find((a) => a.workspace === owner.workspace && a.role === role)).filter(Boolean) as TestAccount[];
    const key = (step: string) => `${owner.workspace}:${step}`;

    if (!journal.sent[key('summary')]) {
      try {
        await email.send({
          to: owner.email!, subject: `Your Mansora test shop: three ways to sign in`, idempotencyKey: `mansora-role-logins/${id}/${owner.workspace}`,
          body: [
            'Hello,', '',
            `Your test shop "${shop}" has three logins, one for each role, so you can see exactly what each person in a real shop can and cannot do.`, '',
            `Shop address: ${origin}/client/${owner.workspace}/`, '',
            `1. Owner. Sign in with ${owner.email} and your current passphrase. Forgot it? Use "Reset owner password" on the sign-in page.`,
            '   Can do everything: staff and permissions, settings, reports and profit, exports, backups, billing and Mansora access.',
            ...staff.map((s, i) => s.role === 'manager'
              ? `${i + 2}. Manager, username ${s.username}. Runs the shop day to day: sales, refunds, stock, purchases, customers, expenses and reports. Cannot manage staff, settings, exports, backups, the audit log or billing.`
              : `${i + 2}. Cashier, username ${s.username}. Sells, opens and closes their own shift and looks up products. Needs a manager or the owner to approve discounts, refunds and credit, and cannot see costs or reports.`),
            '',
            'The manager and cashier logins arrive in two separate emails, each with a one-time sign-in code. On the sign-in page choose "I have a sign-in code", enter the username and code, and choose a password. Each code works once and expires after 48 hours; as the owner you can send a new one from Staff.', '',
            'This is a test environment. Use sample data only.',
          ].join('\n'),
        });
        journal.sent[key('summary')] = now().toISOString(); save(journalPath, journal); result.sent++;
      } catch { reasons.add('SUMMARY_NOT_SENT'); result.waiting += 1 + staff.length; continue; }
    } else result.skipped++;

    const token = engine.createSession(ownerRow.id);
    try {
      const list = await engine.execute(token, 'staff.list', {});
      for (const account of staff) {
        if (journal.sent[key(account.role)]) { result.skipped++; continue; }
        const user = list.find((u: any) => u.username === account.username);
        if (!user || user.status !== 'active') { result.waiting++; reasons.add('STAFF_ACCOUNT_MISSING'); continue; }
        try {
          // Record the tester's address on the staff login (kept on the shop's own store only), then send its code.
          await engine.execute(token, 'staff.save', { id: user.id, name: user.name, username: user.username, role: user.role, status: user.status, permissions: user.permissions, email: owner.email });
          await engine.execute(token, 'staff.invite', { userId: user.id });
          journal.sent[key(account.role)] = now().toISOString(); save(journalPath, journal); result.sent++;
        } catch (e: any) { result.waiting++; reasons.add(typeof e?.code === 'string' ? `STAFF_${e.code}` : 'STAFF_INVITE_FAILED'); }
      }
    } finally { engine.endSession(token); }
  }
  result.failureReasons = [...reasons];
  return result;
}
