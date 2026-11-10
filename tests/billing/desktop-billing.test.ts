import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { expectCode, makeShop, type TestShop } from '../helpers';
import { approveOnProviderPage, GHS, mkPlan, one, subscribe } from './helpers';

let cloud: Cloud;
let shop: TestShop;
let invoiceId: string;
let tenantId: string;
const net = flakyNetwork();

beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Desk Billing Mart');
  shop = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code });
  tenantId = client.id;
  await cloud.db.platform((x) => x(`UPDATE tenants SET email = 'owner@deskbilling.test' WHERE id = $1`, [client.id]));
  const planId = await mkPlan(cloud, { name: 'Desk plan', price: GHS(250) });
  invoiceId = (await subscribe(cloud, client.id, planId)).invoiceId!;
});
afterAll(() => cloud.close());

describe('the client billing screen (desktop engine)', () => {
  it('is owner only by default: managers and cashiers cannot see or pay Mansora invoices', async () => {
    for (const who of [shop.manager, shop.cashier]) {
      await expectCode(shop.run(who, 'billing.summary', {}), 'PERMISSION_DENIED');
      await expectCode(shop.run(who, 'billing.pay', { invoiceId }), 'PERMISSION_DENIED');
      await expectCode(shop.run(who, 'billing.mandate.start', { method: 'card' }), 'PERMISSION_DENIED');
    }
  });

  it('shows the plan, fee and what is due, then pays through the provider page and shows the receipt', async () => {
    const s = await shop.run(shop.owner, 'billing.summary', {});
    expect(s).toMatchObject({ offline: false, subscription: { plan: 'Desk plan', amount: GHS(250) }, outstanding: GHS(250) });
    expect(s.nextPayment.invoiceId).toBe(invoiceId);
    expect(s.invoices[0]).toMatchObject({ canPay: true, outstanding: GHS(250) });

    const { url } = await shop.run(shop.owner, 'billing.pay', { invoiceId });
    expect(url).toContain('/sandbox/checkout/');
    // Starting a payment does not mark anything paid.
    expect((await shop.run(shop.owner, 'billing.summary', {})).outstanding).toBe(GHS(250));
    await approveOnProviderPage(url);

    const after = await shop.run(shop.owner, 'billing.summary', {});
    expect(after.outstanding).toBe(0);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ amount: GHS(250), sandbox: true });
    const doc = await shop.run(shop.owner, 'billing.document', { kind: 'receipt', id: after.payments[0].id });
    expect(doc.html).toContain(doc.number);
    const inv = await shop.run(shop.owner, 'billing.document', { kind: 'invoice', id: invoiceId });
    expect(inv.html).toContain('Desk plan');
  });

  it('keeps showing the last known state offline, and refuses actions that need the server', async () => {
    net.online = false;
    try {
      const s = await shop.run(shop.owner, 'billing.summary', {});
      expect(s.offline).toBe(true);
      expect(s.payments).toHaveLength(1);
      await expectCode(shop.run(shop.owner, 'billing.mandate.cancel', {}), 'OFFLINE');
      await expectCode(shop.run(shop.owner, 'billing.cancellation.request', { reason: 'Closing down' }), 'OFFLINE');
      await expectCode(shop.run(shop.owner, 'billing.document', { kind: 'invoice', id: invoiceId }), 'OFFLINE');
    } finally {
      net.online = true;
    }
  });

  it('sends a cancellation request to Mansora without cancelling anything', async () => {
    await shop.run(shop.owner, 'billing.cancellation.request', { reason: 'Closing down' });
    const sub = await one(cloud, `SELECT status, cancel_requested_at FROM client_subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(sub.cancel_requested_at).not.toBeNull();
    expect(sub.status).not.toBe('cancelled');
    const s = await shop.run(shop.owner, 'billing.summary', {});
    expect(s.subscription.cancelRequested).toBe(true);
    // The request is recorded in the laptop's own audit history too.
    const logged = shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'billing.cancellation_requested'`).get() as { n: number };
    expect(logged.n).toBe(1);
  });
});
