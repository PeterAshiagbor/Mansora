import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { renameTestShops } from '../../scripts/staging/shop-names';

it('renames shops still carrying the old default names, once, and keeps names testers chose', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shop-names-'));
  writeFileSync(join(dir, 'workspaces.json'), JSON.stringify([{ id: 'shop-a', label: 'Team Test Shop A' }, { id: 'shop-b', label: 'Kofi Stores' }]));
  const meta = (m: Record<string, string>) => ({ meta: (k: string) => m[k], setMeta: (k: string, v: string) => { m[k] = v; } }) as any;
  const a = { 'business_name': 'Team Test Shop A', tenant_id: 't-a' }, b = { 'business_name': 'Kofi Stores', tenant_id: 't-b' };
  const workspaces = [{ id: 'shop-a', label: 'Team Test Shop A', engine: meta(a) }, { id: 'shop-b', label: 'Kofi Stores', engine: meta(b) }];
  const sql: unknown[][] = [];
  const platform = async (fn: any) => fn(async (_s: string, p: unknown[]) => { sql.push(p); return []; });
  expect(await renameTestShops({ dataDir: dir, workspaces, platform })).toEqual({ renamed: 1 });
  expect(a.business_name).toBe('Mansora TSA'); expect(b.business_name).toBe('Kofi Stores');
  expect(workspaces.map((w) => w.label)).toEqual(['Mansora TSA', 'Kofi Stores']);
  expect(JSON.parse(readFileSync(join(dir, 'workspaces.json'), 'utf8')).map((r: any) => r.label)).toEqual(['Mansora TSA', 'Kofi Stores']);
  expect(sql).toContainEqual(['t-a', 'Mansora TSA', 'Team Test Shop A']);
  expect(await renameTestShops({ dataDir: dir, workspaces, platform })).toEqual({ renamed: 0 });
});
