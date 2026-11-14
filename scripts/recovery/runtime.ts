import pg from 'pg';
import type { StagingWorkspace } from '../staging/gateway';
import { createSystemBackupManager, systemBackupConfig } from './manager';
import type { RecoveryQuery } from './postgres';

/**
 * Off-site system backups for the browser version (owner request 2026-11-14: Google, for now).
 *
 * Every SYSTEM_BACKUP_INTERVAL_HOURS the whole service is copied: the PostgreSQL database, every shop's encrypted
 * store, the shop registry and the private keys. The copy is encrypted with SYSTEM_BACKUP_ENCRYPTION_KEY (kept by
 * the owner as well as on Railway) and sent to an S3-compatible bucket: Google Cloud Storage through its
 * interoperability (HMAC) keys, or any other S3 store later. Each copy is read back and decrypted before it counts.
 * Off unless MANSORA_SYSTEM_BACKUPS=1 and all the bucket settings are present.
 */
export function startSystemBackups(o: {
  env: NodeJS.ProcessEnv; dataDir: string; adminDatabaseUrl: string;
  withSnapshotLock: <T>(capture: (workspaces: StagingWorkspace[]) => Promise<T>) => Promise<T>;
  log?: (line: string) => void;
}) {
  const config = systemBackupConfig(o.env);
  if (!config) return undefined;
  const log = o.log ?? ((line: string) => console.log(line));
  // One read-only, repeatable-read transaction as the database owner: it sees every row, changes nothing.
  const databaseSnapshot = async <T>(capture: (q: RecoveryQuery) => Promise<T>): Promise<T> => {
    const client = new pg.Client({ connectionString: o.adminDatabaseUrl });
    client.on('error', () => {}); // a dropped connection fails this attempt only; the next one retries
    await client.connect();
    try {
      await client.query('BEGIN');
      try { const out = await capture(async (sql, params) => (await client.query(sql, params as any[])).rows); await client.query('COMMIT'); return out; }
      catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    } finally { await client.end().catch(() => {}); }
  };
  const manager = createSystemBackupManager({
    dataDir: o.dataDir, key: config.key, storage: config.storage, intervalMs: config.intervalMs,
    withSnapshotLock: o.withSnapshotLock, databaseSnapshot,
    onVerified: (r) => log(`System backup stored off-site and verified (${r.createdAt}).`),
    onFailure: () => log('System backup failed; it will be retried. The last good copy is kept.'),
  });
  log(`System backups: on, every ${config.intervalMs / 3_600_000} hour(s).`);
  // The manager decides when a copy is due; checking every 10 minutes keeps retries and the schedule on time.
  const first = setTimeout(() => void manager.tick(), 60_000); first.unref();
  const timer = setInterval(() => void manager.tick(), 10 * 60_000); timer.unref();
  return { manager, close: async () => { clearTimeout(first); clearInterval(timer); await manager.close(); } };
}
