/** Explicit, idempotent provisioning. Never resets an existing test business. */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { openEngine, syncNow } from '../../apps/desktop/src/core';
import { stagingConfig, loadWorkspaces, workspaceKey, type StagingConfig, type WorkspaceRecord } from './config';
export interface TestAccount { workspace: string; username: string; role: string; password: string; email?: string }
import { testerEmails, testerPasswords } from './accounts';
export { testerEmails, loadLoginAliases } from './accounts';
export async function provisionStaging(config: StagingConfig, admin: { email: string; password: string }, emails: string[] = [], passwords: string[] = []) {
  const identities = testerEmails(emails.length ? JSON.stringify(emails) : undefined);
  const suppliedPasswords = testerPasswords(passwords.length ? JSON.stringify(passwords) : undefined);
  if (suppliedPasswords.length && identities.length !== 2) throw new Error('Generated tester passwords require two configured identities.');
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (existsSync(join(config.dataDir, 'workspaces.json'))) {
    const saved = JSON.parse(readFileSync(join(config.dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
    if (identities.some(email => !saved.some(a => a.email === email))) throw new Error('Tester identities changed after provisioning. Review the existing accounts; passwords will not be reset automatically.');
    if (suppliedPasswords.length && identities.some((email, i) => !saved.some(a => a.email === email && createHash('sha256').update(a.password).digest('hex') === createHash('sha256').update(suppliedPasswords[i]).digest('hex')))) throw new Error('Configured tester passwords changed. Existing passwords will not be reset automatically.');
    const opened = loadWorkspaces(config); for (const w of opened) w.engine.db.close(); return { existing: true }; }
  let token = '';
  const phase = (name: string) => console.log('Staging setup: ' + name);
  const api = async (method: string, path: string, payload?: unknown) => {
    const r = await fetch(new URL(path, config.apiUrl), { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(30_000) });
    const data = await r.json() as any; if (!r.ok) throw new Error(`Staging provisioning failed at ${path}: ${data.code ?? r.status}`); return data;
  };
  phase('administrator authentication');
  token = (await api('POST', '/v1/admin/login', admin)).token;
  const records: WorkspaceRecord[] = [], accounts: TestAccount[] = [];
  phase('illustrative plan');
  const plan = await api('POST', '/v1/admin/plans', { name: 'TEAM TEST — illustrative plan', price: 30000, billingPeriod: 'monthly', includedSupport: 'Sandbox testing only; not a commercial offer' });
  try {
    for (const id of ['shop-a', 'shop-b']) {
      const directory = join(config.dataDir, 'workspaces', id);
      if (existsSync(directory)) throw new Error('An unfinished workspace exists. Preserve it and investigate provisioning before retrying; do not silently overwrite it.');
      const label = `Team Test Shop ${id.endsWith('a') ? 'A' : 'B'}`;
      phase(id + ' API registration');
      const client = await api('POST', '/v1/admin/clients', { name: label, ownerName: 'Test business owner', email: `${id}@mansora.example`, businessType: 'retail' });
      const code = (await api('POST', `/v1/admin/clients/${client.id}/activation-codes`)).code;
      phase(id + ' encrypted store');
      const engine = openEngine({ dataDir: directory, dbKey: workspaceKey(config.key, id), appVersion: '0.1.0-team-staging' });
      try {
        const email = identities[id === 'shop-a' ? 0 : 1];
        const username = email ? 'tester-' + createHash('sha256').update(email).digest('hex').slice(0, 12) : 'owner';
        const password = suppliedPasswords[id === 'shop-a' ? 0 : 1] ?? randomBytes(24).toString('base64url'); accounts.push({ workspace: id, username, role: 'owner', password, ...(email ? { email } : {}) });
        phase(id + ' activation');
        await engine.execute(null, 'activation.activate', { apiUrl: config.apiUrl, code, deviceName: `${label} shared browser gateway`, owner: { name: email ? email.split('@')[0].slice(0, 100) : 'Test owner', username, password } });
        const session = (await engine.execute(null, 'auth.login', { username, password })).token;
        phase(id + ' test records');
        for (const role of ['manager', 'cashier']) { const staffPassword = randomBytes(24).toString('base64url'); await engine.execute(session, 'staff.save', { name: `Test ${role}`, username: role, role, password: staffPassword }); accounts.push({ workspace: id, username: role, role, password: staffPassword }); }
        await engine.execute(session, 'product.save', { name: 'Test item — sample only', sku: 'TEAM-SAMPLE-1', sellingPrice: 1200, costPrice: 600, openingStock: 50, reorderLevel: 5 });
        await engine.execute(session, 'customer.save', { name: 'Test customer — sample only' }); engine.endSession(session); await syncNow(engine);
        phase(id + ' sandbox subscription');
        const sub = await api('POST', '/v1/admin/billing/subscriptions', { tenantId: client.id, planId: plan.id, paymentMethod: 'manual' }); await api('POST', `/v1/admin/billing/subscriptions/${sub.id}/submit`);
        records.push({ id, label });
      } finally { engine.db.close(); }
    }
    const credentials = join(config.dataDir, 'test-accounts.json'); writeFileSync(credentials, JSON.stringify(accounts, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); chmodSync(credentials, 0o600);
    const temporary = join(config.dataDir, 'workspaces.json.pending'); writeFileSync(temporary, JSON.stringify(records, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temporary, join(config.dataDir, 'workspaces.json'));
    return { existing: false };
  } finally { await api('POST', '/v1/admin/logout').catch(() => {}); }
}
