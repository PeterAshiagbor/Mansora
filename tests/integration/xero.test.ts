/** Audit F08: daily journals pushed to Xero as DRAFT manual journals, against a simulated Xero API. */
import { afterEach, describe, expect, it } from 'vitest';
import { expectCode, fakeActivationFetch, makeShop, uuid, type TestShop } from '../helpers';

let shop: TestShop;
afterEach(() => shop?.engine.db.close());

function fakeXero() {
  const calls: { url: string; init: any }[] = [];
  let fail = false;
  const activation = fakeActivationFetch();
  const fetchFn = (async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.endsWith('/v1/devices/activate')) return activation(url, init);
    calls.push({ url: u, init });
    if (u === 'https://identity.xero.com/connect/token') return new Response(JSON.stringify({ access_token: `at-${calls.length}`, refresh_token: 'rt', expires_in: 1800 }), { status: 200 });
    if (u === 'https://api.xero.com/connections') return new Response(JSON.stringify([{ tenantId: 'org-1', tenantName: 'Demo Mart Ltd', tenantType: 'ORGANISATION' }]), { status: 200 });
    if (u === 'https://api.xero.com/api.xro/2.0/ManualJournals') {
      if (fail) return new Response(JSON.stringify({ Elements: [{ ValidationErrors: [{ Message: 'Account code 999 is not valid' }] }] }), { status: 400 });
      return new Response(JSON.stringify({ ManualJournals: [{ ManualJournalID: `mj-${calls.length}` }] }), { status: 200 });
    }
    throw new TypeError('fetch failed (offline)');
  }) as typeof fetch;
  return { fetch: fetchFn, calls, setFail: (v: boolean) => { fail = v; } };
}

describe('Xero connector', () => {
  it('connects with PKCE, requires a mapping, posts each balanced day once as a draft and retries failures', async () => {
    let clock = new Date('2026-11-04T09:00:00.000Z');
    const x = fakeXero();
    shop = await makeShop({ now: () => clock, fetch: x.fetch });
    shop.engine.setMeta('lock_minutes', '100000000');
    const s = shop;
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.rice, quantity: 2 }], tenders: [{ method: 'cash', amount: 16_000 }] });
    clock = new Date('2026-11-05T09:00:00.000Z');
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.milk, quantity: 1 }], tenders: [{ method: 'momo', amount: 1250, reference: 'MM1' }] });

    await expectCode(s.run(s.manager, 'xero.authUrl', { clientId: 'client-abc-123', redirectUri: 'https://app.mansora.test/xero/callback' }), 'PERMISSION_DENIED');
    const { url } = await s.run(s.owner, 'xero.authUrl', { clientId: 'client-abc-123', redirectUri: 'https://app.mansora.test/xero/callback' });
    const q = new URL(url).searchParams;
    expect(q.get('code_challenge_method')).toBe('S256');
    await expectCode(s.run(s.owner, 'xero.connect', { code: 'the-code', state: 'forged-state' }), 'XERO_STATE_MISMATCH');
    expect((await s.run(s.owner, 'xero.connect', { code: 'the-code', state: q.get('state')! })).tenant).toEqual({ id: 'org-1', name: 'Demo Mart Ltd' });
    // The token exchange sent the PKCE verifier and no client secret.
    const tokenBody = new URLSearchParams(x.calls.find((c) => c.url.includes('/connect/token'))!.init.body);
    expect(tokenBody.get('code_verifier')).toBeTruthy(); expect(tokenBody.get('client_secret')).toBeNull();

    // 4 Nov: opening stock 20 x 60.00 + 50 x 9.00 + 30 x 3.33 = 1,749.90 (Dr 1200, Cr 3000); cash sale 160.00
    // (Dr 1000, Cr 4000) and its cost 120.00 (Dr 5000, Cr 1200). Inventory net: 1,749.90 - 120.00 = 1,629.90.
    const preview = await s.run(s.owner, 'xero.preview', { from: '2026-11-01', to: '2026-11-30' });
    expect(preview.map((d: any) => d.date)).toEqual(['2026-11-04', '2026-11-05']);
    expect(Object.fromEntries(preview[0].lines.map((l: any) => [l.account, l.net]))).toEqual({ '1000': 16_000, '4000': -16_000, '5000': 12_000, '1200': 162_990, '3000': -174_990 });
    await expectCode(s.run(s.owner, 'xero.push', { from: '2026-11-01', to: '2026-11-30' }), 'XERO_MAPPING_REQUIRED');
    const mapping = { '1000': '090', '1010': '091', '3000': '960', '4000': '200', '5000': '310', '1200': '630' };
    await s.run(s.owner, 'xero.mapping', { mapping });

    x.setFail(true);
    expect(await s.run(s.owner, 'xero.push', { from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ posted: 0, failed: 2 });
    x.setFail(false);
    expect(await s.run(s.owner, 'xero.push', { from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ posted: 2, failed: 0 });
    expect(await s.run(s.owner, 'xero.push', { from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ posted: 0, skipped: 2 });
    const posts = x.calls.filter((c) => c.url.endsWith('/ManualJournals'));
    const last = JSON.parse(posts[posts.length - 1].init.body).ManualJournals[0];
    expect(last).toMatchObject({ Date: '2026-11-05', Status: 'DRAFT' });
    expect(last.JournalLines.reduce((t: number, l: any) => t + Math.round(Number(l.LineAmount) * 100), 0)).toBe(0);
    expect(posts[posts.length - 1].init.headers['xero-tenant-id']).toBe('org-1');

    // Tokens are refreshed once expired, and are never written into a portable backup.
    clock = new Date('2026-11-06T09:00:00.000Z');
    await s.run(s.cashier, 'sale.complete', { id: uuid(), lines: [{ productId: s.products.soap, quantity: 1 }], tenders: [{ method: 'cash', amount: 500 }] });
    await s.run(s.owner, 'xero.mapping', { mapping: { ...mapping } });
    const before = x.calls.filter((c) => c.url.includes('/connect/token')).length;
    await s.run(s.owner, 'xero.push', { from: '2026-11-06', to: '2026-11-06' });
    expect(new URLSearchParams(x.calls.filter((c) => c.url.includes('/connect/token'))[before].init.body).get('grant_type')).toBe('refresh_token');
    const b = await s.run(s.owner, 'backup.create', { passphrase: 'correct horse battery' });
    const { verifyBackupFile } = await import('../../apps/desktop/src/core');
    expect(verifyBackupFile(b.path, 'correct horse battery')).toBeTruthy();
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const db = new Database(b.path); db.pragma(`cipher = 'sqlcipher'`); db.pragma(`key = 'correct horse battery'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM meta WHERE key = 'xero_tokens'`).get()).toEqual({ n: 0 });
    db.close();
  });
});
