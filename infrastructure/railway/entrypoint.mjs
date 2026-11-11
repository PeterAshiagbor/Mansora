import { readFileSync, mkdirSync, chmodSync, chownSync } from 'node:fs';
import { createRequire } from 'node:module';
try {
  // Refuse ephemeral image storage: the volume holds encryption keys and real test records.
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH !== '/data' || !readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4] === '/data')) throw new Error('Mount the persistent Railway volume at /data.');
  if (process.getuid() === 0) {
    mkdirSync('/data', { recursive: true }); chownSync('/data', 1000, 1000); chmodSync('/data', 0o700);
    process.setgroups([]); process.setgid(1000); process.setuid(1000);
  }
  await createRequire(import.meta.url)('/app/railway/server.cjs').runRailwayServer();
} catch (error) {
  const category = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : error?.name ?? 'Unknown';
  console.error('Railway startup failed (' + category + '). Verify the persistent /data volume, private PostgreSQL reference, hostname and two tester identities. Existing data and passwords are never reset automatically.');
  process.exitCode = 1;
}
