/** Explicit one-time tester invitations; never part of ordinary account provisioning. */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmailDeliveryError, type EmailAdapter } from '../../apps/api/src/email';
import type { TestAccount } from './bootstrap';
import type { StagingWorkspace } from './gateway';
import { readableTestPassword } from './passphrase';

interface Invitation {
  workspace: string; username: string; email: string; password: string;
  firstAttemptAt?: string; messageId?: string; activatedAt?: string; error?: string;
}
interface Journal { id: string; invitations: Invitation[] }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function save(path: string, value: unknown) {
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); chmodSync(path, 0o600);
}
export async function inviteTesters(options: { id?: string; dataDir: string; origin: string; workspaces: StagingWorkspace[]; email: EmailAdapter; now?: () => Date; onActivated?: (tenantId: string, email: string) => Promise<void> }) {
  const { id, dataDir, workspaces, email } = options;
  if (!id) return { accepted: 0, activated: 0, waiting: 0, disabled: true, failureReasons: [] as string[] };
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('STAGING_TESTER_INVITATION_ID must be an explicit operation identifier.');
  const origin = new URL(options.origin);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Use HTTPS for tester invitations.');
  const now = options.now ?? (() => new Date());
  const accountsPath = join(dataDir, 'test-accounts.json'), journalPath = join(dataDir, 'tester-invitations.json');
  const accounts = JSON.parse(readFileSync(accountsPath, 'utf8')) as TestAccount[];
  const owners = accounts.filter(a => a.role === 'owner' && a.email);
  if (!owners.length) throw new Error('No assigned tester emails were provisioned.');
  // No provider means no credential mutation and no private passphrase plan yet.
  if (!email.configured()) return { accepted: 0, activated: 0, waiting: owners.length, disabled: false, failureReasons: ['RESEND_NOT_CONFIGURED'] };
  let journal: Journal | undefined = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : undefined;
  if (journal && journal.id !== id && journal.invitations.some(i => !i.activatedAt)) throw new Error('Finish or reconcile the pending tester invitation operation first.');
  if (!journal || journal.id !== id) {
    journal = { id, invitations: owners.map(a => ({ workspace: a.workspace, username: a.username, email: a.email!, password: readableTestPassword() })) };
    save(journalPath, journal);
  }
  if (journal.invitations.length !== owners.length || new Set(journal.invitations.map(i => i.workspace)).size !== owners.length) throw new Error('The private invitation plan does not match assigned tester accounts.');
  let accepted = 0, activated = 0;
  const failureReasons = new Set<string>();
  for (const invitation of journal.invitations) {
    const account = owners.find(a => a.workspace === invitation.workspace && a.username === invitation.username && a.email === invitation.email);
    const workspace = workspaces.find(w => w.id === invitation.workspace);
    if (!account || !workspace) throw new Error('Assigned tester identities changed; review the private invitation journal.');
    if (invitation.activatedAt) { accepted++; activated++; continue; }
    try {
      if (!invitation.messageId) {
        if (invitation.firstAttemptAt && now().getTime() - Date.parse(invitation.firstAttemptAt) >= 23 * 3_600_000) throw new Error('Provider reconciliation required');
        invitation.firstAttemptAt ??= now().toISOString(); save(journalPath, journal);
        const link = `${origin.origin}/client/${invitation.workspace}/#email=${encodeURIComponent(invitation.email)}`;
        const result = await email.send({ to: invitation.email, subject: 'Your Mansora test workspace is ready',
          idempotencyKey: `mansora-test-invite/${id}/${invitation.workspace}`,
          body: `Welcome to Mansora,\n\nYour private test workspace: ${link}\nSign-in email: ${invitation.email}\nYour unique test passphrase: ${invitation.password}\n\nPaste the passphrase exactly, including the hyphens and numbers. It will be activated immediately after this invitation is accepted for delivery. If you open this email straight away, allow a few seconds and retry.\n\nThis is a team test environment. Use sample records only. Your existing business records are preserved. Keep these sign-in details private; reply to this email if you need help.\n\nMansora Consulting & Business Solutions` });
        if (!result?.id) throw new Error('Provider acknowledgement missing');
        invitation.messageId = result.id; invitation.error = undefined; save(journalPath, journal);
      }
      accepted++;
      // Use the existing auth commands; never patch password hashes or bypass roles.
      let token: string | undefined;
      try {
        try { token = (await workspace.engine.execute(null, 'auth.login', { username: account.username, password: account.password })).token; }
        catch { token = (await workspace.engine.execute(null, 'auth.login', { username: account.username, password: invitation.password })).token; }
        if (account.password !== invitation.password) {
          // A crash after the DB commit but before the manifest write is recovered
          // by the second login above; do not repeat a password mutation in that case.
          let alreadyApplied = false;
          try { const session = await workspace.engine.execute(null, 'auth.login', { username: account.username, password: invitation.password }); workspace.engine.endSession(session.token); alreadyApplied = true; } catch { /* expected before the first rotation */ }
          if (!alreadyApplied) await workspace.engine.execute(token!, 'auth.changePassword', { current: account.password, next: invitation.password });
        }
      } finally { if (token) workspace.engine.endSession(token); }
      account.provisionedPasswordHash ??= hash(account.password);
      account.password = invitation.password; save(accountsPath, accounts);
      if (options.onActivated) {
        const state = await workspace.engine.execute(null, 'app.state');
        await options.onActivated(state.business.tenantId, invitation.email);
      }
      invitation.activatedAt = now().toISOString(); invitation.error = undefined; save(journalPath, journal); activated++;
    } catch (error) {
      const status = error instanceof EmailDeliveryError ? error.message.match(/^Resend rejected delivery \(HTTP (\d{3})\)\.$/)?.[1] : undefined;
      failureReasons.add(status ? `RESEND_HTTP_${status}` : error instanceof EmailDeliveryError && error.message === 'Resend sender domain is not verified.' ? 'RESEND_SENDER_UNVERIFIED' : error instanceof EmailDeliveryError ? 'RESEND_DELIVERY_UNAVAILABLE' : 'ACTIVATION_REVIEW_REQUIRED');
      // No addresses, provider responses or credential text enters deployment logs.
      invitation.error = error instanceof EmailDeliveryError ? error.message : 'Invitation needs retry or administrator review. Current credentials are preserved unless activation already committed.';
      save(journalPath, journal);
    }
  }
  return { accepted, activated, waiting: journal.invitations.length - activated, disabled: false, failureReasons: [...failureReasons] };
}
