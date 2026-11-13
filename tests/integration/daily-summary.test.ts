import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { expectCode, login, makeShop, OWNER, CASHIER, MANAGER, type TestShop } from '../helpers';

let cloud: Cloud;
let shop: TestShop;
const net = flakyNetwork();
const sent: any[] = [];
const clock = { iso: '2034-09-01T10:00:00.000Z' };
const at = async (iso: string) => { clock.iso = iso; shop.owner = await login(shop.engine, OWNER); shop.cashier = await login(shop.engine, CASHIER); shop.manager = await login(shop.engine, MANAGER); };

beforeAll(async () => {
  cloud = await startCloud();
  cloud.billing.email = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: `m${sent.length}` }; }) };
  const client = await cloud.createClient('Summary Mart');
  shop = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code, now: () => new Date(clock.iso) });
});
afterAll(() => cloud.close());

describe('the owner\'s daily closing summary email (C33)', () => {
  it('sends nothing until the owner turns it on, and only the owner can', async () => {
    await shop.run(shop.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.rice, quantity: 1 }], tenders: [{ method: 'momo', amount: 8000 }] });
    await at('2034-09-01T22:00:00.000Z');
    await shop.run(shop.owner, 'sync.run', {});
    expect(sent).toHaveLength(0);
    await expectCode(shop.run(shop.manager, 'summary.save', { email: 'boss@example.test', hour: 21 }), 'PERMISSION_DENIED');
  });

  it('sends once a day after the chosen hour, with sales and payments but never costs, and the server keeps no figures', async () => {
    await at('2034-09-02T09:00:00.000Z');
    await shop.run(shop.owner, 'summary.save', { email: 'Boss@Example.test', hour: 21 });
    await shop.run(shop.cashier, 'sale.complete', { id: randomUUID(), lines: [{ productId: shop.products.milk, quantity: 2 }], tenders: [{ method: 'cash', amount: 2500 }] });
    await shop.run(shop.owner, 'sync.run', {});
    expect(sent).toHaveLength(0); // before 21:00
    await at('2034-09-02T21:05:00.000Z');
    await shop.run(shop.owner, 'sync.run', {});
    await shop.run(shop.owner, 'sync.run', {}); // a second sync the same evening sends nothing more
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail.to).toBe('boss@example.test');
    expect(mail.subject).toBe('Summary Mart: GHS 25.00 net sales on 2034-09-02');
    expect(mail.body).toContain('Net sales: GHS 25.00 from 1 sale');
    expect(mail.body).toContain('Cash: GHS 25.00');
    expect(mail.body.replace('exclude costs and profit', '')).not.toMatch(/cost|profit|margin/i);
    const [record] = await cloud.db.platform((q) => q(`SELECT subject, body FROM notifications WHERE kind = 'daily_summary'`));
    expect(record.body).toBe('[business figures removed after sending]');
    expect(record.subject).not.toContain('GHS');

    await at('2034-09-03T21:30:00.000Z');
    await shop.run(shop.owner, 'sync.run', {});
    expect(sent).toHaveLength(2); // next day
  });

  it('retries after a failed send, offers a test send, and stops when turned off', async () => {
    await at('2034-09-04T21:10:00.000Z');
    cloud.billing.email = { configured: () => false, send: vi.fn() };
    await shop.run(shop.owner, 'sync.run', {});
    cloud.billing.email = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: 'x' }; }) };
    await shop.run(shop.owner, 'sync.run', {});
    expect(sent.filter((m) => m.subject.includes('2034-09-04'))).toHaveLength(0); // waits an hour after a failure
    await at('2034-09-04T22:15:00.000Z');
    await shop.run(shop.owner, 'sync.run', {});
    expect(sent.filter((m) => m.subject.includes('2034-09-04'))).toHaveLength(1);
    await shop.run(shop.owner, 'summary.sendTest', {});
    expect(sent.filter((m) => m.subject.includes('2034-09-04'))).toHaveLength(2);
    await shop.run(shop.owner, 'summary.save', { email: null, hour: 21 });
    await at('2034-09-05T22:00:00.000Z');
    await shop.run(shop.owner, 'sync.run', {});
    expect(sent.filter((m) => m.subject.includes('2034-09-05'))).toHaveLength(0);
    await expectCode(shop.run(shop.owner, 'summary.sendTest', {}), 'EMAIL_REQUIRED');
  });
});
