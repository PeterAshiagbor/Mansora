import { ProviderError, type CheckoutInput, type ParsedEvent, type Provider } from './types';

const BLOCKED = 'Hubtel recurring Mobile Money is an integration blocker. It needs a Hubtel merchant account, written confirmation of the recurring/direct-debit API and mandate rules for MTN and Telecel, and sandbox credentials. See docs/billing/provider-onboarding.md.';

/**
 * Hubtel (Mobile Money). INTENTIONALLY NOT IMPLEMENTED.
 * Hubtel's recurring invoices exist as a dashboard feature, and third-party material mentions mobile-money pre-approvals, but no
 * official API reference for recurring collection could be confirmed. Guessing endpoints for a system that moves customers'
 * money would be worse than saying so, so every operation fails with an explicit, visible blocker. Implement this adapter
 * (same interface as Paystack's) once Hubtel supplies the API terms and sandbox access.
 */
export class HubtelProvider implements Provider {
  caps = { id: 'hubtel', label: 'Hubtel (Mobile Money)', sandbox: false, verified: false, oneOff: false, recurringCard: false, recurringMomo: true, refunds: false };
  configured(): boolean { return false; }
  private blocked(): never { throw new ProviderError('PROVIDER_BLOCKED', BLOCKED); }
  async createCheckout(_i: CheckoutInput): Promise<never> { return this.blocked(); }
  async startMandate(): Promise<never> { return this.blocked(); }
  async charge(): Promise<never> { return this.blocked(); }
  async verify(): Promise<never> { return this.blocked(); }
  parseWebhook(): ParsedEvent { return this.blocked(); }
}
