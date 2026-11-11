import { runScheduledBackup, syncNow } from '../../apps/desktop/src/core';
import { loadLoginAliases } from './accounts';
import { stagingConfig, loadWorkspaces } from './config';
import { startStagingGateway } from './gateway';
export async function startConfiguredStaging(readiness?: () => Promise<boolean>) {
  const config = stagingConfig(), workspaces = loadWorkspaces(config);
  let gateway: Awaited<ReturnType<typeof startStagingGateway>>;
  try { gateway = await startStagingGateway({ ...config, workspaces, loginAliases: loadLoginAliases(config.dataDir), readiness, host: process.env.STAGING_BIND_HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 4500) }); }
  catch (e) { for (const w of workspaces) w.engine.db.close(); throw e; }
  const running = new Set<string>();
  const timer = setInterval(() => { for (const w of workspaces) { if (running.has(w.id)) continue; running.add(w.id); void syncNow(w.engine).catch(() => {}).finally(() => running.delete(w.id)); } }, 15_000); timer.unref();
  const backups = setInterval(() => { for (const w of workspaces) { const key = 'backup:' + w.id; if (running.has(key)) continue; running.add(key); void runScheduledBackup(w.engine).catch(() => {}).finally(() => running.delete(key)); } }, 3_600_000); backups.unref();
  return { ...gateway, close: async () => { clearInterval(timer); clearInterval(backups); await gateway.close();
    const deadline = Date.now() + 30_000; while (running.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    if (running.size) throw new Error('Sync still running during shutdown; let the container exit without closing active stores.');
    for (const w of workspaces) w.engine.db.close(); } };
}
