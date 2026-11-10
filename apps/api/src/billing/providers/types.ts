/** What a payment provider adapter must offer. Billing talks only to this interface, so a provider can be swapped without touching billing. */
export class ProviderError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
  }
}
export class SignatureError extends Error {}

export interface ProviderCaps {
  id: string;
  label: string;
  /** Simulated provider: no real money ever moves and its payments are excluded from revenue. */
  sandbox: boolean;
  /** True only after the adapter has been checked against the provider's live or test API. */
  verified: boolean;
  oneOff: boolean;
  recurringCard: boolean;
  recurringMomo: boolean;
  refunds: boolean;
}

export type ProviderStatus = 'successful' | 'failed' | 'pending' | 'not_found';
export interface VerifyResult {
  status: ProviderStatus;
  amount?: number;
  currency?: string;
  fee?: number;
  txnId?: string;
  channel?: string;
  failureReason?: string;
  /** A reusable payment token (never card details) that allows later authorised charges. */
  authorization?: { token: string; reusable: boolean; masked: string; channel: string };
}

export type EventType = 'payment.success' | 'payment.failed' | 'mandate.approved' | 'mandate.cancelled' | 'refund.processed' | 'dispute.opened' | 'other';
export interface ParsedEvent {
  eventId: string;
  type: EventType;
  reference?: string;
  mandateRef?: string;
  authorization?: { token: string; masked: string };
  raw: unknown;
}

export interface CheckoutInput { reference: string; amount: number; currency: string; email: string; description: string; callbackUrl: string; metadata?: Record<string, unknown> }

export interface Provider {
  caps: ProviderCaps;
  configured(): boolean;
  createCheckout(i: CheckoutInput): Promise<{ providerRef: string; url: string }>;
  /** Start authorisation of future debits. Cards authorise by paying a first charge; wallets by an approval flow. */
  startMandate(i: CheckoutInput & { method: 'card' | 'momo'; phone?: string | null }): Promise<{ providerRef: string; url: string }>;
  charge(i: { token: string; reference: string; amount: number; currency: string; email: string }): Promise<{ status: 'pending' | 'failed'; reason?: string }>;
  /** Authoritative status of a transaction, asked of the provider itself. */
  verify(reference: string): Promise<VerifyResult>;
  /** Check the signature and parse. Throws SignatureError when it does not verify. */
  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): ParsedEvent;
  cancelMandate?(i: { token: string | null; providerRef: string | null }): Promise<void>;
  refund?(i: { transactionRef: string; amount: number; reason: string }): Promise<{ ref: string; status: 'pending' | 'completed' | 'failed' }>;
}
