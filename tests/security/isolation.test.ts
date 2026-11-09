import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncNow } from '../../apps/desktop/src/core';
import { count, startCloud, type Cloud } from '../cloud';
import { expectCode, makeShop, uuid, type TestShop } from '../helpers';

let cloud: Cloud;
let a: TestShop, b: TestShop;
let A: { id: string; code: string }, B: { id: string; code: string };
const today = new Date().toISOString().slice(0, 10);
const summary = (id: string, token?: string | null) => cloud.api('GET', `/v1/admin/clients/${id}/reports/summary?from=${today}&to=${today}`, undefined, token);

beforeAll(async () => {
  cloud = await startCloud();
  A = await cloud.createClient('Business A');
  B = await cloud.createClient('Business B');
  // Phase 1 exit criterion: two isolated businesses on separately activated desktop applications.
  a = await makeShop({ apiUrl: cloud.url, code: A.code, fetch });
  b = await makeShop({ apiUrl: cloud.url, code: B.code, fetch });
  await a.run(a.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: a.products.rice, quantity: 1 }], tenders: [{ method: 'cash', amount: 8000 }] });
  for (let i = 0; i < 2; i++) await b.run(b.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: b.products.milk, quantity: 1 }], tenders: [{ method: 'card', amount: 1250 }] });
  await b.run(b.manager, 'customer.save', { name: 'Private Customer of B', phone: '0209999999' });
  expect((await syncNow(a.engine)).ok).toBe(true);
  expect((await syncNow(b.engine)).ok).toBe(true);
});
afterAll(() => cloud.close());

