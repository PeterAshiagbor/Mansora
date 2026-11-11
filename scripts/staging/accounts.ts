import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestAccount } from './bootstrap';
export function testerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('STAGING_TESTER_EMAILS must be a JSON array of two distinct email addresses.'); }
  if (!Array.isArray(values) || values.length !== 2 || values.some(v => typeof v !== 'string' || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) throw new Error('Configure exactly two valid tester email identities.');
  const emails = values.map(v => v.trim().toLowerCase());
  if (new Set(emails).size !== 2) throw new Error('Tester email identities must be distinct.');
  return emails;
}
export function loadLoginAliases(dataDir: string): Record<string, Record<string, string>> {
  const accounts = JSON.parse(readFileSync(join(dataDir, 'test-accounts.json'), 'utf8')) as TestAccount[];
  const aliases: Record<string, Record<string, string>> = {};
  for (const a of accounts) if (a.email) (aliases[a.workspace] ??= {})[a.email.toLowerCase()] = a.username;
  return aliases;
}
