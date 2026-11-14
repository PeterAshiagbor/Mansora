import { runScheduledBackup, syncNow } from '../../apps/desktop/src/core';
import { gatewayPolicyFromEnv } from './gateway-policy';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLoginAliases } from './accounts';
import { stagingConfig, loadWorkspaces } from './config';
import { startStagingGateway } from './gateway';
import type { OwnerRecovery } from './owner-recovery';
import type { WorkspaceOnboarding } from './workspace-onboarding';
import type { StagingWorkspace } from './gateway';
export async function startConfiguredStaging(readiness?: () => Promise<boolean>, beforeListen?: (workspaces: StagingWorkspace[]) => Promise<void>, onboarding?: WorkspaceOnboarding, ownerRecovery?: OwnerRecovery) {
  const config = stagingConfig(), workspaces = loadWorkspaces(config), policy = gatewayPolicyFromEnv(process.env, config.mode);
  const manifest = join(config.dataDir, 'test-accounts.json');
  const testWorkspaceIds: string[] = existsSync(manifest) ? [...new Set<string>(JSON.parse(readFileSync(manifest, 'utf8')).map((a: any) => a.workspace))] : [];
  let gateway: Awaited<ReturnType<typeof startStagingGateway>>;
  try { await beforeListen?.(workspaces); gateway = await startStagingGateway({ ...config, ...policy, testWorkspaceIds, workspaces, loginAliases: loadLoginAliases(config.dataDir), readiness, onboarding, ownerRecovery, host: process.env.STAGING_BIND_HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 4500) }); try { onboarding?.attach(workspaces, gateway.registerWorkspace); ownerRecovery?.attach(workspaces); } catch (error) { await gateway.close(); throw error; } }
  catch (e) { for (const w of workspaces) w.engine.db.close(); throw e; }
  const running = new Set<string>();
  let backgroundPaused = false, stopping = false, snapshot: Promise<unknown> | undefined;
  const timer = setInterval(() => { if (backgroundPaused) return; for (const w of workspaces) { if (running.has(w.id)) continue; running.add(w.id); void syncNow(w.engine).catch(() => {}).finally(() => running.delete(w.id)); } }, 15_000); timer.unref();
  const backups = setInterval(() => { if (backgroundPaused) return; for (const w of workspaces) { const key = 'backup:' + w.id; if (running.has(key)) continue; running.add(key); void runScheduledBackup(w.engine).catch(() => {}).finally(() => running.delete(key)); } }, 3_600_000); backups.unref();
  const withSnapshotLock = async <T>(capture: (active: StagingWorkspace[]) => Promise<T>): Promise<T> => {
    if (snapshot || stopping) throw new Error('Recovery snapshot is unavailable during another snapshot or shutdown.');
    backgroundPaused = true;
    snapshot = gateway.withSnapshotLock(async () => {
      const deadline = Date.now() + 30_000;
      while (running.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (running.size) throw new Error('Background work did not finish; the recovery snapshot was cancelled.');
      return capture(workspaces);
    });
    try { return await snapshot as T; } finally { snapshot = undefined; backgroundPaused = false; }
  };
  return { ...gateway, withSnapshotLock, close: async () => { stopping = true; clearInterval(timer); clearInterval(backups); await snapshot?.catch(() => {}); await gateway.close(); await ownerRecovery?.close();
    const deadline = Date.now() + 30_000; while (running.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    if (running.size) throw new Error('Sync still running during shutdown; let the container exit without closing active stores.');
    for (const w of workspaces) w.engine.db.close(); } };
}
