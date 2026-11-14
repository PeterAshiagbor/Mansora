import { connectPostgres } from './db';
import { buildApp } from './app';
import { apiRuntimeOptions } from './runtime';
import { createBillingFromEnv, runDaily } from './billing';
import { runBugDigest } from './modules/bug-reports';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const runtime = apiRuntimeOptions();
const db = await connectPostgres(url);
const { billing } = createBillingFromEnv(db);
const app = await buildApp({
  ...runtime,
  db,
  billing,
  adminOrigins: (process.env.ADMIN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
// Billing runs every 15 minutes. Every step is idempotent, so overlapping or repeated runs are harmless.
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  // Problem reports go to BUG_REPORT_EMAIL once a day after 19:00 Ghana time.
  await runBugDigest({ db, email: billing.email, to: process.env.BUG_REPORT_EMAIL }).catch((e) => app.log.error(e, 'problem report email failed'));
  try { const r = await runDaily(billing); if (r.cycle.errors.length) app.log.warn({ errors: r.cycle.errors }, 'billing cycle reported errors'); } catch (e) { app.log.error(e, 'billing run failed'); } finally { running = false; }
}, 15 * 60_000);
timer.unref();
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.close().then(() => db.close()).then(() => process.exit(0)));
