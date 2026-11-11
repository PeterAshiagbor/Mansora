// Shared-browser import/request/header guards do not change the native Electron IPC allowlist.
// Railway binds DATABASE_URL, RAILWAY_PUBLIC_DOMAIN/STAGING_ORIGIN, STAGING_TESTER_EMAILS/STAGING_TESTER_PASSWORDS and /data.
// Email aliases exist only in the staging HTTP gateway; native bridge capabilities remain unchanged.
// Resend delivery is server-only (RESEND_API_KEY/FROM_EMAIL/REPLY_TO,
// PLATFORM_ALERT_EMAIL and the team-test RESEND_ALLOWED_RECIPIENTS); none enters IPC.
// Explicit tester invitations use STAGING_TESTER_INVITATION_ID server-side only.
/**
 * Launches the PACKAGED desktop application and checks the security shell:
 * the window opens on the activation screen, the page has no Node access,
 * only the narrow `mansora` bridge is exposed, and the engine refuses
 * unauthenticated and unknown commands.
 *
 * Run on Windows after `npm run dist -w @mansora/desktop` (CI does this).
 * Team-staging variables and its HTTP-only browser transport do not extend this
 * native bridge: the exact allowlist below must remain unchanged.
 * It needs a desktop session and OS key storage, so it is not part of `npm test`.
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';

const release = join(import.meta.dirname, '..', '..', 'apps', 'desktop', 'release');
const unpacked = readdirSync(release).map((d) => join(release, d)).find((d) => /-unpacked$/.test(d));
if (!unpacked) throw new Error('No unpacked build found. Run the dist script first.');
const exe = readdirSync(unpacked).map((f) => join(unpacked, f)).find((f) => (process.platform === 'win32' ? /\.exe$/i.test(f) && !/uninstall/i.test(f) : !/\./.test(f.split(/[\\/]/).pop()) && existsSync(f) && /mansora/i.test(f)));
if (!exe) throw new Error(`No application executable in ${unpacked}`);

const app = await _electron.launch({ executablePath: exe, args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'mansora-smoke-'))}`] });
try {
  const win = await app.firstWindow();
  await win.getByText('Activate this laptop').waitFor({ timeout: 60_000 });
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
    if (!ok) process.exitCode = 1;
  };
  check('window title', (await win.title()).includes('Mansora'));
  check('no Node.js in the page', (await win.evaluate(() => `${typeof window.require}/${typeof window.process}/${typeof window.module}`)) === 'undefined/undefined/undefined');
  check('bridge exposes only the agreed calls', (await win.evaluate(() => Object.keys(window.mansora).sort().join(','))) === 'invoke,openExternal,print,restore,saveFile,savePdf');
  const state = await win.evaluate(() => window.mansora.invoke('app.state'));
  check('engine answers, laptop not yet activated', state.ok && state.data.business.activated === false, JSON.stringify(state.data?.appVersion));
  check('unauthenticated command refused', (await win.evaluate(() => window.mansora.invoke('product.list'))).error?.code === 'NOT_SIGNED_IN');
  check('unknown command refused', (await win.evaluate(() => window.mansora.invoke('sale.delete'))).error?.code === 'UNKNOWN_COMMAND');
  check('navigation away is blocked', await win.evaluate(() => { location.href = 'https://example.com/'; return new Promise((r) => setTimeout(() => r(location.protocol === 'file:'), 1500)); }));
} finally {
  await app.close();
}
