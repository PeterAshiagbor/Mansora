import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { serveStatic } from '../../scripts/static';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/admin-web/dist/index.html')))('public demo request to administrator Leads', () => {
  let cloud: Cloud, web: Awaited<ReturnType<typeof serveStatic>>, browser: any, page: any;
  const name = '<img src=x onerror=alert(1)> Prospect';
  beforeAll(async () => {
    cloud = await startCloud(); web = await serveStatic(join(import.meta.dirname, '../../apps/admin-web/dist'), 0, { '/config.js': 'window.MANSORA_API_URL = "/api";' });
    browser = await pw.chromium.launch(); page = await browser.newPage(); page.setDefaultTimeout(10_000);
  });
  afterAll(async () => { await browser?.close(); if (web) await new Promise<void>(r => web.server.close(() => r())); await cloud?.close(); });
  it('submits the real public form, safely displays the prospect and saves its manual status', async () => {
    await page.goto(cloud.url + '/v1/public/demo-request-form');
    await page.getByLabel('Your name', { exact: true }).fill(name); await page.getByLabel('Business name', { exact: true }).fill('Lead test business');
    await page.getByLabel('Email', { exact: true }).fill('browser-prospect@example.test');
    await page.getByLabel('I agree that Mansora may contact me about this request.', { exact: true }).check();
    await page.getByRole('button', { name: 'Request demo', exact: true }).click();
    await page.getByRole('heading', { name: 'Request received', exact: true }).waitFor();
    await page.route('**/api/**', async (route: any) => {
      const req = route.request(), target = cloud.url + new URL(req.url()).pathname.slice(4) + new URL(req.url()).search;
      const response = await fetch(target, { method: req.method(), headers: { ...(req.headers().authorization ? { authorization: req.headers().authorization } : {}), ...(req.postData() ? { 'content-type': 'application/json' } : {}) }, ...(req.postData() ? { body: req.postData() } : {}) });
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    await page.goto(web.url); await page.getByLabel('Email', { exact: true }).fill(ADMIN.email); await page.getByLabel('Password', { exact: true }).fill(ADMIN.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(page, 'Leads'); await page.getByRole('cell', { name, exact: true }).waitFor();
    expect(await page.locator('#workspace-main img').count()).toBe(0);
    await page.getByRole('cell', { name, exact: true }).click();
    await page.getByRole('dialog', { name: 'Demo request', exact: true }).getByLabel('Lead status', { exact: true }).selectOption('qualified');
    await expect.poll(async () => (await cloud.api('GET', '/v1/admin/leads?status=qualified')).body.rows.length).toBe(1);
    // PR-03: record a call; it appears on the timeline.
    const dialog = page.getByRole('dialog', { name: 'Demo request', exact: true });
    await dialog.getByLabel('Details', { exact: true }).fill('Called; demo booked for Friday');
    await dialog.getByRole('button', { name: 'Record', exact: true }).click();
    await dialog.getByRole('cell', { name: 'Called; demo booked for Friday', exact: true }).waitFor();
    await dialog.getByRole('cell', { name: 'Acknowledgement to prospect', exact: true }).waitFor();
    expect((await cloud.api('GET', '/v1/admin/clients')).body).toHaveLength(0);
    // PR-04: explicit conversion of the qualified lead.
    await dialog.getByRole('button', { name: 'Convert to client', exact: true }).click();
    await dialog.getByLabel(/I have confirmed these details/).check();
    await dialog.getByRole('button', { name: 'Approve and convert', exact: true }).click();
    await dialog.getByText(/Converted to a client on/).waitFor();
    expect((await cloud.api('GET', '/v1/admin/clients')).body).toHaveLength(1);
  });
});
