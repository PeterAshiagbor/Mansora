import { mulDivRound } from '@mansora/domain';

/** All billing dates are plain YYYY-MM-DD in Ghana local time (UTC all year). */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 } as const;
export type Frequency = keyof typeof FREQUENCY_MONTHS;

/**
 * The first period boundary strictly after `after`, counted from a fixed anchor.
 * Counting from the anchor (not from the previous date) keeps a 31 January
 * start billing on the last day of shorter months and back to the 31st later.
 */
export function nextBoundary(anchor: string, after: string, months: number): string {
  let n = 0;
  let d = anchor;
  while (d <= after) d = addMonths(anchor, ++n * months);
  return d;
}

/** Monthly equivalent of a per-period amount, rounded half up in whole pesewas. */
export const monthlyEquivalent = (amount: number, frequency: Frequency): number => mulDivRound(amount, 1, FREQUENCY_MONTHS[frequency]);
