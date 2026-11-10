import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { admin, asClient, at, GHS, mkClient, one, q } from './helpers';
import { payToken } from '../../apps/api/src/billing';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());
const a = () => admin(cloud);

async function invoice(tenantId: string, amount: number, due = '2026-11-30') {
  const r = await a().post('/invoices', { tenantId, lines: [{ description: 'Retainer', quantity: 1, unitPrice: amount }], dueDate: due, issue: true });
  return r.body.id as string;
}
const deliver = async (event: Record<string, unknown>, headers?: Record<string, string>) => {
  const s = cloud.sandbox.signEvent(event);
  const res = await fetch(`${cloud.url}/v1/webhooks/sandbox`, { method: 'POST', headers: headers ?? s.headers, body: new Uint8Array(s.body) });
  return { status: res.status, body: await res.json() };
};
const payments = () => q(cloud, `SELECT * FROM billing_payments`);

describe('acceptance 10, 21: webhooks are verified, deduplicated and never trusted on their own', () => {
  let client: { id: string; token: string }, inv: string, ref: string, attemptId: string;

  it('set up: a payment is started through the client portal', async () => {
    at(cloud, '2026-11-10');
    client = await mkClient(cloud, 'Webhook Client');
    inv = await invoice(client.id, GHS(240));
    const r = await asClient(cloud, client.token).post(`/invoices/${inv}/pay`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reused: false, sandbox: true });
    attemptId = r.body.attemptId;
    ref = (await one(cloud, `SELECT reference FROM payment_attempts WHERE id = $1`, [attemptId])).reference;
    // asking again returns the same checkout rather than starting a second payment
    const again = await asClient(cloud, client.token).post(`/invoices/${inv}/pay`);
    expect(again.body).toMatchObject({ reused: true, attemptId });
    expect(await q(cloud, `SELECT 1 FROM payment_attempts WHERE invoice_id = $1`, [inv])).toHaveLength(1);
  });

  it('rejects a webhook with a bad or missing signature and changes nothing', async () => {
    const s = cloud.sandbox.signEvent({ id: 'evt-forged', type: 'payment.success', reference: ref });
    expect((await deliver({ id: 'evt-forged', type: 'payment.success', reference: ref }, { ...s.headers, 'x-sandbox-signature': 'deadbeef' })).status).toBe(401);
    expect((await deliver({ id: 'evt-forged', type: 'payment.success', reference: ref }, { 'content-type': 'application/json' })).status).toBe(401);
    expect(await payments()).toHaveLength(0);
    expect(await q(cloud, `SELECT 1 FROM billing_events`)).toHaveLength(0);
    expect((await q(cloud, `SELECT action FROM billing_audit_logs WHERE action = 'webhook.rejected'`)).length).toBe(2);
  });

  it('a signed "success" event is not proof of payment: the provider is asked, and says it is still pending', async () => {
    const r = await deliver({ id: 'evt-early', type: 'payment.success', reference: ref });
    expect(r.status).toBe(200);
    expect(await payments()).toHaveLength(0);
    expect(await one(cloud, `SELECT status FROM invoices WHERE id = $1`, [inv])).toMatchObject({ status: 'sent' });
    expect((await one(cloud, `SELECT status FROM payment_attempts WHERE id = $1`, [attemptId])).status).toBe('awaiting_customer');
    expect((await one(cloud, `SELECT outcome FROM billing_events WHERE event_id = 'evt-early'`)).outcome).toBe('deferred');
  });

  it('10. once the provider confirms, repeated and simultaneous deliveries create exactly one payment', async () => {
    cloud.sandbox.approve(ref);
    const results = await Promise.all([1, 2, 3, 4].map(() => deliver({ id: 'evt-paid-1', type: 'payment.success', reference: ref })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    await deliver({ id: 'evt-paid-1', type: 'payment.success', reference: ref });
    await deliver({ id: 'evt-paid-2', type: 'payment.success', reference: ref }); // even a new event id for the same payment
    expect(await payments()).toHaveLength(1);
    expect(await one(cloud, `SELECT status, amount_paid FROM invoices WHERE id = $1`, [inv])).toMatchObject({ status: 'paid', amount_paid: GHS(240) });
    expect(await q(cloud, `SELECT 1 FROM billing_events WHERE event_id = 'evt-paid-1'`)).toHaveLength(1); // stored once
    expect(await q(cloud, `SELECT 1 FROM payment_allocations`)).toHaveLength(1);
    expect(await q(cloud, `SELECT 1 FROM notifications WHERE kind = 'receipt'`)).toHaveLength(1); // one receipt, not four
  });

  it('an event about a payment Mansora never asked for is ignored and put in the exception queue', async () => {
    const r = await deliver({ id: 'evt-ghost', type: 'payment.success', reference: 'MNS-GHOST-1' });
    expect(r.body).toMatchObject({ outcome: 'ignored' });
    expect(await payments()).toHaveLength(1);
    expect((await a().get('/exceptions')).body.map((e: any) => e.kind)).toContain('unknown_reference');
  });

  it('a provider amount that differs from the request is never recorded as paid', async () => {
    const inv2 = await invoice(client.id, GHS(100));
    const r = await asClient(cloud, client.token).post(`/invoices/${inv2}/pay`);
    const ref2 = (await one(cloud, `SELECT reference FROM payment_attempts WHERE id = $1`, [r.body.attemptId])).reference;
    cloud.sandbox.txns.get(ref2)!.amount = 1; // the provider reports a different amount
    cloud.sandbox.approve(ref2);
    await deliver({ id: 'evt-mismatch', type: 'payment.success', reference: ref2 });
    expect(await payments()).toHaveLength(1);
    expect(await one(cloud, `SELECT status FROM invoices WHERE id = $1`, [inv2])).toMatchObject({ status: 'sent' });
    expect((await a().get('/exceptions')).body.map((e: any) => e.kind)).toContain('amount_mismatch');
  });

  it('a provider-reported dispute pauses collection and is queued for review', async () => {
    const pay = await one(cloud, `SELECT id, reference FROM billing_payments`);
    const r = await deliver({ id: 'evt-dispute', type: 'dispute.opened', reference: pay.reference });
    expect(r.status).toBe(200);
    expect(await one(cloud, `SELECT status FROM billing_payments WHERE id = $1`, [pay.id])).toMatchObject({ status: 'disputed' });
    expect((await one(cloud, `SELECT status FROM invoices WHERE id = $1`, [inv])).status).toBe('disputed');
    expect((await a().get('/exceptions')).body.map((e: any) => e.kind)).toContain('dispute');
  });
});

describe('acceptance 18, 21: tenants are isolated and provider trouble is visible, not silent', () => {
  let A: { id: string; token: string }, B: { id: string; token: string }, invA: string, invB: string;

  it('18. one client cannot read, pay or download another client\'s billing', async () => {
    at(cloud, '2026-12-01');
    A = await mkClient(cloud, 'Client A'); B = await mkClient(cloud, 'Client B');
    invA = await invoice(A.id, GHS(10)); invB = await invoice(B.id, GHS(20));
    const ca = asClient(cloud, A.token);
    const sum = (await ca.get('/summary')).body;
    expect(sum.invoices.map((i: any) => i.id)).toEqual([invA]);
    expect((await ca.get(`/invoices/${invB}/document`)).status).toBe(404);
    expect((await ca.post(`/invoices/${invB}/pay`)).status).toBe(404);
    const payB = await a().post(`/invoices/${invB}/payment`, { amount: GHS(20), method: 'cash' });
    expect((await ca.get(`/payments/${payB.body.paymentId}/receipt`)).status).toBe(404);
    expect((await cloud.api('GET', '/v1/billing/summary', undefined, null)).status).toBe(401);
    expect((await cloud.api('GET', '/v1/billing/summary', undefined, cloud.adminToken)).status).toBe(401); // an admin token is not a device token
    expect((await cloud.api('GET', '/v1/admin/billing/invoices', undefined, A.token)).status).toBe(401); // and a device token is not an admin token
    // payment links are signed: they cannot be edited to point at someone else's invoice
    const token = payToken(cloud.billing, invA);
    expect((await fetch(`${cloud.url}/pay/${token}`)).status).toBe(200);
    expect((await fetch(`${cloud.url}/pay/${invB}.${token.split('.')[1]}`)).status).toBe(404);
    expect((await fetch(`${cloud.url}/pay/${invA}.AAAAAAAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });

  it('18. the database itself keeps business-data roles out of billing tables, and billing history cannot be rewritten', async () => {
    for (const table of ['invoices', 'billing_payments', 'payment_mandates', 'billing_audit_logs']) {
      await expect(cloud.db.tenant(A.id, (x) => x(`SELECT * FROM ${table}`)), table).rejects.toThrow(/permission denied/);
    }
    // Two independent protections: the application role has no UPDATE/DELETE privilege on the audit log, and a trigger refuses changes even to a role that did.
    await expect(q(cloud, `UPDATE billing_audit_logs SET action = 'x'`)).rejects.toThrow(/permission denied|cannot be changed or deleted/);
    await expect(q(cloud, `DELETE FROM billing_audit_logs`)).rejects.toThrow(/permission denied|cannot be changed or deleted/);
    expect(await q(cloud, `SELECT 1 FROM pg_trigger WHERE tgname = 'billing_audit_no_change'`)).toHaveLength(1);
    await expect(q(cloud, `DELETE FROM invoices`)).rejects.toThrow(/permission denied/);
  });

  it('payment links work, label sandbox payments clearly, and send the customer to the provider', async () => {
    const page = await fetch(`${cloud.url}/pay/${payToken(cloud.billing, invA)}`);
    const html = await page.text();
    expect(html).toContain('GH₵10.00'); expect(html).toContain('SANDBOX'); expect(html).not.toContain('<script');
    const go = await fetch(`${cloud.url}/pay/${payToken(cloud.billing, invA)}/start`, { method: 'POST', redirect: 'manual' });
    expect(go.status).toBe(303);
    expect(go.headers.get('location')).toContain('/sandbox/checkout/');
  });

  it('21. when the provider is down the client sees a clear error, nothing is left stuck, and it works again afterwards', async () => {
    await q(cloud, `UPDATE payment_attempts SET status = 'cancelled' WHERE invoice_id = $1 AND status IN ('initiated','awaiting_customer')`, [invA]);
    cloud.sandbox.down = true;
    const r = await asClient(cloud, A.token).post(`/invoices/${invA}/pay`);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(r.body.message).toContain('could not be reached');
    expect((await q(cloud, `SELECT status FROM payment_attempts WHERE invoice_id = $1 ORDER BY attempt_no DESC LIMIT 1`, [invA]))[0].status).toBe('failed');
    cloud.sandbox.down = false;
    const ok = await asClient(cloud, A.token).post(`/invoices/${invA}/pay`);
    expect(ok.status).toBe(200);
  });

  it('a client with no email address on file cannot start a payment, and is told why', async () => {
    const noMail = await mkClient(cloud, 'No Email Ltd', null);
    const i = await invoice(noMail.id, GHS(5));
    const r = await asClient(cloud, noMail.token).post(`/invoices/${i}/pay`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NO_EMAIL');
  });
});
