import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { OWNER, tempDir } from '../helpers';
import { startDevHost } from '../../apps/desktop/dev/host';
import { navigate } from './navigation';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
describe.skipIf(!pw || !existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html')))('Report a problem, pointing at the screen', () => {
  let cloud: Cloud, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
  beforeAll(async () => {
    cloud = await startCloud(); const client = await cloud.createClient('Report test shop');
    host = await startDevHost({ dataDir: tempDir(), port: 0 });
    await host.engine.execute(null, 'activation.activate', { apiUrl: cloud.url, code: client.code, deviceName: 'Report test', owner: OWNER });
    browser = await pw.chromium.launch(); page = await browser.newPage(); page.setDefaultTimeout(10_000);
    await page.goto(host.url);
    await page.getByLabel('Username', { exact: true }).fill(OWNER.username); await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigate(page, 'Products');
  });
  afterAll(async () => { await browser?.close(); if (host) { await new Promise<void>(r => host.server.close(() => r())); host.engine.db.close(); } await cloud?.close(); });

  it('stays on every page, lets the person point at a part of the screen, and sends the report', async () => {
    const open = page.getByRole('button', { name: 'Report a problem to Mansora', exact: true }).first();
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Tell Mansora about a problem', exact: true });
    await dialog.getByLabel('What happened?').fill('The add product button did nothing');
    await dialog.getByLabel('It stops my work').check();
    await dialog.getByRole('button', { name: 'Point to it on the screen', exact: true }).click();
    await page.getByText('Click the part of the screen this is about.').waitFor();
    // Clicking a real control while pointing selects it and does not run it.
    const before = await page.getByRole('dialog').count();
    await page.getByRole('heading', { name: 'Products', exact: true }).click();
    await dialog.waitFor();
    expect(before).toBe(0);
    await dialog.getByText('Pointing at:').waitFor();
    expect(await dialog.innerText()).toContain('Products');
    await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
    await dialog.getByText('Your report was sent').waitFor();
    const [row] = await cloud.db.platform((q) => q(`SELECT * FROM bug_reports`));
    expect(row).toMatchObject({ source: 'shop', severity: 'blocking', page: 'Products', reporter_role: 'owner', description: 'The add product button did nothing' });
    expect(row.area.label).toBe('Products');
    expect(row.area.viewport).toMatch(/^\d+x\d+$/);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await navigate(page, 'Dashboard');
    await open.waitFor(); // still there on another page
  });

  it('keeps the text when the report cannot be sent', async () => {
    await page.route('**/invoke', (route: any) => route.request().postDataJSON()?.command === 'bug.report' ? route.fulfill({ status: 200, json: { ok: false, error: { code: 'OFFLINE', message: 'The report could not be sent because the internet is not available.' } } }) : route.continue());
    await page.getByRole('button', { name: 'Report a problem to Mansora', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Tell Mansora about a problem', exact: true });
    await dialog.getByLabel('What happened?').fill('Offline draft text');
    await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
    await dialog.getByText('internet is not available').waitFor();
    expect(await dialog.getByLabel('What happened?').inputValue()).toBe('Offline draft text');
    await page.unroute('**/invoke');
  });
});
