import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { flakyNetwork, startCloud, type Cloud } from '../cloud';
import { expectCode, makeShop, type TestShop } from '../helpers';

// A staff member gets a one-time code by email and chooses their own password.
let cloud: Cloud;
let shop: TestShop;
const net = flakyNetwork();
const sent: { to: string; subject: string; body: string }[] = [];
const codeIn = (body: string) => /code: ([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(body)![1];

beforeAll(async () => {
  cloud = await startCloud();
  const client = await cloud.createClient('Invite Mart');
  shop = await makeShop({ fetch: net.fetch, apiUrl: cloud.url, code: client.code });
  cloud.billing.email = { configured: () => true, send: vi.fn(async (m: any) => { sent.push(m); return { id: `msg-${sent.length}` }; }) };
});
afterAll(() => cloud.close());

describe('emailing staff a one-time sign-in code', () => {
  it('creates a staff member with only an email, emails a code, and lets them choose a password', async () => {
    const { id } = await shop.run(shop.owner, 'staff.save', { name: 'Adwoa Mensah', username: 'adwoa', role: 'cashier', email: 'Adwoa@Example.test' });
    // No password was set, so nothing can sign in yet.
    await expectCode(shop.run(null, 'auth.login', { username: 'adwoa', password: 'anything-at-all' }), 'INVALID_CREDENTIALS');

    const r = await shop.run(shop.owner, 'staff.invite', { userId: id });
    expect(r.sentTo).toBe('a****@example.test');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'adwoa@example.test', subject: 'Your sign-in details for Invite Mart' });
    expect(sent[0].body).toContain('Username: adwoa');
    const code = codeIn(sent[0].body);

    // The code never rests anywhere readable: only its hash on the laptop, and a redacted record in the cloud.
    expect(JSON.stringify(shop.engine.db.prepare('SELECT * FROM staff_invites').all())).not.toContain(code);
    const [record] = await cloud.db.platform((q) => q(`SELECT kind, status, body FROM notifications WHERE kind = 'staff_invitation'`));
    expect(record).toMatchObject({ kind: 'staff_invitation', status: 'sent' });
    expect(record.body).not.toContain(code);
    expect(record.body).toContain('[one-time code removed after sending]');
    const outbox = shop.engine.db.prepare(`SELECT payload FROM outbox`).all().map((r: any) => r.payload).join('\n');
    expect(outbox).not.toContain(code);
    expect(outbox).not.toContain('adwoa@example.test'); // staff emails stay on the laptop

    await shop.run(null, 'auth.acceptInvite', { username: 'adwoa', code: code.toLowerCase().replace('-', ' '), newPassword: 'my-own-password-1' });
    const login = await shop.run(null, 'auth.login', { username: 'adwoa', password: 'my-own-password-1' });
    expect(login.user.role).toBe('cashier');
    // Single use.
    await expectCode(shop.run(null, 'auth.acceptInvite', { username: 'adwoa', code, newPassword: 'another-password-2' }), 'INVALID_INVITE');
    const audit = shop.engine.db.prepare(`SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY occurred_at`).all(id).map((r: any) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['staff.invite', 'auth.invite_accepted']));
  });

  it('cancels a code after five wrong tries, and a new code replaces the old one', async () => {
    const { id } = await shop.run(shop.owner, 'staff.save', { name: 'Kojo Asante', username: 'kojo', role: 'cashier', email: 'kojo@example.test' });
    await shop.run(shop.owner, 'staff.invite', { userId: id });
    const first = codeIn(sent.at(-1)!.body);
    await shop.run(shop.owner, 'staff.invite', { userId: id });
    const second = codeIn(sent.at(-1)!.body);
    await expectCode(shop.run(null, 'auth.acceptInvite', { username: 'kojo', code: first, newPassword: 'kojo-password-1' }), 'INVALID_INVITE');
    for (let i = 0; i < 4; i++) await expectCode(shop.run(null, 'auth.acceptInvite', { username: 'kojo', code: 'AAAAA-AAAAA', newPassword: 'kojo-password-1' }), 'INVALID_INVITE');
    await expectCode(shop.run(null, 'auth.acceptInvite', { username: 'kojo', code: second, newPassword: 'kojo-password-1' }), 'INVALID_INVITE');
  });

  it('refuses owners, people without an email and non-managers, rejects weak passwords, and tells the owner when offline', async () => {
    const owner = (await shop.run(shop.owner, 'staff.list', {})).find((u: any) => u.role === 'owner');
    await expectCode(shop.run(shop.owner, 'staff.invite', { userId: owner.id }), 'OWNER_PROTECTED');
    const { id } = await shop.run(shop.owner, 'staff.save', { name: 'No Email', username: 'noemail', role: 'cashier', password: 'starting-pass-1' });
    await expectCode(shop.run(shop.owner, 'staff.invite', { userId: id }), 'EMAIL_REQUIRED');
    await expectCode(shop.run(shop.cashier, 'staff.invite', { userId: id }), 'PERMISSION_DENIED');
    await expectCode(shop.run(shop.owner, 'staff.save', { name: 'Nobody', username: 'nobody', role: 'cashier' }), 'INVALID_INPUT');

    const { id: ama } = await shop.run(shop.owner, 'staff.save', { name: 'Ama Weak', username: 'amaweak', role: 'cashier', email: 'ama.weak@example.test' });
    await shop.run(shop.owner, 'staff.invite', { userId: ama });
    await expectCode(shop.run(null, 'auth.acceptInvite', { username: 'amaweak', code: codeIn(sent.at(-1)!.body), newPassword: 'short' }), 'WEAK_PASSWORD');

    net.online = false;
    const before = sent.length;
    await expectCode(shop.run(shop.owner, 'staff.invite', { userId: ama }), 'OFFLINE');
    net.online = true;
    expect(sent.length).toBe(before);
    expect(shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM staff_invites WHERE user_id = ?`).get(ama)).toMatchObject({ n: 1 }); // the earlier, still-valid code stays usable

    cloud.billing.email = { configured: () => false, send: vi.fn() };
    await expectCode(shop.run(shop.owner, 'staff.invite', { userId: ama }), 'EMAIL_UNAVAILABLE');
  });
});
