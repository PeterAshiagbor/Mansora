import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { railwayConfig } from './config';
import { smokeStaging } from '../staging/smoke';
const config = railwayConfig();
Object.assign(process.env, { STAGING_ORIGIN: config.origin, STAGING_DATA_DIR: '/data/staging', STAGING_DB_KEY_FILE: '/data/secrets/staging_db_key', STAGING_API_URL: 'http://127.0.0.1:4000' });
async function smokeRailway() {
  await smokeStaging();
  const base = process.env.STAGING_SMOKE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
  const denied = await fetch(`${base}/api/metrics`);
  if (denied.status !== (process.env.METRICS_TOKEN ? 401 : 404)) throw new Error('Metrics access control failed');
  if (process.env.METRICS_TOKEN) {
    const accepted = await fetch(`${base}/api/metrics`, { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
    if (accepted.status !== 200 || !(await accepted.text()).includes('mansora_http_requests_total')) throw new Error('Configured metrics unavailable');
  }
  console.log('PASS Railway metrics configuration and access control');
  const operator = JSON.parse(readFileSync('/data/secrets/operator-account.json', 'utf8'));
  const request = async (path: string, input: unknown, token?: string) => {
    const result = await fetch(base + path, { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
    const data = await result.json() as any;
    if (!result.ok) throw new Error('Browser workspace acceptance request failed.');
    return data;
  };
  const login = await request('/api/v1/admin/login', operator);
  if (!login.token) throw new Error('Operator authentication requires review; no bypass is permitted.');
  try {
    const response = await fetch(base + '/api/v1/admin/clients', { headers: { authorization: `Bearer ${login.token}` } });
    if (!response.ok) throw new Error('Client lookup failed.');
    const clients = await response.json() as any[];
    let tenant = clients.find(client => client.name === 'RAILWAY-SMOKE third browser shop');
    if (!tenant && process.argv.includes('--existing')) throw new Error('Third shop did not survive restart.');
    tenant ??= await request('/api/v1/admin/clients', { name: 'RAILWAY-SMOKE third browser shop', ownerName: 'Synthetic acceptance owner', email: 'third@example.test', businessType: 'retail' }, login.token);
    const fixturePath = '/data/staging/smoke-third-owner.json';
    if (!existsSync(fixturePath)) writeFileSync(fixturePath, JSON.stringify({ password: randomBytes(24).toString('base64url') }), { mode: 0o600, flag: 'wx' });
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const link = await request(`/api/v1/admin/clients/${tenant.id}/browser-workspace`, {}, login.token);
    if (link.status === 'pending') {
      const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('token');
      const completed = await request('/onboarding/complete', { token, password: fixture.password });
      if (!completed.ok) throw new Error('Third shop activation failed.');
    }
    const workspace = 'shop-' + tenant.id;
    let cookie = '';
    const invoke = async (command: string, input: unknown = {}) => {
      const response = await fetch(`${base}/client/${workspace}/invoke`, { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json', cookie }, body: JSON.stringify({ command, input }) });
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
      const result = await response.json() as any;
      if (!response.ok || !result.ok) throw new Error('Third shop command failed.');
      return result.data;
    };
    await invoke('auth.login', { username: 'third@example.test', password: fixture.password });
    try {
      if ((await invoke('app.state')).business.tenantId !== tenant.id) throw new Error('Third shop tenant mismatch.');
      let rows = await invoke('product.list', { search: 'RAILWAY-THIRD-SMOKE' });
      if (!rows.length && !process.argv.includes('--existing')) {
        await invoke('product.save', { name: 'RAILWAY-THIRD-SMOKE saved data', sku: 'RAILWAY-THIRD-SMOKE', sellingPrice: 200, costPrice: 100, openingStock: 4 });
        rows = await invoke('product.list', { search: 'RAILWAY-THIRD-SMOKE' });
      }
      if (rows.length !== 1 || rows[0].quantity !== 4) throw new Error('Third shop saved data missing.');
    } finally { await invoke('auth.logout'); }
    console.log('PASS third browser shop provisioned without redeploy; owner access and saved records preserved');
  } finally { await request('/api/v1/admin/logout', {}, login.token); }

}
void smokeRailway().catch(() => { console.error('Railway acceptance failed. No credentials or request payloads are logged.'); process.exitCode = 1; });
