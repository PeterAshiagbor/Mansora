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

describe('lead management (acquisition spec PR-03)', () => {
  let c: Cloud;
  beforeAll(async () => { c = await startCloud(); }); afterAll(async () => { await c?.close(); });
  const make = async (email: string) => { const v = request(email); await c.api('POST', '/v1/public/demo-requests', v, null); return v.id; };

  it('records a call on the timeline, marks a new lead contacted and so stops the follow-ups', async () => {
    const id = await make('call@example.test');
    expect((await c.api('POST', `/v1/admin/leads/${id}/events`, { kind: 'call', body: 'Spoke to Ama; demo on Friday' }, null)).status).toBe(401);
    expect((await c.api('POST', `/v1/admin/leads/${id}/events`, { kind: 'call', body: 'Spoke to Ama; demo on Friday' })).status).toBe(200);
    const d = (await c.api('GET', `/v1/admin/leads/${id}`)).body;
    expect(d.lead.status).toBe('contacted'); expect(d.lead.last_contacted_at).toBeTruthy();
    expect(d.events.map((e: any) => e.kind).sort()).toEqual(['call', 'status']);
    expect(d.emails.map((m: any) => m.kind).sort()).toEqual(['lead_ack', 'lead_customer_followup']);
    // A note does not count as contact.
    const other = await make('note@example.test');
    await c.api('POST', `/v1/admin/leads/${other}/events`, { kind: 'note', body: 'Looks like a wholesaler' });
    expect((await c.api('GET', `/v1/admin/leads/${other}`)).body.lead.status).toBe('new');
    expect((await c.api('POST', `/v1/admin/leads/${other}/events`, { kind: 'call', body: 'x', occurredAt: '2099-01-01T00:00:00Z' })).body.code).toBe('FUTURE_DATE');
  });

  it('assigns only active administrators, keeps follow-up dates, qualification and opt-out, and logs each change', async () => {
    const id = await make('assign@example.test');
    expect((await c.api('PUT', `/v1/admin/leads/${id}`, { assignedAdminId: randomUUID() })).body.code).toBe('UNKNOWN_ADMIN');
    const { admins } = (await c.api('GET', `/v1/admin/leads/${id}`)).body;
    expect((await c.api('PUT', `/v1/admin/leads/${id}`, { assignedAdminId: admins[0].id, nextFollowUpAt: '2026-12-01T10:00:00Z', qualification: { shops: 2, tills: 3, planInterest: 'business' }, optOut: true })).status).toBe(200);
    const d = (await c.api('GET', `/v1/admin/leads/${id}`)).body;
    expect(d.lead).toMatchObject({ assigned_admin_id: admins[0].id, qualification: { shops: 2, tills: 3, planInterest: 'business' } });
    expect(d.lead.follow_up_opt_out_at).toBeTruthy(); expect(new Date(d.lead.next_follow_up_at).toISOString()).toBe('2026-12-01T10:00:00.000Z');
    expect(d.events.map((e: any) => e.kind).sort()).toEqual(['assignment', 'follow_up', 'opt_out']);
    expect((await c.api('PUT', `/v1/admin/leads/${id}`, { qualification: { anything: 1 } })).status).toBe(400);
    expect((await c.api('PUT', `/v1/admin/leads/${id}`, {})).status).toBe(400);
  });

  it('an opted-out prospect gets no follow-up email, while the team reminder still applies', async () => {
    const id = await make('optout@example.test');
    await c.api('PUT', `/v1/admin/leads/${id}`, { optOut: true });
    c.billing.email = { configured: () => true, send: async () => ({ id: 'x' }) } as any;
    c.clock.now = new Date(Date.now() + 50 * 3_600_000);
    await deliverQueued(c.billing); await deliverQueued(c.billing);
    const [f] = await c.db.platform(q => q(`SELECT status, error FROM notifications WHERE lead_id = $1 AND kind = 'lead_customer_followup'`, [id]));
    expect(f).toEqual({ status: 'skipped', error: 'The prospect asked not to be followed up' });
  });

  it('keeps the timeline as a record: the application role cannot edit or delete it, and businesses cannot see it', async () => {
    await expect(c.db.platform(q => q(`UPDATE lead_events SET body = 'changed'`))).rejects.toThrow(/permission denied/);
    await expect(c.db.platform(q => q(`DELETE FROM lead_events`))).rejects.toThrow(/permission denied/);
    await expect(c.db.tenant(randomUUID(), q => q('SELECT * FROM lead_events'))).rejects.toThrow(/permission denied/);
    expect((await c.api('GET', `/v1/admin/leads/${randomUUID()}`)).status).toBe(404);
  });
});

