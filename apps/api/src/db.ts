import { MIGRATIONS } from './migrations';

export type Query = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;

interface Driver {
  tx<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Database access is only possible through one of two doors:
 *   platform(fn) - Mansora administration data; cannot see any business table.
 *   tenant(id, fn) - one business's data; row-level security hides all others.
 */
export class Database {
  constructor(private driver: Driver) {}

  platform<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    return this.driver.tx(async (q) => {
      await q('SET LOCAL ROLE mansora_platform');
      return fn(q);
    });
  }

  async tenant<T>(tenantId: string, fn: (q: Query) => Promise<T>): Promise<T> {
    if (!UUID.test(tenantId)) throw new Error('Invalid tenant id');
    return this.driver.tx(async (q) => {
      await q('SET LOCAL ROLE mansora_tenant');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return fn(q);
    });
  }

  async migrate(): Promise<void> {
    await this.driver.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = await this.driver.tx((q) => q<{ id: number }>('SELECT id FROM schema_migrations'));
    for (const m of MIGRATIONS) {
      if (done.some((d) => d.id === m.id)) continue;
      await this.driver.exec(`BEGIN;\n${m.sql}\nINSERT INTO schema_migrations (id, name) VALUES (${m.id}, '${m.name}');\nCOMMIT;`);
    }
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}

const normalise = (rows: any[]) =>
  rows.map((r) => {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (typeof v === 'bigint') r[k] = Number(v);
      else if (v instanceof Date) r[k] = v.toISOString();
    }
    return r;
  });

/** Production driver: node-postgres connection pool. */
export async function connectPostgres(connectionString: string): Promise<Database> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v: string) => Number(v)); // int8: all our amounts fit in a JS safe integer
  pg.types.setTypeParser(1082, (v: string) => v); // date stays YYYY-MM-DD
  const pool = new pg.Pool({ connectionString, max: 10 });
  return new Database({
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(async (sql, params) => normalise((await client.query(sql, params as any[])).rows));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => void (await pool.query(sql)),
    close: () => pool.end(),
  });
}

/** Embedded PostgreSQL (PGlite) for automated tests and the local demo. Same SQL, same row-level security. */
export async function connectEmbedded(dataDir?: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  // Match node-postgres, where we keep DATE columns as YYYY-MM-DD text.
  const db = await PGlite.create(dataDir);
  const parsers = { 1082: (v: string) => v };
  return new Database({
    tx: (fn) => db.transaction((t) => fn(async (sql, params) => normalise((await t.query(sql, params as any[], { parsers })).rows as any[]))) as Promise<any>,
    exec: async (sql) => void (await db.exec(sql)),
    close: () => db.close(),
  });
}
