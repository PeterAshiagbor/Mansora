import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startCloud, type Cloud } from '../cloud';

// An administrator invites a colleague; the colleague chooses their own password from a one-time link.
let cloud: Cloud;
const sent: any[] = [];
const tokenIn = (body: string) => /#admin-invite=([A-Za-z0-9_-]{43})/.exec(body)![1];
beforeAll(async () => {
  process.env.ADMIN_PUBLIC_URL = 'https://admin.example.test/admin';
  cloud = await startCloud();
  delete process.env.ADMIN_PUBLIC_URL;
  cloud.billing.email = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: `m${sent.length}` }; }) };
});
afterAll(() => cloud.close());

describe('administrator invitations by email', () => {
  it('invites, accepts once, and lets the new administrator sign in with the password they chose', async () => {
    const r = await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Test Colleague', email: 'Colleague@Example.test' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(sent.at(-1)).toMatchObject({ to: 'colleague@example.test', subject: 'You have been invited to administer Mansora' });
    expect(sent.at(-1).body).toContain('https://admin.example.test/admin/#admin-invite=');
    const token = tokenIn(sent.at(-1).body);
    const [stored] = await cloud.db.platform((q) => q(`SELECT token_hash FROM admin_invitations WHERE email = 'colleague@example.test'`));
    expect(stored.token_hash).not.toBe(token); // only the hash is kept
    expect((await cloud.api('GET', '/v1/admin/admins')).body.invitations.map((i: any) => i.email)).toContain('colleague@example.test');

    expect((await cloud.api('POST', '/v1/admin/invitations/accept', { token, password: 'too-short' }, null)).status).toBe(400);
    const ok = await cloud.api('POST', '/v1/admin/invitations/accept', { token, password: 'colleague-chose-this-1' }, null);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await cloud.api('POST', '/v1/admin/invitations/accept', { token, password: 'colleague-chose-this-2' }, null)).status).toBe(410);
    const login = await cloud.api('POST', '/v1/admin/login', { email: 'colleague@example.test', password: 'colleague-chose-this-1' }, null);
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    const actions = (await cloud.db.platform((q) => q(`SELECT action FROM admin_audit_logs WHERE action LIKE 'admin.invit%'`))).map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.invited', 'admin.invitation_accepted']));
    expect((await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Again', email: 'colleague@example.test' })).status).toBe(409);
  });

  it('replaces and cancels pending invitations, refuses expired links and anonymous inviting, and reports missing email', async () => {
    await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Second Person', email: 'second@example.test' });
    const first = tokenIn(sent.at(-1).body);
    const again = await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Second Person', email: 'second@example.test' });
    const second = tokenIn(sent.at(-1).body);
    expect((await cloud.api('POST', '/v1/admin/invitations/accept', { token: first, password: 'second-person-pass-1' }, null)).status).toBe(410);
    await cloud.api('POST', `/v1/admin/admins/invitations/${again.body.id}/cancel`, {});
    expect((await cloud.api('POST', '/v1/admin/invitations/accept', { token: second, password: 'second-person-pass-1' }, null)).status).toBe(410);

    await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Late Person', email: 'late@example.test' });
    const late = tokenIn(sent.at(-1).body);
    await cloud.db.platform((q) => q(`UPDATE admin_invitations SET expires_at = now() - interval '1 minute' WHERE email = 'late@example.test'`));
    expect((await cloud.api('POST', '/v1/admin/invitations/accept', { token: late, password: 'late-person-pass-1' }, null)).status).toBe(410);

    expect((await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'X', email: 'x@example.test' }, null)).status).toBe(401);
    cloud.billing.email = { configured: () => false, send: vi.fn() };
    expect((await cloud.api('POST', '/v1/admin/admins/invitations', { name: 'Y', email: 'y@example.test' })).body.code).toBe('EMAIL_UNAVAILABLE');
  });
});
