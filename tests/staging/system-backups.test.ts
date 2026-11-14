import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, type Query } from '../../apps/api/src/db';
import { createSystemBackupManager, systemBackupConfig } from '../../scripts/recovery/manager';
import { restoreSystemBackup } from '../../scripts/recovery/restore';
import { capturePostgres } from '../../scripts/recovery/postgres';
import { tempDir } from '../helpers';

/** A stand-in for the Google Cloud Storage bucket: path-style PUT and GET, as the S3 interoperability API serves. */
function fakeBucket() {
  const objects = new Map<string, { body: Buffer; sha: string }>();
  let failPuts = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c)).on('end', () => {
      if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 Credential=GOOGHMAC/')) { res.writeHead(403).end(); return; }
      if (req.method === 'PUT') {
        if (failPuts > 0) { failPuts--; res.writeHead(503).end(); return; }
        if (objects.has(req.url!)) { res.writeHead(412).end(); return; }
        objects.set(req.url!, { body: Buffer.concat(chunks), sha: String(req.headers['x-amz-meta-sha256']) }); res.writeHead(200).end(); return;
      }
      const o = objects.get(req.url!);
      if (!o) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'x-amz-meta-sha256': o.sha }); res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  return { server, objects, failNext: (n: number) => { failPuts = n; } };
}
function wrap(raw: PGlite) { return new Database({ tx: fn => raw.transaction(t => fn((async (sql, params) => (await t.query(sql, params as any[], { parsers: { 1082: (v: string) => v } })).rows) as Query)), exec: async sql => { await raw.exec(sql); }, close: () => raw.close() }); }

let bucket: ReturnType<typeof fakeBucket>, url = '', raw: PGlite;
const key = randomBytes(32).toString('hex');
const env = () => ({ MANSORA_SYSTEM_BACKUPS: '1', SYSTEM_BACKUP_ENCRYPTION_KEY: key, SYSTEM_BACKUP_INTERVAL_HOURS: '6', SYSTEM_BACKUP_S3_ENDPOINT: url, SYSTEM_BACKUP_S3_REGION: 'auto',
  SYSTEM_BACKUP_S3_BUCKET: 'mansora-backups', SYSTEM_BACKUP_S3_ACCESS_KEY_ID: 'GOOGHMAC', SYSTEM_BACKUP_S3_SECRET_ACCESS_KEY: 'synthetic-secret', SYSTEM_BACKUP_S3_SERVER_SIDE_ENCRYPTION: 'none' });
function privateTree() {
  const root = tempDir();
  mkdirSync(join(root, 'secrets'), { mode: 0o700 }); mkdirSync(join(root, 'staging'), { mode: 0o700 });
  writeFileSync(join(root, 'secrets/staging_db_key'), randomBytes(32).toString('hex'), { mode: 0o600 });
  writeFileSync(join(root, 'secrets/migration_password'), randomBytes(32).toString('hex'), { mode: 0o600 });
  writeFileSync(join(root, 'staging/workspaces.json'), '[]\n', { mode: 0o600 });
  return root;
}

