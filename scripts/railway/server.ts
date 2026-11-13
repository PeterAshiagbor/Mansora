import { browserOwnerRecoveryIssuer } from '../../apps/api/src/browser-workspaces';
import { createOwnerRecovery, type OwnerRecovery } from '../staging/owner-recovery';
import { join } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { connectPostgres } from '../../apps/api/src/db';
import { buildApp } from '../../apps/api/src/app';
import { createAdmin } from '../../apps/api/src/modules/admin';
import { createBillingFromEnv, runDaily } from '../../apps/api/src/billing';
import { railwayConfig, persistentSecret } from './config';
import { prepareRailwayDatabase } from './database';
import { provisionStaging } from '../staging/bootstrap';
import { stagingConfig } from '../staging/config';
import { startConfiguredStaging } from '../staging/server';
import { inviteTesters } from '../staging/invitations';
import { apiRuntimeOptions } from '../../apps/api/src/runtime';
import { seedTestWorkspaces } from '../staging/sample-data';
import { createWorkspaceOnboarding } from '../staging/workspace-onboarding';

export async function runRailwayServer() {
  if (process.getuid?.() === 0) throw new Error('Drop root privileges before starting the application.');
  const config = railwayConfig(), directory = join(config.dataDir, 'secrets');
  const migration = persistentSecret(directory, 'migration_password'), runtime = persistentSecret(directory, 'runtime_password');
  const adminPassword = persistentSecret(directory, 'operator_password'); persistentSecret(directory, 'staging_db_key');
  const totp = persistentSecret(directory, 'admin_totp_key', 'base64'), billingKey = persistentSecret(directory, 'billing_encryption_key', 'base64'), payLink = persistentSecret(directory, 'pay_link_secret');
  console.log('Railway setup: restricted database roles and reviewed migrations.');
  const runtimeUrl = await prepareRailwayDatabase(config.databaseUrl, { migration, runtime });
  Object.assign(process.env, { DATABASE_URL: runtimeUrl, ADMIN_TOTP_KEY: totp, BILLING_ENCRYPTION_KEY: billingKey, PAY_LINK_SECRET: payLink,
    PUBLIC_BASE_URL: config.origin + '/api', BILLING_ALLOW_SANDBOX: '1', BILLING_SANDBOX: '1', PORT: String(config.port),
    STAGING_ORIGIN: config.origin, STAGING_API_URL: 'http://127.0.0.1:4000', STAGING_DATA_DIR: join(config.dataDir, 'staging'), STAGING_DB_KEY_FILE: join(directory, 'staging_db_key') });
  const db = await connectPostgres(runtimeUrl);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined, gateway: Awaited<ReturnType<typeof startConfiguredStaging>> | undefined;
  let recovery: OwnerRecovery | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await db.platform(async q => { if (!(await q('SELECT id FROM admins WHERE email = $1', [config.adminEmail])).length) await createAdmin(q, { email: config.adminEmail, name: 'Staging operator', password: adminPassword }); });
    const operatorFile = join(directory, 'operator-account.json');
    if (!existsSync(operatorFile)) writeFileSync(operatorFile, JSON.stringify({ email: config.adminEmail, password: adminPassword }) + '\n', { flag: 'wx', mode: 0o600 });
    if (process.env.STAGING_TESTER_INVITATION_ID) {
      process.env.RESEND_ALLOWED_RECIPIENTS = [...new Set([...(process.env.RESEND_ALLOWED_RECIPIENTS ?? '').split(',').filter(Boolean), ...config.emails])].join(',');
    }
    const { billing } = createBillingFromEnv(db);
    const [operator] = await db.platform(q => q<{ id: string }>('SELECT id FROM admins WHERE email = $1', [config.adminEmail]));
    recovery = createOwnerRecovery({ config: stagingConfig(), email: billing.email, issueCode: browserOwnerRecoveryIssuer(db, operator.id), onFailure: () => console.warn('Owner recovery email needs review; no private message content is logged.') });
    const onboarding = createWorkspaceOnboarding(stagingConfig());
    app = await buildApp({ ...apiRuntimeOptions(process.env, join(config.dataDir, 'cloud-backups')), db, billing, browserWorkspaces: onboarding, adminOrigins: [config.origin], adminUrl: `${config.origin}/admin/` });
    await app.listen({ host: '127.0.0.1', port: 4000 });
    if (config.mode === 'team-test') await provisionStaging(stagingConfig(), { email: config.adminEmail, password: adminPassword }, config.emails, config.passwords);
    else {
      const dataDir = join(config.dataDir, 'staging'); mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      if (!existsSync(join(dataDir, 'workspaces.json'))) writeFileSync(join(dataDir, 'workspaces.json'), '[]\n', { mode: 0o600, flag: 'wx' });
    }
    gateway = await startConfiguredStaging(async () => { const r = await fetch('http://127.0.0.1:4000/health/ready', { signal: AbortSignal.timeout(3000) }); return r.ok; }, async workspaces => {
      const result = await inviteTesters({ id: config.mode === 'team-test' ? process.env.STAGING_TESTER_INVITATION_ID : undefined, dataDir: join(config.dataDir, 'staging'), origin: config.origin, workspaces, email: billing.email, onActivated: async (tenantId, email) => {
        await db.platform(async q => {
          await q("UPDATE tenants SET email = $2 WHERE id = $1 AND (email IS NULL OR email LIKE '%@mansora.example')", [tenantId, email]);
          await q("UPDATE billing_accounts SET billing_email = $2 WHERE tenant_id = $1 AND (billing_email IS NULL OR billing_email LIKE '%@mansora.example')", [tenantId, email]);
        });
      } });
      if (!result.disabled) console.log(`Tester invitations: ${result.accepted} accepted, ${result.activated} activated, ${result.waiting} awaiting setup or review.`);
      if (result.failureReasons.length) console.warn('Tester invitation status: ' + result.failureReasons.join(', '));
      if (config.mode === 'team-test' && process.env.STAGING_SAMPLE_DATA_VERSION) {
        let prepared = 0, preserved = 0, pending = 0;
        for (const workspace of workspaces) {
          try {
            const samples = await seedTestWorkspaces({ mode: config.mode, version: process.env.STAGING_SAMPLE_DATA_VERSION, dataDir: join(config.dataDir, 'staging'), workspaces: [workspace] });
            prepared += samples.prepared; preserved += samples.preserved;
          } catch { pending++; }
        }
        // Keep existing access available if an account password changed or a data pack needs review.
        console.log(`Sample test data: ${prepared} workspaces prepared, ${preserved} preserved, ${pending} awaiting review.`);
      }
    }, onboarding, recovery);
    let billingRun: Promise<unknown> | undefined;
    timer = setInterval(() => { if (billingRun) return; billingRun = runDaily(billing).catch(() => console.error('Sandbox billing job failed; inspect application health.')).finally(() => { billingRun = undefined; }); }, 15 * 60_000); timer.unref();
    let stopping = false;
    const close = async () => { if (stopping) return; stopping = true; clearInterval(timer); await gateway!.close(); await billingRun; await app!.close(); await db.close(); };
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void close().then(() => process.exit(0), () => process.exit(1)); });
    console.log('Railway team testing is ready. Retrieve assigned accounts privately from the persistent volume.');
    return { app, gateway, db, close };
  } catch (error) { clearInterval(timer); await gateway?.close(); await recovery?.close(); await app?.close(); await db.close(); throw error; }
}