describe('TEST 09 - tenant isolation', () => {
  it('each business sees only its own rows (database row-level security)', async () => {
    expect(await count(cloud.db, A.id, 'sales')).toBe(1);
    expect(await count(cloud.db, B.id, 'sales')).toBe(2);
    expect(await count(cloud.db, A.id, 'customers')).toBe(0);
    expect(await count(cloud.db, B.id, 'customers')).toBe(1);
    // Explicitly asking for the other tenant's rows from inside A's context returns nothing.
    expect(await cloud.db.tenant(A.id, (q) => q(`SELECT * FROM sales WHERE tenant_id = $1`, [B.id]))).toEqual([]);
    expect(await cloud.db.tenant(A.id, (q) => q(`SELECT * FROM customers`))).toEqual([]);
  });

  it('the database refuses cross-tenant writes and updates', async () => {
    const saleOfB = (await cloud.db.tenant(B.id, (q) => q(`SELECT id, total FROM sales LIMIT 1`)))[0];
    await expect(cloud.db.tenant(A.id, (q) => q(`INSERT INTO categories (tenant_id, id, name, active, updated_at) VALUES ($1, $2, 'x', 1, now())`, [B.id, uuid()]))).rejects.toThrow(/row-level security/);
    await cloud.db.tenant(A.id, (q) => q(`UPDATE sales SET total = 1 WHERE id = $1`, [saleOfB.id]));
    expect((await cloud.db.tenant(B.id, (q) => q(`SELECT total FROM sales WHERE id = $1`, [saleOfB.id])))[0].total).toBe(saleOfB.total);
    await expect(cloud.db.tenant(A.id, (q) => q(`DELETE FROM sales`))).rejects.toThrow(/permission denied/); // nobody may delete business records
  });

  it('administration code cannot read business tables at all', async () => {
    for (const table of ['sales', 'customers', 'payments', 'products', 'audit_logs', 'sync_events']) {
      await expect(cloud.db.platform((q) => q(`SELECT * FROM ${table}`)), table).rejects.toThrow(/permission denied/);
    }
    // ...and a tenant context cannot read the platform's tables (other clients, admin accounts, device tokens).
    for (const table of ['tenants', 'admins', 'devices', 'admin_sessions']) {
      await expect(cloud.db.tenant(A.id, (q) => q(`SELECT * FROM ${table}`)), table).rejects.toThrow(/permission denied/);
    }
    await expect(cloud.db.tenant("x' OR '1'='1", (q) => q('SELECT 1'))).rejects.toThrow(/Invalid tenant/);
  });

  it("a device can only ever write into its own business, even with forged content", async () => {
    const tokenA = a.engine.meta('device_token')!;
    const saleOfB = (await cloud.db.tenant(B.id, (q) => q(`SELECT * FROM sales LIMIT 1`)))[0];
    const productOfB = (await cloud.db.tenant(B.id, (q) => q(`SELECT id, name, selling_price FROM products WHERE id = $1`, [b.products.milk])))[0];
    const now = new Date().toISOString();
    // A's laptop tries to overwrite B's product by sending a row with B's product id.
    const forged = {
      id: uuid(), seq: 99_999, type: 'product.save', occurredAt: now, actorId: null,
      payload: { rows: { products: [{ id: productOfB.id, sku: null, barcode: null, name: 'HACKED', category_id: null, unit: 'each', cost_price: 0, selling_price: 1, reorder_level: 0, active: 1, version: 999, created_at: now, updated_at: now }] } },
    };
    const res = await cloud.api('POST', '/v1/sync/events', { protocol: 1, device: { appVersion: 't', pendingCount: 0, lastBackupAt: null }, events: [forged] }, tokenA);
    expect(res.body.accepted).toEqual([forged.id]); // accepted - but only ever into A's own space
    expect((await cloud.db.tenant(B.id, (q) => q(`SELECT name, selling_price FROM products WHERE id = $1`, [productOfB.id])))[0]).toEqual({ name: productOfB.name, selling_price: productOfB.selling_price });
    expect((await cloud.db.tenant(B.id, (q) => q(`SELECT total FROM sales WHERE id = $1`, [saleOfB.id])))[0].total).toBe(saleOfB.total);
    expect(await count(cloud.db, B.id, 'products')).toBe(3);
  });

  it('device and admin credentials are not interchangeable, and unauthenticated calls are refused', async () => {
    const tokenA = a.engine.meta('device_token')!;
    expect((await cloud.api('GET', '/v1/admin/clients', undefined, tokenA)).status).toBe(401);
    expect((await cloud.api('GET', '/v1/admin/clients', undefined, null)).status).toBe(401);
    expect((await cloud.api('GET', '/v1/sync/pull', undefined, cloud.adminToken)).status).toBe(401);
    expect((await cloud.api('GET', '/v1/sync/pull', undefined, null)).status).toBe(401);
    expect((await cloud.api('GET', '/v1/backups/latest', undefined, tokenA)).status).toBe(404); // A has no backup; it can never be handed B's
    expect((await cloud.api('POST', '/v1/admin/login', { email: 'admin@mansora.test', password: 'wrong' }, null)).status).toBe(401);
  });

  it('activation codes are single-use and one business has one active laptop', async () => {
    expect((await cloud.api('POST', '/v1/devices/activate', { code: A.code, deviceName: 'Second', appVersion: '1' }, null)).body.code).toBe('INVALID_ACTIVATION_CODE');
    const code2 = (await cloud.api('POST', `/v1/admin/clients/${A.id}/activation-codes`)).body.code;
    expect((await cloud.api('POST', '/v1/devices/activate', { code: code2, deviceName: 'Second', appVersion: '1' }, null)).body.code).toBe('DEVICE_ALREADY_ACTIVE');
    expect((await cloud.api('POST', '/v1/devices/activate', { code: 'MNS-AAAA-BBBB-CCCC', deviceName: 'x', appVersion: '1' }, null)).status).toBe(400);
  });

  it('a revoked laptop can no longer sync, but keeps working locally', async () => {
    const C = await cloud.createClient('Business C');
    const c = await makeShop({ apiUrl: cloud.url, code: C.code, fetch });
    await syncNow(c.engine);
    const deviceId = (await cloud.api('GET', `/v1/admin/clients/${C.id}`)).body.devices[0].id;
    await cloud.api('POST', `/v1/admin/devices/${deviceId}/revoke`);
    await c.run(c.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: c.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    const r = await syncNow(c.engine);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not authorised/);
    expect(r.pending).toBeGreaterThan(0); // nothing lost: still queued locally
  });
});

