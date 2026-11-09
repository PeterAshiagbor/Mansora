import { connectPostgres } from './db';
import { buildApp } from './app';
import { backupStorageFromEnv } from './storage';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const backupStorage = backupStorageFromEnv();
const db = await connectPostgres(url);
const app = await buildApp({
  db,
  backupDir: process.env.BACKUP_DIR ?? './data/backups',
  backupStorage,
  adminOrigins: (process.env.ADMIN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  logger: true,
  trustProxy: (process.env.TRUSTED_PROXIES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.close().then(() => db.close()).then(() => process.exit(0)));
