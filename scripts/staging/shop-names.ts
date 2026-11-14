import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StagingWorkspace } from './gateway';

/** The two team-test shops are called Mansora TSA and Mansora TSB (test shop A and B). */
export const TEST_SHOP_NAMES: Record<string, string> = { 'shop-a': 'Mansora TSA', 'shop-b': 'Mansora TSB' };
const OLD_NAMES: Record<string, string> = { 'shop-a': 'Team Test Shop A', 'shop-b': 'Team Test Shop B' };

type Query = (sql: string, params?: unknown[]) => Promise<unknown[]>;

/**
 * Renames shops created under the old names. It changes only a name that is still the old default, so a name a
 * tester chose themselves is kept. Safe to run on every start: once renamed, nothing matches.
 */
export async function renameTestShops(o: { dataDir: string; workspaces: StagingWorkspace[]; platform: <T>(fn: (q: Query) => Promise<T>) => Promise<T> }) {
  let renamed = 0;
  for (const w of o.workspaces) {
    const name = TEST_SHOP_NAMES[w.id], old = OLD_NAMES[w.id];
    if (!name) continue;
    if (w.engine.meta('business_name') === old) { w.engine.setMeta('business_name', name); renamed++; }
    const tenantId = w.engine.meta('tenant_id');
    if (tenantId) await o.platform((q) => q(`UPDATE tenants SET name = $2 WHERE id = $1 AND name = $3`, [tenantId, name, old]));
    if (w.label === old) w.label = name;
  }
  const file = join(o.dataDir, 'workspaces.json');
  if (existsSync(file)) {
    const records = JSON.parse(readFileSync(file, 'utf8')) as { id: string; label: string }[];
    let changed = false;
    for (const r of records) if (TEST_SHOP_NAMES[r.id] && r.label === OLD_NAMES[r.id]) { r.label = TEST_SHOP_NAMES[r.id]; changed = true; }
    if (changed) { writeFileSync(`${file}.pending`, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 }); renameSync(`${file}.pending`, file); }
  }
  return { renamed };
}
