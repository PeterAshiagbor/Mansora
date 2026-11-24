import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { admin, mkPlan, subscribe } from '../billing/helpers';
import { buildApp } from '../../apps/api/src/app';
import { paidPurchaseEligible } from '../../apps/api/src/modules/purchased-setup';
let cloud: Cloud, app: Awaited<ReturnType<typeof buildApp>>;
const sent: any[] = [];
const invite = vi.fn(async (_input: unknown) => ({ workspaceId: 'shop-synthetic', status: 'pending' as const, expiresAt: new Date(Date.now() + 1800000).toISOString(), url: 'https://mansora.example/onboarding/#token=' + 'T'.repeat(43) }));
const request = (email: string, extra: Record<string, unknown> = {}) => cloud.api('POST', '/v1/accounts/purchased-setup', { email, ...extra }, null);
beforeAll(async () => {
  cloud = await startCloud(); const issuer = (await cloud.api('GET', '/v1/admin/me')).body.id;
  cloud.billing.email = { configured: () => true, send: async message => { sent.push(message); return { id: 'synthetic-message' }; } };
  await cloud.app.close(); app = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir(), browserWorkspaces: { invite }, purchasedSetupIssuerId: issuer });
  await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
  // API assertions use the replacement Fastify instance directly; do not reuse a pooled
  // HTTP connection belonging to the deliberately closed fixture server.
  cloud.api = async (method, path, body, token) => {
    const bearer = token === undefined ? cloud.adminToken : token;
    const response = await app.inject({ method: method as any, url: path, ...(body === undefined ? {} : { payload: body as any }), headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
    return { status: response.statusCode, body: response.json() };
  };
});
afterAll(async () => { await app?.close(); await cloud?.db.close(); });
it('rejects sandbox-only payment as production purchase proof and ignores caller attempts to enable the test allowance', async () => {
  const email = 'sandbox-only@example.test', client = await cloud.api('POST', '/v1/admin/clients', { name: 'Sandbox-only buyer', ownerName: 'Synthetic owner', email });
  const plan = await mkPlan(cloud), { invoiceId } = await subscribe(cloud, client.body.id, plan);
  const link = (await admin(cloud).post(`/invoices/${invoiceId}/link`)).body.url;
  const checkout = await fetch(link + '/start', { method: 'POST', redirect: 'manual' }); expect(checkout.status).toBe(303);
  expect((await fetch(checkout.headers.get('location')! + '/approve', { method: 'POST', redirect: 'manual' })).status).toBe(303);
  expect((await admin(cloud).get(`/invoices/${invoiceId}`)).body.status).toBe('paid');
  expect(await cloud.db.platform(q => paidPurchaseEligible(q, client.body.id))).toBe(false);
  const blocked = await request(email, { allowSandboxAccountSetup: true, role: 'admin', ownerUsername: ADMIN.email });
  const unknown = await request('unknown-purchase@example.test'); expect(blocked.status).toBe(202); expect(blocked.body).toEqual(unknown.body);
  expect(invite).not.toHaveBeenCalled(); expect(sent).toHaveLength(0);
  const [payment] = await cloud.db.platform(q => q('SELECT id FROM billing_payments WHERE tenant_id = $1', [client.body.id]));
  expect((await admin(cloud).post(`/payments/${payment.id}/refund`, { amount: 1, reason: 'Synthetic mixed-funding regression', viaProvider: false })).status).toBe(200);
  expect((await admin(cloud).post(`/invoices/${invoiceId}/payment`, { amount: 1, method: 'bank', reference: 'synthetic-one-pesewa-real-funding' })).status).toBe(200);
  expect((await admin(cloud).get(`/invoices/${invoiceId}`)).body.status).toBe('paid');
  expect(await cloud.db.platform(q => paidPurchaseEligible(q, client.body.id))).toBe(false); // One real pesewa cannot legitimise the remaining simulated payment.
  expect((await request(email)).status).toBe(202); expect(invite).not.toHaveBeenCalled(); expect(sent).toHaveLength(0);
});
it('accepts only the full net non-sandbox amount and sends proof exclusively to the recorded owner', async () => {
  const email = 'recorded-paid-owner@example.test', client = await cloud.api('POST', '/v1/admin/clients', { name: 'Recorded purchase', ownerName: 'Recorded owner', email });
  const plan = await mkPlan(cloud), { invoiceId } = await subscribe(cloud, client.body.id, plan);
  const total = (await admin(cloud).get(`/invoices/${invoiceId}`)).body.total, half = Math.floor(total / 2);
  expect((await admin(cloud).post(`/invoices/${invoiceId}/payment`, { amount: half, method: 'bank', reference: 'synthetic-recorded-payment-1' })).status).toBe(200);
  expect((await request(email)).status).toBe(202); expect(invite).not.toHaveBeenCalled();
  expect((await admin(cloud).post(`/invoices/${invoiceId}/payment`, { amount: total - half, method: 'bank', reference: 'synthetic-recorded-payment-2' })).status).toBe(200);
  expect(await cloud.db.platform(q => paidPurchaseEligible(q, client.body.id))).toBe(true);
  expect((await request(email.toUpperCase(), { to: 'attacker@example.test', tenantId: 'another-tenant' })).status).toBe(202);
  expect(invite).toHaveBeenCalledTimes(1); expect(invite.mock.calls[0][0]).toMatchObject({ tenantId: client.body.id, ownerEmail: email, requiresPaidPurchase: true });
  expect(sent).toHaveLength(1); expect(sent[0].to).toBe(email);
  const [payment] = await cloud.db.platform(q => q('SELECT id FROM billing_payments WHERE tenant_id = $1 ORDER BY received_at LIMIT 1', [client.body.id]));
  expect((await admin(cloud).post(`/payments/${payment.id}/refund`, { amount: 1, reason: 'Synthetic eligibility check', viaProvider: false })).status).toBe(200);
  expect(await cloud.db.platform(q => paidPurchaseEligible(q, client.body.id))).toBe(false);
});
