import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { stagingConfig } from './config';
import { provisionStaging, testerEmails } from './bootstrap';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void (async () => {
    const config = stagingConfig(); const password = readFileSync(process.env.ADMIN_PASSWORD_FILE ?? '/run/secrets/admin_password', 'utf8').trim(); const email = process.env.ADMIN_EMAIL;
    if (!email || !password) throw new Error('Private administrator bootstrap configuration is required.');
    await provisionStaging(config, { email, password }, testerEmails(process.env.STAGING_TESTER_EMAILS)); console.log('Team staging is provisioned. Tester credentials are in the private staging volume; existing data and passwords were preserved.');
  })().catch((error) => { console.error('Staging error category: ' + (error instanceof Error ? error.name : 'Unknown') + (typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ' (' + error.code + ')' : '')); console.error('Staging provisioning failed. Inspect service health and private configuration; no existing business is reset automatically.'); process.exitCode = 1; });
}
