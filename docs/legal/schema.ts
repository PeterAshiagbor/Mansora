/** Schema-only documentation helper: no application or client records are read. */
import { openDatabase } from '../../apps/desktop/src/core/db';
import { connectEmbedded } from '../../apps/api/src/db';
import { SYNC_TABLES } from '../../packages/domain/src/sync';

export interface TableSchema {
  source: 'laptop' | 'cloud';
  table: string;
  columns: string[];
  tenantIsolated: boolean;
  appendOnly: boolean;
}
export async function readSchema(): Promise<TableSchema[]> {
  const local = openDatabase(':memory:');
  let cloud: Awaited<ReturnType<typeof connectEmbedded>> | undefined;
  try {
    const tables: TableSchema[] = (local.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[]).map(({ name }) => ({
      source: 'laptop', table: name,
      columns: (local.pragma(`table_info("${name.replace(/"/g, '""')}")`) as { name: string }[]).map((column) => column.name),
      tenantIsolated: false,
      appendOnly: !!local.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name = ?").get(name, `${name}_no_delete`),
    }));
    cloud = await connectEmbedded();
    await cloud.migrate();
    // Public catalog metadata is readable under the platform role, without selecting business rows.
    const rows = await cloud.platform((q) => q<{ table_name: string; column_name: string; tenant_isolated: boolean }>(`
      SELECT c.relname AS table_name, a.attname AS column_name,
             (c.relrowsecurity AND c.relforcerowsecurity) AS tenant_isolated
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`));
    for (const row of rows) {
      let table = tables.find((entry) => entry.source === 'cloud' && entry.table === row.table_name);
      if (!table) {
        const spec = (SYNC_TABLES as Record<string, { mode: string }>)[row.table_name];
        table = { source: 'cloud', table: row.table_name, columns: [], tenantIsolated: row.tenant_isolated, appendOnly: spec?.mode === 'insert' || row.table_name === 'admin_audit_logs' };
        tables.push(table);
      }
      table.columns.push(row.column_name);
    }
    return tables.sort((a, b) => `${a.source}.${a.table}`.localeCompare(`${b.source}.${b.table}`));
  } finally { local.close(); await cloud?.close(); }
}
