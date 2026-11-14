import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { stagingOrigin } from '../staging/gateway';
import { assertTestPaymentKeysOnly, deploymentMode } from '../staging/gateway-policy';
import { testerEmails, testerPasswords } from '../staging/accounts';

/** Railway supplies only the private PostgreSQL reference, public hostname and tester identities. */
export function railwayConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = deploymentMode(env);
  assertTestPaymentKeysOnly(env);
  const origin = stagingOrigin(env.STAGING_ORIGIN || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')).origin;
  const db = new URL(env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.password || !db.pathname.slice(1) || !(['localhost', '127.0.0.1', 'postgres'].includes(db.hostname) || db.hostname.endsWith('.railway.internal'))) throw new Error('A dedicated private Railway PostgreSQL DATABASE_URL reference is required.');
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 4000) throw new Error('Choose a valid public port distinct from the loopback API port 4000.');
  const emails = testerEmails(env.STAGING_TESTER_EMAILS);
  if (mode === 'team-test' && emails.length !== 2) throw new Error('Two tester identities are required.');
  const passwords = testerPasswords(env.STAGING_TESTER_PASSWORDS);
  return { mode, passwords, origin, databaseUrl: db.toString(), port, emails, dataDir: '/data', adminEmail: 'staging.operator@mansora.example' };
}
export function persistentSecret(directory: string, name: string, encoding: 'hex' | 'base64' = 'hex'): string {
  if (!/^[a-z][a-z0-9_-]+$/.test(name)) throw new Error('Invalid secret identifier.');
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const file = join(directory, name);
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString(encoding) + '\n', { flag: 'wx', mode: 0o600 });
  const value = readFileSync(file, 'utf8').trim();
  if ((encoding === 'hex' && !/^[a-f0-9]{64}$/.test(value)) || (encoding === 'base64' && (!/^[a-zA-Z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32))) throw new Error('A persisted secret is invalid; existing keys will not be replaced.');
  chmodSync(file, 0o600); return value;
}
