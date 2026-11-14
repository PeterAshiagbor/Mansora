import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { roleMatrix, roleMatrixMarkdown, ROLE_DEFAULTS, isOvernightShift } from '@mansora/domain';
import { makeShop } from '../helpers';

describe('C59 shifts and logins', () => {
  it('flags a shift opened on an earlier day as overnight', () => {
    expect(isOvernightShift('2026-11-13T20:00:00.000Z', '2026-11-14T08:00:00.000Z')).toBe(true);
    expect(isOvernightShift('2026-11-14T06:00:00.000Z', '2026-11-14T21:00:00.000Z')).toBe(false);
  });
  it('builds the role matrix from the same defaults the engine enforces', () => {
    const m = roleMatrix();
    expect(m.filter((r) => r.cashier).map((r) => r.permission).sort()).toEqual([...ROLE_DEFAULTS.cashier].sort());
    expect(m.find((r) => r.permission === 'staff.manage')).toMatchObject({ ownerOnly: true });
  });
  it('keeps the published guide identical to the code (run npx tsx scripts/docs/roles.ts after changing permissions)', () => {
    expect(readFileSync(new URL('../../docs/user-guide/who-can-do-what.md', import.meta.url), 'utf8')).toBe(roleMatrixMarkdown());
  });
  it('shows open shifts to the owner, flags one left from yesterday, and keeps the list from cashiers', async () => {
    const shop = await makeShop();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    shop.engine.db.prepare(`UPDATE shifts SET opened_at = ? WHERE status = 'open'`).run(yesterday);
    const list = await shop.run(shop.owner, 'shift.openList');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ overnight: true, opened_at: yesterday });
    expect(list[0].cashier_name).toBeTruthy();
    expect((await shop.run(shop.cashier, 'shift.current')).overnight).toBe(true);
    await expect(shop.run(shop.cashier, 'shift.openList')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('lets an owner close a shift someone else left open, with a count and reason, and not their own', async () => {
    const shop = await makeShop();
    const [open] = await shop.run(shop.owner, 'shift.openList');
    await expect(shop.run(shop.cashier, 'shift.closeFor', { shiftId: open.id, countedCash: 0, reason: 'x went' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const r = await shop.run(shop.owner, 'shift.closeFor', { shiftId: open.id, countedCash: 9_000, reason: 'Went home without closing' });
    expect(r).toMatchObject({ expectedCash: 10_000, countedCash: 9_000, variance: -1_000 });
    expect(await shop.run(shop.owner, 'shift.openList')).toEqual([]);
    expect(await shop.run(shop.cashier, 'shift.current')).toBeNull();
    const row = shop.engine.db.prepare('SELECT status, notes FROM shifts WHERE id = ?').get(open.id) as any;
    expect(row.status).toBe('closed'); expect(row.notes).toContain('Went home without closing');
    await expect(shop.run(shop.owner, 'shift.closeFor', { shiftId: open.id, countedCash: 0, reason: 'again' })).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
    await shop.run(shop.owner, 'shift.open', { openingFloat: 0 });
    const mine = (await shop.run(shop.owner, 'shift.openList'))[0];
    await expect(shop.run(shop.owner, 'shift.closeFor', { shiftId: mine.id, countedCash: 0, reason: 'own one' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
