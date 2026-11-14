import { identifier, sha256, validateSnapshot, type SnapshotTable, type SystemSnapshot } from './archive';
export type RecoveryQuery = (sql: string, params?: unknown[]) => Promise<any[]>;
const quote = (name: string) => { if (!identifier(name)) throw new Error('Unsupported recovery database identifier.'); return '"' + name + '"'; };
async function schema(q: RecoveryQuery) {
  const tables = await q(`SELECT c.relname AS name, array_agg(a.attname ORDER BY a.attnum) AS columns,
    array_agg(format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum) AS types,
    array_agg(a.attnotnull ORDER BY a.attnum) AS not_null, bool_or(c.relrowsecurity) AS rls, bool_or(c.relforcerowsecurity) AS force_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    GROUP BY c.relname ORDER BY c.relname`);
  const links = await q(`SELECT child.relname AS name, parent.relname AS dependency FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    WHERE fk.contype = 'f' AND ns.nspname = 'public' AND pn.nspname = 'public' ORDER BY child.relname, parent.relname`);
  const migrations = await q('SELECT id, name FROM public.schema_migrations ORDER BY id');
  for (const table of tables) {
    quote(table.name); if (!Array.isArray(table.columns) || !table.columns.length || !table.columns.every(identifier)) throw new Error('Unsupported recovery database columns.');
    table.dependencies = [...new Set<string>(links.filter(link => link.name === table.name).map(link => link.dependency))].sort();
  }
  const constraints = await q(`SELECT child.relname AS table_name, con.conname, con.contype, con.condeferrable, con.condeferred, pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con JOIN pg_class child ON child.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
    WHERE ns.nspname='public' ORDER BY child.relname, con.conname`);
  const policies = await q("SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname");
  const grants = await q("SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('mansora_platform','mansora_tenant','mansora_runtime') ORDER BY grantee,table_name,privilege_type");
  const indexes = await q("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname");
  const version = await q("SELECT current_setting('server_version_num')::integer / 10000 AS major");
  return { tables, hash: sha256(JSON.stringify({ migrations, tables, constraints, policies, grants, indexes, version })) };
}
/** Caller owns a dedicated administrator transaction. Runtime RLS roles are never widened. */
export async function capturePostgres(q: RecoveryQuery): Promise<Pick<SystemSnapshot, 'schemaHash' | 'tables'>> {
  await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await q('SAVEPOINT mansora_recovery_capture');
  const layout = await schema(q), tables: SnapshotTable[] = []; let bytes = 0;
  for (const table of layout.tables) {
    const rows: string[] = [], columns = table.columns.map(quote).join(', ');
    await q(`DECLARE mansora_recovery_cursor NO SCROLL CURSOR FOR SELECT row_to_json(snapshot_row)::text AS row_json FROM (SELECT ${columns} FROM public.${quote(table.name)}) snapshot_row`);
    try {
      while (true) {
        const batch = await q('FETCH FORWARD 256 FROM mansora_recovery_cursor'); if (!batch.length) break;
        for (const row of batch) { if (typeof row.row_json !== 'string') throw new Error('Recovery row serialization failed.'); bytes += Buffer.byteLength(row.row_json); if (bytes > 16 * 1024 * 1024) throw new Error('Database snapshot exceeds the reviewed size limit.'); rows.push(row.row_json); }
      }
    } finally { await q('CLOSE mansora_recovery_cursor'); }
    tables.push({ name: table.name, columns: table.columns, dependencies: table.dependencies, rows });
  }
  await q('RELEASE SAVEPOINT mansora_recovery_capture');
  return { schemaHash: layout.hash, tables };
}
/** Empty destination only. Cyclic foreign keys validate atomically before original constraint modes are restored. */
export async function restorePostgres(q: RecoveryQuery, snapshot: SystemSnapshot) {
  validateSnapshot(snapshot); await q('SAVEPOINT mansora_recovery_restore'); const layout = await schema(q);
  if (layout.hash !== snapshot.schemaHash || layout.tables.length !== snapshot.tables.length) throw new Error('Restore schema differs from the captured schema; preserve both for review.');
  for (const table of snapshot.tables) {
    const actual = layout.tables.find(candidate => candidate.name === table.name);
    if (!actual || JSON.stringify(actual.columns) !== JSON.stringify(table.columns) || JSON.stringify(actual.dependencies) !== JSON.stringify(table.dependencies)) throw new Error('Restore table metadata differs from the captured schema.');
    if ((await q(`SELECT EXISTS (SELECT 1 FROM public.${quote(table.name)} LIMIT 1) AS occupied`))[0].occupied) throw new Error('Restore database must be empty; existing data is never overwritten.');
  }
  const foreignKeys = await q(`SELECT child.relname AS table_name, fk.conname AS constraint_name, fk.condeferrable AS deferrable
    FROM pg_constraint fk JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND ns.nspname = 'public' ORDER BY child.relname, fk.conname`);
  for (const fk of foreignKeys) if (!fk.deferrable) await q(`ALTER TABLE public.${quote(fk.table_name)} ALTER CONSTRAINT ${quote(fk.constraint_name)} DEFERRABLE INITIALLY DEFERRED`);
  await q('SET CONSTRAINTS ALL DEFERRED');
  const done = new Set<string>();
  for (const table of snapshot.tables) {
    const columns = table.columns.map(quote).join(', ');
    for (let offset = 0; offset < table.rows.length; offset += 100) await q(`INSERT INTO public.${quote(table.name)} (${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM json_populate_recordset(NULL::public.${quote(table.name)}, $1::json)`, ['[' + table.rows.slice(offset, offset + 100).join(',') + ']']);
    if ((await q(`SELECT count(*)::text AS count FROM public.${quote(table.name)}`))[0].count !== String(table.rows.length)) throw new Error('Restored row count differs; preserve the destination for review.');
    done.add(table.name);
  }
  await q('SET CONSTRAINTS ALL IMMEDIATE');
  for (const fk of foreignKeys) if (!fk.deferrable) await q(`ALTER TABLE public.${quote(fk.table_name)} ALTER CONSTRAINT ${quote(fk.constraint_name)} NOT DEFERRABLE`);
  const sequences = await q(`SELECT table_name, column_name, pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) AS sequence
    FROM information_schema.columns WHERE table_schema = 'public' AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`);
  for (const sequence of sequences) if (sequence.sequence && done.has(sequence.table_name)) await q(`SELECT setval($1::regclass, GREATEST(COALESCE((SELECT max(${quote(sequence.column_name)}) FROM public.${quote(sequence.table_name)}), 0), 1), EXISTS (SELECT 1 FROM public.${quote(sequence.table_name)}))`, [sequence.sequence]);
  await q('RELEASE SAVEPOINT mansora_recovery_restore');
  return { tables: done.size, rows: snapshot.tables.reduce((count, table) => count + table.rows.length, 0) };
}
