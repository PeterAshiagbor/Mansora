import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProviderError, SignatureError, type CheckoutInput, type ParsedEvent, type Provider, type ProviderStatus, type VerifyResult } from './types';

interface Txn { amount: number; currency: string; status: ProviderStatus; reason?: string; txnId: string; authorize: boolean }

/**
 * SANDBOX. A simulator for development, tests and demonstrations. No real money
 * ever moves, every payment it produces is flagged sandbox and left out of
 * revenue reports, and the application refuses to register it in production
 * unless BILLING_ALLOW_SANDBOX=1 is set explicitly.
 */
export class SandboxProvider implements Provider {
  caps = { id: 'sandbox', label: 'Sandbox (simulated, no real money)', sandbox: true, verified: true, oneOff: true, recurringCard: true, recurringMomo: true, refunds: true };
  txns = new Map<string, Txn>();
  mandates = new Map<string, { status: 'pending' | 'active' | 'cancelled'; token?: string }>();
  revokedTokens = new Set<string>();
  /** What the next mandate charge does. Tests and demos change this. */
  nextChargeOutcome: 'successful' | 'failed' | 'pending' = 'successful';
  /** Make the provider unreachable, to exercise error handling. */
  down = false;
  constructor(public baseUrl = 'http://localhost:4000', public secret = randomBytes(16).toString('hex')) {}

  configured(): boolean { return true; }
  private guard(): void { if (this.down) throw new ProviderError('PROVIDER_UNAVAILABLE', 'The payment provider could not be reached. Try again shortly.', true); }
  private id(prefix: string): string { return `${prefix}_${randomBytes(6).toString('hex')}`; }

  async createCheckout(i: CheckoutInput) {
    this.guard();
    this.txns.set(i.reference, { amount: i.amount, currency: i.currency, status: 'pending', txnId: this.id('sbx'), authorize: false });
    return { providerRef: i.reference, url: `${this.baseUrl}/sandbox/checkout/${encodeURIComponent(i.reference)}` };
  }

  async startMandate(i: CheckoutInput & { method: 'card' | 'momo' }) {
    this.guard();
    if (i.method === 'card') {
      this.txns.set(i.reference, { amount: i.amount, currency: i.currency, status: 'pending', txnId: this.id('sbx'), authorize: true });
      return { providerRef: i.reference, url: `${this.baseUrl}/sandbox/checkout/${encodeURIComponent(i.reference)}` };
    }
    this.mandates.set(i.reference, { status: 'pending' });
    return { providerRef: i.reference, url: `${this.baseUrl}/sandbox/mandate/${encodeURIComponent(i.reference)}` };
  }

  async charge(i: { token: string; reference: string; amount: number; currency: string; email: string }) {
    this.guard();
    if (this.revokedTokens.has(i.token)) {
      this.txns.set(i.reference, { amount: i.amount, currency: i.currency, status: 'failed', reason: 'Authorisation was cancelled', txnId: this.id('sbx'), authorize: false });
      return { status: 'failed' as const, reason: 'Authorisation was cancelled' };
    }
    const outcome = this.nextChargeOutcome;
    this.txns.set(i.reference, {
      amount: i.amount, currency: i.currency, status: outcome, txnId: this.id('sbx'), authorize: false,
      reason: outcome === 'failed' ? 'Insufficient funds (sandbox)' : undefined,
    });
    // An accepted request is NOT a success. The caller must still verify.
    return outcome === 'failed' ? { status: 'failed' as const, reason: 'Insufficient funds (sandbox)' } : { status: 'pending' as const };
  }

  async verify(reference: string): Promise<VerifyResult> {
    this.guard();
    const t = this.txns.get(reference);
    if (!t) return { status: 'not_found' };
    const out: VerifyResult = { status: t.status, amount: t.amount, currency: t.currency, fee: Math.round(t.amount * 0.015), txnId: t.txnId, channel: 'card', failureReason: t.reason };
    if (t.status === 'successful' && t.authorize) out.authorization = { token: `sbx_tok_${t.txnId}`, reusable: true, masked: 'Sandbox card •••• 0000', channel: 'card' };
    return out;
  }

  /** Test and demo controls, standing in for what the customer does on the provider's page. */
  approve(reference: string) { const t = this.txns.get(reference); if (t) t.status = 'successful'; }
  fail(reference: string, reason = 'Declined (sandbox)') { const t = this.txns.get(reference); if (t) { t.status = 'failed'; t.reason = reason; } }
  approveMandate(reference: string): string { const token = `sbx_mdt_${randomBytes(6).toString('hex')}`; this.mandates.set(reference, { status: 'active', token }); return token; }

  async cancelMandate(i: { token: string | null }) { this.guard(); if (i.token) this.revokedTokens.add(i.token); }
  async refund(i: { transactionRef: string; amount: number }) { this.guard(); return { ref: this.id('sbx_rf'), status: 'completed' as const }; }

  /** Build a correctly signed webhook delivery, as the provider would send it. */
  signEvent(event: Record<string, unknown>): { body: Buffer; headers: Record<string, string> } {
    const body = Buffer.from(JSON.stringify(event));
    return { body, headers: { 'content-type': 'application/json', 'x-sandbox-signature': createHmac('sha256', this.secret).update(body).digest('hex') } };
  }

  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): ParsedEvent {
    const given = String(headers['x-sandbox-signature'] ?? '');
    const expected = createHmac('sha256', this.secret).update(raw).digest('hex');
    if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new SignatureError('Invalid signature');
    const e = JSON.parse(raw.toString('utf8'));
    return { eventId: String(e.id), type: e.type, reference: e.reference, mandateRef: e.mandateRef, authorization: e.token ? { token: e.token, masked: e.masked ?? 'Sandbox wallet' } : undefined, raw: e };
  }
}
