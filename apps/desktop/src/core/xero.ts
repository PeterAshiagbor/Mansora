import { createHash, randomBytes } from 'node:crypto';
import { fail, sum } from '@mansora/domain';
import type { Ctx, Engine } from './engine';
import { buildJournal, CHART } from './commands/accounting';

/**
 * Audit F08: push Mansora's balanced daily journals to the owner's Xero organisation as DRAFT manual journals, so
 * the accountant reviews and posts them in Xero. Mansora stays the operational sub-ledger; Xero keeps the books.
 *
 * Connection uses Xero's OAuth 2.0 PKCE flow (no client secret stored on the laptop): the owner opens the authorise
 * link, signs in to Xero and pastes back the code. Tokens live in the encrypted local database and are refreshed
 * automatically. Each day is pushed at most once; an edited closed month cannot be re-pushed silently.
 */
export const XERO = {
  authorize: 'https://login.xero.com/identity/connect/authorize',
  token: 'https://identity.xero.com/connect/token',
  connections: 'https://api.xero.com/connections',
  manualJournals: 'https://api.xero.com/api.xro/2.0/ManualJournals',
  scopes: 'offline_access accounting.transactions accounting.settings.read',
};
const KEYS = { clientId: 'xero_client_id', redirect: 'xero_redirect_uri', verifier: 'xero_pkce_verifier', state: 'xero_oauth_state', tokens: 'xero_tokens', tenant: 'xero_tenant', mapping: 'xero_account_mapping' };
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function xeroStatus(engine: Engine) {
  const tenant = JSON.parse(engine.meta(KEYS.tenant) ?? 'null');
  const mapping = JSON.parse(engine.meta(KEYS.mapping) ?? '{}') as Record<string, string>;
  return { configured: !!engine.meta(KEYS.clientId), connected: !!engine.meta(KEYS.tokens) && !!tenant, tenant, mapping, chart: CHART };
}

export function xeroAuthUrl(engine: Engine, clientId: string, redirectUri: string): string {
  const verifier = b64url(randomBytes(48)), state = b64url(randomBytes(16));
  engine.setMeta(KEYS.clientId, clientId); engine.setMeta(KEYS.redirect, redirectUri);
  engine.setMeta(KEYS.verifier, verifier); engine.setMeta(KEYS.state, state);
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: XERO.scopes, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `${XERO.authorize}?${q}`;
}

async function tokenRequest(engine: Engine, body: Record<string, string>) {
  const res = await engine.fetch(XERO.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) fail('XERO_AUTH_FAILED', `Xero refused the sign-in (${res.status}). Connect Xero again.`);
  const t: any = await res.json();
  const tokens = { access: t.access_token, refresh: t.refresh_token, expiresAt: engine.now().getTime() + (Number(t.expires_in) || 1800) * 1000 };
  engine.setMeta(KEYS.tokens, JSON.stringify(tokens));
  return tokens;
}

