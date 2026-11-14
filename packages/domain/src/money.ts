import { fail } from './errors';

/**
 * All money is an integer number of pesewas (1 GHS = 100 pesewas).
 * Floating-point arithmetic is never used for money.
 */
export type Pesewas = number;

export const CURRENCY = 'GHS';

export function assertAmount(n: unknown, label = 'amount'): asserts n is Pesewas {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) fail('INVALID_AMOUNT', `${label} must be a whole number of pesewas`);
}

export function assertNonNegative(n: unknown, label = 'amount'): asserts n is Pesewas {
  assertAmount(n, label);
  if (n < 0) fail('INVALID_AMOUNT', `${label} cannot be negative`);
}

/** Parse a user-entered cedi string ("12", "12.5", "1,234.50") into pesewas without floats. */
export function parseGHS(input: string): Pesewas {
  const s = String(input).trim().replace(/^(GHS|GH₵|GH¢|GHC|₵|¢)\s*/i, '');
  const m = /^(-)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) fail('INVALID_AMOUNT', `"${input}" is not a valid cedi amount`);
  const value = Number(BigInt(m[2].replace(/,/g, '')) * 100n + BigInt((m[3] ?? '').padEnd(2, '0')));
  assertAmount(value);
  return m[1] ? -value : value;
}

/** "GHS 1,234.50" */
export function formatGHS(p: Pesewas, withCurrency = true): string {
  assertAmount(p);
  const neg = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${withCurrency ? 'GHS ' : ''}${whole}.${frac}`;
}

/** round-half-up of (a * b / c) using exact integer arithmetic. c must be > 0, a*b >= 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c <= 0) fail('INVALID_AMOUNT', 'Division by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const q = (n * 2n + d) / (d * 2n);
  return Number(q);
}

/** floor of (a * b / c) using exact integer arithmetic. */
export function mulDivFloor(a: number, b: number, c: number): number {
  if (c <= 0) fail('INVALID_AMOUNT', 'Division by zero');
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/**
 * Split `total` across `weights` so the parts sum exactly to `total`
 * (largest-remainder method). Used to spread a basket discount over lines.
 */
export function allocate(total: Pesewas, weights: number[]): Pesewas[] {
  assertNonNegative(total, 'total');
  weights.forEach((w) => assertNonNegative(w, 'weight'));
  const weightTotal = sum(weights);
  if (weights.length === 0) return [];
  if (weightTotal <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const base = weights.map((w) => mulDivFloor(total, w, weightTotal));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, rem: Number((BigInt(total) * BigInt(w)) % BigInt(weightTotal)) }))
    .sort((x, y) => y.rem - x.rem || x.i - y.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) base[order[k].i] += 1;
  return base;
}

export function sum(values: number[]): number {
  const total = values.reduce((a, b) => { assertAmount(b); return a + BigInt(b); }, 0n);
  const result = Number(total);
  assertAmount(result);
  return result;
}
