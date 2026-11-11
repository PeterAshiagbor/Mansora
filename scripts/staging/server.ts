import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScheduledBackup, syncNow } from '../../apps/desktop/src/core';
import { stagingConfig, loadWorkspaces } from './config';
import { startStagingGateway } from './gateway';
export async function startConfiguredStaging() {
  const config = stagingConfig(), workspaces = loadWorkspaces(config);
  let gateway: Awaited<ReturnType<typeof startStagingGateway>>;
  try { gateway = await startStagingGateway({ ...config, workspaces, host: process.env.STAGING_BIND_HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 4500) }); }
  catch (e) { for (const w of workspaces) w.engine.db.close(); throw e; }
  const running = new Set<string>();
  const timer = setInterval(() => { for (const w of workspaces) { if (running.has(w.id)) continue; running.add(w.id); void syncNow(w.engine).catch(() => {}).finally(() => running.delete(w.id)); } }, 15_000); timer.unref();
  const backups = setInterval(() => { for (const w of workspaces) void runScheduledBackup(w.engine).catch(() => {}); }, 3_600_000); backups.unref();
  return { ...gateway, close: async () => { clearInterval(timer); clearInterval(backups); await gateway.close();
    const deadline = Date.now() + 30_000; while (running.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    if (running.size) throw new Error('Sync still running during shutdown; let the container exit without closing active stores.');
    for (const w of workspaces) w.engine.db.close(); } };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void startConfiguredStaging().then(host => {
    console.log('Mansora team staging is running. Test accounts are required; records persist in the staging volume.');
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (stopping) return; stopping = true; void host.close().then(() => process.exit(0), () => process.exit(1)); });
  }).catch(() => { console.error('Staging did not start. Check the private configuration, provisioned stores and persistent key.'); process.exitCode = 1; });
}