export async function xeroExchange(engine: Engine, code: string, state: string) {
  if (!engine.meta(KEYS.verifier) || state !== engine.meta(KEYS.state)) fail('XERO_STATE_MISMATCH', 'This Xero sign-in did not start from this laptop. Start the connection again.');
  const tokens = await tokenRequest(engine, { grant_type: 'authorization_code', code, redirect_uri: engine.meta(KEYS.redirect)!, client_id: engine.meta(KEYS.clientId)!, code_verifier: engine.meta(KEYS.verifier)! });
  engine.setMeta(KEYS.verifier, null); engine.setMeta(KEYS.state, null);
  const res = await engine.fetch(XERO.connections, { headers: { authorization: `Bearer ${tokens.access}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) fail('XERO_AUTH_FAILED', 'Could not read the Xero organisations for this sign-in');
  const orgs: any[] = await res.json();
  const org = orgs.find((o) => o.tenantType === 'ORGANISATION') ?? orgs[0];
  if (!org) fail('XERO_NO_ORGANISATION', 'This Xero sign-in has no organisation');
  engine.setMeta(KEYS.tenant, JSON.stringify({ id: org.tenantId, name: org.tenantName }));
  return { tenant: { id: org.tenantId, name: org.tenantName } };
}

async function accessToken(engine: Engine): Promise<string> {
  const t = JSON.parse(engine.meta(KEYS.tokens) ?? 'null');
  if (!t) fail('XERO_NOT_CONNECTED', 'Connect Xero first');
  if (engine.now().getTime() < t.expiresAt - 60_000) return t.access;
  return (await tokenRequest(engine, { grant_type: 'refresh_token', refresh_token: t.refresh, client_id: engine.meta(KEYS.clientId)! })).access;
}

export function setXeroMapping(engine: Engine, mapping: Record<string, string>) {
  for (const [k, v] of Object.entries(mapping)) {
    if (!(k in CHART)) fail('INVALID_INPUT', `Unknown Mansora account ${k}`);
    if (!/^[A-Za-z0-9.\-]{1,10}$/.test(v)) fail('INVALID_INPUT', `Xero account code "${v}" is not valid`);
  }
  engine.setMeta(KEYS.mapping, JSON.stringify(mapping));
}

/** One Xero manual journal per day: the day's balanced Mansora journals, summed per account. */
export function xeroJournals(ctx: Ctx, from: string, to: string) {
  const j = buildJournal(ctx, from, to);
  const days = new Map<string, Map<string, number>>();
  for (const e of j.entries) {
    const day = days.get(e.date) ?? new Map<string, number>();
    for (const l of e.lines) day.set(l.account, (day.get(l.account) ?? 0) + l.debit - l.credit);
    days.set(e.date, day);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, accounts]) => {
    const lines = [...accounts].filter(([, v]) => v !== 0).map(([account, net]) => ({ account, net }));
    if (sum(lines.map((l) => l.net)) !== 0) fail('JOURNAL_UNBALANCED', `The journal for ${date} does not balance`);
    return { date, lines };
  }).filter((d) => d.lines.length);
}

export async function pushToXero(engine: Engine, ctx: Ctx, from: string, to: string) {
  const status = xeroStatus(engine);
  if (!status.connected) fail('XERO_NOT_CONNECTED', 'Connect Xero first');
  const days = xeroJournals(ctx, from, to);
  const unmapped = [...new Set(days.flatMap((d) => d.lines.map((l) => l.account)))].filter((a) => !status.mapping[a]);
  if (unmapped.length) fail('XERO_MAPPING_REQUIRED', `Choose the Xero account for: ${unmapped.map((a) => `${a} ${CHART[a]}`).join(', ')}`, { unmapped });
  const out = { posted: 0, skipped: 0, failed: 0, errors: [] as string[] };
  for (const d of days) {
    const existing = ctx.get(`SELECT status FROM accounting_exports WHERE provider = 'xero' AND journal_date = ?`, d.date);
    if (existing?.status === 'posted') { out.skipped++; continue; }
    const body = { ManualJournals: [{
      Narration: `Mansora daily journal ${d.date} (${ctx.setting('business_name') ?? ''})`.slice(0, 500), Date: d.date, Status: 'DRAFT', LineAmountTypes: 'NoTax', ShowOnCashBasisReports: false,
      JournalLines: d.lines.map((l) => ({ AccountCode: status.mapping[l.account], LineAmount: (l.net / 100).toFixed(2), Description: `${l.account} ${CHART[l.account]}` })),
    }] };
    const payload = JSON.stringify(body), sha = createHash('sha256').update(payload).digest('hex');
    let externalId: string | null = null, error: string | null = null;
    try {
      const res = await engine.fetch(XERO.manualJournals, { method: 'POST', headers: { authorization: `Bearer ${await accessToken(engine)}`, 'xero-tenant-id': status.tenant.id, 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': `mansora-${status.tenant.id}-${d.date}` }, body: payload, signal: AbortSignal.timeout(30_000) });
      const r: any = await res.json().catch(() => ({}));
      if (!res.ok) error = r?.Elements?.[0]?.ValidationErrors?.[0]?.Message ?? r?.Message ?? `Xero responded ${res.status}`;
      else externalId = r?.ManualJournals?.[0]?.ManualJournalID ?? null;
    } catch (e) { error = (e as Error).message; }
    ctx.tx(() => {
      ctx.run(`INSERT INTO accounting_exports (id, provider, journal_date, payload_sha256, external_id, status, last_error, created_by, created_at) VALUES (?, 'xero', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider, journal_date) DO UPDATE SET payload_sha256 = excluded.payload_sha256, external_id = excluded.external_id, status = excluded.status, last_error = excluded.last_error, created_at = excluded.created_at`,
        ctx.id(), d.date, sha, externalId, error ? 'failed' : 'posted', error, ctx.user.id, ctx.now());
      ctx.audit('accounting_export', null, { provider: 'xero', date: d.date, status: error ? 'failed' : 'posted', externalId, error }, 'accounting.xero_push');
    });
    if (error) { out.failed++; out.errors.push(`${d.date}: ${error}`); } else out.posted++;
  }
  return out;
}

export function disconnectXero(engine: Engine) {
  for (const k of [KEYS.tokens, KEYS.tenant, KEYS.verifier, KEYS.state]) engine.setMeta(k, null);
}
