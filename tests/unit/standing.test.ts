import { describe, expect, it } from 'vitest';
import { computeStanding, DEFAULT_STANDING_POLICY as P, effectiveStanding, policyProblem } from '../../packages/domain/src';

const due = { number: 'INV-2026-00001', dueDate: '2026-11-01' };
const at = (today: string, hold: string | null = null) => computeStanding(P, today, due, hold);

describe('non-payment policy rules (D-28)', () => {
  it('moves from good to notice to warning to restricted on exact day boundaries', () => {
    expect(computeStanding(P, '2026-11-01', due, null).stage).toBe('good'); // due today is not late
    expect(computeStanding(P, '2026-11-20', null, null).stage).toBe('good'); // nothing overdue
    expect(at('2026-11-02')).toMatchObject({ stage: 'notice', daysOverdue: 1, warnFrom: '2026-11-16', restrictFrom: '2026-12-01' });
    expect(at('2026-11-15').stage).toBe('notice');
    expect(at('2026-11-16').stage).toBe('warning');
    expect(at('2026-11-30').stage).toBe('warning');
    expect(at('2026-12-01').stage).toBe('restricted');
  });

  it('lets an arrangement keep reports open through its last day, and never brings restrictions forward', () => {
    expect(at('2026-12-05', '2026-12-20')).toMatchObject({ stage: 'warning', restrictFrom: '2026-12-21', holdUntil: '2026-12-20' });
    expect(at('2026-12-21', '2026-12-20')).toMatchObject({ stage: 'restricted', holdUntil: null }); // expired arrangement
    expect(at('2026-11-20', '2026-11-21')).toMatchObject({ restrictFrom: '2026-12-01' }); // short arrangement does not shorten grace
  });

  it('refuses thresholds that would restrict early or without a real warning', () => {
    expect(policyProblem(P)).toBeNull();
    expect(policyProblem({ ...P, restrictAfterDays: 20 })).toMatch(/sooner than 21/);
    expect(policyProblem({ noticeAfterDays: 1, warnAfterDays: 25, restrictAfterDays: 30 })).toMatch(/at least 7 days/);
    expect(policyProblem({ noticeAfterDays: 20, warnAfterDays: 15, restrictAfterDays: 30 })).toMatch(/notice must come before/);
    expect(policyProblem({ ...P, noticeAfterDays: 1.5 })).toMatch(/whole numbers/);
  });

  it('keeps escalating offline from the stored dates, and treats unreadable data as no information', () => {
    const stored = at('2026-11-10'); // notice, as last sent by the server
    expect(effectiveStanding(stored, '2026-11-10')!.stage).toBe('notice');
    expect(effectiveStanding(stored, '2026-11-16')!.stage).toBe('warning');
    expect(effectiveStanding(stored, '2026-12-01')).toMatchObject({ stage: 'restricted', daysOverdue: 30 });
    const held = at('2026-12-05', '2026-12-20');
    expect(effectiveStanding(held, '2026-12-20')!.stage).toBe('warning');
    expect(effectiveStanding(held, '2026-12-21')!.stage).toBe('restricted');
    expect(effectiveStanding(computeStanding(P, '2026-11-20', null, null), '2027-06-01')!.stage).toBe('good');
    for (const junk of [null, 'restricted', { stage: 'banned' }, 42]) expect(effectiveStanding(junk, '2026-12-01')).toBeNull();
    expect(effectiveStanding({ ...stored, restrictFrom: '2026-02-30' }, '2026-12-01')!.stage).toBe('warning'); // bad date ignored, warning still applies
  });
});
