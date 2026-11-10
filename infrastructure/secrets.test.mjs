import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('local secrets are random, private, readable by container UIDs and never reset on rerun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mansora-infrastructure-'));
  try {
    await copyFile(new URL('./init-secrets.mjs', import.meta.url), join(root, 'init-secrets.mjs'));
    const run = () => execFileSync(process.execPath, [join(root, 'init-secrets.mjs')], { encoding: 'utf8' });
    const output = run();
    const directory = join(root, '.secrets');
    const names = await readdir(directory);
    assert.equal(names.length, 7);
    const before = new Map();
    for (const name of names) {
      const content = await readFile(join(directory, name), 'utf8');
      before.set(name, content);
      assert.ok(!output.includes(content.trim()), 'No generated value may be logged');
      if (name === 'admin_totp_key' || name === 'billing_encryption_key') assert.equal(Buffer.from(content.trim(), 'base64').length, 32);
      else assert.match(content, /^[a-f0-9]{48}\n$/);
      if (process.platform !== 'win32') assert.equal((await stat(join(directory, name))).mode & 0o777, 0o444);
    }
    assert.equal(new Set(before.values()).size, names.length);
    if (process.platform !== 'win32') assert.equal((await stat(directory)).mode & 0o777, 0o700);
    run();
    for (const name of names) assert.equal(await readFile(join(directory, name), 'utf8'), before.get(name));
  } finally { await rm(root, { recursive: true, force: true }); }
});
