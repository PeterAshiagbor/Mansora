import { randomUUID } from 'node:crypto';
import type { Cloud } from '../cloud';

export const at = (cloud: Cloud, iso: string) => { cloud.clock.now = new Date(iso.length === 10 ? `${iso}T09:00:00.000Z` : iso); };
export const GHS = (n: number) => Math.round(n * 100);

export const q = <T = any>(cloud: Cloud, sql: string, params: unknown[] = []): Promise<T[]> => cloud.db.platform((x) => x<T>(sql, params));
export const one = async <T = any>(cloud: Cloud, sql: string, params: unknown[] = []): Promise<T> => (await q<T>(cloud, sql, params))[0];

/** A client with a contact email and an activated laptop (so its device token can call the client billing endpoints). */
export async function mkClient(cloud: Cloud, name: string, email: string | null = `${name.toLowerCase().replace(/\W+/g, '')}@clients.test`) {
  const res = await cloud.api('POST', '/v1/admin/clients', { name, ownerName: `Owner of ${name}`, phone: '0240000000', address: 'Accra', ...(email ? { email } : {}) });
  if (res.status !== 200) throw new Error(`client: ${JSON.stringify(res.body)}`);
  const id = res.body.id as string;
  const code = (await cloud.api('POST', `/v1/admin/clients/${id}/activation-codes`)).body.code;
  const act = await cloud.api('POST', '/v1/devices/activate', { code, deviceName: `${name} laptop`, appVersion: 'test' }, null);
  return { id, token: act.body.deviceToken as string };
}

export async function mkPlan(cloud: Cloud, over: Record<string, unknown> = {}) {
  const res = await cloud.api('POST', '/v1/admin/plans', { name: `Plan ${randomUUID().slice(0, 6)}`, price: GHS(300), billingPeriod: 'monthly', includedSupport: 'Phone support', description: 'Test plan', setupFee: 0, ...over });
  if (res.status !== 200) throw new Error(`plan: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export const admin = (cloud: Cloud) => ({
  post: async (path: string, body: unknown = {}) => cloud.api('POST', `/v1/admin/billing${path}`, body),
  get: async (path: string) => cloud.api('GET', `/v1/admin/billing${path}`),
  put: async (path: string, body: unknown = {}) => cloud.api('PUT', `/v1/admin/billing${path}`, body),
});

export const asClient = (cloud: Cloud, token: string) => ({
  get: (path: string) => cloud.api('GET', `/v1/billing${path}`, undefined, token),
  post: (path: string, body: unknown = {}) => cloud.api('POST', `/v1/billing${path}`, body, token),
});

/** What the customer does on the (sandbox) provider's page: press Approve. */
export async function approveOnProviderPage(url: string): Promise<void> {
  const res = await fetch(`${url}/approve`, { method: 'POST', redirect: 'manual' });
  if (![302, 303].includes(res.status)) throw new Error(`provider page approve failed: ${res.status}`);
}
export async function declineOnProviderPage(url: string): Promise<void> {
  await fetch(`${url}/decline`, { method: 'POST', redirect: 'manual' });
}

/** Create a subscription, send it for approval (issuing the initial invoice) and return the ids. */
export async function subscribe(cloud: Cloud, tenantId: string, planId: string, over: Record<string, unknown> = {}) {
  const a = admin(cloud);
  const created = await a.post('/subscriptions', { tenantId, planId, ...over });
  if (created.status !== 200) throw new Error(`subscription: ${JSON.stringify(created.body)}`);
  const submitted = await a.post(`/subscriptions/${created.body.id}/submit`);
  if (submitted.status !== 200) throw new Error(`submit: ${JSON.stringify(submitted.body)}`);
  return { subscriptionId: created.body.id as string, invoiceId: (submitted.body.invoiceId ?? null) as string | null };
}
