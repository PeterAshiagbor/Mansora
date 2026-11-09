import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openEngine, syncNow } from '../../apps/desktop/src/core';
import { SYNC_TABLES } from '@mansora/domain';
import { count, flakyNetwork, startCloud, type Cloud } from '../cloud';
import { CASHIER, login, makeShop, TEST_DB_KEY, uuid } from '../helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

const cash = (amount: number) => [{ method: 'cash', amount }];

describe('TEST 04 - 100 offline transactions survive a restart and sync exactly once', () => {
  it('works', async () => {
    const client = await cloud.createClient('Offline Mart');
    const net = flakyNetwork();
    const s = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code });
    expect((await syncNow(s.engine)).ok).toBe(true); // setup data reaches the cloud

    net.online = false; // ---- internet disconnected ----
    for (let i = 0; i < 100; i++) {
      await s.run(s.cashier, 'sale.complete', {
        id: uuid(),
        lines: i % 2 ? [{ productId: s.products.soap, quantity: 1 }] : [{ productId: s.products.milk, quantity: 1 }, { productId: s.products.soap, quantity: 1 }],
        tenders: i % 5 === 0 ? [{ method: 'momo', amount: 500, reference: `MM${i}` }, { method: 'cash', amount: 2000 }] : cash(2000),
      }).catch(() => null); // soap (30 in stock) runs out part-way: those sales are correctly refused
    }
    const local = (sql: string) => (s.engine.db.prepare(sql).get() as any).v;
    const sales = local('SELECT COUNT(*) AS v FROM sales');
    expect(sales).toBe(30);
    // Top up stock and finish the remaining sales so that exactly 100 are completed offline.
    await s.run(s.owner, 'purchase.receive', { items: [{ productId: s.products.soap, quantity: 200, unitCost: 350 }] });
    for (let i = 0; i < 70; i++) await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 2 }], tenders: cash(1000) });
    expect(local('SELECT COUNT(*) AS v FROM sales')).toBe(100);
    const offline = await syncNow(s.engine);
    expect(offline).toMatchObject({ ok: false, pushed: 0 });
    expect((await s.run(s.cashier, 'sync.status', {})).state).toBe('offline');
    const pendingBefore = offline.pending;
    expect(pendingBefore).toBeGreaterThanOrEqual(101);

    // ---- application restart ----
    s.engine.db.close();
    const engine = openEngine({ dataDir: s.dir, dbKey: TEST_DB_KEY, fetch: net.fetch });
    const q = (sql: string) => (engine.db.prepare(sql).get() as any).v;
    expect(q('SELECT COUNT(*) AS v FROM sales')).toBe(100);
    expect(q(`SELECT COUNT(*) AS v FROM outbox WHERE status = 'pending'`)).toBe(pendingBefore);
    const cashier = await login(engine, CASHIER); // offline login after restart
    expect((await engine.execute(cashier, 'shift.current', {})).totals.salesCount).toBe(100);

    net.online = true; // ---- internet returns ----
    const synced = await syncNow(engine);
    expect(synced).toMatchObject({ ok: true, pending: 0, rejected: 0 });
    expect(synced.pushed).toBe(pendingBefore);

    // The cloud now reconciles exactly with the laptop.
    for (const table of ['sales', 'sale_items', 'payments', 'inventory_movements', 'products', 'users', 'shifts', 'audit_logs', 'purchases']) {
      expect(await count(cloud.db, client.id, table), table).toBe(q(`SELECT COUNT(*) AS v FROM ${table}`));
    }
    const [money] = await cloud.db.tenant(client.id, (t) => t(`SELECT SUM(total)::bigint AS total FROM sales`));
    expect(money.total).toBe(q('SELECT SUM(total) AS v FROM sales'));
    const balances = await cloud.db.tenant(client.id, (t) => t(`SELECT product_id, quantity, average_cost FROM stock_balances ORDER BY product_id`));
    expect(balances).toEqual(engine.db.prepare('SELECT product_id, quantity, average_cost FROM stock_balances ORDER BY product_id').all());
    const [ledger] = await cloud.db.tenant(client.id, (t) => t(`SELECT COUNT(*) AS n FROM stock_balances b WHERE b.quantity <> (SELECT SUM(quantity_delta) FROM inventory_movements m WHERE m.product_id = b.product_id)`));
    expect(ledger.n).toBe(0);

    // Syncing again changes nothing.
    expect(await syncNow(engine)).toMatchObject({ ok: true, pushed: 0, pending: 0 });
    expect(await count(cloud.db, client.id, 'sales')).toBe(100);
    const health = (await cloud.api('GET', `/v1/admin/clients/${client.id}`)).body.client;
    expect(health).toMatchObject({ pending_count: 0, connectivity: 'online', data_may_be_incomplete: false });
  });
});

