import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openEngine, syncNow } from '../../apps/desktop/src/core';
import { count, flakyNetwork, startCloud, type Cloud } from '../cloud';
import { CASHIER, expectCode, login, makeShop, OWNER, tempDir, TEST_DB_KEY, uuid } from '../helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

const sell = (s: any, product: string, qty = 1) => s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: product, quantity: qty }], tenders: [{ method: 'cash', amount: 100_000 }] });
const recoveryCode = async (tenantId: string) => (await cloud.api('POST', `/v1/admin/clients/${tenantId}/recovery-codes`, { reason: 'Owner forgot password' })).body.code as string;
const activeDevice = async (tenantId: string) => (await cloud.api('GET', `/v1/admin/clients/${tenantId}`)).body.devices.find((d: any) => d.status === 'active').id as string;

describe('owner password recovery', () => {
  it('needs a valid one-time code for this business, and never gives Mansora the password', async () => {
    const A = await cloud.createClient('Recovery Shop A');
    const B = await cloud.createClient('Recovery Shop B');
    const net = flakyNetwork();
    const a = await makeShop({ apiUrl: cloud.url, code: A.code, fetch: net.fetch });
    await makeShop({ apiUrl: cloud.url, code: B.code, fetch });
    const recover = (code: string, newPassword = 'brand-new-pass-1') => a.run(null, 'auth.recoverOwner', { code, newPassword });

    await expectCode(recover('REC-AAAA-BBBB-CCCC'), 'INVALID_RECOVERY_CODE');
    await expectCode(recover(await recoveryCode(B.id)), 'INVALID_RECOVERY_CODE'); // another business's code is useless here
    const code = await recoveryCode(A.id);
    await expectCode(recover(code, 'short'), 'WEAK_PASSWORD');
    net.online = false;
    await expectCode(recover(code), 'OFFLINE');
    net.online = true;

    expect(await recover(code)).toEqual({ username: OWNER.username });
    await expectCode(a.run(a.owner, 'staff.list', {}), 'NOT_SIGNED_IN'); // existing owner sessions are ended
    await expectCode(login(a.engine, OWNER), 'INVALID_CREDENTIALS');
    const owner = await login(a.engine, { username: OWNER.username, password: 'brand-new-pass-1' });
    expect((await a.run(owner, 'staff.list', {})).length).toBe(3);
    await expectCode(recover(code, 'another-pass-22'), 'INVALID_RECOVERY_CODE'); // single use

    // A newer code cancels an older unused one.
    const first = await recoveryCode(A.id);
    const second = await recoveryCode(A.id);
    await expectCode(recover(first), 'INVALID_RECOVERY_CODE');
    await recover(second, 'final-password-3');

    // Recorded on both sides; the password itself is nowhere in the cloud.
    expect((a.engine.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'owner.password_recovered'`).get() as any).n).toBe(2);
    const audit = (await cloud.api('GET', `/v1/admin/audit?tenantId=${A.id}`)).body;
    expect(audit.filter((l: any) => l.action === 'owner_recovery_code.created').length).toBe(3);
    expect(audit.filter((l: any) => l.action === 'owner_recovery_code.used').length).toBe(2);
    expect(JSON.stringify(audit)).not.toContain('final-password-3');
  });
});

describe('replacement laptop without a backup file', () => {
  it('rebuilds from cloud data, continues numbering and syncs without duplicates', async () => {
    const C = await cloud.createClient('Rebuild Shop');
    const old = await makeShop({ apiUrl: cloud.url, code: C.code, fetch });
    for (let i = 0; i < 5; i++) await sell(old, old.products.milk, 2);
    const customer = (await old.run(old.manager, 'customer.save', { name: 'Kwame' })).id;
    await old.run(old.manager, 'shift.open', { openingFloat: 0 });
    await old.run(old.manager, 'sale.complete', { id: uuid(), lines: [{ productId: old.products.rice, quantity: 1 }], tenders: [{ method: 'credit', amount: 8000 }], customerId: customer });
    expect((await syncNow(old.engine)).ok).toBe(true);
    await sell(old, old.products.soap); // never synced: this one is lost with the laptop
    const oldDb = old.engine.db;

    // The laptop is lost. Mansora deactivates it and issues a new code.
    await cloud.api('POST', `/v1/admin/devices/${await activeDevice(C.id)}/revoke`);
    const code = (await cloud.api('POST', `/v1/admin/clients/${C.id}/activation-codes`)).body.code;
    const engine = openEngine({ dataDir: tempDir('mansora-rebuild-'), dbKey: 'new-laptop-key', fetch });
    await engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code, deviceName: 'Replacement', owner: { ...OWNER, password: 'new-owner-pass-1' }, restoreFromCloud: true });

    const n = (db: any, sql: string) => (db.prepare(sql).get() as any).v;
    expect(n(engine.db, 'SELECT COUNT(*) AS v FROM sales')).toBe(6);
    expect(n(engine.db, 'SELECT SUM(total) AS v FROM sales')).toBe(n(oldDb, 'SELECT SUM(total) AS v FROM sales') - 500);
    for (const p of [old.products.milk, old.products.rice]) {
      expect(engine.db.prepare('SELECT quantity, average_cost FROM stock_balances WHERE product_id = ?').get(p)).toEqual(oldDb.prepare('SELECT quantity, average_cost FROM stock_balances WHERE product_id = ?').get(p));
    }
    expect(n(engine.db, 'SELECT SUM(outstanding_balance) AS v FROM credit_accounts')).toBe(8000);
    expect(n(engine.db, 'SELECT COUNT(*) AS v FROM stock_balances b WHERE b.quantity <> (SELECT SUM(quantity_delta) FROM inventory_movements m WHERE m.product_id = b.product_id)')).toBe(0);
    expect(n(engine.db, `SELECT COUNT(*) AS v FROM users WHERE role = 'owner'`)).toBe(1); // the owner record was taken over, not duplicated

    // The owner signs in with the password chosen on the new laptop. Other staff need new passwords.
    const owner = await login(engine, { username: OWNER.username, password: 'new-owner-pass-1' });
    await expectCode(login(engine, CASHIER), 'INVALID_CREDENTIALS');
    const staff = await engine.execute(owner, 'staff.list', {});
    const cashierRow = staff.find((u: any) => u.username === CASHIER.username);
    await engine.execute(owner, 'staff.save', { id: cashierRow.id, name: cashierRow.name, username: cashierRow.username, role: 'cashier', password: 'reset-cashier-9' });
    const cashier = await login(engine, { username: CASHIER.username, password: 'reset-cashier-9' });

    // Selling continues with the next receipt number, on the cashier's still-open shift.
    const sale = await engine.execute(cashier, 'sale.complete', { id: uuid(), lines: [{ productId: old.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 1250 }] });
    expect(sale.receiptNo).toBe('R-000007');
    expect(await syncNow(engine)).toMatchObject({ ok: true, pending: 0, rejected: 0 });
    expect(await count(cloud.db, C.id, 'sales')).toBe(7);
    expect(await count(cloud.db, C.id, 'users')).toBe(3);
    // The lost laptop can no longer sync.
    expect((await syncNow(old.engine)).ok).toBe(false);
  });

  it('refuses to restore from cloud over a laptop that already has data', async () => {
    const D = await cloud.createClient('Already Active');
    const s = await makeShop({ apiUrl: cloud.url, code: D.code, fetch });
    await expectCode(s.run(null, 'activation.activate', { apiUrl: cloud.url, code: 'x-code', deviceName: 'x', owner: OWNER, restoreFromCloud: true }), 'ALREADY_ACTIVATED');
  });
});

describe('re-linking a restored laptop and re-sending records', () => {
  it('gets a new identity with a code for the same business only', async () => {
    const E = await cloud.createClient('Relink Shop');
    const F = await cloud.createClient('Other Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: E.code, fetch });
    await sell(s, s.products.milk);
    await syncNow(s.engine);
    await cloud.api('POST', `/v1/admin/devices/${await activeDevice(E.id)}/revoke`);
    await sell(s, s.products.milk);
    expect((await syncNow(s.engine)).ok).toBe(false);

    await expectCode(s.run(s.manager, 'device.relink', { code: F.code, deviceName: 'x' }), 'PERMISSION_DENIED');
    await expectCode(s.run(s.owner, 'device.relink', { code: F.code, deviceName: 'x' }), 'INVALID_ACTIVATION_CODE');
    // The other business's code was not consumed by the failed attempt.
    expect((await cloud.api('POST', '/v1/devices/activate', { code: F.code, deviceName: 'F laptop', appVersion: '1' }, null)).status).toBe(200);

    const code = (await cloud.api('POST', `/v1/admin/clients/${E.id}/activation-codes`)).body.code;
    await s.run(s.owner, 'device.relink', { code, deviceName: 'Restored laptop' });
    expect(await syncNow(s.engine)).toMatchObject({ ok: true, pending: 0 });
    expect(await count(cloud.db, E.id, 'sales')).toBe(2);
  });

  it('re-sends synced records harmlessly after a cloud rollback', async () => {
    const G = await cloud.createClient('Resend Shop');
    const s = await makeShop({ apiUrl: cloud.url, code: G.code, fetch });
    for (let i = 0; i < 4; i++) await sell(s, s.products.soap);
    await syncNow(s.engine);
    // Simulate the cloud losing recent data: forget the events and the sales they carried.
    await cloud.db.platform((q) => q('SET LOCAL ROLE NONE').then(() => q(`DELETE FROM payments WHERE tenant_id = $1`, [G.id])).then(() => q(`DELETE FROM sale_items WHERE tenant_id = $1`, [G.id])).then(() => q(`DELETE FROM sales WHERE tenant_id = $1`, [G.id])).then(() => q(`DELETE FROM sync_events WHERE tenant_id = $1 AND type = 'sale.complete'`, [G.id])));
    expect(await count(cloud.db, G.id, 'sales')).toBe(0);

    await expectCode(s.run(s.manager, 'sync.requeue', {}), 'PERMISSION_DENIED');
    const { requeued } = await s.run(s.owner, 'sync.requeue', {});
    expect(requeued).toBeGreaterThan(4);
    expect(await syncNow(s.engine)).toMatchObject({ ok: true, pending: 0, rejected: 0 });
    expect(await count(cloud.db, G.id, 'sales')).toBe(4);
    expect(await count(cloud.db, G.id, 'payments')).toBe(4);
    expect(await count(cloud.db, G.id, 'inventory_movements')).toBe(4 + 3); // nothing that survived was duplicated
  });
});
