import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runBugDigest, DIGEST_SUBJECT } from '../../apps/api/src/modules/bug-reports';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { expectCode, makeShop, type TestShop } from '../helpers';

let cloud: Cloud;
let shop: TestShop;
const sent: any[] = [];
const email = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: `m${sent.length}` }; }) };
const to = 'reports@example.test';

beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Report Mart');
  shop = await makeShop({ fetch: flakyNetwork().fetch, apiUrl: cloud.url, code: client.code });
});
afterAll(() => cloud.close());

describe('Tell Mansora about a problem', () => {
  it('takes a report from any signed-in shop role, with who sent it and what they pointed at', async () => {
    const area = { label: 'Take payment', text: 'Take payment', path: 'main > section "Basket" > button "Take payment"', x: 10, y: 20, width: 100, height: 30, viewport: '1366x768' };
    const r = await shop.run(shop.cashier, 'bug.report', { description: 'Pressing Take payment does nothing', severity: 'blocking', page: 'New sale', area });
    expect(r.sendsAt).toBe('19:00');
    const [row] = await cloud.db.platform((q) => q(`SELECT * FROM bug_reports WHERE id = $1`, [r.id]));
    expect(row).toMatchObject({ source: 'shop', reporter_role: 'cashier', page: 'New sale', severity: 'blocking', description: 'Pressing Take payment does nothing', digest_day: null });
    expect(row.area).toMatchObject({ label: 'Take payment' });
    expect(shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE type = 'bug.report'`).get()).toEqual({ n: 1 });
    await expectCode(shop.run(shop.cashier, 'bug.report', { description: 'x' }), 'INVALID_INPUT');
    await expectCode(shop.run(null, 'bug.report', { description: 'not signed in' }), 'NOT_SIGNED_IN');
  });

  it('takes a report from an administrator and lists reports for administrators only', async () => {
    expect((await cloud.api('POST', '/v1/admin/bug-reports', { description: 'Invoices page is slow', page: 'Invoices' })).status).toBe(200);
    const list = await cloud.api('GET', '/v1/admin/bug-reports');
    expect(list.body.map((r: any) => r.source).sort()).toEqual(['admin', 'shop']);
    expect(list.body.find((r: any) => r.source === 'shop').shop).toBe('Report Mart');
    expect((await cloud.api('GET', '/v1/admin/bug-reports', undefined, null)).status).toBe(401);
    expect((await cloud.api('POST', '/v1/admin/bug-reports', { description: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('emails every new report once a day after 7pm Ghana time, with the subject Mansora Platform Errors', async () => {
    const day = new Date().toISOString().slice(0, 10);
    expect(await runBugDigest({ db: cloud.db, email, to, now: () => new Date(`${day}T18:59:00Z`) })).toMatchObject({ sent: false, reason: 'NOT_YET' });
    expect(await runBugDigest({ db: cloud.db, email, to: undefined, now: () => new Date(`${day}T19:30:00Z`) })).toMatchObject({ sent: false, reason: 'NO_RECIPIENT' });
    const r = await runBugDigest({ db: cloud.db, email, to, now: () => new Date(`${day}T23:59:00Z`) });
    expect(r).toEqual({ sent: true, reports: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to, subject: DIGEST_SUBJECT, idempotencyKey: `mansora-bug-digest/${day}` });
    expect(sent[0].body).toContain('Pressing Take payment does nothing');
    expect(sent[0].body).toContain('Stops work');
    expect(sent[0].body).toContain('Report Mart');
    expect(sent[0].body.indexOf('Stops work')).toBeLessThan(sent[0].body.indexOf('Invoices page is slow')); // blocking first
    // Once a day only.
    expect(await runBugDigest({ db: cloud.db, email, to, now: () => new Date(`${day}T23:59:30Z`) })).toMatchObject({ sent: false, reason: 'ALREADY_SENT' });
    expect(sent).toHaveLength(1);
  });

  it('retries a failed send on the next run and never loses the reports', async () => {
    await shop.run(shop.owner, 'bug.report', { description: 'Receipt cut off on the right', page: 'Sales history' });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const failing = { configured: () => true, send: vi.fn(async () => { throw new Error('provider down'); }) };
    await expect(runBugDigest({ db: cloud.db, email: failing, to, now: () => new Date(`${tomorrow}T19:05:00Z`) })).rejects.toThrow('provider down');
    const r = await runBugDigest({ db: cloud.db, email, to, now: () => new Date(`${tomorrow}T19:20:00Z`) });
    expect(r).toEqual({ sent: true, reports: 1 });
    expect(sent.at(-1).body).toContain('Receipt cut off on the right');
  });

  it('still sends a short email on a day with no reports', async () => {
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(await runBugDigest({ db: cloud.db, email, to, now: () => new Date(`${later}T19:00:00Z`) })).toEqual({ sent: true, reports: 0 });
    expect(sent.at(-1).body).toBe('No new problem reports today.');
  });
});
