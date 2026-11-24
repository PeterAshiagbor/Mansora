import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
import { admin as billingAdmin, mkPlan, subscribe } from '../billing/helpers';
import { buildApp } from '../../apps/api/src/app';
import { paidPurchaseEligible } from '../../apps/api/src/modules/purchased-setup';
import { createWorkspaceOnboarding } from '../../scripts/staging/workspace-onboarding';
import { startStagingGateway, type StagingWorkspace } from '../../scripts/staging/gateway';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/desktop/dist/renderer/index.html')))('client-facing account onboarding through the browser, gateway and real stores', () => {
  let cloud: Cloud, app: Awaited<ReturnType<typeof buildApp>>, gateway: Awaited<ReturnType<typeof startStagingGateway>>, browser: any, operator: any, owner: any;
  const workspaces: StagingWorkspace[] = [], sent: any[] = [], errors: string[] = [];
  const ownerPassword = randomBytes(24).toString('base64url'), staffPassword = randomBytes(24).toString('base64url');
  const email = 'assigned-owner@example.test';
  const page = async () => { const result = await (await browser.newContext()).newPage(); result.setDefaultTimeout(10_000); result.on('pageerror', (error: Error) => errors.push(error.message)); return result; };
  const call = async (path: string, input: unknown) => { const response = await fetch(gateway.url + path, { method: 'POST', headers: { origin: gateway.publicOrigin, 'content-type': 'application/json' }, body: JSON.stringify(input) }); return { status: response.status, body: await response.json() as any }; };
  const setupUrl = (body: string) => gateway.url + '/onboarding/' + new URL(body.match(/https?:\/\/\S+\/onboarding\/#token=\S+/)![0]).hash;
  const scan = async (page: any) => { await page.evaluate(axe.source); const violations = await page.evaluate(async () => (await (window as any).axe.run(document)).violations.filter((item: any) => ['serious', 'critical'].includes(item.impact)).map((item: any) => item.id)); expect(violations).toEqual([]); };
  beforeAll(async () => {
    cloud = await startCloud();
    cloud.billing.email = { configured: () => true, send: async message => { sent.push(message); return { id: 'synthetic-mail-' + sent.length }; } };
    const config = { mode: 'client' as const, origin: 'http://127.0.0.1:0', apiUrl: cloud.url, dataDir: tempDir(), key: randomBytes(32).toString('hex'), clientDir: join(root, 'apps/desktop/dist/renderer'), adminDir: join(root, 'apps/admin-web/dist') };
    writeFileSync(join(config.dataDir, 'workspaces.json'), '[]');
    const onboarding = createWorkspaceOnboarding(config, undefined, tenant => cloud.db.platform(q => paidPurchaseEligible(q, tenant, true)));
    gateway = await startStagingGateway({ ...config, workspaces, onboarding, port: 0, adminIdentityExists: email => cloud.db.platform(async q => (await q('SELECT 1 FROM admins WHERE email=$1', [email])).length > 0) });
    onboarding.attach(workspaces, gateway.registerWorkspace);
    const issuer = (await cloud.api('GET', '/v1/admin/me')).body.id;
    await cloud.app.close(); app = await buildApp({ db: cloud.db, backupDir: tempDir(), billing: cloud.billing, browserWorkspaces: onboarding, purchasedSetupIssuerId: issuer, allowSandboxAccountSetup: true, adminOrigins: [gateway.publicOrigin], adminUrl: gateway.publicOrigin + '/admin/' });
    await app.listen({ host: '127.0.0.1', port: Number(new URL(cloud.url).port) });
    cloud.billing.env.publicBaseUrl = gateway.publicOrigin + '/api'; cloud.sandbox.baseUrl = gateway.publicOrigin + '/api';
    browser = await pw.chromium.launch(); operator = await page(); owner = await page();
  });
  afterAll(async () => { await browser?.close(); await gateway?.close(); for (const workspace of workspaces) workspace.engine.db.close(); await app?.close(); await cloud?.db.close(); });
  it('lets Mansora create an owner account, assign a username and email the private password setup link', async () => {
    await operator.goto(gateway.url); await scan(operator);
    await operator.getByLabel('Username or email', { exact: true }).fill(ADMIN.email); await operator.getByLabel('Password', { exact: true }).fill(ADMIN.password); await operator.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(operator, 'Clients'); await operator.getByRole('button', { name: 'Add client', exact: true }).click();
    await operator.getByLabel('Business name', { exact: true }).fill('Assigned owner shop'); await operator.getByLabel('Primary owner', { exact: true }).fill('Assigned Owner'); await operator.getByLabel('Email', { exact: true }).fill(email);
    await operator.getByRole('button', { name: 'Create client', exact: true }).click(); await operator.getByRole('heading', { name: 'Assigned owner shop', exact: true }).waitFor();
    await operator.getByRole('button', { name: 'Browser workspace', exact: true }).click();
    await operator.getByLabel('Assign owner username (optional)', { exact: true }).fill('assigned.owner'); await operator.getByRole('button', { name: 'Create owner setup link', exact: true }).click();
    await operator.getByText('The setup email was accepted for delivery to the recorded owner email.', { exact: true }).waitFor();
    const invite = sent.find(message => message.to === email);
    const proof = new URLSearchParams(new URL(setupUrl(invite.body)).hash.slice(1)).get('token');
    expect((await call('/onboarding/complete', { token: proof, password: ownerPassword, username: 'overridden.owner' })).body.error.code).toBe('USERNAME_ASSIGNED');
    expect(workspaces).toHaveLength(0);
    expect(invite.body).toContain('Your assigned username: assigned.owner'); expect(invite.body).not.toContain(ownerPassword);
    await owner.goto(setupUrl(invite.body)); await owner.getByLabel('Username', { exact: true }).waitFor();
    expect(await owner.getByLabel('Username', { exact: true }).inputValue()).toBe('assigned.owner'); expect(await owner.getByLabel('Username', { exact: true }).getAttribute('readonly')).not.toBeNull(); await scan(owner);
    await owner.getByLabel('Choose a password', { exact: true }).fill(ownerPassword); await owner.getByLabel('Confirm password', { exact: true }).fill(ownerPassword); await owner.getByRole('button', { name: 'Create my workspace', exact: true }).click();
    // Setup ends on the one sign-in page with the email filled in; there is no second, shop-specific form.
    await owner.waitForURL('**/signin/'); expect(await owner.getByLabel('Username or email', { exact: true }).inputValue()).toBe(email);
    await owner.getByLabel('Username or email', { exact: true }).fill(email); await owner.getByLabel('Password', { exact: true }).fill(ownerPassword); await owner.getByRole('button', { name: 'Sign in', exact: true }).click();
    await owner.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    expect((await owner.evaluate(() => (window as any).mansora.invoke('app.state'))).data.user.role).toBe('owner');
  });
  it('lets the owner assign a unique staff username and email a one-time code; staff choose their password and reach the correct shop', async () => {
    await navigate(owner, 'Staff'); await owner.getByRole('button', { name: 'Add staff member', exact: true }).click();
    const form = owner.getByRole('dialog', { name: 'Add staff member', exact: true });
    await form.getByLabel('Full name', { exact: true }).fill('Invited Cashier'); await form.getByLabel('Username', { exact: true }).fill('assigned.owner'); await form.getByLabel('Email (optional)', { exact: true }).fill('team-member@example.test');
    await form.getByRole('button', { name: 'Save and email code', exact: true }).click(); await owner.getByRole('alert').filter({ hasText: 'This username is taken' }).waitFor();
    await form.getByLabel('Username', { exact: true }).fill('invited.cashier'); await form.getByRole('button', { name: 'Save and email code', exact: true }).click();
    await expect.poll(() => sent.filter(message => message.to === 'team-member@example.test').length).toBe(1);
    const message = sent.find(message => message.to === 'team-member@example.test'); const code = /One-time sign-in code: ([A-Z2-9-]+)/.exec(message.body)![1];
    const staff = await page();
    try {
      await staff.goto(gateway.url); await staff.getByRole('link', { name: 'I have a sign-in code', exact: true }).click();
      await staff.getByLabel('Username', { exact: true }).fill('invited.cashier'); await staff.getByLabel('Sign-in code', { exact: true }).fill(code); await staff.getByLabel('New password', { exact: true }).fill(staffPassword); await staff.getByLabel('Repeat new password', { exact: true }).fill(staffPassword); await scan(staff);
      await staff.getByRole('button', { name: 'Set password and sign in', exact: true }).click(); await staff.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      const state = (await staff.evaluate(() => (window as any).mansora.invoke('app.state'))).data; expect(state.user.role).toBe('cashier'); expect(state.business.name).toBe('Assigned owner shop');
      expect((await staff.evaluate(() => (window as any).mansora.invoke('staff.list'))).error.code).toBe('PERMISSION_DENIED');
      expect((await call('/signin/accept-invite', { username: 'invited.cashier', code, newPassword: 'another-strong-password' })).status).toBe(401);
    } finally { await staff.context().close(); }
  });
  it('requires a completed purchase and email proof before self-service username/password setup, then lets the purchaser onboard staff', async () => {
    const email = 'purchaser@example.test';
    const client = await cloud.api('POST', '/v1/admin/clients', { name: 'Purchased shop', ownerName: 'Purchasing Owner', email });
    const plan = await mkPlan(cloud); const { invoiceId } = await subscribe(cloud, client.body.id, plan);
    const pendingCount = workspaces.length;
    const unpaid = await call('/api/v1/accounts/purchased-setup', { email }); const unknown = await call('/api/v1/accounts/purchased-setup', { email: 'unknown@example.test' }); expect(unpaid.status).toBe(202); expect(unpaid.body).toEqual(unknown.body); expect(sent.filter(message => message.to === email)).toHaveLength(0); expect(workspaces).toHaveLength(pendingCount);
    const invoiceLink = await billingAdmin(cloud).post(`/invoices/${invoiceId}/link`);
    const buyer = await page();
    try {
      await buyer.goto(invoiceLink.body.url); await buyer.getByRole('button', { name: 'Pay securely', exact: true }).click();
      // Real application and signed webhook path, with the sandbox provider; no real money.
      await buyer.getByRole('button', { name: 'Approve', exact: true }).click(); await buyer.getByRole('heading', { name: 'Thank you', exact: true }).waitFor();
      expect((await billingAdmin(cloud).get(`/invoices/${invoiceId}`)).body.status).toBe('paid');
      expect(await cloud.db.platform(q => paidPurchaseEligible(q, client.body.id))).toBe(false); // Production excludes the simulated payment.
      expect(await cloud.db.platform(q => paidPurchaseEligible(q, client.body.id, true))).toBe(true); // Explicit synthetic fixture only.
      await buyer.goto(gateway.url); await buyer.getByRole('link', { name: 'Set up a purchased account', exact: true }).click(); await scan(buyer);
      await buyer.getByLabel('Owner email', { exact: true }).fill(email); await buyer.getByRole('button', { name: 'Email my setup link', exact: true }).click(); await buyer.getByRole('status').filter({ hasText: 'eligible paid purchase' }).waitFor();
      const invite = sent.find(message => message.to === email && message.subject.startsWith('Set up your')); expect(invite).toBeTruthy(); expect(workspaces).toHaveLength(pendingCount);
      await buyer.goto(setupUrl(invite.body)); await buyer.getByLabel('Username', { exact: true }).fill('assigned.owner'); await buyer.getByLabel('Choose a password', { exact: true }).fill(ownerPassword); await buyer.getByLabel('Confirm password', { exact: true }).fill(ownerPassword); await buyer.getByRole('button', { name: 'Create my workspace', exact: true }).click(); await buyer.getByRole('status').filter({ hasText: 'This username is taken' }).waitFor();
      await buyer.getByLabel('Username', { exact: true }).fill('purchased.owner'); await buyer.getByRole('button', { name: 'Create my workspace', exact: true }).click(); await buyer.waitForURL('**/signin/');
      await buyer.goto(gateway.url); await buyer.getByLabel('Username or email', { exact: true }).fill('purchased.owner'); await buyer.getByLabel('Password', { exact: true }).fill(ownerPassword); await buyer.getByRole('button', { name: 'Sign in', exact: true }).click(); await buyer.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      const state = (await buyer.evaluate(() => (window as any).mansora.invoke('app.state'))).data; expect(state.business.name).toBe('Purchased shop'); expect(state.user.role).toBe('owner');
      const saved = await buyer.evaluate(() => (window as any).mansora.invoke('staff.save', { name: 'Purchased shop team', username: 'purchased.cashier', role: 'cashier', email: 'purchased-team@example.test' })); expect(saved.ok).toBe(true);
      expect((await buyer.evaluate((id: string) => (window as any).mansora.invoke('staff.invite', { userId: id }), saved.data.id)).ok).toBe(true);
      expect((await buyer.evaluate(() => (window as any).mansora.invoke('product.list'))).data).toEqual([]);
      const replay = await call('/onboarding/complete', { token: new URL(setupUrl(invite.body)).hash.slice(7), password: ownerPassword, username: 'purchased.owner' }); expect(replay.status).toBe(410);
      expect(errors).toEqual([]);
    } finally { await buyer.context().close(); }
  });
  it('rechecks purchase eligibility when an emailed setup link is redeemed after a refund', async () => {
    const email = 'refunded-purchaser@example.test';
    const client = await cloud.api('POST', '/v1/admin/clients', { name: 'Refunded purchase', ownerName: 'Refunded Owner', email });
    const plan = await mkPlan(cloud); const { invoiceId } = await subscribe(cloud, client.body.id, plan);
    const payLink = (await billingAdmin(cloud).post(`/invoices/${invoiceId}/link`)).body.url;
    const start = await fetch(payLink + '/start', { method: 'POST', redirect: 'manual' }); expect(start.status).toBe(303);
    const approve = await fetch(start.headers.get('location')! + '/approve', { method: 'POST', redirect: 'manual' }); expect(approve.status).toBe(303);
    expect((await call('/api/v1/accounts/purchased-setup', { email })).status).toBe(202);
    const invite = sent.find(message => message.to === email && message.subject.startsWith('Set up your')); expect(invite).toBeTruthy();
    const [payment] = await cloud.db.platform(q => q('SELECT id FROM billing_payments WHERE tenant_id = $1', [client.body.id]));
    expect((await billingAdmin(cloud).post(`/payments/${payment.id}/refund`, { amount: 1, reason: 'Synthetic purchase eligibility regression', viaProvider: false })).status).toBe(200);
    const before = workspaces.length, token = new URLSearchParams(new URL(setupUrl(invite.body)).hash.slice(1)).get('token');
    const blocked = await call('/onboarding/complete', { token, password: ownerPassword, username: 'refunded.owner' });
    expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('PURCHASE_REQUIRED'); expect(workspaces).toHaveLength(before);
    expect(await cloud.db.platform(q => q('SELECT id FROM devices WHERE tenant_id = $1', [client.body.id]))).toHaveLength(0);
  });

});
