import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { describe, expect, it } from 'vitest';
import { applyKey, createBackupFile, openEngine } from '../../apps/desktop/src/core';
import { fakeActivationFetch, OWNER, tempDir } from '../helpers';

describe('backup secret handling', () => {
  it('omits remembered passphrases from portable backups', () => {
    const dir = tempDir();
    const engine = openEngine({ dataDir: dir, dbKey: 'device-key' });
    try {
      engine.setMeta('backup_passphrase', 'old-secret-passphrase');
      const made = createBackupFile(engine.db, 'device-key', join(dir, 'backups'), 'new-secret-passphrase');
      const backup = new Database(made.path);
      try {
        applyKey(backup, 'new-secret-passphrase');
        expect(backup.prepare("SELECT value FROM meta WHERE key = 'backup_passphrase'").get()).toBeUndefined();
        expect(engine.meta('backup_passphrase')).toBe('old-secret-passphrase');
      } finally { backup.close(); }
    } finally { engine.db.close(); }
  });
  it('never stores a backup passphrase, whatever the caller sends', async () => {
    const engine = openEngine({ dataDir: tempDir(), dbKey: 'device-key', fetch: fakeActivationFetch() });
    try {
      await engine.execute(null, 'activation.activate', { apiUrl: 'http://localhost:9', code: 'TEST-CODE', deviceName: 'Test', owner: OWNER });
      const { token } = await engine.execute(null, 'auth.login', OWNER);
      await engine.execute(token, 'backup.create', { passphrase: 'secret-passphrase', remember: true });
      expect(engine.meta('backup_passphrase')).toBeUndefined();
      expect(engine.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE value LIKE '%secret-passphrase%'").get()).toEqual({ n: 0 });
    } finally { engine.db.close(); }
  });
});
