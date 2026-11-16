import { z } from 'zod';
import { zCalendarDate } from './dates';
import { allocate, assertNonNegative, mulDivRound, sum } from './money';
import { fail } from './errors';
import type { PricedCart } from './sale';

export const TAX_CLASSES = ['standard', 'zero', 'exempt', 'outside'] as const;
export type TaxClass = typeof TAX_CLASSES[number];
export const GHANA_VAT_THRESHOLD = 75_000_000; // pesewas; GHS 750,000
export const taxConfigSchema = z.object({
  effectiveDate: zCalendarDate,
  revision: z.number().int().nonnegative().safe().default(0),
  registered: z.boolean().default(false),
  automatic: z.boolean().default(true),
  registrationDate: zCalendarDate.nullable().default(null),
  tin: z.string().trim().max(80).default(''),
  vatNumber: z.string().trim().max(80).default(''),
  pricing: z.enum(['inclusive', 'exclusive']).default('inclusive'),
  vatBps: z.number().int().min(0).max(10000).default(1500),
  nhilBps: z.number().int().min(0).max(10000).default(250),
  getfundBps: z.number().int().min(0).max(10000).default(250),
  supplyType: z.enum(['goods', 'services', 'mixed']).default('goods'),
  threshold: z.number().int().positive().safe().default(GHANA_VAT_THRESHOLD),
  alertBps: z.number().int().min(1).max(10000).default(8000),
  forecast: z.number().int().nonnegative().safe().default(0),
  forecastNineMonths: z.number().int().nonnegative().safe().default(0),
  // No guessed commencement date for Act 1177. An evidenced business-specific rule can be selected.
  serviceThresholdConfirmed: z.boolean().default(false),
  serviceThresholdDate: zCalendarDate.nullable().default(null),
  serviceThresholdAuthority: z.string().trim().max(400).default(''),
  mandatoryRegistration: z.boolean().default(false),
  ruleOverrideAuthority: z.string().trim().max(400).default(''),
  deregistrationAuthority: z.string().trim().max(400).default(''),
  reason: z.string().trim().min(1).max(400),
});
export type TaxConfig = z.infer<typeof taxConfigSchema>;
export const defaultTaxConfig = (): TaxConfig => taxConfigSchema.parse({ effectiveDate: '2026-01-01', reason: 'Initial Ghana 2026 rules' });
export interface TaxAmounts { base: number; vat: number; nhil: number; getfund: number; total: number }
export interface TaxSnapshot extends TaxAmounts {
  classification: TaxClass; registered: boolean;
  rates: [number, number, number];
}
export const zeroTax = (): TaxAmounts => ({ base: 0, vat: 0, nhil: 0, getfund: 0, total: 0 });
export function addTax(rows: TaxAmounts[]): TaxAmounts {
  return Object.fromEntries(Object.keys(zeroTax()).map(k => [k, sum(rows.map(r => r[k as keyof TaxAmounts]))])) as unknown as TaxAmounts;
}
export function taxAmount(amount: number, classification: TaxClass, config: TaxConfig, date: string): TaxSnapshot {
  assertNonNegative(amount);
  if (!TAX_CLASSES.includes(classification)) fail('INVALID_TAX_CLASS', 'Choose a valid VAT classification');
  const registered = config.registered && !!config.registrationDate && config.registrationDate <= date;
  const rates: [number, number, number] = [config.vatBps, config.nhilBps, config.getfundBps];
  let base = amount, vat = 0, nhil = 0, getfund = 0;
  if (registered && classification === 'standard' && sum(rates)) {
    if (config.pricing === 'inclusive') {
      base = mulDivRound(amount, 10000, 10000 + sum(rates));
      [vat, nhil, getfund] = allocate(amount - base, rates);
    } else [vat, nhil, getfund] = rates.map(r => mulDivRound(base, r, 10000));
  }
  return { base, vat, nhil, getfund, total: sum([base, vat, nhil, getfund]), classification, registered, rates };
}
/** Discounts are allocated before tax. The tender total is always the tax-inclusive amount. */
export function taxCart(cart: PricedCart, classes: TaxClass[], config: TaxConfig, date: string) {
  const snapshots = cart.lines.map((l, i) => taxAmount(l.lineTotal, classes[i], config, date));
  const tax = addTax(snapshots);
  return { ...cart, total: tax.total, lines: cart.lines.map((l, i) => ({ ...l, lineTotal: snapshots[i].total })), snapshots, tax };
}
/** Cumulative allocation ensures repeated partial refunds reverse every original pesewa exactly. */
export function refundTax(original: TaxSnapshot, previous: number, amount: number): TaxSnapshot {
  assertNonNegative(previous); assertNonNegative(amount);
  if (previous + amount > original.total) fail('INVALID_REFUND', 'Tax refund exceeds the original line');
  const cumulative = (gross: number) => {
    if (!original.total) return [0, 0, 0, 0];
    // Sequential proportional splitting is monotonic for each component with fixed weights.
    const vat = mulDivRound(gross, original.vat, original.total);
    const remaining = gross - vat;
    const denominator = original.total - original.vat;
    const nhil = denominator ? mulDivRound(remaining, original.nhil, denominator) : 0;
    const rest = remaining - nhil;
    const d = denominator - original.nhil;
    const getfund = d ? mulDivRound(rest, original.getfund, d) : 0;
    return [rest - getfund, vat, nhil, getfund];
  };
  const end = cumulative(previous + amount), start = cumulative(previous);
  const [base, vat, nhil, getfund] = end.map((v, i) => v - start[i]);
  return { ...original, base, vat, nhil, getfund, total: amount };
}
