import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, SignatureError, type CheckoutInput, type ParsedEvent, type Provider, type VerifyResult } from './types';

export interface PaystackConfig { secretKey?: string; baseUrl?: string; fetch?: typeof fetch }

/**
 * Paystack adapter (cards and one-off checkout). Written against Paystack's documented API:
 *   POST /transaction/initialize, GET /transaction/verify/:reference, POST /transaction/charge_authorization, POST /refund,
 *   and webhooks signed with HMAC-SHA512 of the raw body in the x-paystack-signature header.
 * It is exercised in tests against a local fake of those endpoints. It has NOT been run against Paystack itself:
 * that needs test keys (see docs/billing/provider-onboarding.md), so caps.verified is false.
 *
 * Paystack's own support documentation states that Mobile Money cannot be used for recurring payments in Ghana, so
 * recurringMomo is false: Mobile Money here means a one-off checkout in which the customer approves every payment.
 */
export class PaystackProvider implements Provider {
  caps = { id: 'paystack', label: 'Paystack', sandbox: false, verified: false, oneOff: true, recurringCard: true, recurringMomo: false, refunds: true };
  constructor(private cfg: PaystackConfig) {}
  configured(): boolean { return !!this.cfg.secretKey; }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    if (!this.cfg.secretKey) throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Paystack is not configured');
    let res: Response;
    try {
      res = await (this.cfg.fetch ?? fetch)(`${this.cfg.baseUrl ?? 'https://api.paystack.co'}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.cfg.secretKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Paystack could not be reached. Try again shortly.', true);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false) {
      const message = String(json.message ?? `Paystack responded ${res.status}`);
      if (/not found/i.test(message)) throw new ProviderError('NOT_FOUND', message);
      throw new ProviderError('PROVIDER_ERROR', message, res.status >= 500 || res.status === 429);
    }
    return json.data;
  }

  async createCheckout(i: CheckoutInput) {
    const d = await this.call('POST', '/transaction/initialize', { email: i.email, amount: i.amount, currency: i.currency, reference: i.reference, callback_url: i.callbackUrl, metadata: i.metadata, channels: ['card', 'mobile_money'] });
    return { providerRef: String(d.reference), url: String(d.authorization_url) };
  }

  async startMandate(i: CheckoutInput & { method: 'card' | 'momo' }) {
    if (i.method !== 'card') throw new ProviderError('UNSUPPORTED', 'Paystack cannot set up recurring Mobile Money debits in Ghana. Cards can be set up for automatic payment.');
    const d = await this.call('POST', '/transaction/initialize', { email: i.email, amount: i.amount, currency: i.currency, reference: i.reference, callback_url: i.callbackUrl, metadata: { ...i.metadata, authorise_future_charges: true }, channels: ['card'] });
    return { providerRef: String(d.reference), url: String(d.authorization_url) };
  }

  async charge(i: { token: string; reference: string; amount: number; currency: string; email: string }) {
    const d = await this.call('POST', '/transaction/charge_authorization', { authorization_code: i.token, email: i.email, amount: i.amount, currency: i.currency, reference: i.reference });
    if (d.status === 'failed') return { status: 'failed' as const, reason: String(d.gateway_response ?? 'Charge failed') };
    return { status: 'pending' as const }; // never treated as paid until verify() says so
  }

  async verify(reference: string): Promise<VerifyResult> {
    let d: any;
    try {
      d = await this.call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'NOT_FOUND') return { status: 'not_found' };
      throw e;
    }
    const map: Record<string, VerifyResult['status']> = { success: 'successful', failed: 'failed', reversed: 'failed', abandoned: 'pending', ongoing: 'pending', pending: 'pending', processing: 'pending', queued: 'pending' };
    const out: VerifyResult = { status: map[String(d.status)] ?? 'pending', amount: d.amount, currency: d.currency, fee: Number(d.fees ?? 0), txnId: d.id != null ? String(d.id) : undefined, channel: d.channel, failureReason: d.gateway_response };
    const a = d.authorization;
    if (out.status === 'successful' && a?.authorization_code) {
      out.authorization = { token: String(a.authorization_code), reusable: a.reusable === true, masked: `${a.brand ?? a.card_type ?? 'Card'} •••• ${a.last4 ?? '????'}`.trim(), channel: String(a.channel ?? 'card') };
    }
    return out;
  }

  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): ParsedEvent {
    const given = String(headers['x-paystack-signature'] ?? '');
    const expected = createHmac('sha512', this.cfg.secretKey ?? '').update(raw).digest('hex');
    if (!this.cfg.secretKey || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new SignatureError('Invalid signature');
    const e = JSON.parse(raw.toString('utf8'));
    const data = e.data ?? {};
    const type = ({ 'charge.success': 'payment.success', 'refund.processed': 'refund.processed', 'charge.dispute.create': 'dispute.opened' } as Record<string, ParsedEvent['type']>)[e.event] ?? 'other';
    // Paystack sends no unique event id, so the event name plus the object's id identifies a delivery.
    return { eventId: `${e.event}:${data.id ?? data.reference ?? ''}`, type, reference: data.reference ?? data.transaction?.reference ?? data.transaction_reference, raw: e };
  }

  async refund(i: { transactionRef: string; amount: number; reason: string }) {
    const d = await this.call('POST', '/refund', { transaction: i.transactionRef, amount: i.amount, customer_note: i.reason, merchant_note: i.reason });
    return { ref: String(d.id ?? d.reference ?? i.transactionRef), status: 'pending' as const };
  }
}
