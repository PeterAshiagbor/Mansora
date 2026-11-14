import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { packSnapshot, restoreSnapshotFiles, sha256, unpackSnapshot, type SystemSnapshot } from '../../scripts/recovery/archive';
const key = randomBytes(32).toString('hex');
const fixture = (): SystemSnapshot => ({ version: 1, createdAt: new Date().toISOString(), schemaHash: 'a'.repeat(64), tables: [{ name: 'tenants', columns: ['id', 'amount'], dependencies: [], rows: ['{"id":"synthetic","amount":9007199254740993}'] }], files: [{ path: 'secrets/staging_db_key', contentBase64: Buffer.from('private-key-fixture').toString('base64'), sha256: sha256('private-key-fixture') }] });
it('authenticates an encrypted compressed archive and preserves raw numeric database JSON without exposing private files', () => {
  const source = fixture(), encrypted = packSnapshot(source, key); expect(encrypted.includes(Buffer.from('private-key-fixture'))).toBe(false); expect(unpackSnapshot(encrypted, key)).toEqual(source);
  expect(() => unpackSnapshot(encrypted, randomBytes(32).toString('hex'))).toThrow(/authentication/);
  const changed = Buffer.from(encrypted); changed[changed.length - 1] ^= 1; expect(() => unpackSnapshot(changed, key)).toThrow(/authentication/);
  expect(() => packSnapshot(source, 'weak-key')).toThrow(/32-byte/);
});
it('restores private bytes only into an empty destination and never overwrites existing data', () => {
  const root = mkdtempSync(join(tmpdir(), 'mansora-snapshot-')), destination = join(root, 'restored'), source = unpackSnapshot(packSnapshot(fixture(), key), key);
  restoreSnapshotFiles(source, destination); expect(readFileSync(join(destination, source.files[0].path), 'utf8')).toBe('private-key-fixture');
  expect(statSync(join(destination, source.files[0].path)).mode & 0o777).toBe(0o600);
  expect(() => restoreSnapshotFiles(source, destination)).toThrow(/empty/);
  const link = join(root, 'linked'); symlinkSync(destination, link); expect(() => restoreSnapshotFiles(source, link)).toThrow(/empty/);
});
it('validates the entire manifest before writing and rejects traversal, duplicates, malformed SQL identifiers and damaged bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'mansora-snapshot-invalid-'));
  for (const path of ['../outside', 'secrets/../../outside', 'secrets\\outside', '/secrets/outside', 'staging/./outside']) {
    const source = fixture(); source.files[0].path = path; const destination = join(root, 'no-write'); expect(() => restoreSnapshotFiles(source, destination)).toThrow(); expect(existsSync(destination)).toBe(false);
  }
  const duplicate = fixture(); duplicate.files.push(duplicate.files[0]); expect(() => packSnapshot(duplicate, key)).toThrow();
  const damaged = fixture(); damaged.files[0].contentBase64 = Buffer.from('changed').toString('base64'); expect(() => packSnapshot(damaged, key)).toThrow();
  const sql = fixture(); sql.tables[0].name = 'tenants; DROP TABLE tenants'; expect(() => packSnapshot(sql, key)).toThrow();
  const existing = join(root, 'occupied'); writeFileSync(existing, 'keep'); expect(() => restoreSnapshotFiles(fixture(), existing)).toThrow(); expect(readFileSync(existing, 'utf8')).toBe('keep');
});
