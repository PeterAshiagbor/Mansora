import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { describe, expect, it } from 'vitest';
import { applyKey, createBackupFile, openEngine } from '../../apps/desktop/src/core';
import { expectCode, fakeActivationFetch, OWNER, tempDir } from '../helpers';

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
  it('refuses to remember a passphrase in an unencrypted database', async () => {
    const engine = openEngine({ dataDir: tempDir(), fetch: fakeActivationFetch() });
    try {
      await engine.execute(null, 'activation.activate', { apiUrl: 'http://localhost:9', code: 'TEST-CODE', deviceName: 'Test', owner: OWNER });
      const { token } = await engine.execute(null, 'auth.login', OWNER);
      await expectCode(engine.execute(token, 'backup.create', { passphrase: 'secret-passphrase', remember: true }), 'ENCRYPTION_REQUIRED');
      expect(engine.meta('backup_passphrase')).toBeUndefined();
    } finally { engine.db.close(); }
  });
});
