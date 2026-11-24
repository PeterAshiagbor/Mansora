/** Authenticated browser transport for the native engine and public sign-in. */
import { findLoginAccounts, normaliseLogin, publicLogin, usernameTaken } from './login-directory';
import { signInHtml, signInCss, signInScript, purchasedSetupHtml, purchasedSetupScript, staffSetupHtml, staffSetupScript } from './sign-in-page';
import { verifyLoginPassword } from '../../apps/api/src/security';
import { clientAddress, trustedProxyMatcher, type DeploymentMode } from './gateway-policy';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { can, DomainError } from '@mansora/domain';
import type { OwnerRecovery } from './owner-recovery';
import { recoveryHtml, recoveryScript } from './recovery-page';
import type { WorkspaceOnboarding } from './workspace-onboarding';
import { HttpError as ApiHttpError } from '../../apps/api/src/security';
import { onboardingHtml, onboardingCss, onboardingScript } from './onboarding-page';
import { guardSpreadsheet, SpreadsheetGuardError } from './import-guard';
import type { Engine } from '../../apps/desktop/src/core';

export interface StagingWorkspace { id: string; label: string; engine: Engine }
export interface GatewayOptions {
  origin: string; apiUrl: string; workspaces: StagingWorkspace[];
  clientDir: string; adminDir: string; port?: number; host?: string;
  loginAliases?: Record<string, Record<string, string>>; readiness?: () => Promise<boolean>;
  ownerRecovery?: Pick<OwnerRecovery, 'available' | 'request' | 'complete'>;
  onboarding?: Pick<WorkspaceOnboarding, 'details' | 'complete'> & Partial<Pick<WorkspaceOnboarding, 'usernameReserved'>>;
  mode?: DeploymentMode; testWorkspaceIds?: string[]; trustedProxies?: string[];
  onProxyPeer?: (peer: string, source: 'socket' | 'forwarded') => void;
  vatFeaturePolicy?: (tenantId: string) => Promise<unknown>;
  adminIdentityExists?: (email: string) => Promise<boolean>;
  /** Stored password hash of an active administrator, or null. Lets one sign-in form tell a shared email's accounts apart. */
  adminPasswordHash?: (email: string) => Promise<string | null>;
  maxConcurrentPerWorkspace?: number; maxConcurrentImports?: number;
  maxConcurrentRequests?: number;
  maxBodyBytes?: number; sessionTtlMs?: number; now?: () => number;
}
/** Every signed-in shop user works here; the shop comes from their session, never from the address. */
export const APP = '/app/';
export const SIGN_IN = '/signin/';
class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
export function stagingOrigin(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('STAGING_ORIGIN must be an HTTPS origin; HTTP is allowed only on loopback for tests.');
  return url;
}
async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > limit) { req.resume(); throw new HttpError(413, 'BODY_TOO_LARGE', 'This upload exceeds the request limit.'); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > limit) throw new HttpError(413, 'BODY_TOO_LARGE', 'This upload exceeds the request limit.'); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
function file(root: string, name: string): string | null {
  const base = resolve(root), path = resolve(base, name);
  return path.startsWith(base + sep) && existsSync(path) && statSync(path).isFile() && !!MIME[extname(path)] ? path : null;
}
const BANNER = '<div class="staging-notice" role="note">TEAM TEST ENVIRONMENT · Use sample data only. Changes are saved and shared with your team.</div>';
const STYLE = '.staging-notice{height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0 12px;background:#fff4d6;color:#633c04;font:12px/1.4 system-ui;text-align:center}html,body{height:100%;margin:0}body{display:flex!important;flex-direction:column!important}body>#root{height:100dvh!important;min-height:0;flex:1}body>.staging-notice~#root{height:calc(100dvh - 36px)!important}';
export async function startStagingGateway(opts: GatewayOptions) {
  let origin = stagingOrigin(opts.origin);
  const upstream = new URL(opts.apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') throw new Error('API upstream must be a fixed HTTP(S) origin.');
  if ((!opts.workspaces.length && opts.mode !== 'client') || opts.workspaces.length > 10 || opts.workspaces.some(w => !/^[a-z0-9][a-z0-9-]{1,40}$/.test(w.id)) || new Set(opts.workspaces.map(w => w.id)).size !== opts.workspaces.length) throw new Error('Configure distinct staging workspaces before starting.');
  if (!file(opts.clientDir, 'index.html') || !file(opts.adminDir, 'index.html')) throw new Error('Build both interfaces before starting staging.');
  for (const w of opts.workspaces) if (!w.engine.activated) throw new Error(`Workspace ${w.id} is not provisioned.`);
  const workspaces = new Map(opts.workspaces.map(w => [w.id, w]));
  let activeRequests = 0, activeImports = 0, snapshotPaused = false;
  const workspaceRequests = new Map<string, number>(), workspaceImports = new Map<string, number>();
  const trusted = trustedProxyMatcher(opts.trustedProxies), observedPeers = new Set<string>();
  const tests = new Set(opts.testWorkspaceIds ?? []);
  const notice = (workspace?: string) => opts.mode !== 'client' || (workspace && tests.has(workspace)) ? BANNER : '';
  const withNotice = (html: string, workspace?: string) => html.replace('<body>', '<body>' + notice(workspace));
  const sessions = new Map<string, { workspace: string; token: string; expires: number }>();
  const budgets = new Map<string, { count: number; expires: number }>();
  const now = opts.now ?? Date.now, limit = opts.maxBodyBytes ?? 16 * 1024 * 1024;
  const cookieName = origin.protocol === 'https:' ? '__Secure-mansora-stage' : 'mansora-stage';
  const clear = (id?: string) => { if (!id) return; const s = sessions.get(id); if (s) workspaces.get(s.workspace)?.engine.endSession(s.token); sessions.delete(id); };
  const sessionId = (req: IncomingMessage) => req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const cookie = (res: ServerResponse, _workspace: string, id: string | null) => res.setHeader('set-cookie', `${cookieName}=${id ?? ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${id ? Math.floor((opts.sessionTtlMs ?? 12 * 3_600_000) / 1000) : 0}${origin.protocol === 'https:' ? '; Secure' : ''}`);
  const budget = (key: string, count: number, ms: number) => {
    if (budgets.size > 2000) for (const [k, b] of budgets) if (b.expires <= now()) budgets.delete(k);
    if (!budgets.has(key) && budgets.size > 2000) throw new HttpError(429, 'TRY_LATER', 'Too many sign-in attempts. Please wait.');
    const current = budgets.get(key); const next = current && current.expires > now() ? current : { count: 0, expires: now() + ms }; budgets.set(key, next);
    if (++next.count > count) throw new HttpError(429, 'TRY_LATER', 'Too many sign-in attempts. Please wait before trying again.');
  };
  const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const signInSession = (req: IncomingMessage, res: ServerResponse, workspace: StagingWorkspace, token: string) => {
    for (const [key, old] of sessions) if (old.expires <= now()) clear(key);
    if (sessions.size >= 500) { workspace.engine.endSession(token); throw new HttpError(503, 'SESSIONS_FULL', 'Sign-in is busy. Please try later.'); }
    clear(sessionId(req));
    const id = randomBytes(32).toString('hex');
    sessions.set(id, { workspace: workspace.id, token, expires: now() + (opts.sessionTtlMs ?? 12 * 3_600_000) });
    cookie(res, workspace.id, id);
  };
  const adminSignIn = async (path: string, input: unknown, address: string) => {
    const response = await fetch(new URL(path, upstream), { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': address }, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
    const data = await response.json() as any;
    if (!response.ok) throw new HttpError(response.status, response.status === 401 ? 'INVALID_CREDENTIALS' : data.code ?? 'SIGN_IN_UNAVAILABLE', response.status === 401 ? 'Incorrect username or password.' : response.status === 429 ? 'Too many sign-in attempts. Please wait and try again.' : 'Sign-in is temporarily unavailable. Please try again.');
    return data.requiresTotp ? { requiresTotp: true, challenge: data.challenge, expiresAt: data.expiresAt } : { platform: 'admin', token: data.token };
  };
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('x-frame-options', 'DENY');
    res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive'); res.setHeader('permissions-policy', 'geolocation=(), microphone=(), camera=(self)' /* camera: barcode scanning, C57 */); res.setHeader('cross-origin-resource-policy', 'same-origin');
    if (origin.protocol === 'https:') res.setHeader('strict-transport-security', 'max-age=31536000');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const counted = req.url !== '/healthz'; let admitted = false, workspaceAdmitted: string | undefined;
    try {
      const client = clientAddress(req, trusted);
      if (req.headers['x-real-ip'] && !observedPeers.has(client.peer) && observedPeers.size < 10) { observedPeers.add(client.peer); opts.onProxyPeer?.(client.peer, client.source); }
      if (counted && snapshotPaused) { res.setHeader('retry-after', '2'); throw new HttpError(503, 'SERVER_BUSY', 'A protected recovery snapshot is being prepared. Please retry shortly.'); }
      if (counted && activeRequests >= (opts.maxConcurrentRequests ?? 16)) { res.setHeader('retry-after', '2'); throw new HttpError(503, 'SERVER_BUSY', 'Mansora is busy. Please retry shortly.'); }
      if (counted) { activeRequests++; admitted = true; }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new HttpError(400, 'BAD_REQUEST', 'Invalid request path.');
      const url = new URL(req.url, origin);
      let path: string; try { path = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'BAD_REQUEST', 'Invalid request path.'); }
      if (path.includes('\\') || path.includes('\0')) throw new HttpError(400, 'BAD_REQUEST', 'Invalid request path.');
      if (req.method === 'GET' && path === '/') { const current = sessions.get(sessionId(req) ?? ''); res.writeHead(302, { location: current && current.expires > now() ? APP : SIGN_IN }); res.end(); return; }
      if (req.method === 'GET' && ['/signup/', '/signup/app.js'].includes(path)) { res.writeHead(200, { 'content-type': path.endsWith('.js') ? MIME['.js'] : MIME['.html'] }); res.end(path.endsWith('.js') ? purchasedSetupScript : purchasedSetupHtml); return; }
      if (req.method === 'GET' && ['/staff-setup/', '/staff-setup/app.js'].includes(path)) { res.writeHead(200, { 'content-type': path.endsWith('.js') ? MIME['.js'] : MIME['.html'] }); res.end(path.endsWith('.js') ? staffSetupScript : staffSetupHtml); return; }
      if (req.method === 'GET' && ['/signin', '/signin/', '/signin/style.css', '/signin/app.js'].includes(path)) {
        if (path === '/signin') { res.writeHead(308, { location: '/signin/' }); res.end(); return; }
        const asset = path.endsWith('.css') ? [MIME['.css'], signInCss] : path.endsWith('.js') ? [MIME['.js'], signInScript] : [MIME['.html'], signInHtml];
        res.writeHead(200, { 'content-type': asset[0] }); res.end(asset[1]); return;
      }
      if (['/signin/login', '/signin/totp', '/signin/accept-invite', '/signin/forgot'].includes(path)) {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST to sign in.');
        if (req.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_DENIED', 'Open the sign-in page directly.');
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send application/json.');
        budget('signin-ip:' + client.address, 60, 60_000);
        let input: any; try { input = JSON.parse((await body(req, 4096)).toString('utf8')); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'BAD_JSON', 'The sign-in request could not be read.'); }
        if (path === '/signin/totp') {
          if (typeof input?.challenge !== 'string' || input.challenge.length > 100 || typeof input.code !== 'string' || input.code.length > 64) throw new HttpError(400, 'INVALID_INPUT', 'Enter your verification code.');
          budget('signin-factor:' + input.challenge, 20, 15 * 60_000);
          return json(res, 200, { ok: true, data: await adminSignIn('/v1/admin/login/totp', input, client.address) });
        }
        if (path === '/signin/forgot') {
          // Owner password reset from the one sign-in page. The same answer whatever the email, so it reveals no account.
          const generic = { message: 'If this email belongs to a business owner, a private reset link is on its way. Staff: ask your business owner to reset your password.' };
          if (typeof input?.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new HttpError(400, 'INVALID_INPUT', 'Enter the owner email recorded for your business.');
          if (!opts.ownerRecovery?.available()) throw new HttpError(503, 'RECOVERY_UNAVAILABLE', 'Email reset is not available here. Contact Mansora support for help signing in.');
          budget('forgot-ip:' + client.address, 6, 15 * 60_000); budget('forgot-email:' + normaliseLogin(input.email), 3, 15 * 60_000);
          for (const workspace of workspaces.values()) await opts.ownerRecovery.request(workspace.id, input.email);
          return json(res, 202, { ok: true, data: generic });
        }
        const accepting = path === '/signin/accept-invite';
        if (accepting) {
          if (typeof input?.code !== 'string' || input.code.length > 30) throw new HttpError(400, 'INVALID_INPUT', 'Enter your one-time sign-in code.');
          input.password = input.newPassword;
        }
        if (typeof input?.username !== 'string' || !input.username.trim() || input.username.length > 254 || typeof input.password !== 'string' || !input.password || input.password.length > 200) throw new HttpError(400, 'INVALID_INPUT', 'Enter your username and password.');
        if (input.choice !== undefined && (typeof input.choice !== 'string' || input.choice.length > 60)) throw new HttpError(400, 'INVALID_INPUT', 'Choose one of the listed accounts.');
        const username = normaliseLogin(input.username);
        budget('signin-user:' + username, 20, 15 * 60_000);
        // One form for everyone: the username or email and the password find the account. The legacy admin: prefix still works.
        const prefixedAdmin = username.startsWith('admin:'), email = prefixedAdmin ? username.slice(6) : username;
        const shops = prefixedAdmin ? [] : findLoginAccounts(workspaces.values(), opts.loginAliases, username);
        const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const adminHash = !accepting && looksLikeEmail && opts.adminPasswordHash ? await opts.adminPasswordHash(email) : null;
        const adminPossible = !accepting && looksLikeEmail && (adminHash !== null || (opts.adminIdentityExists ? await opts.adminIdentityExists(email) : !shops.length));
        if (accepting && shops.length > 1) { await verifyLoginPassword(input.password); throw new HttpError(401, 'INVALID_CREDENTIALS', 'This username is used in more than one business. Enter the full sign-in shown in your invitation email, for example name@business.'); }
        const signInShop = async (account: (typeof shops)[number]) => {
          budget(`user:${account.workspace.id}:${normaliseLogin(account.username)}`, 20, 15 * 60_000);
          try {
            if (accepting) await account.workspace.engine.execute(null, 'auth.acceptInvite', { username: account.username, code: input.code, newPassword: input.password });
            const data = await account.workspace.engine.execute(null, 'auth.login', { username: account.username, password: input.password });
            signInSession(req, res, account.workspace, data.token);
            return json(res, 200, { ok: true, data: { platform: 'client', url: APP } });
          } catch (error) {
            if (error instanceof DomainError) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
            throw error;
          }
        };
        const signInAdmin = async () => json(res, 200, { ok: true, data: await adminSignIn('/v1/admin/login', { email, password: input.password }, client.address) });
        // A single possible account keeps the normal path, including that account's own lockout after repeated failures.
        if (shops.length + (adminPossible ? 1 : 0) <= 1 && input.choice === undefined) {
          if (shops[0]) return await signInShop(shops[0]);
          if (adminPossible) return await signInAdmin();
          await verifyLoginPassword(input.password);
          throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
        }
        // The same username or email belongs to more than one account (a shared owner email, or a legacy "owner" in two
        // shops). Each account keeps its own password, so the password decides. Checking reads the stored hash only; it
        // does not count as a failed sign-in on accounts the person was not trying to open.
        const matches: { id: string; label: string; open: () => Promise<void> }[] = [];
        for (const account of shops) {
          const row = account.workspace.engine.db.prepare('SELECT password_hash, status FROM users WHERE id = ?').get(account.id) as { password_hash: string; status: string } | undefined;
          if (row?.status === 'active' && await verifyLoginPassword(input.password, row.password_hash)) matches.push({ id: `shop:${account.workspace.id}:${account.id}`, label: account.workspace.label, open: () => signInShop(account) });
        }
        // Two accounts in the same business (a shared staff email) are told apart by their usernames.
        const repeated = new Set(matches.filter((match, index) => matches.findIndex(other => other.label === match.label) !== index).map(match => match.label));
        for (const match of matches) if (repeated.has(match.label)) match.label += ' · ' + shops.find(account => match.id === `shop:${account.workspace.id}:${account.id}`)!.username;
        if (adminPossible && (adminHash === null ? !matches.length : await verifyLoginPassword(input.password, adminHash))) matches.push({ id: 'admin', label: 'Mansora administration', open: signInAdmin });
        if (!matches.length) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
        if (input.choice !== undefined) {
          const chosen = matches.find(match => match.id === input.choice);
          if (!chosen) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
          return await chosen.open();
        }
        if (matches.length === 1) return await matches[0].open();
        // Only someone who has just proved the password sees which of their own accounts it opens.
        return json(res, 200, { ok: true, data: { choose: matches.map(({ id, label }) => ({ id, label })) } });
      }
      if (path.startsWith('/api/')) {
        // The public pay page's form sends the payer on to Paystack's hosted checkout. Browsers apply form-action to that
        // redirect, so payment pages, and only those, also allow Paystack's checkout address.
        if (/^\/api\/pay\/[^/]+(\/start)?$/.test(path)) res.setHeader('content-security-policy', String(res.getHeader('content-security-policy')).replace("form-action 'self'", "form-action 'self' https://checkout.paystack.com"));
        const bytes = ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : await body(req, limit);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (v && !['host', 'cookie', 'connection', 'content-length', 'transfer-encoding', 'proxy-authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'].includes(k)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        // The API trusts only this loopback hop, so its per-address limits see the real client, not 127.0.0.1.
        headers.set('x-forwarded-for', client.address);
        // API sandbox forms carry no fields; avoid an unsupported empty form parser.
        if (bytes?.length === 0 && headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) headers.delete('content-type');
        const target = new URL(upstream); target.pathname = url.pathname.slice(4); target.search = url.search;
        const response = await fetch(target, { method: req.method, headers, ...(bytes ? { body: new Uint8Array(bytes) } : {}), redirect: 'manual', signal: AbortSignal.timeout(30_000) });
        res.statusCode = response.status;
        response.headers.forEach((v, k) => { if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie', 'cache-control'].includes(k)) res.setHeader(k, v); });
        const location = response.headers.get('location');
        if (location?.startsWith('/') && !location.startsWith('/api/')) res.setHeader('location', '/api' + location);
        else if (location && new URL(location, upstream).origin === upstream.origin) { const target = new URL(location, upstream); res.setHeader('location', origin.origin + '/api' + target.pathname + target.search); }
        // The public brand logo and font (used in emails and payment pages) may be cached; everything else stays no-store.
        if (/^\/api\/brand\/[\w.-]+$/.test(path) && response.ok) res.setHeader('cache-control', 'public, max-age=86400');
        const responseBytes = Buffer.from(await response.arrayBuffer());
        if (response.headers.get('content-type')?.includes('text/html')) {
          // Existing API documents/forms use root-relative links; retain the proxy prefix.
          res.end(responseBytes.toString('utf8').replace(/\b(href|src|action)=(['"])\/(?!\/|api\/)/gi, '$1=$2/api/'));
        } else res.end(responseBytes); return;
      }
      if (opts.ownerRecovery && req.method === 'GET' && ['/recovery.js', '/recovery.css'].includes(path)) { res.writeHead(200, { 'content-type': path.endsWith('.css') ? MIME['.css'] : MIME['.js'] }); res.end(path.endsWith('.css') ? onboardingCss : recoveryScript); return; }
      if (opts.onboarding && req.method === 'GET' && ['/onboarding/', '/onboarding.js', '/onboarding.css'].includes(path)) {
        const [type, content] = path.endsWith('.js') ? ['application/javascript; charset=utf-8', onboardingScript] : path.endsWith('.css') ? ['text/css; charset=utf-8', onboardingCss] : [MIME['.html'], onboardingHtml];
        res.writeHead(200, { 'content-type': type }); res.end(path === '/onboarding/' ? withNotice(content) : content); return;
      }
      if (opts.onboarding && ['/onboarding/details', '/onboarding/complete'].includes(path)) {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for workspace setup.');
        if (req.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_DENIED', 'Open the setup link directly.');
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send application/json.');
        budget('setup-ip:' + client.address, 30, 60_000);
        let input: any; try { input = JSON.parse((await body(req, 4096)).toString('utf8')); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'BAD_JSON', 'The setup request could not be read.'); }
        if (typeof input?.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(input.token)) throw new HttpError(410, 'SETUP_LINK_UNAVAILABLE', 'This setup link is unavailable or expired. Ask Mansora for a new link.');
        if (path.endsWith('/complete')) budget('setup-proof:' + input.token, 5, 15 * 60_000);
        const data = path.endsWith('/details') ? opts.onboarding.details(input.token) : await opts.onboarding.complete(input.token, input.password, input.username);
        return json(res, 200, { ok: true, data });
      }
      if (path === '/healthz') { const ready = opts.readiness ? await opts.readiness().catch(() => false) : true; return json(res, ready ? 200 : 503, { ok: ready, mode: opts.mode === 'client' ? 'client' : 'team-staging', ...(opts.trustedProxies?.length ? { clientAddressSource: client.source } : {}) }); }
      if (req.method === 'GET' && path === '/staging.css') { res.writeHead(200, { 'content-type': MIME['.css'] }); res.end(STYLE); return; }
      if (req.method === 'GET' && path === '/config.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); res.end('window.MANSORA_API_URL = "/api"; window.MANSORA_SIGNIN_URL = "/signin/";'); return; }
      if (path === '/app') { res.writeHead(308, { location: APP }); res.end(); return; }
      const appTail = path.startsWith(APP) ? path.slice(APP.length) : null;
      const match = appTail === null ? path.match(/^\/client\/([a-z0-9][a-z0-9-]{1,40})(?:\/(.*))?$/) : null;
      if (appTail !== null || match) {
        let workspace: StagingWorkspace | undefined, prefix: string, tail: string;
        if (appTail !== null) {
          prefix = APP; tail = appTail;
          const current = sessions.get(sessionId(req) ?? '');
          workspace = current && current.expires > now() ? workspaces.get(current.workspace) : undefined;
          if (!workspace) {
            // Signed out, expired or never signed in: there is no shop to show, only the one sign-in page.
            if (tail === 'invoke') return json(res, 200, { ok: false, error: { code: 'NOT_SIGNED_IN', message: 'Sign in to continue.' } });
            if (req.method === 'GET' && (tail === '' || tail === 'index.html' || tail === 'bridge.js')) { if (tail === 'bridge.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); res.end(`location.replace(${JSON.stringify(SIGN_IN)});`); return; } res.writeHead(302, { location: SIGN_IN }); res.end(); return; }
            const asset = req.method === 'GET' ? file(opts.clientDir, tail) : null;
            if (!asset || extname(asset) === '.html') throw new HttpError(404, 'NOT_FOUND', 'Not found.');
            res.setHeader('content-type', MIME[extname(asset)]); res.end(readFileSync(asset)); return;
          }
        } else {
          workspace = workspaces.get(match![1]); if (!workspace) throw new HttpError(404, 'NOT_FOUND', 'Workspace not found.');
          prefix = `/client/${workspace.id}/`; tail = match![2] ?? '';
          if (!path.endsWith('/') && match![2] === undefined) { res.writeHead(308, { location: prefix }); res.end(); return; }
          // Older links and emails pointed at a shop's own address. Opening one goes to the signed-in workspace or to
          // the one sign-in page; a shop never shows a second sign-in form.
          if (req.method === 'GET' && (tail === '' || tail === 'index.html')) {
            const current = sessions.get(sessionId(req) ?? '');
            res.writeHead(302, { location: current && current.expires > now() ? APP : SIGN_IN }); res.end(); return;
          }
        }
        if (opts.ownerRecovery && tail.startsWith('recover/')) {
          if (tail === 'recover/' && req.method === 'GET') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(withNotice(recoveryHtml, workspace.id)); return; }
          if (!['recover/request', 'recover/complete'].includes(tail)) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
          if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for recovery.');
          if (req.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_DENIED', 'Open your workspace directly.');
          if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send application/json.');
          budget(`recovery-ip:${workspace.id}:${client.address}`, 12, 15 * 60_000);
          let input: any; try { input = JSON.parse((await body(req, 4096)).toString('utf8')); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'BAD_JSON', 'The recovery request could not be read.'); }
          if (tail === 'recover/request') {
            budget(`recovery-request:${workspace.id}:${client.address}`, 6, 15 * 60_000); budget(`recovery-request:${workspace.id}`, 40, 15 * 60_000);
            return json(res, 202, { ok: true, data: await opts.ownerRecovery.request(workspace.id, input?.email) });
          }
          budget(`recovery-complete:${workspace.id}:${client.address}`, 6, 15 * 60_000); budget(`recovery-complete:${workspace.id}`, 40, 15 * 60_000);
          return json(res, 200, { ok: true, data: await opts.ownerRecovery.complete(workspace.id, input?.token, input?.password) });
        }
        if (tail === 'invoke') {
          const used = workspaceRequests.get(workspace.id) ?? 0;
          if (used >= (opts.maxConcurrentPerWorkspace ?? Math.min(8, opts.maxConcurrentRequests ?? 16))) { res.setHeader('retry-after', '2'); throw new HttpError(503, 'WORKSPACE_BUSY', 'This workspace is busy. Retry shortly.'); }
          workspaceRequests.set(workspace.id, used + 1); workspaceAdmitted = workspace.id;
          if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for application commands.');
          if (req.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_DENIED', 'Open this workspace directly before submitting a request.');
          if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send application/json.');
          // /app/ follows the browser's session, which another tab can replace by signing in to a different business.
          // A page loaded for one shop says which; if the session now belongs to another, nothing runs there.
          if (prefix === APP && req.headers['x-mansora-workspace'] !== workspace.id) return json(res, 200, { ok: false, error: { code: 'WORKSPACE_CHANGED', message: 'This browser is now signed in to a different business. The page will reload; nothing was saved.' } });
          let payload: any; try { payload = JSON.parse((await body(req, limit)).toString('utf8')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'BAD_JSON', 'The request could not be read.'); }
          if (!payload || typeof payload.command !== 'string' || payload.command.length > 100) throw new HttpError(400, 'BAD_COMMAND', 'A valid command is required.');
          const { command } = payload; let input = payload.input ?? {};
          if (command === 'auth.login' && typeof input.username === 'string') {
            const aliases = opts.loginAliases?.[workspace.id], name = input.username.trim().toLowerCase();
            const alias = aliases && Object.hasOwn(aliases, name) ? aliases[name] : undefined;
            if (alias) input = { ...input, username: alias };
          }
          if (['activation.activate', 'device.relink'].includes(command)) throw new HttpError(403, 'STAGING_MANAGED', 'The deployment administrator manages activation and re-linking for browser workspaces.');
          let id = sessionId(req), session = id ? sessions.get(id) : undefined;
          if (session && session.expires <= now()) { clear(id); session = undefined; cookie(res, workspace.id, null); }
          if (session?.workspace !== workspace.id) session = undefined;
          if (command === 'auth.login') {
            budget(`ip:${workspace.id}:${client.address}`, 60, 60_000); budget(`user:${workspace.id}:${String(input?.username ?? '').trim().toLowerCase().slice(0, 100)}`, 20, 15 * 60_000);
          }
          let importing = false, previousUsername: string | undefined;
          try {
            const importingCommand = ['import.preview', 'import.commit'].includes(command);
            const importActor = importingCommand ? (await workspace.engine.execute(session?.token ?? null, 'app.state')).user : null;
            if (importingCommand && can(importActor, 'data.import')) {
              if (activeImports >= (opts.maxConcurrentImports ?? (opts.mode === 'client' ? 2 : 1)) || (workspaceImports.get(workspace.id) ?? 0) >= 1) { res.setHeader('retry-after', '2'); throw new HttpError(429, 'IMPORT_BUSY', 'Another spreadsheet is being processed. Please retry shortly.'); }
              activeImports++; workspaceImports.set(workspace.id, 1); importing = true; guardSpreadsheet(input);
            }
            if (command === 'auth.logout') { if (session) clear(id); cookie(res, workspace.id, null); return json(res, 200, { ok: true, data: { ok: true } }); }
            if (opts.vatFeaturePolicy) workspace.engine.setMeta('platform_vat_feature',JSON.stringify(await opts.vatFeaturePolicy(workspace.engine.meta('tenant_id')!)));
            if (command === 'staff.save') {
              const actor = (await workspace.engine.execute(session?.token ?? null, 'app.state')).user;
              if (can(actor, 'staff.manage') && typeof input?.username === 'string') {
                const current = input.id ? workspace.engine.db.prepare('SELECT username FROM users WHERE id = ?').get(input.id) as { username: string } | undefined : undefined;
                previousUsername = current?.username;
                // Legacy duplicates may be edited without renaming or resetting their accounts.
                if ((!current || normaliseLogin(current.username) !== normaliseLogin(input.username)) && (usernameTaken(workspaces.values(), workspace.id, input.id, input.username) || opts.onboarding?.usernameReserved?.(input.username))) throw new HttpError(409, 'USERNAME_TAKEN', 'This username is taken. Choose another username.');
              }
            }
            const data = await workspace.engine.execute(session?.token ?? null, command, input);
            if (command === 'staff.save' && previousUsername && opts.loginAliases?.[workspace.id]) {
              for (const [alias, username] of Object.entries(opts.loginAliases[workspace.id])) if (normaliseLogin(username) === normaliseLogin(previousUsername)) opts.loginAliases[workspace.id][alias] = input.username.trim();
            }
            if (command === 'auth.login') {
              signInSession(req, res, workspace, data.token);
              return json(res, 200, { ok: true, data: { user: data.user } });
            }
            if (command === 'staff.list') return json(res, 200, { ok: true, data: data.map((user: any) => ({ ...user, publicLogin: publicLogin(workspace.id, user.username) })) });
            return json(res, 200, { ok: true, data });
          } catch (e) {
            if (e instanceof SpreadsheetGuardError) throw new HttpError(e.status, e.code, e.message);
            if (e instanceof DomainError) { if (e.code === 'SESSION_LOCKED') { if (session) clear(id); cookie(res, workspace.id, null); } return json(res, 200, { ok: false, error: { code: e.code, message: e.message, details: e.details } }); }
            throw e;
          } finally { if (importing) { activeImports--; workspaceImports.delete(workspace.id); } }
        }
        if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        if (tail === 'bridge.js') {
          res.writeHead(200, { 'content-type': MIME['.js'] });
          res.end(`${opts.ownerRecovery?.available() ? "window.MANSORA_OWNER_RECOVERY_URL=" + JSON.stringify(`/client/${workspace.id}/recover/`) + ";" : ""}window.MANSORA_SIGNIN_URL=${JSON.stringify(SIGN_IN)};window.mansora = {invoke: async (command,input) => {try {const r=await fetch(${JSON.stringify(prefix + 'invoke')},{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'${prefix === APP ? `,'x-mansora-workspace':${JSON.stringify(workspace.id)}` : ''}},body:JSON.stringify({command,input})});return await r.json();}catch {return {ok:false,error:{code:'OFFLINE',message:'Cannot reach Mansora. Reconnect and check saved records before retrying a transaction.'}};}}};`); return;
        }
        const target = file(opts.clientDir, tail || 'index.html'); if (!target) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        res.setHeader('content-type', MIME[extname(target)]);
        if (tail === '' || tail === 'index.html') res.end(readFileSync(target, 'utf8').replace('</head>', `<script src="${prefix}bridge.js"></script><link rel="stylesheet" href="/staging.css"></head>`).replace('<body>', '<body>' + notice(workspace.id)));
        else res.end(readFileSync(target)); return;
      }
      if (req.method === 'GET') {
        if (path === '/admin') { res.writeHead(308, { location: '/admin/' }); res.end(); return; }
        const target = path.startsWith('/admin/') ? file(opts.adminDir, path.slice(7) || 'index.html') : file(opts.adminDir, path.slice(1)) ?? file(opts.clientDir, path.slice(1));
        if (target) { res.setHeader('content-type', MIME[extname(target)]); const html = extname(target) === '.html'; res.end(html ? readFileSync(target, 'utf8').replace('</head>', '<link rel="stylesheet" href="/staging.css"></head>').replace('<body>', '<body>' + notice()) : readFileSync(target)); return; }
      }
      throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    } catch (e) {
      const known = e instanceof HttpError || e instanceof ApiHttpError;
      const status = known ? e.status : 502, code = known ? e.code : 'STAGING_UNAVAILABLE';
      const message = known ? e.message : 'Mansora could not complete this request. Check saved records before retrying a transaction.';
      if (!res.headersSent) json(res, status, { ok: false, error: { code, message }, message }); else res.end();
    } finally { if (admitted) activeRequests--; if (workspaceAdmitted) { const remaining = (workspaceRequests.get(workspaceAdmitted) ?? 1) - 1; if (remaining) workspaceRequests.set(workspaceAdmitted, remaining); else workspaceRequests.delete(workspaceAdmitted); } }
  });
  server.maxConnections = 128; server.maxHeadersCount = 100; server.maxRequestsPerSocket = 100; server.keepAliveTimeout = 5_000;
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(opts.port ?? 4500, opts.host ?? '127.0.0.1', done); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  if (origin.port === '0') origin = new URL(url);
  const registerWorkspace = (workspace: StagingWorkspace, aliases: Record<string, string> = {}) => {
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(workspace.id) || !workspace.engine.activated || !workspace.label || workspace.label.length > 120 || workspaces.has(workspace.id)) throw new Error('A distinct activated workspace is required.');
    if (workspaces.size >= 10) throw new Error('The configured workspace capacity is reached.');
    workspaces.set(workspace.id, workspace); opts.workspaces.push(workspace);
    (opts.loginAliases ??= {})[workspace.id] = { ...aliases };
  };
  const withSnapshotLock = async <T>(capture: () => Promise<T>): Promise<T> => {
    if (snapshotPaused) throw new Error('A recovery snapshot is already in progress.');
    snapshotPaused = true;
    try {
      const deadline = Date.now() + 30_000;
      while (activeRequests && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (activeRequests) throw new Error('Existing requests did not finish; the recovery snapshot was cancelled.');
      return await capture();
    } finally { snapshotPaused = false; }
  };
  return { server, url, publicOrigin: origin.origin, registerWorkspace, withSnapshotLock, close: async () => { await new Promise<void>(r => server.close(() => r())); for (const id of sessions.keys()) clear(id); } };
}
