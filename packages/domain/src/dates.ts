import { z } from 'zod';

/** True only for a real Gregorian calendar day written as YYYY-MM-DD (e.g. 2028-02-29 yes, 2026-02-29 and 2026-99-01 no). */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** A calendar date in YYYY-MM-DD form. Shape-only checks let impossible dates reach the database (C30 F02). */
export const zCalendarDate = z.string().refine(isCalendarDate, { message: 'must be a real date in the form YYYY-MM-DD' });

/** An inclusive date range whose start is not after its end. */
export function zDateRange() {
  return z.object({ from: zCalendarDate, to: zCalendarDate }).refine((r) => r.from <= r.to, { message: 'The start date must be on or before the end date', path: ['from'] });
}
