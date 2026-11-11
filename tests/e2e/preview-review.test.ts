import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { serveStatic } from '../../scripts/static';

const require = createRequire(import.meta.url);
const pw = (() => { try { return require('playwright'); } catch { return null; } })();
const root = join(import.meta.dirname, '../..');
const built = existsSync(join(root, 'apps/admin-web/dist/index.html')) && existsSync(join(root, 'apps/desktop/dist/renderer/index.html'));
describe.skipIf(!pw || !built)('generated preview on phone screens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mansora-preview-review-'));
  let web: Awaited<ReturnType<typeof serveStatic>>, browser: any, page: any;
  const errors: string[] = [];
  beforeAll(async () => {
    execFileSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/build-interface-demo.ts', dir], { cwd: root, timeout: 60_000, stdio: 'pipe' });
    web = await serveStatic(join(dir, 'dist'), 0);
    browser = await pw.chromium.launch();
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page.on('pageerror', (error: Error) => errors.push(error.message));
    // Walkthrough fonts must have a usable fallback without external network access.
    await page.route('https://**/*', (route: any) => route.abort());
  }, 90_000);
  afterAll(async () => {
    await browser?.close();
    if (web) await new Promise<void>(resolve => web.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  for (const [path, destination] of [['client', 'Products'], ['admin', 'Clients']]) {
    it(`${path} keeps navigation, page content and keyboard focus usable at 390px`, async () => {
      await page.goto(`${web.url}/${path}/index.html`);
      const toggle = page.getByRole('button', { name: 'Menu', exact: true });
      await toggle.waitFor();
      const nav = page.getByRole('navigation', { name: 'Main' });
      expect(await nav.isVisible()).toBe(false);
      await toggle.click();
      expect(await nav.isVisible()).toBe(true);
      await page.keyboard.press('Escape');
      expect(await toggle.evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
      expect(await nav.isVisible()).toBe(false);
      await toggle.click();
      await nav.getByRole('button', { name: destination, exact: true }).click();
      await page.getByRole('heading', { name: destination, exact: true }).waitFor();
      expect(await nav.isVisible()).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter((v: any) => ['serious', 'critical'].includes(v.impact)));
      expect(violations).toEqual([]);
      await page.setViewportSize({ width: 1366, height: 768 });
      await nav.waitFor({ state: 'visible' });
      expect(await toggle.isVisible()).toBe(false);
      await page.setViewportSize({ width: 390, height: 844 });
    });
  }
  it('walkthrough declares its language and viewport and preserves screenshot keyboard dismissal', async () => {
    await page.goto(`${web.url}/walkthrough/index.html`);
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('width=device-width');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const shot = page.locator('button.zoom').first();
    await shot.click();
    expect(await page.getByRole('dialog').isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.getByRole('dialog').isVisible()).toBe(false);
    expect(errors).toEqual([]);
  });
});
