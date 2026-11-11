import pg from 'pg';
import { connectPostgres } from '../../apps/api/src/db';

const quoteIdentifier = (v: string) => '"' + v.replace(/"/g, '""') + '"';
/** Bootstrap only. Request handling connects exclusively as mansora_runtime. */
export async function prepareRailwayDatabase(adminUrl: string, passwords: { migration: string; runtime: string }) {
  if (Object.values(passwords).some(p => !/^[a-f0-9]{64}$/.test(p))) throw new Error('Invalid private database credential.');
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  const connection = await pool.connect();
  try {
    await connection.query('SELECT pg_advisory_lock(73109742)');
    await connection.query('BEGIN');
    for (const role of ['mansora_platform', 'mansora_tenant']) {
      const exists = await connection.query('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1', [role]);
      if (!exists.rowCount) await connection.query(`CREATE ROLE ${role} NOLOGIN`);
      else if (exists.rows[0].rolsuper || exists.rows[0].rolcreatedb || exists.rows[0].rolcreaterole || exists.rows[0].rolbypassrls || exists.rows[0].rolcanlogin) throw new Error('Existing data-access role has unsafe privileges.');
    }
    for (const [role, password] of [['mansora_migration', passwords.migration], ['mansora_runtime', passwords.runtime]]) {
      const found = await connection.query('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1', [role]);
      if (!found.rowCount) await connection.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
      else if (found.rows[0].rolsuper || found.rows[0].rolcreatedb || found.rows[0].rolcreaterole || found.rows[0].rolbypassrls || !found.rows[0].rolcanlogin || found.rows[0].rolinherit) throw new Error('Existing application database role has unsafe privileges.');
    }
    await connection.query('GRANT mansora_platform, mansora_tenant TO mansora_migration WITH ADMIN OPTION');
    await connection.query('GRANT mansora_platform, mansora_tenant TO mansora_runtime');
    const [{ name }] = (await connection.query('SELECT current_database() AS name')).rows;
    await connection.query(`REVOKE CONNECT ON DATABASE ${quoteIdentifier(name)} FROM PUBLIC`);
    await connection.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(name)} TO mansora_migration, mansora_runtime`);
    await connection.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await connection.query('ALTER SCHEMA public OWNER TO mansora_migration');
    await connection.query('GRANT USAGE ON SCHEMA public TO mansora_runtime, mansora_platform, mansora_tenant');
    await connection.query('COMMIT');
    const urlFor = (username: string, password: string) => { const url = new URL(adminUrl); url.username = username; url.password = password; return url.toString(); };
    const migrationUrl = urlFor('mansora_migration', passwords.migration), runtimeUrl = urlFor('mansora_runtime', passwords.runtime);
    const migration = await connectPostgres(migrationUrl);
    try { await migration.migrate(); } finally { await migration.close(); }
    const runtime = await connectPostgres(runtimeUrl);
    try {
      const [role] = await runtime.platform(q => q('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, pg_has_role(session_user, $1, $2) AS can_migrate FROM pg_roles WHERE rolname = session_user', ['mansora_migration', 'MEMBER']));
      if (role.rolname !== 'mansora_runtime' || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls || role.can_migrate) throw new Error('Runtime database role is not restricted.');
    } finally { await runtime.close(); }
    return runtimeUrl;
  } catch (error) { await connection.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await connection.query('SELECT pg_advisory_unlock(73109742)').catch(() => {}); connection.release(); await pool.end(); }
}
