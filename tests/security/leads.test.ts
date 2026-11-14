import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
import { deliverQueued } from '../../apps/api/src/billing/core';
let cloud: Cloud;
const request = (email = 'prospect@example.test') => ({ id: randomUUID(), name: 'Prospect', business: 'Sample business', email, phone: '', message: 'Show me stock reports', consent: true });
beforeAll(async () => { cloud = await startCloud(); });
afterAll(async () => { await cloud?.close(); });
it('accepts an explicit public request once and exposes it only to active administrators', async () => {
  const value = request();
  expect((await cloud.api('POST', '/v1/public/demo-requests', value, null)).status).toBe(202);
  expect((await cloud.api('POST', '/v1/public/demo-requests', { ...value, message: 'Do not overwrite the first request' }, null)).status).toBe(202);
  expect((await cloud.api('GET', '/v1/admin/leads', undefined, null)).status).toBe(401);
  expect((await cloud.api('GET', '/v1/public/leads', undefined, null)).status).toBe(404);
  const list = (await cloud.api('GET', '/v1/admin/leads')).body;
  expect(list.rows).toHaveLength(1); expect(list.rows[0]).toMatchObject({ id: value.id, message: value.message, status: 'new' });
  expect((await cloud.api('PUT', `/v1/admin/leads/${value.id}`, { status: 'qualified' }, null)).status).toBe(401);
  expect((await cloud.api('PUT', `/v1/admin/leads/${value.id}`, { status: 'qualified' })).status).toBe(200);
  expect((await cloud.api('GET', '/v1/admin/leads?status=qualified')).body.rows).toHaveLength(1);
  await expect(cloud.db.tenant(randomUUID(), q => q('SELECT * FROM demo_requests'))).rejects.toThrow(/permission denied/);
  expect((await cloud.api('GET', '/v1/admin/clients')).body).toHaveLength(0);
  // Owner decision D02: one acknowledgement now and one follow-up later for the prospect (no team inbox is
  // configured in this test, so no team alert). The repeated submission queued nothing more.
  const notifications = await cloud.db.platform(q => q('SELECT kind, to_address FROM notifications ORDER BY kind'));
  expect(notifications).toEqual([{ kind: 'lead_ack', to_address: value.email }, { kind: 'lead_customer_followup', to_address: value.email }]);
});
it('requires consent and bounds payloads, statuses, pagination and hidden bot submissions', async () => {
  expect((await cloud.api('POST', '/v1/public/demo-requests', { ...request(), consent: false }, null)).status).toBe(400);
  expect((await cloud.api('POST', '/v1/public/demo-requests', { ...request(), message: 'x'.repeat(9000) }, null)).status).toBe(413);
  expect((await cloud.api('POST', '/v1/public/demo-requests', { ...request(), website: 'bot.example' }, null)).status).toBe(202);
  expect((await cloud.api('GET', '/v1/admin/leads')).body.rows).toHaveLength(1);
  expect((await cloud.api('GET', '/v1/admin/leads?page=-1')).status).toBe(400);
  expect((await cloud.api('GET', '/v1/admin/leads?status=active')).status).toBe(400);
});
it('accepts a normal cross-origin HTML form without CORS relaxation', async () => {
  const form = new URLSearchParams({ id: randomUUID(), name: 'Form prospect', business: 'Form shop', email: 'form@example.test', consent: 'yes', format: 'html' });
  const response = await cloud.app.inject({ method: 'POST', url: '/v1/public/demo-requests', headers: { origin: 'https://mansora-consulting.com', 'content-type': 'application/x-www-form-urlencoded' }, payload: form.toString() });
  expect(response.statusCode).toBe(303); expect(response.headers.location).toBe('demo-requests/received');
  expect((await cloud.api('GET', '/v1/public/demo-requests/received', undefined, null)).body).toContain('No account, subscription or payment');
  expect((await cloud.api('GET', '/v1/admin/leads')).body.rows).toHaveLength(2);
});
describe('public intake abuse limits', () => {
  let isolated: Cloud;
  beforeAll(async () => { isolated = await startCloud(); }); afterAll(async () => { await isolated?.close(); });
  it('does not trust spoofed forwarding headers to evade its per-address limit', async () => {
    let denied = false;
    for (let n = 0; n < 31; n++) {
      const r = await isolated.app.inject({ method: 'POST', url: '/v1/public/demo-requests', headers: { 'x-forwarded-for': `192.0.2.${n + 1}` }, payload: request(`limit-${n}@example.test`) });
      if (r.statusCode === 429) { denied = true; break; } expect(r.statusCode).toBe(202);
    }
    expect(denied).toBe(true);
  });
});

