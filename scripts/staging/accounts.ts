import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestAccount } from './bootstrap';
import { existsSync } from 'node:fs';
import type { StagingWorkspace } from './gateway';
export function testerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('STAGING_TESTER_EMAILS must be a JSON array of two distinct email addresses.'); }
  if (!Array.isArray(values) || values.length !== 2 || values.some(v => typeof v !== 'string' || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) throw new Error('Configure exactly two valid tester email identities.');
  const emails = values.map(v => v.trim().toLowerCase());
  if (new Set(emails).size !== 2) throw new Error('Tester email identities must be distinct.');
  return emails;
}
export function loadLoginAliases(dataDir: string, workspaces: StagingWorkspace[] = []): Record<string, Record<string, string>> {
  const manifest = join(dataDir, 'test-accounts.json');
  const accounts = (existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : []) as TestAccount[];
  const aliases: Record<string, Record<string, string>> = {};
  const ownerUsername = (workspaceId: string, fallback: string) => (workspaces.find(workspace => workspace.id === workspaceId)?.engine.db.prepare("SELECT username FROM users WHERE role = 'owner'").get() as { username: string } | undefined)?.username ?? fallback;
  for (const a of accounts) if (a.email) (aliases[a.workspace] ??= {})[a.email.toLowerCase()] = a.role === 'owner' ? ownerUsername(a.workspace, a.username) : a.username;
  const registry = join(dataDir, 'workspaces.json');
  if (existsSync(registry)) for (const w of JSON.parse(readFileSync(registry, 'utf8'))) if (w.ownerEmail && w.ownerUsername && /^[a-z0-9][a-z0-9-]{1,40}$/.test(w.id)) (aliases[w.id] ??= {})[w.ownerEmail.toLowerCase()] = ownerUsername(w.id, w.ownerUsername);
  return aliases;
}

/** Optional generated credentials, held only in private service variables and the private manifest. */
export function testerPasswords(raw: string | undefined): string[] {
  if (!raw) return [];
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('STAGING_TESTER_PASSWORDS must be a private JSON array of two passwords.'); }
  if (!Array.isArray(values) || values.length !== 2 || values.some(v => typeof v !== 'string' || v.length < 24 || v.length > 200) || values[0] === values[1]) throw new Error('Provide two distinct generated passwords of at least 24 characters.');
  return values;
}
