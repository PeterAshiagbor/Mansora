/** Private recovery envelope. No plaintext archive is written to disk. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lstatSync, mkdirSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
const MAGIC = Buffer.from('MANSORA-SYSTEM-SNAPSHOT-1\n');
const MAX_PLAIN = 64 * 1024 * 1024, MAX_FILES = 10_000;
export interface SnapshotTable { name: string; columns: string[]; rows: string[]; dependencies: string[] }
export interface SystemSnapshot {
  version: 1; createdAt: string; schemaHash: string;
  tables: SnapshotTable[];
  files: { path: string; sha256: string; contentBase64: string }[];
}
export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value);
const invalid = (): never => { throw new Error('Invalid or incompatible private recovery archive.'); };
function keyBytes(value: string) { if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('A separate 32-byte recovery key is required.'); return Buffer.from(value, 'hex'); }
function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && !/[\\:\x00-\x1f\x7f]/.test(value) && ['secrets', 'staging', 'cloud-backups'].includes(value.split('/')[0]) && value.split('/').length >= 2 && value.split('/').length <= 12 && value.split('/').every(p => p && p !== '.' && p !== '..');
}
export function validateSnapshot(value: unknown): asserts value is SystemSnapshot {
  const snapshot = value as SystemSnapshot;
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt)) || !/^[a-f0-9]{64}$/.test(snapshot.schemaHash) || !Array.isArray(snapshot.tables) || snapshot.tables.length > 200 || !Array.isArray(snapshot.files) || snapshot.files.length > MAX_FILES) invalid();
  const names = new Set<string>(); let rows = 0;
  for (const table of snapshot.tables) {
    if (!table || !identifier(table.name) || names.has(table.name) || !Array.isArray(table.columns) || !table.columns.length || table.columns.length > 200 || !table.columns.every(identifier) || new Set(table.columns).size !== table.columns.length || !Array.isArray(table.rows) || !Array.isArray(table.dependencies) || !table.dependencies.every(identifier)) invalid();
    names.add(table.name); rows += table.rows.length; if (rows > 1_000_000) invalid();
    for (const text of table.rows) {
      if (typeof text !== 'string') invalid();
      let row: any; try { row = JSON.parse(text); } catch { invalid(); }
      if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).length !== table.columns.length || Object.keys(row).some(column => !table.columns.includes(column))) invalid();
    }
  }
  for (const table of snapshot.tables) if (table.dependencies.some(name => !names.has(name))) invalid();
  const paths = new Set<string>(); let bytes = 0;
  for (const file of snapshot.files) {
    if (!file || !safePath(file.path) || paths.has(file.path) || typeof file.contentBase64 !== 'string' || file.contentBase64.length > MAX_PLAIN || !/^[a-f0-9]{64}$/.test(file.sha256)) invalid();
    paths.add(file.path); const content = Buffer.from(file.contentBase64, 'base64'); bytes += content.length;
    if (bytes > 32 * 1024 * 1024 || content.toString('base64') !== file.contentBase64 || sha256(content) !== file.sha256) invalid();
  }
  for (const path of paths) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) invalid(); }
}
export function packSnapshot(snapshot: SystemSnapshot, key: string): Buffer {
  validateSnapshot(snapshot); const bytes = Buffer.from(JSON.stringify(snapshot)); if (bytes.length > MAX_PLAIN) throw new Error('Recovery archive exceeds the reviewed size limit.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv); cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(gzipSync(bytes)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}
export function unpackSnapshot(bytes: Buffer, key: string): SystemSnapshot {
  const secret = keyBytes(key);
  try {
    if (bytes.length > MAX_PLAIN || bytes.length < MAGIC.length + 29 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) invalid();
    const start = MAGIC.length, decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(start, start + 12)); decipher.setAAD(MAGIC); decipher.setAuthTag(bytes.subarray(start + 12, start + 28));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(start + 28)), decipher.final()]);
    const snapshot = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_PLAIN }).toString('utf8')); validateSnapshot(snapshot); return snapshot;
  } catch { throw new Error('Recovery archive authentication or validation failed; preserve the source and key for review.'); }
}
/** A rehearsal can restore only into a new or empty, nonsymlink directory. */
export function restoreSnapshotFiles(snapshot: SystemSnapshot, destination: string) {
  validateSnapshot(snapshot);
  try { const state = lstatSync(destination); if (!state.isDirectory() || state.isSymbolicLink() || readdirSync(destination).length) throw new Error('Restore destination must be a new or empty private directory.'); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; mkdirSync(destination, { recursive: false, mode: 0o700 }); }
  chmodSync(destination, 0o700);
  for (const file of snapshot.files) { const target = join(destination, file.path); mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); writeFileSync(target, Buffer.from(file.contentBase64, 'base64'), { flag: 'wx', mode: 0o600 }); }
}
