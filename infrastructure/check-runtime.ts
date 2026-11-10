import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { connectPostgres } from '../apps/api/src/db';
assert.notEqual(process.getuid?.(), 0, 'API must run as a non-root user');
await assert.rejects(writeFile('/home/node/readonly-probe', ''), (err: any) => err.code === 'EROFS');
for (const name of ['tsx', 'typescript', 'vitest', 'esbuild', 'vite', '@electric-sql/pglite', 'better-sqlite3-multiple-ciphers']) await assert.rejects(access(`/app/node_modules/${name}`));
await assert.rejects(access('/run/secrets/migration_password'));
const db = await connectPostgres(process.env.DATABASE_URL!);
try {
  const [role] = await db.platform((q) => q(`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = session_user`));
  assert.equal(role.rolname, 'mansora_runtime');
  for (const flag of ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolbypassrls']) assert.equal(role[flag], false);
  const [membership] = await db.platform((q) => q(`SELECT pg_has_role(session_user, 'mansora_migration', 'MEMBER') AS allowed`));
  assert.equal(membership.allowed, false);
  await assert.rejects(db.platform((q) => q('SET LOCAL ROLE mansora_migration')), /permission denied/);
  await assert.rejects(db.platform((q) => q('CREATE TABLE forbidden_probe (id integer)')), /permission denied/);
  await assert.rejects(db.platform((q) => q('SELECT * FROM sales LIMIT 1')), /permission denied/);
  console.log('Non-root, read-only filesystem, production dependencies and runtime role boundaries verified.');
} finally { await db.close(); }