beforeAll(async () => {
  bucket = fakeBucket(); await new Promise<void>((r) => bucket.server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(bucket.server.address() as any).port}`;
  raw = await PGlite.create(); await wrap(raw).migrate();
  await raw.query(`INSERT INTO tenants (id, name, owner_name) VALUES (gen_random_uuid(), 'Backup Shop', 'Ama')`);
});
afterAll(async () => { bucket?.server.close(); await raw?.close(); });

describe('off-site system backups (owner request 2026-11-14: Google for now)', () => {
  const managerFor = (root: string, now = () => new Date('2026-11-20T10:00:00Z')) => {
    const c = systemBackupConfig(env())!;
    return createSystemBackupManager({ dataDir: root, key: c.key, storage: c.storage, intervalMs: c.intervalMs, now,
      withSnapshotLock: (capture) => capture([]), databaseSnapshot: (capture) => raw.transaction((t) => capture(async (sql, p) => (await t.query(sql, p as any[])).rows)) });
  };

  it('is off unless switched on, and refuses partial bucket settings rather than keeping copies locally', () => {
    expect(systemBackupConfig({})).toBeUndefined();
    expect(() => systemBackupConfig({ ...env(), SYSTEM_BACKUP_S3_BUCKET: undefined })).toThrow(/all five/);
    expect(() => systemBackupConfig({ ...env(), SYSTEM_BACKUP_ENCRYPTION_KEY: 'short' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('stores an encrypted copy off-site, reads it back, and restores-checks it with the restore command', async () => {
    const root = privateTree(), m = managerFor(root);
    await m.tick();
    expect(m.status()).toMatchObject({ enabled: true, pending: false, failures: 0, lastSnapshotAt: '2026-11-20T10:00:00.000Z' });
    const [objectKey] = [...bucket.objects.keys()];
    expect(objectKey).toMatch(/^\/mansora-backups\/system-snapshots\/v1\/2026-11-20\/[a-f0-9-]{36}\.msbk$/);
    // The copy in the bucket is encrypted: the shop name is not readable in it.
    expect(bucket.objects.get(objectKey)!.body.includes(Buffer.from('Backup Shop'))).toBe(false);
    const lines: string[] = [];
    const r = await restoreSystemBackup({ objectKey: objectKey.replace('/mansora-backups/', ''), env: env(), checkOnly: true, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ verified: true, restored: false, createdAt: '2026-11-20T10:00:00.000Z' });
    expect(lines[0]).toMatch(/verified/);
    // The wrong key cannot open it.
    await expect(restoreSystemBackup({ objectKey: objectKey.replace('/mansora-backups/', ''), env: { ...env(), SYSTEM_BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex') }, checkOnly: true, log: () => {} })).rejects.toThrow();
    // Not due again until the interval has passed.
    await m.tick(); expect(bucket.objects.size).toBe(1);
    await m.close();
  });

  it('keeps the same copy and retries it after a failed upload, never losing the pending archive', async () => {
    bucket.objects.clear(); bucket.failNext(1);
    let clock = new Date('2026-11-21T10:00:00Z');
    const root = privateTree(), m = managerFor(root, () => clock);
    await m.tick();
    expect(m.status()).toMatchObject({ pending: true, failures: 1 });
    expect(bucket.objects.size).toBe(0);
    expect(readdirSync(join(root, 'system-backups')).some((f) => f.endsWith('.msbk'))).toBe(true);
    clock = new Date('2026-11-21T10:20:00Z'); // after the 15-minute back-off
    await m.tick();
    expect(m.status()).toMatchObject({ pending: false, failures: 0, lastSnapshotAt: '2026-11-21T10:00:00.000Z' });
    expect(bucket.objects.size).toBe(1);
    expect(readdirSync(join(root, 'system-backups')).some((f) => f.endsWith('.msbk'))).toBe(false);
    await m.close();
  });

  it('refuses to start with a different key than the one its earlier copies were made with', async () => {
    const root = privateTree(), m = managerFor(root); await m.tick(); await m.close();
    const c = systemBackupConfig(env())!;
    expect(() => createSystemBackupManager({ dataDir: root, key: randomBytes(32).toString('hex'), storage: c.storage, intervalMs: c.intervalMs,
      withSnapshotLock: (capture) => capture([]), databaseSnapshot: async () => { throw new Error('unused'); } })).toThrow(/journal/);
  });

  it('captures the whole database read-only', async () => {
    const snap = await raw.transaction((t) => capturePostgres(async (sql, p) => (await t.query(sql, p as any[])).rows));
    expect(snap.tables.find((t) => t.name === 'tenants')!.rows.some((r) => r.includes('Backup Shop'))).toBe(true);
  });
});
