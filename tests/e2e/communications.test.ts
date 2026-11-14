import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { ResendEmail } from '../../apps/api/src/email';
import { serveStatic } from '../../scripts/static';
import { tempDir } from '../helpers';
import { navigate } from './navigation';
import { ADMIN, startCloud, type Cloud } from '../cloud';

const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
describe.skipIf(!pw || !existsSync(join(root, 'apps/admin-web/dist/index.html')))('administrator service email through the real API', () => {
  let cloud: Cloud, app: Awaited<ReturnType<typeof buildApp>>, web: Awaited<ReturnType<typeof serveStatic>>, browser: any, page: any;
  const sent: any[] = [], errors: string[] = [];
  beforeAll(async () => {
    cloud = await startCloud();
    const client = await cloud.createClient('Email browser fixture');
    await cloud.db.platform(q => q('UPDATE tenants SET email = $2 WHERE id = $1', [client.id, 'fixture@example.test']));
    cloud.billing.email = new ResendEmail({ apiKey: 'test-only', from: 'sender@example.test', fetch: (async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: 'synthetic-provider-id' })); }) as typeof fetch });
    web = await serveStatic(join(root, 'apps/admin-web/dist'), 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close();
    app = await buildApp({ db: cloud.db, billing: cloud.billing, backupDir: tempDir(), adminOrigins: [web.url] });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    browser = await pw.chromium.launch(); page = await browser.newPage();
    page.on('pageerror', (e: Error) => errors.push(e.message));
  });
  afterAll(async () => { await browser?.close(); await app?.close(); if (web) await new Promise<void>(resolve => web.server.close(() => resolve())); await cloud?.close(); });
  it('preserves a failed message draft, then queues once and shows provider acceptance', async () => {
    await page.goto(web.url);
    await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(page, 'Collections');
    await page.getByRole('tab', { name: 'Messages', exact: true }).click();
    await page.getByRole('button', { name: 'Write client message', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Write client message', exact: true });
    await modal.getByLabel('Client', { exact: true }).selectOption({ label: 'Email browser fixture' });
    await modal.getByLabel('Subject', { exact: true }).fill('Service availability update');
    await modal.getByLabel('Message', { exact: true }).fill('Synthetic service message, no real recipient.');
    let refused = false;
    await page.route('**/v1/admin/billing/notifications', (route: any) => {
      if (route.request().method() === 'POST' && !refused) { refused = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary queue failure' }) }); }
      return route.continue();
    });
    await modal.getByRole('button', { name: 'Queue message', exact: true }).click();
    await modal.getByText('Temporary queue failure', { exact: true }).waitFor();
    expect(await modal.getByLabel('Subject', { exact: true }).inputValue()).toBe('Service availability update');
    await modal.getByRole('button', { name: 'Queue message', exact: true }).click();
    await modal.waitFor({ state: 'detached' });
    await page.getByRole('cell', { name: 'Service availability update', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Process queued email', exact: true }).click();
    await page.getByText('Accepted by Resend', { exact: false }).waitFor();
    expect(sent).toHaveLength(1); expect(sent[0].to).toEqual(['fixture@example.test']);
    const rows = await cloud.db.platform(q => q("SELECT id, status FROM notifications WHERE subject = 'Service availability update'"));
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('sent'); expect(errors).toEqual([]);
  });
});
