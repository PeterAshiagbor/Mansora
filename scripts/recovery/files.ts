import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import type { StagingWorkspace } from '../staging/gateway';
import { sha256, type SystemSnapshot } from './archive';
/** Caller holds the gateway/background snapshot lock. Native SQLite copies remain encrypted under their original keys. */
export function capturePrivateFiles(dataDir: string, workspaces: StagingWorkspace[]): SystemSnapshot['files'] {
  const root = resolve(dataDir), temp = mkdtempSync(join(tmpdir(), 'mansora-private-snapshot-')); chmodSync(temp, 0o700);
  const replacements = new Map<string, string>(), skip = new Set<string>(), files: SystemSnapshot['files'] = []; let size = 0;
  try {
    const keyPath = join(root, 'secrets', 'staging_db_key');
    if (!/^[a-f0-9]{64}$/i.test(readFileSync(keyPath, 'utf8').trim()) || !existsSync(join(root, 'staging', 'workspaces.json'))) throw new Error('Recovery needs the existing registry and encryption root; neither will be generated.');
    for (const workspace of workspaces) {
      const source = resolve(workspace.engine.db.name);
      if (!source.startsWith(join(root, 'staging', 'workspaces') + sep)) throw new Error('Recovery store is outside the configured private data tree.');
      const target = join(temp, workspace.id + '.db'); workspace.engine.db.prepare('VACUUM INTO ?').run(target);
      replacements.set(source, target); skip.add(source + '-wal'); skip.add(source + '-shm');
    }
    function walk(directory: string) {
      for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name); if (skip.has(path)) continue;
        const state = lstatSync(path); if (state.isSymbolicLink()) throw new Error('Recovery refuses symbolic links in the private data tree.');
        if (state.isDirectory()) { walk(path); continue; }
        if (!state.isFile()) throw new Error('Recovery encountered an unsupported private file.');
        if (files.length >= 10_000 || state.size > 32 * 1024 * 1024) throw new Error('Private snapshot exceeds the reviewed size limit.');
        const bytes = readFileSync(replacements.get(path) ?? path); size += bytes.length;
        if (size > 32 * 1024 * 1024) throw new Error('Private snapshot exceeds the reviewed size limit.');
        files.push({ path: relative(root, path).split(sep).join('/'), sha256: sha256(bytes), contentBase64: bytes.toString('base64') });
      }
    }
    for (const name of ['secrets', 'staging', 'cloud-backups']) { const path = join(root, name); if (existsSync(path)) { if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Recovery source roots must be private directories.'); walk(path); } }
    for (const source of replacements.keys()) if (!files.some(file => file.path === relative(root, source).split(sep).join('/'))) throw new Error('An active retail store is missing from the private snapshot.');
    return files;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
