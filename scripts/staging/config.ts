import { hkdfSync } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { deploymentMode, type DeploymentMode } from './gateway-policy';
import { openEngine } from '../../apps/desktop/src/core';
import { stagingOrigin, type StagingWorkspace } from './gateway';
export interface WorkspaceRecord { id: string; label: string; tenantId?: string; ownerEmail?: string; ownerUsername?: string }
export function stagingConfig() {
  const mode = deploymentMode();
  const origin = stagingOrigin(process.env.STAGING_ORIGIN ?? '').origin;
  const apiUrl = process.env.STAGING_API_URL ?? 'http://127.0.0.1:4000';
  const api = new URL(apiUrl);
  if (!['localhost', '127.0.0.1'].includes(api.hostname) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new Error('Staging must use the loopback API in its shared private network namespace, never a production endpoint.');
  if (process.env.PAYSTACK_SECRET_KEY || process.env.HUBTEL_CLIENT_SECRET) throw new Error('Live payment credentials are not allowed in the staging gateway.');
  const key = readFileSync(process.env.STAGING_DB_KEY_FILE ?? '/run/secrets/staging_db_key', 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('The persistent staging database key must contain 32 random bytes encoded as hex.');
  return { mode, origin, apiUrl, dataDir: resolve(process.env.STAGING_DATA_DIR ?? '/data/staging'), key,
    clientDir: resolve(process.env.STAGING_CLIENT_DIR ?? 'apps/desktop/dist/renderer'), adminDir: resolve(process.env.STAGING_ADMIN_DIR ?? 'apps/admin-web/dist') };
}
export type StagingConfig = Omit<ReturnType<typeof stagingConfig>, 'mode'> & { mode?: DeploymentMode };
export function workspaceKey(key: string, id: string) { return Buffer.from(hkdfSync('sha256', Buffer.from(key, 'hex'), Buffer.from(id), Buffer.from('mansora-team-staging-v1'), 32)).toString('hex'); }
export function readWorkspaceRecords(config: StagingConfig): WorkspaceRecord[] {
  const registry = join(config.dataDir, 'workspaces.json');
  if (!existsSync(registry)) throw new Error('Run the staging bootstrap service before starting the gateway.');
  const records = JSON.parse(readFileSync(registry, 'utf8')) as WorkspaceRecord[];
  if (!Array.isArray(records) || (!records.length && config.mode !== 'client') || records.length > 10 || records.some(w => !w || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(w.id) || typeof w.label !== 'string' || w.label.length > 120) || new Set(records.map(w => w.id)).size !== records.length) throw new Error('Invalid staging workspace registry.');
  for (const w of records) if ([w.tenantId, w.ownerEmail, w.ownerUsername].some(value => value !== undefined) && (typeof w.tenantId !== "string" || w.id !== "shop-" + w.tenantId || !/^[a-f0-9-]{36}$/.test(w.tenantId) || typeof w.ownerEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.ownerEmail) || typeof w.ownerUsername !== "string" || !/^owner-[a-f0-9]{12}$/.test(w.ownerUsername))) throw new Error("Invalid browser workspace owner registry.");
  return records;
}
export function loadWorkspaces(config: StagingConfig): StagingWorkspace[] {
  const records = readWorkspaceRecords(config);
  const opened: StagingWorkspace[] = [];
  try {
    for (const w of records) {
      const engine = openEngine({ dataDir: join(config.dataDir, 'workspaces', w.id), dbKey: workspaceKey(config.key, w.id), appVersion: '0.1.0-team-staging' });
      opened.push({ ...w, engine });
      if (!engine.activated) throw new Error(`Test workspace ${w.id} was not provisioned. Existing records will not be overwritten.`);
    }
    return opened;
  } catch (e) { for (const w of opened) w.engine.db.close(); throw e; }
}
