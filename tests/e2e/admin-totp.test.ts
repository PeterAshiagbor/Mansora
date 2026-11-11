import { navigate } from './navigation';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app';
import { totpCode } from '../../apps/api/src/security';
import { serveStatic } from '../../scripts/static';
import { ADMIN, startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';

// Same optional browser prerequisite as the existing UI suite; CI installs it.
const require = createRequire(import.meta.url);
let pw: any;
try { pw = require('playwright'); } catch { /* available in CI or via NODE_PATH */ }
const dist = join(import.meta.dirname, '../../apps/admin-web/dist');

describe.skipIf(!pw || !existsSync(join(dist, 'index.html')))('administrator TOTP through the dashboard', () => {
  let cloud: Cloud, browser: any, page: any, app: Awaited<ReturnType<typeof buildApp>>;
  let web: Awaited<ReturnType<typeof serveStatic>>;
  let oldKey: string | undefined;
  const errors: string[] = [];
  beforeAll(async () => {
    oldKey = process.env.ADMIN_TOTP_KEY;
    process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
    cloud = await startCloud();
    web = await serveStatic(dist, 0, { '/config.js': `window.MANSORA_API_URL = ${JSON.stringify(cloud.url)};` });
    await cloud.app.close();
    app = await buildApp({ db: cloud.db, backupDir: tempDir(), adminOrigins: [web.url] });
    await app.listen({ port: Number(new URL(cloud.url).port), host: '127.0.0.1' });
    browser = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(20_000);
    page.on('pageerror', (error: Error) => errors.push(error.message));
  });
  afterAll(async () => {
    await browser?.close();
    await app?.close();
    if (web) await new Promise<void>((resolve) => web.server.close(() => resolve()));
    await cloud?.db.close();
    if (oldKey === undefined) delete process.env.ADMIN_TOTP_KEY;
    else process.env.ADMIN_TOTP_KEY = oldKey;
  });
  const passwordLogin = async () => {
    await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  it('enrols, shows recovery codes once, challenges password login and disables with reauthentication', async () => {
    await page.goto(web.url);
    await passwordLogin();
    await navigate(page, 'Account security');
    await page.getByLabel('Current password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    const secret = await page.getByTestId('totp-secret').innerText();
    await page.getByLabel('Authenticator code', { exact: true }).fill('000000');
    // Generate a definitely incorrect six-digit code for this secret/window.
    const valid = new Set([-1, 0, 1].map((skew) => totpCode(secret, Date.now() + skew * 30_000)));
    const wrong = Array.from({ length: 10 }, (_, i) => String(i).padStart(6, '0')).find((value) => !valid.has(value))!;
    await page.getByLabel('Authenticator code', { exact: true }).fill(wrong);
    await page.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
    await page.getByText('Incorrect, expired or already used code', { exact: true }).waitFor();
    await page.getByLabel('Authenticator code', { exact: true }).fill(totpCode(secret));
    await page.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
    await page.getByTestId('totp-recovery-codes').waitFor();
    const recoveryCodes = await page.getByTestId('totp-recovery-codes').getByRole('listitem').allTextContents();
    expect(recoveryCodes).toHaveLength(10);
    await page.getByRole('button', { name: 'I have saved my recovery codes' }).click();
    expect(await page.getByTestId('totp-recovery-codes').count()).toBe(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await passwordLogin();
    await page.getByRole('heading', { name: 'Two-factor verification' }).waitFor();
    expect(await page.evaluate(() => sessionStorage.getItem('mansora-admin-token'))).toBeNull();
    await page.getByLabel('Authenticator or recovery code').fill(totpCode(secret, Date.now() + 30_000));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await navigate(page, 'Account security');
    await page.getByRole('button', { name: 'Disable two-factor authentication', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Current password').fill(ADMIN.password);
    await dialog.getByLabel('Authenticator or recovery code').fill(recoveryCodes[0]);
    await dialog.getByRole('button', { name: 'Confirm disable' }).click();
    await page.getByRole('heading', { name: 'Administrator sign in' }).waitFor();
    await passwordLogin();
    await navigate(page, 'Account security');
    await page.getByText('Not enabled', { exact: true }).waitFor();
    expect(errors).toEqual([]);
  });
});
