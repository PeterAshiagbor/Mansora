import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { closeOpenShifts } from '../../scripts/staging/close-shifts';
import { makeShop } from '../helpers';

it('closes every open shift once, at the expected cash, with a note', async () => {
  const shop = await makeShop();
  await shop.run(shop.owner, 'shift.open', { openingFloat: 5_000 });
  const dir = mkdtempSync(join(tmpdir(), 'close-shifts-'));
  const workspaces = [{ id: 'shop-a', label: 'Mansora TSA', engine: shop.engine }];
  expect(await closeOpenShifts({ id: 'test-op', dataDir: dir, workspaces })).toMatchObject({ closed: 2, failures: 0 });
  const rows = shop.engine.db.prepare(`SELECT status, variance, notes FROM shifts`).all() as any[];
  expect(rows.every((r) => r.status === 'closed' && r.variance === 0 && r.notes.includes("owner's request"))).toBe(true);
  // A shift opened afterwards is left alone: the operation does not repeat.
  await shop.run(shop.cashier, 'shift.open', { openingFloat: 0 });
  expect(await closeOpenShifts({ id: 'test-op', dataDir: dir, workspaces })).toMatchObject({ disabled: true });
  expect((shop.engine.db.prepare(`SELECT COUNT(*) AS n FROM shifts WHERE status = 'open'`).get() as any).n).toBe(1);
});