describe('TEST 05 - retries and repeated delivery never duplicate anything', () => {
  it('re-sends events whose acknowledgement was lost, without duplicates', async () => {
    const client = await cloud.createClient('Flaky Net Shop');
    const net = flakyNetwork();
    const s = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code });
    for (let i = 0; i < 12; i++) await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 1 }], tenders: cash(1250) });

    net.dropResponses = 3; // the server stores the batch, but the laptop never hears back - three times in a row
    for (let i = 0; i < 3; i++) {
      const r = await syncNow(s.engine);
      expect(r.ok).toBe(false);
      expect(r.pushed).toBe(0);
    }
    // The laptop must NOT have marked anything as synced without confirmation...
    expect((s.engine.db.prepare(`SELECT COUNT(*) AS v FROM outbox WHERE status = 'synced'`).get() as any).v).toBe(0);
    // ...even though the server already has the data.
    expect(await count(cloud.db, client.id, 'sales')).toBe(12);

    const ok = await syncNow(s.engine);
    expect(ok).toMatchObject({ ok: true, pending: 0, rejected: 0 });
    expect(await count(cloud.db, client.id, 'sales')).toBe(12);
    expect(await count(cloud.db, client.id, 'payments')).toBe(12);
    expect(await count(cloud.db, client.id, 'inventory_movements')).toBe(12 + 3); // 12 sales + 3 opening stock
    const [milk] = await cloud.db.tenant(client.id, (q) => q(`SELECT quantity FROM stock_balances WHERE product_id = $1`, [s.products.milk]));
    expect(milk.quantity).toBe(38);
  });

  it('accepts the same raw request many times, in any order, with one logical effect', async () => {
    const client = await cloud.createClient('Replay Shop');
    const net = flakyNetwork();
    const s = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code });
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 3 }], tenders: cash(24_000) });
    const events = (s.engine.db.prepare('SELECT * FROM outbox ORDER BY seq').all() as any[]).map((r) => ({ id: r.id, seq: r.seq, type: r.type, occurredAt: r.occurred_at, actorId: r.actor_id, payload: JSON.parse(r.payload) }));
    const token = s.engine.meta('device_token')!;
    const push = (list: unknown[]) => cloud.api('POST', '/v1/sync/events', { protocol: 1, device: { appVersion: 't', pendingCount: 0, lastBackupAt: null }, events: list }, token);

    const first = await push(events);
    expect(first.body.accepted.length).toBe(events.length);
    for (let i = 0; i < 3; i++) expect((await push([...events].reverse())).body).toEqual({ accepted: [...events].reverse().map((e) => e.id), rejected: [] });
    await Promise.all([push(events), push(events), push(events.slice(-1))]);

    expect(await count(cloud.db, client.id, 'sync_events')).toBe(events.length);
    expect(await count(cloud.db, client.id, 'sales')).toBe(1);
    const moves = await cloud.db.tenant(client.id, (q) => q(`SELECT quantity_delta FROM inventory_movements WHERE product_id = $1 ORDER BY occurred_at`, [s.products.rice]));
    expect(moves.map((m) => m.quantity_delta)).toEqual([20, -3]);
    const [rice] = await cloud.db.tenant(client.id, (q) => q(`SELECT quantity FROM stock_balances WHERE product_id = $1`, [s.products.rice]));
    expect(rice.quantity).toBe(17);
    // An older copy of a row can never overwrite a newer one (replayed opening-stock event vs later balance).
    await push(events.slice(0, 5));
    expect((await cloud.db.tenant(client.id, (q) => q(`SELECT quantity FROM stock_balances WHERE product_id = $1`, [s.products.rice])))[0].quantity).toBe(17);
  });

  it('rejects malformed events permanently and surfaces them, without blocking valid ones', async () => {
    const client = await cloud.createClient('Strict Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: client.code, fetch: fetch });
    await syncNow(s.engine);
    const token = s.engine.meta('device_token')!;
    const bad = { id: uuid(), seq: 9001, type: 'evil', occurredAt: new Date().toISOString(), actorId: null, payload: { rows: { sales: [{ id: 'not-a-uuid', total: 1.5 }] } } };
    const unknownTable = { ...bad, id: uuid(), payload: { rows: { admins: [{ id: uuid() }] } } };
    const extraColumn = { ...bad, id: uuid(), payload: { rows: { categories: [{ id: uuid(), name: 'x', active: 1, updated_at: new Date().toISOString(), tenant_id: uuid() }] } } };
    const res = await cloud.api('POST', '/v1/sync/events', { protocol: 1, device: { appVersion: 't', pendingCount: 0, lastBackupAt: null }, events: [bad, unknownTable, extraColumn] }, token);
    expect(res.body.accepted).toEqual([]);
    expect(res.body.rejected.map((r: any) => r.id)).toEqual([bad.id, unknownTable.id, extraColumn.id]);
    expect((await cloud.api('POST', '/v1/sync/events', { protocol: 1, device: { appVersion: 't', pendingCount: 0, lastBackupAt: null }, events: [] }, 'wrong-token')).status).toBe(401);
  });
});

describe('contract', () => {
  it('every synced column exists on both the laptop and the cloud', async () => {
    const client = await cloud.createClient('Contract Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: client.code, fetch: fetch });
    for (const [table, spec] of Object.entries(SYNC_TABLES)) {
      const cols = Object.keys(spec.cols).join(', ');
      expect(() => s.engine.db.prepare(`SELECT ${cols} FROM ${table} LIMIT 1`).all(), `laptop.${table}`).not.toThrow();
      await cloud.db.tenant(client.id, (q) => q(`SELECT ${cols} FROM ${table} LIMIT 1`));
    }
  });

  it('uploads an encrypted backup when online and reports health', async () => {
    const client = await cloud.createClient('Backup Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: client.code, fetch: fetch });
    const b = await s.run(s.owner, 'backup.create', { passphrase: 'a long backup passphrase' });
    expect(b.uploaded).toBe(true);
    const detail = (await cloud.api('GET', `/v1/admin/clients/${client.id}`)).body;
    expect(detail.backups.length).toBe(1);
    expect(detail.client.last_backup_at).toBeTruthy();
    const status = await s.run(s.owner, 'sync.status', {});
    expect(status.unprotected).toBe(1); // only the backup's own audit entry is newer than the backup
  });
});
