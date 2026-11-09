import Database from 'better-sqlite3-multiple-ciphers';
import { MIGRATIONS } from './schema';

export type Db = Database.Database;

/**
 * Open (and migrate) the local store. When `key` is given the file is
 * encrypted at rest with SQLCipher (AES-256, per-page HMAC).
 */
export function openDatabase(path: string, key?: string | null): Db {
  const db = new Database(path);
  if (key) applyKey(db, key);
  // Fails here with "file is not a database" if the key is wrong.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL'); // a committed sale must survive power loss
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function applyKey(db: Db, key: string): void {
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma(`key = '${key.replace(/'/g, "''")}'`);
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r: any) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, new Date().toISOString());
    })();
  }
}
