/** Recorded-owner email proof gates the existing device-bound engine recovery command. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@mansora/domain';
import { EmailDeliveryError, type EmailAdapter } from '../../apps/api/src/email';
import { HttpError } from '../../apps/api/src/security';
import { readWorkspaceRecords, workspaceKey, type StagingConfig } from './config';
import type { StagingWorkspace } from './gateway';
import type { TestAccount } from './bootstrap';

interface Recovery {
  workspaceId: string; tenantId: string; emailHash: string; tokenHash: string; origin: string; expiresAt: string;
  secret?: { iv: string; tag: string; data: string }; usedAt?: string; acceptedAt?: string; providerId?: string;
  attempts: number; nextAttemptAt?: string; leaseUntil?: string; failed?: boolean;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const validWorkspace = (value: string) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(value);
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };
const unavailable = () => fail(410, 'RECOVERY_LINK_UNAVAILABLE', 'This recovery link is unavailable, expired or already used. Try your chosen password, or request a new link.');
function save(path: string, value: Recovery) {
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); chmodSync(path, 0o600);
}
export function createOwnerRecovery(options: { config: StagingConfig; email: EmailAdapter; issueCode: (tenantId: string) => Promise<string>; now?: () => Date; onFailure?: () => void }) {
  const { config, email } = options, now = options.now ?? (() => new Date());
  const directory = join(config.dataDir, 'owner-recovery'); mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const key = Buffer.from(workspaceKey(config.key, 'browser-owner-recovery-secrets'), 'hex');
  let workspaces: StagingWorkspace[] = [], running: Promise<void> | undefined, closed = false;
  const resetting = new Set<string>();
  const path = (workspace: string) => join(directory, workspace + '.json');
  function read(workspace: string): Recovery | undefined {
    if (!existsSync(path(workspace))) return undefined;
    const record = JSON.parse(readFileSync(path(workspace), 'utf8')) as Recovery;
    if (record.workspaceId !== workspace || !validWorkspace(workspace) || !/^[a-f0-9-]{36}$/.test(record.tenantId) || !/^[a-f0-9]{64}$/.test(record.tokenHash) || !/^[a-f0-9]{64}$/.test(record.emailHash) || typeof record.origin !== 'string' || !Number.isFinite(Date.parse(record.expiresAt)) || !Number.isInteger(record.attempts) || record.attempts < 0 || record.attempts > 3) throw new Error('Invalid owner recovery journal; preserve it for review.');
    return record;
  }
  function encrypt(workspace: string, token: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(workspace));
    const data = Buffer.concat([cipher.update(token), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  function decrypt(record: Recovery) {
    if (!record.secret) return unavailable();
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.secret.iv, 'base64')); cipher.setAAD(Buffer.from(record.workspaceId)); cipher.setAuthTag(Buffer.from(record.secret.tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(record.secret.data, 'base64')), cipher.final()]).toString();
  }
  async function owner(workspaceId: string) {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return undefined;
    const state = await workspace.engine.execute(null, 'app.state'), tenantId = state.business.tenantId;
    const registry = readWorkspaceRecords(config).find(w => w.id === workspaceId);
    if (registry?.ownerEmail && registry.tenantId === tenantId) return { workspace, tenantId, email: registry.ownerEmail.toLowerCase() };
    const manifest = join(config.dataDir, 'test-accounts.json');
    const accounts = (existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : []) as TestAccount[];
    const owners = accounts.filter(a => a.workspace === workspaceId && a.role === 'owner' && a.email);
    if (owners.length === 1) return { workspace, tenantId, email: owners[0].email!.toLowerCase() };
    return undefined;
  }
  async function deliver() {
    if (!email.configured() || closed) return;
    for (const name of readdirSync(directory).filter(name => /^[a-z0-9][a-z0-9-]{1,40}\.json$/.test(name)).slice(0, 10)) {
      let record = read(name.slice(0, -5))!;
      if (record.usedAt) { if (record.secret) { record.secret = undefined; save(path(record.workspaceId), record); } continue; }
      if (record.origin !== config.origin || Date.parse(record.expiresAt) <= now().getTime()) { record.secret = undefined; record.failed = true; save(path(record.workspaceId), record); continue; }
      if (record.acceptedAt || record.failed) continue;
      if (record.attempts >= 3) { record.failed = true; record.secret = undefined; save(path(record.workspaceId), record); continue; }
      if ((record.leaseUntil && Date.parse(record.leaseUntil) > now().getTime()) || (record.nextAttemptAt && Date.parse(record.nextAttemptAt) > now().getTime())) continue;
      const identity = await owner(record.workspaceId);
      if (!identity || identity.tenantId !== record.tenantId || hash(identity.email) !== record.emailHash) { record.secret = undefined; record.failed = true; save(path(record.workspaceId), record); continue; }
      const fresh = read(record.workspaceId);
      if (!fresh || fresh.tokenHash !== record.tokenHash || fresh.usedAt || fresh.acceptedAt || Date.parse(fresh.expiresAt) <= now().getTime()) continue;
      record = fresh;
      const token = decrypt(record);
      record.leaseUntil = new Date(now().getTime() + 30_000).toISOString(); record.attempts++; save(path(record.workspaceId), record);
      try {
        const accepted = await email.send({ to: identity.email, subject: 'Reset your Mansora owner password', idempotencyKey: `mansora-owner-recovery/${record.tokenHash}`, body: `A request was made to reset your Mansora business-owner password.\n\nOpen this private link to choose a new password:\n${record.origin}/client/${record.workspaceId}/recover/#token=${token}\n\nThe link expires at ${record.expiresAt} and works once. If you did not request it, ignore this email; your password has not changed. Never share this link, your password or a payment PIN.\n\nMansora` });
        const latest = read(record.workspaceId);
        if (!latest || latest.tokenHash !== record.tokenHash || latest.usedAt) continue;
        record = latest;
        record.acceptedAt = now().toISOString(); record.providerId = accepted?.id; record.leaseUntil = undefined; save(path(record.workspaceId), record);
      } catch (error) {
        const latest = read(record.workspaceId);
        if (!latest || latest.tokenHash !== record.tokenHash || latest.usedAt) continue;
        record = latest;
        record.leaseUntil = undefined;
        if (error instanceof EmailDeliveryError && !error.retryable || record.attempts >= 3) record.failed = true;
        else record.nextAttemptAt = new Date(now().getTime() + 2 ** record.attempts * 30_000).toISOString();
        save(path(record.workspaceId), record); options.onFailure?.();
      }
    }
  }
  function processPending() {
    if (running) return running;
    running = deliver().catch(() => { options.onFailure?.(); }).finally(() => { running = undefined; }); return running;
  }
  const timer = setInterval(() => { void processPending(); }, 30_000); timer.unref();
  return {
    attach(active: StagingWorkspace[]) { workspaces = active; },
    available() { return email.configured(); },
    async request(workspaceId: string, address: string) {
      if (closed || !email.configured()) fail(503, 'RECOVERY_UNAVAILABLE', 'Email recovery is unavailable. Contact Mansora for help signing in.');
      if (!validWorkspace(workspaceId) || typeof address !== 'string' || address.length > 254) return { message: 'If these details match the recorded owner, a private recovery link will be sent.' };
      const identity = await owner(workspaceId), normalized = address.trim().toLowerCase();
      if (identity && identity.email === normalized) {
        const current = read(workspaceId);
        if (!current || current.usedAt || current.origin !== config.origin || Date.parse(current.expiresAt) <= now().getTime()) {
          const token = randomBytes(32).toString('base64url');
          save(path(workspaceId), { workspaceId, tenantId: identity.tenantId, emailHash: hash(identity.email), tokenHash: hash(token), origin: config.origin, expiresAt: new Date(now().getTime() + 15 * 60_000).toISOString(), secret: encrypt(workspaceId, token), attempts: 0 });
        }
        void processPending();
      }
      return { message: 'If these details match the recorded owner, a private recovery link will be sent.' };
    },
    async complete(workspaceId: string, token: string, password: string) {
      if (!validWorkspace(workspaceId) || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return unavailable();
      const identity = await owner(workspaceId), record = read(workspaceId);
      if (!record || !identity || record.usedAt || record.origin !== config.origin || Date.parse(record.expiresAt) <= now().getTime() || record.tokenHash !== hash(token) || identity.tenantId !== record.tenantId || hash(identity.email) !== record.emailHash) return unavailable();
      if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail(400, 'INVALID_PASSWORD', 'Choose a strong password of 12 to 200 characters.');
      if (resetting.has(workspaceId)) fail(409, 'RECOVERY_BUSY', 'Recovery is already in progress. Try signing in shortly.');
      resetting.add(workspaceId);
      // Consume proof before the existing one-time device-code operation. A crash cannot replay a reset.
      record.usedAt = now().toISOString(); record.secret = undefined; save(path(workspaceId), record);
      try {
        const code = await options.issueCode(identity.tenantId);
        const result = await identity.workspace.engine.execute(null, 'auth.recoverOwner', { code, newPassword: password });
        return { url: `/client/${workspaceId}/`, username: result.username };
      } catch (error) {
        if (error instanceof DomainError && error.code === 'WEAK_PASSWORD') fail(400, 'WEAK_PASSWORD', error.message);
        throw error;
      } finally { resetting.delete(workspaceId); }
    },
    processPending,
    async close() { closed = true; clearInterval(timer); await running; },
  };
}
export type OwnerRecovery = ReturnType<typeof createOwnerRecovery>;
