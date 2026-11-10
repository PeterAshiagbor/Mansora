import { randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
const directory = new URL('./.secrets/', import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
for (const name of ['postgres_password', 'migration_password', 'runtime_password', 'admin_password', 'admin_totp_key']) {
  const content = randomBytes(name === 'admin_totp_key' ? 32 : 24).toString(name === 'admin_totp_key' ? 'base64' : 'hex');
  try {
    // The parent directory is private. Docker bind-mounted secret files must be
    // readable by both the PostgreSQL and Node container UIDs.
    await writeFile(new URL(name, directory), content + '\n', { flag: 'wx', mode: 0o644 });
  } catch (err) { if (err.code !== 'EEXIST') throw err; }
  // Explicit chmod also handles hosts whose umask removes group/other reads.
  await chmod(new URL(name, directory), 0o444);
}
console.log('Local secrets are ready in infrastructure/.secrets (existing files were preserved).');
