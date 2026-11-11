import type { AppOptions } from './app';
import { backupStorageFromEnv } from './storage';

/** One reviewed configuration path for the normal API and Railway composition. */
export function apiRuntimeOptions(env: NodeJS.ProcessEnv = process.env, fallbackBackupDir = './data/backups'): Pick<AppOptions, 'backupDir' | 'backupStorage' | 'logger' | 'metricsToken' | 'errorWebhookUrl' | 'trustProxy'> {
  const backupDir = env.BACKUP_DIR || fallbackBackupDir;
  return {
    backupDir,
    backupStorage: backupStorageFromEnv({ ...env, BACKUP_DIR: backupDir }),
    logger: true,
    metricsToken: env.METRICS_TOKEN,
    errorWebhookUrl: env.ERROR_WEBHOOK_URL,
    trustProxy: (env.TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean),
  };
}
