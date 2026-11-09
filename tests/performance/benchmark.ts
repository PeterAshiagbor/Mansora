import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, totalmem, tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../../apps/api/src/app';
import { connectEmbedded } from '../../apps/api/src/db';
import { DAY, MONTH, YEAR, seedFixture } from './fixture';

const args = process.argv.slice(2);
const value = (flag: string, fallback: string) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const samples = Number(value('--samples', '20'));
const syncSamples = Number(value('--sync-samples', '5'));
if (!Number.isSafeInteger(samples) || samples < 5 || !Number.isSafeInteger(syncSamples) || syncSamples < 3) throw new Error('Use at least five local samples and three sync samples');
const output = value('--output', 'performance-results.json');
const candidateIndexes = args.includes('--candidate-indexes');
const root = await mkdtemp(join(tmpdir(), 'mansora-performance-'));
const seedStarted = performance.now();
let fixture: ReturnType<typeof seedFixture> | undefined;
const rows: { operation: string; samples: number; medianMs: number; p95Ms: number; minMs: number; maxMs: number }[] = [];
const round = (v: number) => Math.round(v * 100) / 100;
async function measure<T>(operation: string, fn: () => Promise<T>, verify: (result: T) => void, n = samples, warmups = 3) {
  for (let i = 0; i < warmups; i++) verify(await fn());
  const elapsed: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    const result = await fn();
    elapsed.push(performance.now() - start);
    verify(result);
  }
  elapsed.sort((a, b) => a - b);
  const row = { operation, samples: n, medianMs: round((elapsed[Math.floor((n - 1) / 2)] + elapsed[Math.floor(n / 2)]) / 2), p95Ms: round(elapsed[Math.ceil(n * 0.95) - 1]), minMs: round(elapsed[0]), maxMs: round(elapsed[n - 1]) };
  rows.push(row); console.log(JSON.stringify(row));
}
let cloud: Awaited<ReturnType<typeof connectEmbedded>> | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const f = seedFixture(root, { candidateIndexes });
  fixture = f;
  const { engine, token, counts, expected } = f;
  assert.deepEqual(engine.db.pragma('foreign_key_check'), []);
  assert.equal((engine.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, counts.sales);
  const seededMs = round(performance.now() - seedStarted);
  console.log(`Fixture seed verified in ${seededMs} ms`);
  const run = (command: string, input: unknown) => engine.execute(token, command, input);
  await measure('product.list name fragment', () => run('product.list', { search: 'Product 123' }), (result) => assert.equal(result.length, 100));
  await measure('product.lookup barcode', () => run('product.lookup', { code: `PERF-${counts.products - 1}` }), (result) => assert.equal(result.id, f.productIds.at(-1)));
  await measure('sale.complete three lines', () => run('sale.complete', { id: randomUUID(), lines: f.productIds.slice(0, 3).map((productId) => ({ productId, quantity: 1 })), tenders: [{ method: 'cash', amount: 1500 }] }), (result) => assert.equal(result.total, 1500));
  for (const [label, range] of [['month', MONTH], ['year', YEAR]] as const) {
    await measure(`report.sales ${label}`, () => run('report.sales', range), (result) => { assert.equal(result.totals.count, label === 'year' ? counts.sales : f.salesByMonth[0]); });
    await measure(`report.profit ${label}`, () => run('report.profit', range), (result) => { assert.equal(result.grossProfit, (label === 'year' ? counts.sales : f.salesByMonth[0]) * 600); });
  }
  await measure('stock.overview all', () => run('stock.overview', { filter: 'all' }), (result) => assert.equal(result.summary.products, counts.products));
  await measure('sale.list one day', () => run('sale.list', DAY), (result) => { assert.equal(result.length, 300); assert.ok(result.every((row: any) => row.created_at.startsWith(DAY.from))); });

  cloud = await connectEmbedded();
  await cloud.migrate();
  const tenantId = randomUUID(), deviceId = randomUUID(), deviceToken = randomBytes(32).toString('base64url');
  await cloud.platform(async (q) => {
    await q('INSERT INTO tenants (id,name,owner_name) VALUES ($1,$2,$3)', [tenantId, 'Synthetic benchmark tenant', 'Synthetic owner']);
    await q('INSERT INTO devices (id,tenant_id,name,token_hash) VALUES ($1,$2,$3,$4)', [deviceId, tenantId, 'Synthetic benchmark device', createHash('sha256').update(deviceToken).digest('hex')]);
  });
  app = await buildApp({ db: cloud, backupDir: join(root, 'cloud-backups') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(app.server.address() as any).port}/v1/sync/events`;
  let sequence = 0;
  await measure('sync.push 1000 product events (5 x 200)', async () => {
    let accepted = 0;
    const now = new Date().toISOString();
    for (let batch = 0; batch < 5; batch++) {
      const events = Array.from({ length: 200 }, () => {
        const id = randomUUID(); sequence++;
        return { id, seq: sequence, type: 'product.save', occurredAt: now, actorId: null, payload: { rows: { products: [{ id: randomUUID(), sku: null, barcode: null, name: 'Synthetic sync product', category_id: null, unit: 'each', cost_price: 300, selling_price: 500, reorder_level: 10, active: 1, version: 1, created_at: now, updated_at: now }] } } };
      });
      const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocol: 1, device: { appVersion: 'performance-fixture', pendingCount: 1000 - batch * 200, lastBackupAt: null }, events }), signal: AbortSignal.timeout(120_000) });
      assert.equal(response.status, 200);
      const result: any = await response.json();
      assert.equal(result.rejected.length, 0); accepted += result.accepted.length;
    }
    return accepted;
  }, (accepted) => assert.equal(accepted, 1000), syncSamples, 1);

  let cgroupMemoryBytes: number | null = null;
  try { const raw = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim(); if (raw !== 'max') cgroupMemoryBytes = Number(raw); } catch { /* non-Linux host */ }
  const plans = Object.fromEntries([
    ['product fragment', "SELECT id FROM products WHERE active=1 AND name LIKE '%Product 123%' ORDER BY name LIMIT 200", []],
    ['sales date', 'SELECT SUM(total) FROM sales WHERE created_at>=? AND created_at<?', ['2025-01-01', '2026-01-01']],
    ['sale items report', 'SELECT i.product_id,MAX(i.product_name),SUM(i.quantity),SUM(i.line_total),SUM(i.quantity*i.cost_snapshot) FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.created_at>=? AND s.created_at<? GROUP BY i.product_id', ['2025-01-01', '2026-01-01']],
  ].map(([name, sql, params]) => [name, engine.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params as unknown[])]));
  const result = { schemaState: candidateIndexes ? 'Experimental covering indexes; not shipped' : 'Released schema; no experimental indexes', measuredAt: new Date().toISOString(), machine: { os: process.platform, arch: process.arch, cpu: cpus()[0]?.model, availableCpus: availableParallelism(), hostMemoryBytes: totalmem(), cgroupMemoryBytes, node: process.version, sqlite: engine.db.prepare('SELECT sqlite_version() AS version').get(), encrypted: true }, fixture: { ...counts, expected, sqliteBytes: (await stat(join(root, 'mansora.db'))).size, seedMs: seededMs, period: YEAR, historicalOutbox: 'not fabricated; writes measured through the real engine', historicalInventoryMovements: counts.products + counts.saleItems }, percentiles: 'median of sorted samples; p95 nearest rank; warmups excluded', rows, plans };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(`Wrote ${output}`);
} finally {
  await app?.close(); await cloud?.close(); fixture?.engine.db.close();
  await rm(root, { recursive: true, force: true });
}
