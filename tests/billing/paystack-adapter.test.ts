import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, nextBoundary } from '../../apps/api/src/billing/dates';
import { priceInvoice } from '../../apps/api/src/billing/invoices';
import { PaystackProvider } from '../../apps/api/src/billing/providers/paystack';
import { createProviders, ProviderRegistry } from '../../apps/api/src/billing/providers/registry';
import { SandboxProvider } from '../../apps/api/src/billing/providers/sandbox';
import { runBillingCycle, type Billing } from '../../apps/api/src/billing';
import { chargeInvoice, processWebhook, startCheckout, startMandate } from '../../apps/api/src/billing/payments';
import { toCsv } from '../../apps/api/src/billing/reports';
import { startCloud, type Cloud } from '../cloud';
import { admin, at, GHS, mkClient, mkPlan, one, q, subscribe } from './helpers';

/** A stand-in for Paystack's documented endpoints. It checks what the adapter sends. It is NOT Paystack. */
function fakePaystack() {
  const SECRET = 'sk_test_fake';
  const calls: { method: string; path: string; body: any; auth: string | undefined }[] = [];
  const txns = new Map<string, any>();
  let server: Server;
  const handler = (req: any, res: any) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method, path: req.url, body, auth: req.headers.authorization });
      const send = (code: number, json: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { status: false, message: 'Invalid key' });
      if (req.method === 'POST' && req.url === '/transaction/initialize') {
        txns.set(body.reference, { status: 'abandoned', amount: body.amount, currency: body.currency, id: 5000 + txns.size, reusable: false });
        return send(200, { status: true, data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, access_code: 'ac', reference: body.reference } });
      }
      const verify = /^\/transaction\/verify\/(.+)$/.exec(req.url ?? '');
      if (req.method === 'GET' && verify) {
        const t = txns.get(decodeURIComponent(verify[1]));
        if (!t) return send(400, { status: false, message: 'Transaction reference not found' });
        return send(200, { status: true, data: { status: t.status, amount: t.amount, currency: t.currency, id: t.id, fees: Math.round(t.amount * 0.0195), channel: t.channel ?? 'card', gateway_response: t.status === 'failed' ? 'Insufficient Funds' : 'Successful', authorization: t.status === 'success' ? { authorization_code: `AUTH_${t.id}`, reusable: t.reusable, brand: 'visa', last4: '4081', channel: 'card' } : {} } });
      }
      if (req.method === 'POST' && req.url === '/transaction/charge_authorization') {
        if (!String(body.authorization_code).startsWith('AUTH_')) return send(400, { status: false, message: 'Invalid authorization code' });
        txns.set(body.reference, { status: server_next.outcome, amount: body.amount, currency: body.currency, id: 9000 + txns.size, reusable: true });
        return send(200, { status: true, data: { status: server_next.outcome === 'failed' ? 'failed' : 'success', reference: body.reference, gateway_response: 'Insufficient Funds' } });
      }
      if (req.method === 'POST' && req.url === '/refund') return send(200, { status: true, data: { id: 31337, status: 'pending' } });
      return send(404, { status: false, message: 'Not found' });
    });
  };
  const server_next = { outcome: 'success' as 'success' | 'failed' };
  return {
    SECRET, calls, txns, next: server_next,
    start: () => new Promise<string>((resolve) => { server = createServer(handler).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as any).port}`)); }),
    stop: () => new Promise<void>((r) => server.close(() => r())),
    sign: (body: string) => createHmac('sha512', SECRET).update(body).digest('hex'), // computed independently of the adapter
  };
}

describe('dates, pricing and provider routing', () => {
  it('month arithmetic keeps the billing day and clamps short months', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // counting from the anchor means a 31st start returns to the 31st instead of drifting to the 28th
    const anchor = '2027-01-31';
    const seq = [anchor];
    for (let i = 0; i < 4; i++) seq.push(nextBoundary(anchor, seq[i], 1));
    expect(seq).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });
  it('invoice totals are exact integers whatever the discounts and tax', () => {
    const p = priceInvoice([{ description: 'a', quantity: 3, unitPrice: 3333, discount: 99 }, { description: 'b', quantity: 1, unitPrice: 501 }], 100, 1250);
    expect(p.subtotal).toBe(10500); expect(p.discountTotal).toBe(199);
    expect(p.taxTotal).toBe(Math.round((10500 - 199) * 0.125)); // 1287.6 rounds to 1288
    expect(p.total).toBe(10500 - 199 + p.taxTotal);
    expect(() => priceInvoice([])).toThrow();
    expect(() => priceInvoice([{ description: 'x', quantity: 1, unitPrice: 100, discount: 101 }])).toThrow();
    expect(() => priceInvoice([{ description: 'x', quantity: 1.5, unitPrice: 100 }])).toThrow();
  });
  it('no payment collection is possible without a provider, and recurring Mobile Money is reported as blocked', () => {
    const none = createProviders({ allowSandbox: false, publicBaseUrl: 'http://x' }).registry;
    expect(() => none.forCheckout()).toThrow(/No payment provider/);
    expect(() => none.forMandate('momo')).toThrow(/Mobile Money payments are not available/);
    const onlyPaystack = createProviders({ paystackSecretKey: 'sk_test_x', allowSandbox: false, publicBaseUrl: 'http://x' }).registry;
    expect(onlyPaystack.forCheckout().caps.id).toBe('paystack');
    expect(onlyPaystack.forMandate('card').caps.id).toBe('paystack');
    expect(() => onlyPaystack.forMandate('momo')).toThrow(/Mobile Money payments are not available/);
    expect(onlyPaystack.find('hubtel')!.configured()).toBe(false);
  });
  it('spreadsheet exports neutralise formula injection', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', 'ok, fine']])).toContain(`"'=HYPERLINK(""x"")",'+1,"ok, fine"`);
  });
});

