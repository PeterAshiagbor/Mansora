import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const mode = process.argv[2] ?? 'api';
const targets = { api: ['apps/api/dist/server.js'], migrate: ['apps/api/dist/cli.js', 'migrate'], bootstrap: ['infrastructure/dist/admin-bootstrap.js'], check: ['infrastructure/dist/check-runtime.js'], smoke: ['infrastructure/smoke.mjs'] };
if (!(mode in targets)) throw new Error('Use api, migrate, bootstrap, check or smoke');
const env = { ...process.env };
if (!env.DATABASE_URL && mode !== 'smoke') {
  if (!env.DATABASE_PASSWORD_FILE || !env.DATABASE_USER) throw new Error('Database user and secret file are required');
  const password = (await readFile(env.DATABASE_PASSWORD_FILE, 'utf8')).trim();
  const url = new URL(`postgres://${env.DATABASE_HOST ?? 'postgres'}:${env.DATABASE_PORT ?? '5432'}/${env.DATABASE_NAME ?? 'mansora'}`);
  url.username = env.DATABASE_USER; url.password = password;
  env.DATABASE_URL = url.toString();
}
if (env.ADMIN_TOTP_KEY_FILE) env.ADMIN_TOTP_KEY = (await readFile(env.ADMIN_TOTP_KEY_FILE, 'utf8')).trim();
if (env.BILLING_ENCRYPTION_KEY_FILE) env.BILLING_ENCRYPTION_KEY = (await readFile(env.BILLING_ENCRYPTION_KEY_FILE, 'utf8')).trim();
if (env.PAY_LINK_SECRET_FILE) env.PAY_LINK_SECRET = (await readFile(env.PAY_LINK_SECRET_FILE, 'utf8')).trim();
if (mode === 'bootstrap') env.ADMIN_PASSWORD = (await readFile(env.ADMIN_PASSWORD_FILE, 'utf8')).trim();
const [entry, ...args] = targets[mode];
const child = spawn(process.execPath, [`/app/${entry}`, ...args], { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Could not start container command'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
