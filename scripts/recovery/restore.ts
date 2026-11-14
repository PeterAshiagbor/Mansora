/**
 * Restore the browser version from an off-site system backup (see docs/disaster-recovery/system-backups.md).
 *
 *   SYSTEM_BACKUP_ENCRYPTION_KEY=… SYSTEM_BACKUP_S3_ENDPOINT=… SYSTEM_BACKUP_S3_REGION=… SYSTEM_BACKUP_S3_BUCKET=…
 *   SYSTEM_BACKUP_S3_ACCESS_KEY_ID=… SYSTEM_BACKUP_S3_SECRET_ACCESS_KEY=… \
 *   RESTORE_DATABASE_URL=postgres://… RESTORE_DATA_DIR=/data \
 *   npx tsx scripts/recovery/restore.ts system-snapshots/v1/2026-11-20/<id>.msbk
 *
 * Into a NEW, EMPTY database and an empty data folder only: nothing existing is ever overwritten. The copy is
 * downloaded, its checksum and encryption are verified, the private files (shop stores, registry, keys) are written,
 * the database roles and tables are created with the restored credentials, and every row is loaded in one
 * transaction. Then start the server on that database and volume as usual.
 * Add --check to download and verify a copy without restoring anything (a monthly drill).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { backupStorageFromEnv } from '../../apps/api/src/storage';
import { prepareRailwayDatabase } from '../railway/database';
import { restoreSnapshotFiles, sha256, unpackSnapshot } from './archive';
import { restorePostgres } from './postgres';

export async function restoreSystemBackup(o: { objectKey: string; env: NodeJS.ProcessEnv; databaseUrl?: string; dataDir?: string; checkOnly?: boolean; log?: (s: string) => void }) {
  const log = o.log ?? console.log;
  const key = o.env.SYSTEM_BACKUP_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Set SYSTEM_BACKUP_ENCRYPTION_KEY: the 64-character key the backups were made with.');
  if (!/^system-snapshots\/v1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]{36}\.msbk$/.test(o.objectKey)) throw new Error('Give the backup name as shown in the bucket: system-snapshots/v1/<date>/<id>.msbk');
  const storageEnv: NodeJS.ProcessEnv = {};
  for (const name of ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']) {
    const value = o.env['SYSTEM_BACKUP_S3_' + name]; if (!value) throw new Error(`Set SYSTEM_BACKUP_S3_${name}.`); storageEnv['BACKUP_S3_' + name] = value;
  }
  storageEnv.BACKUP_S3_SERVER_SIDE_ENCRYPTION = o.env.SYSTEM_BACKUP_S3_SERVER_SIDE_ENCRYPTION ?? 'AES256';
  const bytes = await backupStorageFromEnv(storageEnv).get(o.objectKey);
  const snapshot = unpackSnapshot(bytes, key); // checks the encryption, the manifest and every file's checksum
  const rows = snapshot.tables.reduce((n, t) => n + t.rows.length, 0);
  log(`Backup ${o.objectKey} verified: made ${snapshot.createdAt}, ${snapshot.files.length} private files, ${snapshot.tables.length} tables, ${rows} rows, sha256 ${sha256(bytes).slice(0, 12)}…`);
  if (o.checkOnly) return { verified: true as const, restored: false as const, createdAt: snapshot.createdAt };
  if (!o.databaseUrl || !o.dataDir) throw new Error('Set RESTORE_DATABASE_URL (a new, empty database) and RESTORE_DATA_DIR (a new, empty folder).');
  restoreSnapshotFiles(snapshot, o.dataDir);
  log('Private files restored.');
  const secret = (name: string) => readFileSync(join(o.dataDir!, 'secrets', name), 'utf8').trim();
  await prepareRailwayDatabase(o.databaseUrl, { migration: secret('migration_password'), runtime: secret('runtime_password') });
  const client = new pg.Client({ connectionString: o.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    try { await restorePostgres(async (sql, params) => (await client.query(sql, params as any[])).rows, snapshot); await client.query('COMMIT'); }
    catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  } finally { await client.end().catch(() => {}); }
  log(`Database restored: ${rows} rows. Start the server on this database and data folder. Administrators sign in again.`);
  return { verified: true as const, restored: true as const, createdAt: snapshot.createdAt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const objectKey = args.find((a) => !a.startsWith('--'));
  if (!objectKey) { console.error('Usage: restore.ts <system-snapshots/v1/date/id.msbk> [--check]'); process.exit(2); }
  restoreSystemBackup({ objectKey, env: process.env, databaseUrl: process.env.RESTORE_DATABASE_URL, dataDir: process.env.RESTORE_DATA_DIR, checkOnly: args.includes('--check') })
    .then(() => process.exit(0), (e) => { console.error(`Restore stopped: ${e?.message ?? e}`); process.exit(1); });
}
