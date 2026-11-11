/** Dynamic browser provisioning, using the existing owner-side activation command. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@mansora/domain';
import type { BrowserWorkspaceInvite, BrowserWorkspaceLink } from '../../apps/api/src/browser-workspaces';
import { HttpError } from '../../apps/api/src/security';
import { openEngine } from '../../apps/desktop/src/core';
import { readWorkspaceRecords, workspaceKey, type StagingConfig, type WorkspaceRecord } from './config';
import type { StagingWorkspace } from './gateway';

interface Record {
  tenantId: string; workspaceId: string; label: string; ownerName: string; ownerEmail: string;
  ownerUsername: string; tokenHash: string; expiresAt: string; completedAt?: string;
  secret?: { iv: string; tag: string; data: string };
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };
const unavailable = () => fail(410, 'SETUP_LINK_UNAVAILABLE', 'This setup link is unavailable or expired. Ask Mansora for a new link.');
function save(path: string, value: unknown) {
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); chmodSync(path, 0o600);
}
export function createWorkspaceOnboarding(config: StagingConfig, now: () => Date = () => new Date()) {
  const directory = join(config.dataDir, 'browser-onboarding');
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const key = Buffer.from(workspaceKey(config.key, 'browser-onboarding-secrets'), 'hex');
  const inflight = new Set<string>();
  let active: StagingWorkspace[] | undefined;
  let register: ((workspace: StagingWorkspace, aliases: { [email: string]: string }) => void) | undefined;
  const file = (id: string) => join(directory, id + '.json');
  const read = (id: string): Record | undefined => {
    if (!existsSync(file(id))) return undefined;
    const record = JSON.parse(readFileSync(file(id), 'utf8')) as Record;
    if (record.tenantId !== id || record.workspaceId !== 'shop-' + id || typeof record.label !== 'string' || record.label.length > 120 || typeof record.ownerName !== 'string' || !record.ownerName || record.ownerName.length > 100 || typeof record.ownerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.ownerEmail) || !/^owner-[a-f0-9]{12}$/.test(record.ownerUsername) || !/^[a-f0-9]{64}$/.test(record.tokenHash) || !Number.isFinite(Date.parse(record.expiresAt)) || (record.completedAt && !Number.isFinite(Date.parse(record.completedAt)))) throw new Error('Invalid browser onboarding journal; preserve it for review.');
    return record;
  };
  const records = () => readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => read(name.slice(0, -5))!);
  function seal(tenantId: string, value: { token: string; activationCode: string }) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(tenantId));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  function unseal(record: Record): { token: string; activationCode: string } {
    if (!record.secret) return unavailable();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.secret.iv, 'base64'));
    decipher.setAAD(Buffer.from(record.tenantId)); decipher.setAuthTag(Buffer.from(record.secret.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.secret.data, 'base64')), decipher.final()]).toString());
  }
  function lookup(token: string) {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return unavailable();
    const record = records().find(r => r.tokenHash === digest(token));
    if (!record || record.completedAt || Date.parse(record.expiresAt) <= now().getTime()) return unavailable();
    return record;
  }
  const link = (record: Record): BrowserWorkspaceLink => record.completedAt
    ? { workspaceId: record.workspaceId, status: 'ready', url: `${config.origin}/client/${record.workspaceId}/` }
    : { workspaceId: record.workspaceId, status: 'pending', expiresAt: record.expiresAt, url: `${config.origin}/onboarding/#token=${unseal(record).token}` };
  return {
    attach(workspaces: StagingWorkspace[], registerWorkspace: typeof register) {
      if (active) throw new Error('Browser workspace lifecycle was already attached.');
      active = workspaces; register = registerWorkspace;
    },
    async invite(input: BrowserWorkspaceInvite): Promise<BrowserWorkspaceLink> {
      if (!/^[a-f0-9-]{36}$/.test(input.tenantId) || !input.label || input.label.length > 120 || !input.ownerName || input.ownerName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.ownerEmail) || input.ownerEmail.length > 254) fail(400, 'INVALID_WORKSPACE', 'A client name and recorded owner name/email are required.');
      const current = read(input.tenantId);
      if (inflight.has(input.tenantId)) fail(409, 'WORKSPACE_BUSY', 'Workspace setup is already in progress. Retry shortly.');
      if (current?.completedAt) {
        if (!readWorkspaceRecords(config).some(w => w.id === current.workspaceId && w.tenantId === current.tenantId)) fail(409, 'WORKSPACE_REVIEW_REQUIRED', 'The completed workspace registry needs review. Existing records will not be overwritten.');
        return link(current);
      }
      if (current && Date.parse(current.expiresAt) > now().getTime()) {
        if (current.ownerEmail !== input.ownerEmail.toLowerCase() || current.label !== input.label || current.ownerName !== input.ownerName) fail(409, 'WORKSPACE_REVIEW_REQUIRED', 'The pending workspace owner details changed. Preserve the setup operation for review.');
        return link(current);
      }
      if (!current && input.hasActiveDevice) fail(409, 'DEVICE_ALREADY_ACTIVE', 'This client already has an activated device. Existing data will not be replaced by an empty browser workspace.');
      const registry = readWorkspaceRecords(config);
      const pending = records().filter(r => !r.completedAt && !registry.some(w => w.id === r.workspaceId));
      if (!current && registry.length + pending.length >= 10) fail(409, 'WORKSPACE_LIMIT', 'The configured workspace capacity is reached.');
      const workspaceId = 'shop-' + input.tenantId;
      if (!current && (registry.some(w => w.id === workspaceId) || existsSync(join(config.dataDir, 'workspaces', workspaceId)))) fail(409, 'WORKSPACE_REVIEW_REQUIRED', 'An existing workspace needs review; it will not be overwritten.');
      const token = randomBytes(32).toString('base64url');
      const record: Record = { tenantId: input.tenantId, workspaceId, label: input.label, ownerName: input.ownerName, ownerEmail: input.ownerEmail.toLowerCase(), ownerUsername: 'owner-' + digest(input.ownerEmail.toLowerCase()).slice(0, 12), tokenHash: digest(token), expiresAt: new Date(now().getTime() + 30 * 60_000).toISOString(), secret: seal(input.tenantId, { token, activationCode: input.activationCode }) };
      save(file(input.tenantId), record); return link(record);
    },
    details(token: string) {
      const record = lookup(token);
      return { businessName: record.label, ownerName: record.ownerName, ownerEmail: record.ownerEmail, expiresAt: record.expiresAt };
    },
    async complete(token: string, password: string) {
      const record = lookup(token);
      if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail(400, 'INVALID_PASSWORD', 'Choose a strong password of 12 to 200 characters.');
      const workspaces = active, registerWorkspace = register;
      if (!workspaces || !registerWorkspace) return fail(503, 'WORKSPACE_NOT_READY', 'Workspace setup is temporarily unavailable. Try again shortly.');
      if (inflight.has(record.tenantId)) fail(409, 'WORKSPACE_BUSY', 'Workspace setup is already in progress. Retry shortly.');
      if (inflight.size >= 2) fail(503, 'WORKSPACE_BUSY', 'Workspace setup is busy. Try again shortly.');
      inflight.add(record.tenantId);
      let engine: StagingWorkspace['engine'] | undefined, registered = false, borrowed = false;
      try {
        const old = workspaces.find(w => w.id === record.workspaceId);
        borrowed = !!old;
        engine = old?.engine ?? openEngine({ dataDir: join(config.dataDir, 'workspaces', record.workspaceId), dbKey: workspaceKey(config.key, record.workspaceId), appVersion: '0.1.0-browser-workspace' });
        if (!engine.activated) await engine.execute(null, 'activation.activate', { apiUrl: config.apiUrl, code: unseal(record).activationCode, deviceName: 'Shared browser workspace', owner: { name: record.ownerName, username: record.ownerUsername, password } });
        const state = await engine.execute(null, 'app.state');
        if (state.business.tenantId !== record.tenantId) fail(409, 'WORKSPACE_REVIEW_REQUIRED', 'Workspace identity needs operator review. Existing records are preserved.');
        // Also recovers a crash after activation without resetting the owner password.
        const login = await engine.execute(null, 'auth.login', { username: record.ownerUsername, password }); engine.endSession(login.token);
        const registry = readWorkspaceRecords(config), existing = registry.find(w => w.id === record.workspaceId);
        if (existing && existing.tenantId !== record.tenantId) fail(409, 'WORKSPACE_REVIEW_REQUIRED', 'Workspace registry needs operator review.');
        if (!existing) {
          if (registry.length >= 10) fail(409, 'WORKSPACE_LIMIT', 'The configured workspace capacity is reached.');
          const added: WorkspaceRecord = { id: record.workspaceId, label: record.label, tenantId: record.tenantId, ownerEmail: record.ownerEmail, ownerUsername: record.ownerUsername };
          save(join(config.dataDir, 'workspaces.json'), [...registry, added]);
        }
        if (!old) registerWorkspace({ id: record.workspaceId, label: record.label, engine }, { [record.ownerEmail]: record.ownerUsername });
        registered = true;
        record.completedAt = now().toISOString(); record.secret = undefined; save(file(record.tenantId), record);
        return { workspaceId: record.workspaceId, url: `/client/${record.workspaceId}/`, email: record.ownerEmail };
      } catch (error) {
        if (error instanceof DomainError && error.code === 'WEAK_PASSWORD') return fail(400, 'WEAK_PASSWORD', error.message);
        throw error;
      } finally {
        if (engine && !registered && !borrowed) engine.db.close();
        inflight.delete(record.tenantId);
      }
    },
  };
}
export type WorkspaceOnboarding = ReturnType<typeof createWorkspaceOnboarding>;
