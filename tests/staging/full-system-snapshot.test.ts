import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Database, type Query } from '../../apps/api/src/db';
import { buildApp } from '../../apps/api/src/app';
import { createAdmin } from '../../apps/api/src/modules/admin';
import { NoEmail, type Billing } from '../../apps/api/src/billing';
import { createProviders } from '../../apps/api/src/billing/providers/registry';
import { FileStorage } from '../../apps/api/src/storage';
import { openEngine, syncNow } from '../../apps/desktop/src/core';
import { loadWorkspaces, readWorkspaceRecords, workspaceKey, type StagingConfig } from '../../scripts/staging/config';
import { provisionStaging, type TestAccount } from '../../scripts/staging/bootstrap';
import { seedTestWorkspaces } from '../../scripts/staging/sample-data';
import { capturePrivateFiles } from '../../scripts/recovery/files';
import { capturePostgres, restorePostgres } from '../../scripts/recovery/postgres';
import { packSnapshot, restoreSnapshotFiles, sha256, unpackSnapshot } from '../../scripts/recovery/archive';
import type { StagingWorkspace } from '../../scripts/staging/gateway';
import { ADMIN } from '../cloud';
import { tempDir } from '../helpers';
function wrap(raw: PGlite) { return new Database({ tx: fn => raw.transaction(t => fn((async (sql, params) => (await t.query(sql, params as any[], { parsers: { 1082: (value: string) => value } })).rows.map((row: any) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : value])))) as Query)), exec: async sql => { await raw.exec(sql); }, close: () => raw.close() }); }
const q = (db: any) => async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
async function api(raw: PGlite) {
  const db = wrap(raw); await db.migrate();
  const providers = createProviders({ allowSandbox: true, publicBaseUrl: 'http://127.0.0.1:0' });
  const billing: Billing = { db, providers: providers.registry, email: new NoEmail(), env: { publicBaseUrl: 'http://127.0.0.1:0', payLinkSecret: 'synthetic-snapshot-link-key', encryptionKey: randomBytes(32), adminEmail: ADMIN.email }, now: () => new Date() };
  const app = await buildApp({ db, billing, backupDir: tempDir() }); await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`; billing.env.publicBaseUrl = url; providers.sandbox!.baseUrl = url;
  return { app, db, url };
}
let source: Awaited<ReturnType<typeof api>>, restored: Awaited<ReturnType<typeof api>>, sourceRaw: PGlite, restoredRaw: PGlite;
let sourceWorkspaces: StagingWorkspace[] = [], restoredWorkspaces: StagingWorkspace[] = [], accounts: TestAccount[], config: StagingConfig;
const root = tempDir(), destination = join(tempDir(), 'isolated-restore'), objectStorage = new FileStorage(tempDir()), archiveKey = randomBytes(32).toString('hex');
beforeAll(async () => {
  sourceRaw = await PGlite.create(); source = await api(sourceRaw); await source.db.platform(query => createAdmin(query, ADMIN));
  const key = randomBytes(32).toString('hex'); mkdirSync(join(root, 'secrets'), { mode: 0o700 }); writeFileSync(join(root, 'secrets/staging_db_key'), key, { mode: 0o600 }); writeFileSync(join(root, 'secrets/operator-account.json'), JSON.stringify(ADMIN), { mode: 0o600 });
  config = { origin: 'http://127.0.0.1:0', apiUrl: source.url, dataDir: join(root, 'staging'), key, clientDir: '', adminDir: '' };
  await provisionStaging(config, ADMIN); sourceWorkspaces = loadWorkspaces(config);
  accounts = JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8'));
  await seedTestWorkspaces({ mode: 'team-test', version: 'retail-v1', dataDir: config.dataDir, workspaces: sourceWorkspaces });
  for (const workspace of sourceWorkspaces) await syncNow(workspace.engine);
});
afterAll(async () => {
  for (const workspace of [...sourceWorkspaces, ...restoredWorkspaces]) workspace.engine.db.close();
  await source?.app.close(); await restored?.app.close(); await source?.db.close(); await restored?.db.close();
});
it('captures encrypted shops, private keys/registry and the whole application schema, then restores authentication, stock, balances and isolated sync', async () => {
  const files = capturePrivateFiles(root, sourceWorkspaces), database = await sourceRaw.transaction(t => capturePostgres(q(t)));
  const snapshot = { version: 1 as const, createdAt: new Date().toISOString(), ...database, files }, encrypted = packSnapshot(snapshot, archiveKey), objectKey = 'system/synthetic-snapshot.msbk';
  for (const account of accounts) expect(encrypted.includes(Buffer.from(account.password))).toBe(false);
  await objectStorage.put(objectKey, encrypted, sha256(encrypted)); const recovered = unpackSnapshot(await objectStorage.get(objectKey), archiveKey);
  restoreSnapshotFiles(recovered, destination); restoredRaw = await PGlite.create(); restored = await api(restoredRaw);
  await restoredRaw.transaction(t => restorePostgres(q(t), recovered));
  // Restored administrators sign in again; archived bearer sessions are never revived.
  await restored.db.platform(query => query('DELETE FROM admin_sessions'));
  const key = readFileSync(join(destination, 'secrets/staging_db_key'), 'utf8');
  const recoveredConfig = { ...config, dataDir: join(destination, 'staging'), key };
  const isolatedFetch: typeof fetch = async (input, init) => { const requested = new URL(String(input)); if (requested.origin !== source.url) throw new Error('Restore fixture refused an unexpected upstream.'); return fetch(new URL(requested.pathname + requested.search, restored.url), init); };
  restoredWorkspaces = readWorkspaceRecords(recoveredConfig).map(record => ({ ...record, engine: openEngine({ dataDir: join(recoveredConfig.dataDir, 'workspaces', record.id), dbKey: workspaceKey(key, record.id), fetch: isolatedFetch }) }));
  for (const original of sourceWorkspaces) {
    const clone = restoredWorkspaces.find(workspace => workspace.id === original.id)!, owner = accounts.find(account => account.workspace === original.id && account.role === 'owner')!;
    const token = (await clone.engine.execute(null, 'auth.login', owner)).token;
    for (const table of ['sales', 'sale_items', 'stock_balances', 'credit_accounts', 'credit_repayments']) {
      expect(clone.engine.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(original.engine.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    }
    expect((await clone.engine.execute(token, 'product.list')).length).toBeGreaterThan(5);
    const sourceCounts = await source.db.tenant((await original.engine.execute(null, 'app.state')).business.tenantId, query => query('SELECT count(*)::text AS n FROM products'));
    await clone.engine.execute(token, 'product.save', { name: 'Restored clone only', sellingPrice: 500, costPrice: 300, openingStock: 2 });
    await syncNow(clone.engine);
    expect(await source.db.tenant((await original.engine.execute(null, 'app.state')).business.tenantId, query => query('SELECT count(*)::text AS n FROM products'))).toEqual(sourceCounts);
    const sourceOwner = (await original.engine.execute(null, 'auth.login', owner)).token;
    expect(await original.engine.execute(sourceOwner, 'product.list', { search: 'Restored clone only' })).toEqual([]);
    expect(relative(destination, clone.engine.db.name).startsWith('staging/')).toBe(true);
  }
});
