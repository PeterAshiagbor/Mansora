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
});
