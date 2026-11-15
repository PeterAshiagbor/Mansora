import { fail, mulDivRound } from '@mansora/domain';

/** Calendar-month arithmetic, clamped at month end; never substitutes month-start for an accrual date. */
export function addMonths(date: string, count: number): string {
  const d = new Date(date + 'T00:00:00Z'), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + count);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
export const evidenceKey = (value: string) => value.replace(/\s+/g, '').toUpperCase();
export function eligibleInputBps(input: { eligibleBps: number; attribution: string; inputCategory: string; exceptionConfirmed: boolean; financialInstitution: boolean }): number {
  if (input.inputCategory === 'membership') fail('INPUT_CREDIT_BLOCKED', 'Sporting, social and recreational membership input tax is not deductible (section 50)');
  if (['vehicle', 'entertainment'].includes(input.inputCategory) && !input.exceptionConfirmed) fail('INPUT_CREDIT_BLOCKED', 'The section 50 business exception must be evidenced before claiming this input');
  if (['exempt', 'private'].includes(input.attribution)) fail('INPUT_CREDIT_BLOCKED', 'Input tax attributable to exempt supplies or private use is not deductible');
  if (input.attribution === 'residual_mixed') {
    if (input.financialInstitution) fail('INPUT_CREDIT_BLOCKED', 'Financial institutions may claim only directly attributable taxable inputs (section 52)');
    if (input.eligibleBps < 500) return 0;
    if (input.eligibleBps > 9500) return 10000;
  }
  return input.eligibleBps;
}
export function claimTaxes(input: { vat: number; nhil: number; getfund: number }, bps: number) {
  return { vat: mulDivRound(input.vat, bps, 10000), nhil: mulDivRound(input.nhil, bps, 10000), getfund: mulDivRound(input.getfund, bps, 10000) };
}
