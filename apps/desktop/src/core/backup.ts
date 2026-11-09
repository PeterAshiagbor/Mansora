import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { fail } from '@mansora/domain';
import { applyKey, migrate, type Db } from './db';

export interface BackupSummary {
  businessName: string;
  createdAt: string;
  products: number;
  users: number;
  sales: number;
  salesTotal: number;
  stockUnits: number;
  outstandingCredit: number;
  movements: number;
  lastOutboxSeq: number;
  pendingSync: number;
}

export function summarise(db: Db): BackupSummary {
  const n = (sql: string) => (db.prepare(sql).get() as { v: number | null }).v ?? 0;
  const meta = (k: string) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? '';
  return {
    businessName: meta('business_name'),
    createdAt: new Date().toISOString(),
    products: n('SELECT COUNT(*) AS v FROM products'),
    users: n('SELECT COUNT(*) AS v FROM users'),
    sales: n('SELECT COUNT(*) AS v FROM sales'),
    salesTotal: n('SELECT SUM(total) AS v FROM sales'),
    stockUnits: n('SELECT SUM(quantity) AS v FROM stock_balances'),
    outstandingCredit: n('SELECT SUM(outstanding_balance) AS v FROM credit_accounts'),
    movements: n('SELECT COUNT(*) AS v FROM inventory_movements'),
    lastOutboxSeq: n('SELECT MAX(seq) AS v FROM outbox'),
    pendingSync: n(`SELECT COUNT(*) AS v FROM outbox WHERE status = 'pending'`),
  };
}

const AUTO_FILE = /\.auto-([0-9a-f]{32})\.mbk$/i;

/**
 * Automatic backups cannot ask for the passphrase each night, and the
 * passphrase itself is never stored. Instead a key is derived from it once
 * (scrypt, random salt) and kept inside the encrypted local database. The salt
 * travels in the backup's file name, so the owner's passphrase alone can
 * reopen the file on any laptop. Do not rename automatic backup files.
 */
export function deriveAutoKey(passphrase: string, saltHex = randomBytes(16).toString('hex')): { salt: string; key: string } {
  const key = scryptSync(passphrase.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return { salt: saltHex, key };
}

/** The secret that actually encrypts a given backup file. */
function fileSecret(path: string, passphrase: string): string {
  const m = AUTO_FILE.exec(path);
  return m ? deriveAutoKey(passphrase, m[1].toLowerCase()).key : passphrase;
}

export function checkPassphrase(passphrase: string): void {
  if (passphrase.length < 10) fail('WEAK_PASSPHRASE', 'The backup passphrase must be at least 10 characters');
}

/**
 * Write a consistent snapshot of the live database to `dir`, encrypted with a
 * key derived from `passphrase` (SQLCipher: AES-256 + per-page HMAC). The
 * backup is independent of this laptop's own database key, so it can be
 * restored on a replacement laptop by someone who knows the passphrase.
 */
export function createBackupFile(db: Db, dbKey: string | null, dir: string, passphrase: string, auto?: { salt: string; key: string }): { id: string; path: string; size: number; sha256: string; summary: BackupSummary } {
  if (!auto) checkPassphrase(passphrase);
  const secret = auto ? auto.key : passphrase;
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `mansora-backup-${stamp}${auto ? `.auto-${auto.salt}` : ''}.mbk`);
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp); // transactionally consistent copy, still under the device key
  const copy = new Database(tmp);
  try {
    if (dbKey) applyKey(copy, dbKey);
    else copy.pragma(`cipher = 'sqlcipher'`);
    // A portable backup must never carry a remembered decryption passphrase.
    copy.pragma('secure_delete = ON');
    copy.prepare("DELETE FROM meta WHERE key IN ('backup_passphrase', 'backup_auto')").run();
    copy.pragma('journal_mode = DELETE');
    copy.pragma(`rekey = '${secret.replace(/'/g, "''")}'`);
  } finally {
    copy.close();
  }
  renameSync(tmp, path);
  const summary = verifySecret(path, secret); // never report success for a file we could not read back
  const bytes = readFileSync(path);
  return { id, path, size: statSync(path).size, sha256: createHash('sha256').update(bytes).digest('hex'), summary };
}

function openBackup(path: string, passphrase: string): Db {
  return openWithSecret(path, fileSecret(path, passphrase));
}

function openWithSecret(path: string, passphrase: string): Db {
  if (!existsSync(path)) fail('NOT_FOUND', 'Backup file not found');
  const db = new Database(path, { readonly: false });
  try {
    applyKey(db, passphrase);
    db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
  } catch {
    db.close();
    fail('BACKUP_UNREADABLE', 'The backup could not be opened. Check the passphrase, or the file may be damaged.');
  }
  return db;
}

/** Open a backup, run SQLite's integrity checks and return what it contains. */
export function verifyBackupFile(path: string, passphrase: string): BackupSummary {
  return verifySecret(path, fileSecret(path, passphrase));
}

function verifySecret(path: string, secret: string): BackupSummary {
  const db = openWithSecret(path, secret);
  try {
    const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity[0]?.integrity_check !== 'ok') fail('BACKUP_CORRUPT', 'The backup failed its integrity check');
    if ((db.pragma('foreign_key_check') as unknown[]).length) fail('BACKUP_CORRUPT', 'The backup has inconsistent records');
    return summarise(db);
  } finally {
    db.close();
  }
}

/**
 * Restore a backup into `destPath` (which must not exist), re-encrypting it
 * under `newKey` for this laptop. Returns the verified contents.
 */
export function restoreBackupFile(backupPath: string, passphrase: string, destPath: string, newKey: string | null): BackupSummary {
  if (existsSync(destPath)) fail('RESTORE_TARGET_EXISTS', 'Refusing to overwrite an existing database');
  verifyBackupFile(backupPath, passphrase);
  const src = openBackup(backupPath, passphrase);
  try {
    src.prepare('VACUUM INTO ?').run(destPath);
  } finally {
    src.close();
  }
  const dest = new Database(destPath);
  try {
    applyKey(dest, fileSecret(backupPath, passphrase));
    dest.pragma('journal_mode = DELETE');
    dest.pragma(`rekey = '${(newKey ?? '').replace(/'/g, "''")}'`);
  } finally {
    dest.close();
  }
  const check = new Database(destPath);
  try {
    if (newKey) applyKey(check, newKey);
    migrate(check);
    return summarise(check);
  } finally {
    check.close();
  }
}