describe('software demo requests from the corporate website (acquisition spec PR-01)', () => {
  let site: Cloud;
  const SECRET = 'a'.repeat(64);
  beforeAll(async () => { process.env.DEMO_INTAKE_SECRET = SECRET; try { site = await startCloud(); } finally { delete process.env.DEMO_INTAKE_SECRET; } }); afterAll(async () => { await site?.close(); });
  const post = (payload: object, headers: Record<string, string> = {}) => site.app.inject({ method: 'POST', url: '/v1/public/demo-requests', headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify(payload) });
  const signed = async (payload: object, clientIp: string, o: { secret?: string; skew?: number } = {}) => {
    const { signWebsiteRequest } = await import('../../apps/api/src/modules/leads');
    const raw = JSON.stringify(payload), ts = Math.floor(Date.now() / 1000) + (o.skew ?? 0);
    return site.app.inject({ method: 'POST', url: '/v1/public/demo-requests', headers: { 'content-type': 'application/json', 'x-mansora-source': 'website', 'x-mansora-timestamp': String(ts), 'x-mansora-client-ip': clientIp, 'x-mansora-signature': signWebsiteRequest(o.secret ?? SECRET, ts, clientIp, raw) }, payload: raw });
  };

  it('records a signed website request as source website, with a reference and business type; a retry is the same lead', async () => {
    const value = { ...request('shop@example.test'), businessType: 'mini_mart' };
    const first = await signed(value, '203.0.113.7');
    expect(first.statusCode).toBe(202);
    const body = first.json();
    expect(body).toMatchObject({ ok: true, duplicate: false }); expect(body.reference).toMatch(/^MSD-\d{6}-[A-Z2-9]{4}$/);
    const again = await signed(value, '203.0.113.7');
    expect(again.json()).toMatchObject({ duplicate: true, reference: body.reference });
    const [row] = await site.db.platform(q => q('SELECT source, business_type, reference FROM demo_requests WHERE id = $1', [value.id]));
    expect(row).toEqual({ source: 'website', business_type: 'mini_mart', reference: body.reference });
  });

  it('refuses a forged, stale or tampered website signature, and records unsigned requests as the app form', async () => {
    expect((await signed(request('forged@example.test'), '203.0.113.8', { secret: 'b'.repeat(64) })).statusCode).toBe(403);
    expect((await signed(request('stale@example.test'), '203.0.113.8', { skew: -600 })).statusCode).toBe(403);
    const { signWebsiteRequest } = await import('../../apps/api/src/modules/leads');
    const ts = Math.floor(Date.now() / 1000), value = request('tamper@example.test');
    const tampered = await post({ ...value, business: 'Changed after signing' }, { 'x-mansora-timestamp': String(ts), 'x-mansora-client-ip': '203.0.113.9', 'x-mansora-signature': signWebsiteRequest(SECRET, ts, '203.0.113.9', JSON.stringify(value)) });
    expect(tampered.statusCode).toBe(403);
    const plain = request('plain@example.test');
    expect((await post(plain)).statusCode).toBe(202);
    expect((await site.db.platform(q => q('SELECT source FROM demo_requests WHERE id = $1', [plain.id])))[0].source).toBe('app_form');
  });

  it('limits by the visitor address the website vouches for, so one busy visitor cannot block everyone else', async () => {
    let denied = false;
    for (let n = 0; n < 31; n++) { const r = await signed(request(`v${n}@example.test`), '198.51.100.1'); if (r.statusCode === 429) { denied = true; break; } }
    expect(denied).toBe(true);
    expect((await signed(request('other-visitor@example.test'), '198.51.100.2')).statusCode).toBe(202);
  });
});

