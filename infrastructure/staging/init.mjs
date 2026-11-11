import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
execFileSync(process.execPath, [fileURLToPath(new URL('../init-secrets.mjs', import.meta.url))], { stdio: 'inherit' });
const directory = new URL('../.secrets/', import.meta.url); await mkdir(directory, { recursive: true, mode: 0o700 });
try { await writeFile(new URL('staging_db_key', directory), randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o644 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
await chmod(new URL('staging_db_key', directory), 0o444);
console.log('Persistent staging key is ready in the private secret directory. Existing keys are preserved.');