describe('TEST 14 - Mansora access to client reports needs the owner\'s consent', () => {
  it('is denied without a grant, and the denial is audited', async () => {
    const res = await summary(B.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPORT_ACCESS_DENIED');
    const audit = (await cloud.api('GET', `/v1/admin/audit?tenantId=${B.id}`)).body;
    expect(audit.some((l: any) => l.action === 'support.access_denied')).toBe(true);
  });

  it('works only inside the granted scope and period, and every access is visible to the owner', async () => {
    await expectCode(b.run(b.manager, 'support.grant', { scope: 'reports', purpose: 'x', hours: 1 }), 'PERMISSION_DENIED'); // only the owner can consent
    const grant = await b.run(b.owner, 'support.grant', { scope: 'reports', purpose: 'Help reconcile November sales', hours: 2 });
    expect((await summary(B.id)).status).toBe(403); // consent has not reached the cloud yet
    await syncNow(b.engine);

    const ok = await summary(B.id);
    expect(ok.status).toBe(200);
    expect(ok.body.sales).toMatchObject({ count: 2, gross: 2500, net: 2500 });
    expect(ok.body.payments).toEqual([{ method: 'card', total: 2500 }]);
    expect(ok.body.grant.id).toBe(grant.id);
    expect(JSON.stringify(ok.body)).not.toContain('Private Customer'); // scope is reports only: no customer data
    expect((await summary(A.id)).status).toBe(403); // B's consent does not open A

    // The owner sees who looked, and when.
    await syncNow(b.engine);
    const seen = await b.run(b.owner, 'support.list', {});
    expect(seen.accessLog.length).toBe(1);
    expect(seen.accessLog[0]).toMatchObject({ admin_name: 'Mansora Admin', grant_id: grant.id });
    expect(seen.accessLog[0].action).toContain('Viewed sales summary');

    // Revoking takes effect as soon as it syncs.
    await b.run(b.owner, 'support.revoke', { id: grant.id });
    await syncNow(b.engine);
    expect((await summary(B.id)).status).toBe(403);
    const audit = (await cloud.api('GET', `/v1/admin/audit?tenantId=${B.id}`)).body.map((l: any) => l.action);
    expect(audit.filter((x: string) => x === 'support.report_viewed').length).toBe(1);
    expect(audit.filter((x: string) => x === 'support.access_denied').length).toBeGreaterThanOrEqual(3);
  });

  it('expires on its own', async () => {
    // A grant issued three hours ago for one hour is already over when it arrives.
    const D = await cloud.createClient('Business D');
    let clock = new Date(Date.now() - 3 * 3_600_000);
    const d = await makeShop({ apiUrl: cloud.url, code: D.code, fetch, now: () => clock });
    await d.run(d.owner, 'support.grant', { scope: 'reports', purpose: 'Old request', hours: 1 });
    clock = new Date();
    const owner = (await d.engine.execute(null, 'auth.login', { username: 'ama', password: 'owner-pass-1' })).token;
    await d.run(owner, 'sync.run', {});
    expect((await cloud.api('GET', `/v1/admin/clients/${D.id}`)).body.grants.length).toBe(1);
    expect((await summary(D.id)).status).toBe(403);
  });

  it('admin overview shows platform health without any client financial data', async () => {
    const overview = (await cloud.api('GET', '/v1/admin/overview')).body;
    expect(overview.clientsByStatus.find((c: any) => c.status === 'onboarding').count).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(overview)).not.toMatch(/gross|revenue|sales|cash/);
    const list = (await cloud.api('GET', '/v1/admin/clients')).body;
    expect(JSON.stringify(list)).not.toMatch(/gross|sales_total|revenue/);
  });
});

describe('onboarding and plans', () => {
  it('tracks the 12 onboarding steps and subscription', async () => {
    const plan = (await cloud.api('POST', '/v1/admin/plans', { name: 'Starter', price: 15_000, billingPeriod: 'monthly', includedSupport: 'Phone support' })).body.id;
    await cloud.api('PUT', `/v1/admin/clients/${A.id}/subscription`, { planId: plan, status: 'active', renewalDate: today });
    let detail = (await cloud.api('GET', `/v1/admin/clients/${A.id}`)).body;
    expect(detail.onboarding.length).toBe(12);
    expect(detail.onboarding.filter((o: any) => o.completed_at).map((o: any) => o.step)).toEqual(['create_account', 'activate_laptop']);
    expect(detail.client).toMatchObject({ plan_name: 'Starter', subscription_status: 'active', status: 'onboarding' });
    await cloud.api('PUT', `/v1/admin/clients/${A.id}/onboarding/go_live`, { completed: true, notes: 'Live' });
    detail = (await cloud.api('GET', `/v1/admin/clients/${A.id}`)).body;
    expect(detail.client.status).toBe('active');
    await syncNow(a.engine);
    expect((await a.run(a.owner, 'sync.status', {})).subscription).toMatchObject({ planName: 'Starter', status: 'active' });
    expect((await cloud.api('GET', '/v1/admin/overview')).body.renewalsDue.some((r: any) => r.id === A.id)).toBe(true);
  });
});
