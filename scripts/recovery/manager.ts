import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupStorageFromEnv, type BackupStorage } from '../../apps/api/src/storage';
import type { StagingWorkspace } from '../staging/gateway';
import { capturePrivateFiles } from './files';
import { capturePostgres, type RecoveryQuery } from './postgres';
import { packSnapshot, sha256, unpackSnapshot } from './archive';
interface Pending { id: string; key: string; sha256: string; createdAt: string; keyFingerprint: string }
interface Journal { version: 1; keyFingerprint: string; pending?: Pending; lastSnapshotAt?: string; lastVerifiedAt?: string; lastKey?: string; failures: number; nextAttemptAt?: string }
function save(path: string, value: Journal) { writeFileSync(path + '.pending', JSON.stringify(value) + '\n', { mode: 0o600 }); chmodSync(path + '.pending', 0o600); renameSync(path + '.pending', path); }
export function systemBackupConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.MANSORA_SYSTEM_BACKUPS === undefined || env.MANSORA_SYSTEM_BACKUPS === '0') return undefined;
  if (env.MANSORA_SYSTEM_BACKUPS !== '1') throw new Error('MANSORA_SYSTEM_BACKUPS must be explicitly 0 or 1.');
  const key = env.SYSTEM_BACKUP_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Set a separate persistent 32-byte SYSTEM_BACKUP_ENCRYPTION_KEY.');
  const hours = env.SYSTEM_BACKUP_INTERVAL_HOURS ?? '1';
  if (!/^\d+$/.test(hours) || Number(hours) < 1 || Number(hours) > 24) throw new Error('System backup interval must be 1 to 24 hours.');
  const storageEnv: NodeJS.ProcessEnv = {};
  for (const name of ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']) {
    const value = env['SYSTEM_BACKUP_S3_' + name]; if (!value) throw new Error('Configure all five SYSTEM_BACKUP_S3_* variables; local fallback is forbidden.'); storageEnv['BACKUP_S3_' + name] = value;
  }
  storageEnv.BACKUP_S3_SERVER_SIDE_ENCRYPTION = env.SYSTEM_BACKUP_S3_SERVER_SIDE_ENCRYPTION ?? 'AES256';
  return { key, intervalMs: Number(hours) * 3_600_000, storage: backupStorageFromEnv(storageEnv) };
}
export function createSystemBackupManager(options: { dataDir: string; key: string; storage: BackupStorage; intervalMs: number;
  withSnapshotLock: <T>(capture: (workspaces: StagingWorkspace[]) => Promise<T>) => Promise<T>;
  databaseSnapshot: <T>(capture: (q: RecoveryQuery) => Promise<T>) => Promise<T>;
  now?: () => Date; onFailure?: () => Promise<void> | void; onVerified?: (result: { createdAt: string; verifiedAt: string; sha256: string }) => void }) {
  if (!/^[a-f0-9]{64}$/i.test(options.key) || options.intervalMs < 3_600_000 || options.intervalMs > 24 * 3_600_000) throw new Error('Invalid system backup policy.');
  const now = options.now ?? (() => new Date()), directory = join(options.dataDir, 'system-backups'), journalPath = join(directory, 'journal.json'), fingerprint = sha256(Buffer.from(options.key, 'hex'));
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  let running: Promise<void> | undefined, stopped = false;
  function read(): Journal {
    if (!existsSync(journalPath)) return { version: 1, keyFingerprint: fingerprint, failures: 0 };
    const state = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
    if (state.version !== 1 || state.keyFingerprint !== fingerprint || !Number.isInteger(state.failures) || state.failures < 0 || [state.lastSnapshotAt, state.lastVerifiedAt, state.nextAttemptAt].some(value => value !== undefined && !Number.isFinite(Date.parse(value)))) throw new Error('Preserve the existing recovery journal and encryption key for review.');
    if (state.pending && (!/^[a-f0-9-]{36}$/.test(state.pending.id) || state.pending.key !== `system-snapshots/v1/${state.pending.createdAt.slice(0, 10)}/${state.pending.id}.msbk` || !/^[a-f0-9]{64}$/.test(state.pending.sha256) || state.pending.keyFingerprint !== fingerprint || !Number.isFinite(Date.parse(state.pending.createdAt)))) throw new Error('Invalid private recovery journal; preserve it for review.');
    return state;
  }
  read(); // Refuse a changed key before scheduling any operation.
  async function perform() {
    const state = read(), time = now();
    if (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > time.getTime()) return;
    if (!state.pending && state.lastSnapshotAt && Date.parse(state.lastSnapshotAt) + options.intervalMs > time.getTime()) return;
    try {
      if (!state.pending) {
        const createdAt = time.toISOString(), id = randomUUID();
        const snapshot = await options.withSnapshotLock(async workspaces => {
          const files = capturePrivateFiles(options.dataDir, workspaces);
          const database = await options.databaseSnapshot(capturePostgres);
          return { version: 1 as const, createdAt, ...database, files };
        });
        const bytes = packSnapshot(snapshot, options.key), temporary = join(directory, id + '.pending'), target = join(directory, id + '.msbk');
        writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 }); renameSync(temporary, target);
        state.pending = { id, createdAt, key: `system-snapshots/v1/${createdAt.slice(0, 10)}/${id}.msbk`, sha256: sha256(bytes), keyFingerprint: fingerprint };
        save(journalPath, state); // Persist the immutable upload identity before any network send.
      }
      const pending = state.pending, path = join(directory, pending.id + '.msbk'), bytes = readFileSync(path);
      if (sha256(bytes) !== pending.sha256) throw new Error('Private pending archive failed integrity validation.');
      unpackSnapshot(bytes, options.key);
      await options.storage.put(pending.key, bytes, pending.sha256);
      const remote = await options.storage.get(pending.key);
      if (sha256(remote) !== pending.sha256) throw new Error('Remote recovery archive failed read-back verification.');
      unpackSnapshot(remote, options.key);
      state.lastSnapshotAt = pending.createdAt; state.lastVerifiedAt = now().toISOString(); state.lastKey = pending.key; state.pending = undefined; state.failures = 0; state.nextAttemptAt = undefined;
      save(journalPath, state); rmSync(path, { force: true }); // Only remove the local cache after remote authentication/read-back succeeds.
      options.onVerified?.({ createdAt: state.lastSnapshotAt, verifiedAt: state.lastVerifiedAt, sha256: pending.sha256 });
    } catch {
      state.failures = Math.min(state.failures + 1, 10); state.nextAttemptAt = new Date(now().getTime() + Math.min(6 * 3_600_000, 15 * 60_000 * 2 ** (state.failures - 1))).toISOString(); save(journalPath, state);
      try { await options.onFailure?.(); } catch { /* Monitoring failure never interrupts a sale or destroys the pending archive. */ }
    }
  }
  return {
    tick() { if (stopped) return Promise.resolve(); if (!running) running = perform().finally(() => { running = undefined; }); return running; },
    status() { const state = read(); return { enabled: true, lastSnapshotAt: state.lastSnapshotAt, lastVerifiedAt: state.lastVerifiedAt, pending: !!state.pending, failures: state.failures }; },
    async close() { stopped = true; await running; },
  };
}
