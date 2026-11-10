import { connectPostgres } from './db';
import { buildApp } from './app';
import { backupStorageFromEnv } from './storage';
import { createBillingFromEnv, runDaily } from './billing';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const backupStorage = backupStorageFromEnv();
const db = await connectPostgres(url);
const { billing } = createBillingFromEnv(db);
const app = await buildApp({
  db,
  billing,
  backupDir: process.env.BACKUP_DIR ?? './data/backups',
  backupStorage,
  adminOrigins: (process.env.ADMIN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  logger: true,
  metricsToken: process.env.METRICS_TOKEN,
  errorWebhookUrl: process.env.ERROR_WEBHOOK_URL,
  trustProxy: (process.env.TRUSTED_PROXIES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
// Billing runs every 15 minutes. Every step is idempotent, so overlapping or repeated runs are harmless.
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try { const r = await runDaily(billing); if (r.cycle.errors.length) app.log.warn({ errors: r.cycle.errors }, 'billing cycle reported errors'); } catch (e) { app.log.error(e, 'billing run failed'); } finally { running = false; }
}, 15 * 60_000);
timer.unref();
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.close().then(() => db.close()).then(() => process.exit(0)));
