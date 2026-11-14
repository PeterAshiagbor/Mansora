/** Authenticated browser transport for the unchanged native engine. Staging only. */
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
  onboarding?: Pick<WorkspaceOnboarding, 'details' | 'complete'>;
  mode?: DeploymentMode; testWorkspaceIds?: string[]; trustedProxies?: string[];
  onProxyPeer?: (peer: string, source: 'socket' | 'forwarded') => void;
  maxConcurrentPerWorkspace?: number; maxConcurrentImports?: number;
  maxConcurrentRequests?: number;
  maxBodyBytes?: number; sessionTtlMs?: number; now?: () => number;
}
class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function stagingOrigin(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('STAGING_ORIGIN must be an HTTPS origin; HTTP is allowed only on loopback for tests.');
  return url;
}
async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > limit) { req.resume(); throw new HttpError(413, 'BODY_TOO_LARGE', 'This upload exceeds the staging request limit.'); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > limit) throw new HttpError(413, 'BODY_TOO_LARGE', 'This upload exceeds the staging request limit.'); chunks.push(bytes); }
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
  const cookie = (res: ServerResponse, workspace: string, id: string | null) => res.setHeader('set-cookie', `${cookieName}=${id ?? ''}; Path=/client/${workspace}/; HttpOnly; SameSite=Strict; Max-Age=${id ? Math.floor((opts.sessionTtlMs ?? 12 * 3_600_000) / 1000) : 0}${origin.protocol === 'https:' ? '; Secure' : ''}`);
  const budget = (key: string, count: number, ms: number) => {
    if (budgets.size > 2000) for (const [k, b] of budgets) if (b.expires <= now()) budgets.delete(k);
    if (!budgets.has(key) && budgets.size > 2000) throw new HttpError(429, 'TRY_LATER', 'Too many sign-in attempts. Please wait.');
    const current = budgets.get(key); const next = current && current.expires > now() ? current : { count: 0, expires: now() + ms }; budgets.set(key, next);
    if (++next.count > count) throw new HttpError(429, 'TRY_LATER', 'Too many sign-in attempts. Please wait before trying again.');
  };
  const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
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
      if (counted && activeRequests >= (opts.maxConcurrentRequests ?? 16)) { res.setHeader('retry-after', '2'); throw new HttpError(503, 'SERVER_BUSY', 'The test server is busy. Please retry shortly.'); }
      if (counted) { activeRequests++; admitted = true; }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new HttpError(400, 'BAD_REQUEST', 'Invalid request path.');
      const url = new URL(req.url, origin);
      let path: string; try { path = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'BAD_REQUEST', 'Invalid request path.'); }
      if (path.includes('\\') || path.includes('\0')) throw new HttpError(400, 'BAD_REQUEST', 'Invalid request path.');
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
        const data = path.endsWith('/details') ? opts.onboarding.details(input.token) : await opts.onboarding.complete(input.token, input.password);
        return json(res, 200, { ok: true, data });
      }
      if (path === '/healthz') { const ready = opts.readiness ? await opts.readiness().catch(() => false) : true; return json(res, ready ? 200 : 503, { ok: ready, mode: opts.mode === 'client' ? 'client' : 'team-staging', ...(opts.trustedProxies?.length ? { clientAddressSource: client.source } : {}) }); }
      if (req.method === 'GET' && path === '/' && opts.mode === 'client') {
        res.setHeader('content-type', MIME['.html']); res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mansora workspace access</title></head><body><main><h1>Mansora workspace access</h1><p>Sign in using your private workspace address. Contact Mansora if you need help finding it.</p><a href="/admin/">Platform administration</a></main></body></html>'); return;
      }
      if (req.method === 'GET' && path === '/') { res.setHeader('content-type', MIME['.html']); res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Mansora team testing</title><link rel="stylesheet" href="/staging.css"></head><body>${BANNER}<main style="max-width:760px;margin:40px auto;padding:24px;font:16px/1.6 system-ui"><h1>Mansora team testing</h1><p>Sign in with your assigned test account. Use sample data only; records are saved and shared within each business.</p><ul>${opts.workspaces.map(w => `<li><a href="/client/${w.id}/">${escape(w.label)}</a></li>`).join('')}<li><a href="/admin/">Mansora administration</a></li></ul><p>The browser environment covers business workflows. Test printers, scanners, cash drawers and offline selling in the desktop application.</p></main></body></html>`); return; }
      if (req.method === 'GET' && path === '/staging.css') { res.writeHead(200, { 'content-type': MIME['.css'] }); res.end(STYLE); return; }
      if (req.method === 'GET' && path === '/config.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); res.end('window.MANSORA_API_URL = "/api";'); return; }
      const match = path.match(/^\/client\/([a-z0-9][a-z0-9-]{1,40})(?:\/(.*))?$/);
      if (match) {
        const workspace = workspaces.get(match[1]); if (!workspace) throw new HttpError(404, 'NOT_FOUND', 'Test workspace not found.');
        const prefix = `/client/${workspace.id}/`, tail = match[2] ?? '';
        if (!path.endsWith('/') && match[2] === undefined) { res.writeHead(308, { location: prefix }); res.end(); return; }
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
          let payload: any; try { payload = JSON.parse((await body(req, limit)).toString('utf8')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'BAD_JSON', 'The request could not be read.'); }
          if (!payload || typeof payload.command !== 'string' || payload.command.length > 100) throw new HttpError(400, 'BAD_COMMAND', 'A valid command is required.');
          const { command } = payload; let input = payload.input ?? {};
          if (command === 'auth.login' && typeof input.username === 'string') {
            const aliases = opts.loginAliases?.[workspace.id], name = input.username.trim().toLowerCase();
            const alias = aliases && Object.hasOwn(aliases, name) ? aliases[name] : undefined;
            if (alias) input = { ...input, username: alias };
          }
          if (['activation.activate', 'device.relink'].includes(command)) throw new HttpError(403, 'STAGING_MANAGED', 'The deployment administrator manages activation and re-linking for shared test workspaces.');
          let id = sessionId(req), session = id ? sessions.get(id) : undefined;
          if (session && session.expires <= now()) { clear(id); session = undefined; cookie(res, workspace.id, null); }
          if (session?.workspace !== workspace.id) session = undefined;
          if (command === 'auth.login') {
            budget(`ip:${workspace.id}:${client.address}`, 60, 60_000); budget(`user:${workspace.id}:${String(input?.username ?? '').trim().toLowerCase().slice(0, 100)}`, 20, 15 * 60_000);
          }
          let importing = false;
          try {
            const importingCommand = ['import.preview', 'import.commit'].includes(command);
            const importActor = importingCommand ? (await workspace.engine.execute(session?.token ?? null, 'app.state')).user : null;
            if (importingCommand && can(importActor, 'data.import')) {
              if (activeImports >= (opts.maxConcurrentImports ?? (opts.mode === 'client' ? 2 : 1)) || (workspaceImports.get(workspace.id) ?? 0) >= 1) { res.setHeader('retry-after', '2'); throw new HttpError(429, 'IMPORT_BUSY', 'Another spreadsheet is being processed. Please retry shortly.'); }
              activeImports++; workspaceImports.set(workspace.id, 1); importing = true; guardSpreadsheet(input);
            }
            if (command === 'auth.logout') { if (session) clear(id); cookie(res, workspace.id, null); return json(res, 200, { ok: true, data: { ok: true } }); }
            const data = await workspace.engine.execute(session?.token ?? null, command, input);
            if (command === 'auth.login') {
              if (session) clear(id);
              for (const [key, old] of sessions) if (old.expires <= now()) clear(key);
              if (sessions.size >= 500) { workspace.engine.endSession(data.token); throw new HttpError(503, 'SESSIONS_FULL', 'The test server is at its session limit. Please try later.'); }
              id = randomBytes(32).toString('hex'); sessions.set(id, { workspace: workspace.id, token: data.token, expires: now() + (opts.sessionTtlMs ?? 12 * 3_600_000) }); cookie(res, workspace.id, id);
              return json(res, 200, { ok: true, data: { user: data.user } });
            }
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
          res.end(`${opts.ownerRecovery?.available() ? "window.MANSORA_OWNER_RECOVERY_URL=" + JSON.stringify(prefix + "recover/") + ";" : ""}window.mansora = {invoke: async (command,input) => {try {const r=await fetch(${JSON.stringify(prefix + 'invoke')},{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({command,input})});return await r.json();}catch {return {ok:false,error:{code:'OFFLINE',message:'Cannot reach the team test server. Reconnect and check saved records before retrying a transaction.'}};}}};`); return;
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
      const message = known ? e.message : 'The test service could not complete this request. Check saved records before retrying a transaction.';
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
