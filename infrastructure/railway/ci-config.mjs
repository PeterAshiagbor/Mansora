import { readFileSync, writeFileSync } from 'node:fs';
const password = readFileSync(new URL('../.secrets/postgres_password', import.meta.url), 'utf8').trim();
const url = new URL('postgres://postgres:5432/railway'); url.username = 'postgres'; url.password = password;
writeFileSync(new URL('../.secrets/railway-test.env', import.meta.url), 'RAILWAY_TEST_DATABASE_URL=' + url.toString() + '\n', { mode: 0o600 });
console.log('Private Railway CI reference prepared. No credential values are logged.');