describe('converting a qualified lead into a client (acquisition spec PR-04/PR-05)', () => {
  let c: Cloud;
  beforeAll(async () => { c = await startCloud(); }); afterAll(async () => { await c?.close(); });
  const qualified = async (email: string) => { const v = request(email); await c.api('POST', '/v1/public/demo-requests', v, null); await c.api('PUT', `/v1/admin/leads/${v.id}`, { status: 'qualified' }); return v.id; };
  const form = (o: object = {}) => ({ name: 'Ama Mini Mart', ownerName: 'Ama Mensah', email: 'ama@minimart.test', phone: '024 111 2222', businessType: 'mini_mart', detailsConfirmed: true, ...o });

  it('converts only a qualified lead, only with the details confirmed, into one linked client with a draft plan and one welcome email', async () => {
    const v = request('new@example.test'); await c.api('POST', '/v1/public/demo-requests', v, null);
    expect((await c.api('POST', `/v1/admin/leads/${v.id}/convert`, form())).body.code).toBe('NOT_QUALIFIED');
    const id = await qualified('ama@example.test');
    expect((await c.api('POST', `/v1/admin/leads/${id}/convert`, { ...form(), detailsConfirmed: false })).status).toBe(400);
    expect((await c.api('POST', `/v1/admin/leads/${id}/convert`, form(), null)).status).toBe(401);
    const [plan] = await c.db.platform(q => q(`INSERT INTO service_plans (id, name, price, billing_period) VALUES (gen_random_uuid(), 'Convert test plan', 22900, 'monthly') RETURNING id`));
    const r = await c.api('POST', `/v1/admin/leads/${id}/convert`, form({ planId: plan.id }));
    expect(r.status).toBe(200); expect(r.body.alreadyConverted).toBe(false);
    const tenantId = r.body.tenantId;
    const [t] = await c.db.platform(q => q('SELECT name, owner_name, email, business_type, lead_id, status FROM tenants WHERE id = $1', [tenantId]));
    expect(t).toEqual({ name: 'Ama Mini Mart', owner_name: 'Ama Mensah', email: 'ama@minimart.test', business_type: 'mini_mart', lead_id: id, status: 'onboarding' });
    expect((await c.db.platform(q => q('SELECT step, completed_at IS NOT NULL AS done FROM onboarding_steps WHERE tenant_id = $1', [tenantId]))).filter((s: any) => s.done).map((s: any) => s.step)).toEqual(['create_account']);
    // A11: a draft subscription only: no invoice, no payment, nothing charged.
    expect(await c.db.platform(q => q('SELECT status FROM client_subscriptions WHERE tenant_id = $1', [tenantId]))).toEqual([{ status: 'draft' }]);
    expect(await c.db.platform(q => q('SELECT 1 FROM invoices WHERE tenant_id = $1', [tenantId]))).toHaveLength(0);
    // A12: exactly one welcome email, with no password or code in it.
    const welcome = await c.db.platform(q => q(`SELECT to_address, subject, body FROM notifications WHERE kind = 'client_onboarding' AND tenant_id = $1`, [tenantId]));
    expect(welcome).toHaveLength(1); expect(welcome[0].to_address).toBe('ama@minimart.test');
    expect(welcome[0].body).toContain('Convert test plan'); expect(welcome[0].body).not.toMatch(/password:|activation code:|passphrase/i);
    // Repeating the request returns the same client and queues nothing new.
    expect((await c.api('POST', `/v1/admin/leads/${id}/convert`, form())).body).toEqual({ tenantId, alreadyConverted: true });
    expect(await c.db.platform(q => q(`SELECT 1 FROM notifications WHERE kind = 'client_onboarding'`))).toHaveLength(1);
    const d = (await c.api('GET', `/v1/admin/leads/${id}`)).body;
    expect(d.lead.tenant_id).toBe(tenantId); expect(d.events.some((e: any) => e.kind === 'conversion')).toBe(true);
  });

  it('two administrators converting at the same moment create one client (A10)', async () => {
    const id = await qualified('race@example.test');
    const results = await Promise.all([1, 2, 3].map(() => c.api('POST', `/v1/admin/leads/${id}/convert`, form({ name: 'Race Shop', email: 'race@shop.test', phone: '' }))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.tenantId)).size).toBe(1);
    expect(await c.db.platform(q => q(`SELECT 1 FROM tenants WHERE name = 'Race Shop'`))).toHaveLength(1);
  });

  it('stops on a possible existing client, and links to it only by an explicit action', async () => {
    const id = await qualified('dup@example.test');
    const r = await c.api('POST', `/v1/admin/leads/${id}/convert`, form({ name: 'Other name', email: 'AMA@minimart.test', phone: '' }));
    expect(r.status).toBe(409); expect(r.body.code).toBe('POSSIBLE_DUPLICATE');
    expect(r.body.details.matches.map((m: any) => m.name)).toEqual(['Ama Mini Mart']);
    const byPhone = await c.api('POST', `/v1/admin/leads/${id}/convert`, form({ name: 'Third', email: 'third@x.test', phone: '+233 24 111 2222' }));
    expect(byPhone.body.code).toBe('POSSIBLE_DUPLICATE');
    const existing = r.body.details.matches[0].id;
    // That client already came from a lead, so it cannot be linked to a second one.
    expect((await c.api('POST', `/v1/admin/leads/${id}/link`, { tenantId: existing })).body.code).toBe('CLIENT_HAS_LEAD');
    const [manual] = await c.db.platform(q => q(`SELECT id FROM tenants WHERE lead_id IS NULL LIMIT 1`));
    const plain = manual?.id ?? (await c.api('POST', '/v1/admin/clients', { name: 'Walk-in Client', ownerName: 'Kofi' })).body.id;
    expect((await c.api('POST', `/v1/admin/leads/${id}/link`, { tenantId: plain })).status).toBe(200);
    expect((await c.api('POST', `/v1/admin/leads/${id}/link`, { tenantId: plain })).body.code).toBe('ALREADY_CONVERTED');
    expect(await c.db.platform(q => q(`SELECT 1 FROM notifications WHERE kind = 'client_onboarding' AND tenant_id = $1`, [plain]))).toHaveLength(0);
  });
});