describe('demo request emails (acquisition spec PR-02, owner decision D02)', () => {
  let c: Cloud; const sent: any[] = [];
  beforeAll(async () => {
    process.env.LEAD_ALERT_EMAIL = 'team@mansora.test';
    try { c = await startCloud(); } finally { delete process.env.LEAD_ALERT_EMAIL; }
    c.billing.email = { configured: () => true, send: async (m: any) => { sent.push(m); return { id: `msg-${sent.length}` }; } } as any;
  });
  afterAll(async () => { await c?.close(); });
  const later = (h: number) => { c.clock.now = new Date(Date.now() + h * 3_600_000); };
  const submit = async (email: string) => { const v = { ...request(email), name: 'Ama Mensah', business: 'Ama Mini Mart', message: 'Stock <b>counts</b>' }; const r = await c.api('POST', '/v1/public/demo-requests', v, null); return { v, ref: r.body.reference as string }; };

  it('sends the acknowledgement and team alert at once, and holds the follow-ups until they are due', async () => {
    process.env.LEAD_ALERT_EMAIL = 'team@mansora.test';
    const { v, ref } = await submit('ama@example.test');
    delete process.env.LEAD_ALERT_EMAIL;
    const kinds = (await c.db.platform(q => q('SELECT kind, to_address FROM notifications WHERE lead_id = $1 ORDER BY kind', [v.id])));
    expect(kinds).toEqual([
      { kind: 'lead_ack', to_address: 'ama@example.test' }, { kind: 'lead_alert', to_address: 'team@mansora.test' },
      { kind: 'lead_customer_followup', to_address: 'ama@example.test' }, { kind: 'lead_team_reminder', to_address: 'team@mansora.test' },
    ]);
    later(0); await deliverQueued(c.billing);
    expect(sent.map((m) => m.to).sort()).toEqual(['ama@example.test', 'team@mansora.test']);
    const ack = sent.find((m) => m.to === 'ama@example.test');
    expect(ack.subject).toContain(ref); expect(ack.body).toContain('no account or subscription is created');
    expect(ack.body).not.toMatch(/\b(today|tomorrow|within \d)/i); // no promised appointment time
    expect(sent.find((m) => m.to === 'team@mansora.test').body).toContain('> Stock <b>counts</b>'); // quoted as text; the HTML part escapes it
    later(23); await deliverQueued(c.billing); expect(sent).toHaveLength(2);
    later(25); await deliverQueued(c.billing); expect(sent.map((m) => m.subject).filter((s) => s.startsWith('Reminder'))).toHaveLength(1);
    later(49); await deliverQueued(c.billing); expect(sent.filter((m) => m.subject.startsWith('Your Mansora demo request'))).toHaveLength(1);
  });

  it('does not send follow-ups once the lead has been contacted, closed or qualified', async () => {
    process.env.LEAD_ALERT_EMAIL = 'team@mansora.test';
    const { v } = await submit('kojo@example.test');
    delete process.env.LEAD_ALERT_EMAIL;
    later(0); await deliverQueued(c.billing);
    const before = sent.length;
    expect((await c.api('PUT', `/v1/admin/leads/${v.id}`, { status: 'contacted' })).status).toBe(200);
    later(50); await deliverQueued(c.billing); await deliverQueued(c.billing);
    expect(sent.length).toBe(before);
    const rows = await c.db.platform(q => q(`SELECT kind, status, error FROM notifications WHERE lead_id = $1 AND kind IN ('lead_team_reminder','lead_customer_followup') ORDER BY kind`, [v.id]));
    expect(rows.map((r: any) => [r.kind, r.status])).toEqual([['lead_customer_followup', 'skipped'], ['lead_team_reminder', 'skipped']]);
    expect(rows[0].error).toMatch(/contacted/);
  });
});