describe('the real Paystack adapter, against a local fake of its documented API', () => {
  let cloud: Cloud, fake: ReturnType<typeof fakePaystack>, b2: Billing, paystack: PaystackProvider;
  beforeAll(async () => {
    cloud = await startCloud();
    fake = fakePaystack();
    const base = await fake.start();
    paystack = new PaystackProvider({ secretKey: fake.SECRET, baseUrl: base });
    b2 = { ...cloud.billing, providers: new ProviderRegistry([paystack]) };
  });
  afterAll(async () => { await fake.stop(); await cloud.close(); });
  const SYSTEM = { type: 'admin' as const, id: null };
  const hook = (event: Record<string, unknown>) => { const raw = JSON.stringify(event); return processWebhook(b2, 'paystack', Buffer.from(raw), { 'x-paystack-signature': fake.sign(raw) }); };

  it('sends amounts in pesewas with the right currency, key and reference, and records the verified payment', async () => {
    at(cloud, '2026-11-10');
    const c = await mkClient(cloud, 'Paystack Payer');
    const inv = (await admin(cloud).post('/invoices', { tenantId: c.id, lines: [{ description: 'Retainer', quantity: 1, unitPrice: GHS(150) }], issue: true })).body.id;
    const co = await startCheckout(b2, { tenantId: c.id, invoiceId: inv, actor: SYSTEM });
    expect(co.url).toMatch(/^https:\/\/checkout\.paystack\.test\/MNS-INV-2026-000001-1-/);
    const init = fake.calls.find((x) => x.path === '/transaction/initialize')!;
    expect(init.auth).toBe(`Bearer ${fake.SECRET}`);
    expect(init.body).toMatchObject({ amount: 15000, currency: 'GHS', email: 'paystackpayer@clients.test', channels: ['card', 'mobile_money'] });
    expect(Number.isInteger(init.body.amount)).toBe(true);
    const ref = (await one(cloud, `SELECT reference FROM payment_attempts WHERE id = $1`, [co.attemptId])).reference;

    // a webhook before the customer has paid is not trusted: the adapter's verify call says "abandoned" (not paid yet)
    const early = JSON.stringify({ event: 'charge.success', data: { id: 5000, reference: ref } });
    expect((await processWebhook(b2, 'paystack', Buffer.from(early), { 'x-paystack-signature': 'bad' })).status).toBe(401);
    await hook({ event: 'charge.success', data: { id: 5000, reference: ref, amount: 15000 } });
    expect(await q(cloud, `SELECT 1 FROM billing_payments`)).toHaveLength(0);

    fake.txns.get(ref).status = 'success'; fake.txns.get(ref).channel = 'mobile_money'; // the customer pays by Mobile Money (one-off)
    await hook({ event: 'charge.success', data: { id: 5000, reference: ref, amount: 15000 } });
    await hook({ event: 'charge.success', data: { id: 5000, reference: ref, amount: 15000 } }); // Paystack redelivers
    const pays = await q(cloud, `SELECT * FROM billing_payments`);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount: 15000, method: 'momo', provider: 'paystack', sandbox: false, fee: 293, provider_txn_id: '5000' }); // 1.95% fee, rounded
    expect((await one(cloud, `SELECT status FROM invoices WHERE id = $1`, [inv])).status).toBe('paid');
  });

  it('recurring cards: authorises with a first payment, then charges the saved authorisation on later due dates', async () => {
    at(cloud, '2026-12-01');
    const plan = await mkPlan(cloud, { price: GHS(300) });
    const c = await mkClient(cloud, 'Card Subscriber');
    const s = await subscribe(cloud, c.id, plan);
    const m = await startMandate(b2, { tenantId: c.id, method: 'card', actor: SYSTEM });
    const mInit = fake.calls.filter((x) => x.path === '/transaction/initialize').pop()!;
    expect(mInit.body.channels).toEqual(['card']);
    expect(mInit.body.metadata.authorise_future_charges).toBe(true);
    const mref = (await one(cloud, `SELECT reference FROM payment_attempts WHERE mandate_id = $1`, [m.mandateId])).reference;
    fake.txns.get(mref).status = 'success'; fake.txns.get(mref).reusable = true;
    await hook({ event: 'charge.success', data: { id: 6001, reference: mref, amount: 30000 } });
    expect(await one(cloud, `SELECT status, masked, method FROM payment_mandates WHERE id = $1`, [m.mandateId])).toMatchObject({ status: 'active', masked: 'visa •••• 4081', method: 'card' });
    expect((await one(cloud, `SELECT status FROM client_subscriptions WHERE id = $1`, [s.subscriptionId])).status).toBe('active');

    at(cloud, '2027-01-01'); // renewal 2027-01-01: invoiced a week earlier, charged on the day
    at(cloud, '2026-12-25');
    await runBillingCycleWith(b2);
    at(cloud, '2027-01-01');
    await runBillingCycleWith(b2);
    const charge = fake.calls.find((x) => x.path === '/transaction/charge_authorization')!;
    expect(charge.body).toMatchObject({ authorization_code: 'AUTH_6000'.replace('6000', String(fake.txns.get(mref).id)), amount: 30000, currency: 'GHS' });
    expect(charge.body.reference).toMatch(/^MNS-INV-/);
    expect(await q(cloud, `SELECT 1 FROM billing_payments WHERE tenant_id = $1`, [c.id])).toHaveLength(2);
    // a declined charge from Paystack is not a payment
    fake.next.outcome = 'failed';
    at(cloud, '2027-01-25'); await runBillingCycleWith(b2);
    at(cloud, '2027-02-01'); await runBillingCycleWith(b2);
    const last = await one(cloud, `SELECT status, failure_reason FROM payment_attempts WHERE tenant_id = $1 AND kind = 'mandate_charge' ORDER BY created_at DESC, attempt_no DESC LIMIT 1`, [c.id]);
    expect(last).toMatchObject({ status: 'failed', failure_reason: 'Insufficient Funds' });
    expect(await q(cloud, `SELECT 1 FROM billing_payments WHERE tenant_id = $1`, [c.id])).toHaveLength(2);
  });

  it('refuses to set up recurring Mobile Money through Paystack, with a clear message', async () => {
    const c = await mkClient(cloud, 'Wallet Customer');
    const plan = await mkPlan(cloud, { price: GHS(50) });
    await subscribe(cloud, c.id, plan);
    await expect(startMandate(b2, { tenantId: c.id, method: 'momo', actor: SYSTEM })).rejects.toMatchObject({ code: 'PROVIDER_BLOCKED' });
  });

  it('turns a refund into a pending provider refund that completes when the provider confirms it', async () => {
    const pay = await one(cloud, `SELECT id, reference FROM billing_payments WHERE provider = 'paystack' ORDER BY received_at LIMIT 1`);
    const { refundPayment } = await import('../../apps/api/src/billing/payments');
    const r = await refundPayment(b2, pay.id, { amount: GHS(50), reason: 'Duplicate charge', viaProvider: true, actor: SYSTEM });
    expect(r.status).toBe('pending_provider');
    expect((await one(cloud, `SELECT amount_refunded FROM billing_payments WHERE id = $1`, [pay.id])).amount_refunded).toBe(0); // not counted until confirmed
    await hook({ event: 'refund.processed', data: { id: 777, reference: '31337' } });
    expect(await one(cloud, `SELECT status, amount_refunded FROM billing_payments WHERE id = $1`, [pay.id])).toMatchObject({ status: 'partially_refunded', amount_refunded: GHS(50) });
    expect((await one(cloud, `SELECT status FROM billing_refunds`)).status).toBe('completed');
    // A confirmation that names only the original transaction still completes the matching refund.
    await refundPayment(b2, pay.id, { amount: GHS(20), reason: 'Goodwill', viaProvider: true, actor: SYSTEM });
    await q(cloud, `UPDATE billing_refunds SET provider_ref = 'unknown-refund-id' WHERE status = 'pending_provider'`);
    await hook({ event: 'refund.processed', data: { transaction: { reference: pay.reference }, amount: GHS(20) } });
    expect((await one(cloud, `SELECT amount_refunded FROM billing_payments WHERE id = $1`, [pay.id])).amount_refunded).toBe(GHS(70));
  });
});

async function runBillingCycleWith(b: Billing) { const r = await runBillingCycle(b); if (r.errors.length) throw new Error(r.errors.join('; ')); return r; }
void SandboxProvider; void chargeInvoice;
