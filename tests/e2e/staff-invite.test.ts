import { navigate } from './navigation';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/desktop/dist/renderer/index.html')))('staff sign-in details by email, in the browser', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
  const dir = tempDir('mansora-staff-invite-');
  const owner = { name: 'Invite Owner', username: 'owner', password: randomUUID() };
  const sent: any[] = [];
  const errors: string[] = [];
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Invite browser shop');
    cloud.billing.email = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: 'msg' }; }) };
    host = await startDevHost({ dataDir: dir, port: 0, dbKey: randomUUID() });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Invite laptop', owner });
    browser = await pw.chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage(); page.setDefaultTimeout(10_000);
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(owner.username);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>((resolve) => host.server.close(() => resolve())); host.engine.db.close(); }
    await cloud?.close(); rmSync(dir, { recursive: true, force: true });
  });

  it('owner adds staff with only an email; the new cashier sets their own password from the code and signs in', async () => {
    await navigate(page, 'Staff');
    await page.getByRole('button', { name: 'Add staff member', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add staff member', exact: true });
    await form.getByLabel('Full name', { exact: true }).fill('Efua Owusu');
    await form.getByLabel('Username', { exact: true }).fill('efua');
    await form.getByLabel('Email (optional)', { exact: true }).fill('efua@example.test');
    await form.getByRole('button', { name: 'Save and email code', exact: true }).click();
    await page.getByText(/Sign-in code emailed to e\*+@example\.test/).waitFor();
    await page.getByText(/Code sent, valid until/).waitFor();
    expect(sent).toHaveLength(1);
    const code = /code: ([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(sent[0].body)![1];

    await page.getByRole('button', { name: 'Lock / sign out', exact: true }).click();
    await page.getByRole('button', { name: 'I have a sign-in code', exact: true }).click();
    const setup = page.getByRole('form', { name: 'Use a sign-in code' });
    await setup.getByLabel('Username', { exact: true }).fill('efua');
    await setup.getByLabel('Sign-in code', { exact: true }).fill(code);
    await setup.getByLabel('New password', { exact: true }).fill('efua-chooses-this-1');
    await setup.getByLabel('Repeat new password', { exact: true }).fill('efua-chooses-this-1');
    await setup.getByRole('button', { name: 'Set my password', exact: true }).click();
    await page.getByText('Password set. Sign in above as "efua" with your new password.', { exact: true }).waitFor();
    await page.getByLabel('Password', { exact: true }).fill('efua-chooses-this-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    expect(errors).toEqual([]);
  });
});
