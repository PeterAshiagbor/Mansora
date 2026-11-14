import { fail } from './errors';
import { allocate, assertNonNegative, sum, type Pesewas } from './money';

export const PAYMENT_METHODS = ['cash', 'card', 'momo', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Methods usable for refund payouts, repayments and expenses (no "credit"). */
export const SETTLEMENT_METHODS = ['cash', 'card', 'momo'] as const;
/** Expenses can also be paid by bank transfer (sales and repayments are taken by cash, card or Mobile Money). */
export const EXPENSE_METHODS = ['cash', 'card', 'momo', 'bank'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  momo: 'Mobile money',
  credit: 'Credit',
};

export interface CartLineInput {
  productId: string;
  quantity: number;
  unitPrice: Pesewas;
  /** Discount applied to this line as a whole, in pesewas. */
  discount?: Pesewas;
}

export interface PricedLine {
  productId: string;
  quantity: number;
  unitPrice: Pesewas;
  gross: Pesewas;
  /** Line discount plus this line's share of the basket discount. */
  discount: Pesewas;
  lineTotal: Pesewas;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: Pesewas;
  discountTotal: Pesewas;
  total: Pesewas;
}

export function assertQuantity(q: unknown): asserts q is number {
  if (typeof q !== 'number' || !Number.isSafeInteger(q) || q <= 0) fail('INVALID_QUANTITY', 'Quantity must be a whole number greater than zero');
}

/** Price a basket. The basket discount is spread over lines so every line carries its true net value. */
export function priceCart(lines: CartLineInput[], cartDiscount: Pesewas = 0): PricedCart {
  if (lines.length === 0) fail('EMPTY_BASKET', 'The basket is empty');
  assertNonNegative(cartDiscount, 'discount');
  const pre = lines.map((l) => {
    assertQuantity(l.quantity);
    assertNonNegative(l.unitPrice, 'unit price');
    const discount = l.discount ?? 0;
    assertNonNegative(discount, 'line discount');
    const gross = l.quantity * l.unitPrice;
    if (!Number.isSafeInteger(gross)) fail('INVALID_AMOUNT', 'Line amount is too large');
    if (discount > gross) fail('DISCOUNT_TOO_LARGE', 'A line discount cannot exceed the line amount');
    return { ...l, gross, discount, net: gross - discount };
  });
  const netBefore = sum(pre.map((l) => l.net));
  if (cartDiscount > netBefore) fail('DISCOUNT_TOO_LARGE', 'The discount cannot exceed the basket total');
  const shares = allocate(cartDiscount, pre.map((l) => l.net));
  const priced = pre.map((l, i) => ({
    productId: l.productId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    gross: l.gross,
    discount: l.discount + shares[i],
    lineTotal: l.net - shares[i],
  }));
  const subtotal = sum(priced.map((l) => l.gross));
  const discountTotal = sum(priced.map((l) => l.discount));
  return { lines: priced, subtotal, discountTotal, total: subtotal - discountTotal };
}

export interface TenderInput {
  method: PaymentMethod;
  /** For cash: the amount handed over. For other methods: the amount recorded. */
  amount: Pesewas;
  reference?: string | null;
}

export interface Settlement {
  /** Amounts actually applied to the sale. Sum always equals the sale total. */
  payments: { method: PaymentMethod; amount: Pesewas; reference: string | null }[];
  cashTendered: Pesewas;
  change: Pesewas;
  creditAmount: Pesewas;
}

/**
 * Validate tenders against a total. Only cash may exceed what is owed (change is given).
 * Card / mobile money / credit must never exceed the amount due.
 */
export function settlePayments(total: Pesewas, tenders: TenderInput[]): Settlement {
  assertNonNegative(total, 'total');
  let cashTendered = 0;
  let nonCash = 0;
  const payments: Settlement['payments'] = [];
  for (const t of tenders) {
    if (!PAYMENT_METHODS.includes(t.method)) fail('INVALID_PAYMENT', `Unknown payment method "${t.method}"`);
    assertNonNegative(t.amount, 'payment amount');
    if (t.amount === 0) continue;
    if (t.method === 'cash') cashTendered = sum([cashTendered, t.amount]);
    else {
      nonCash = sum([nonCash, t.amount]);
      payments.push({ method: t.method, amount: t.amount, reference: t.reference?.trim() || null });
    }
  }
  if (nonCash > total) fail('OVERPAYMENT', 'Card, mobile money and credit amounts cannot exceed the amount due');
  const cashDue = total - nonCash;
  if (cashTendered < cashDue) fail('UNDERPAID', 'The payments do not cover the amount due', { shortBy: cashDue - cashTendered });
  if (cashDue > 0) payments.unshift({ method: 'cash', amount: cashDue, reference: null });
  return {
    payments,
    cashTendered,
    change: cashTendered - cashDue,
    creditAmount: sum(payments.filter((p) => p.method === 'credit').map((p) => p.amount)),
  };
}
