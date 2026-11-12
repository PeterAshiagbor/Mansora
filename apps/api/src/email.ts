/** Resend's HTTPS API. Secrets and provider response bodies never enter logs/errors. */
export interface EmailMessage { to: string; subject: string; body: string; idempotencyKey?: string }
export class EmailDeliveryError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); }
}
export interface EmailAdapter { configured(): boolean; send(message: EmailMessage): Promise<void | { id: string }> }
const address = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
export class ResendEmail implements EmailAdapter {
  constructor(private options: { apiKey?: string; from?: string; replyTo?: string; allowedRecipients?: string[]; fetch?: typeof fetch }) {}
  configured() { return !!(this.options.apiKey && this.options.from); }
  async send(message: EmailMessage): Promise<{ id: string }> {
    if (!this.configured()) throw new EmailDeliveryError('Resend is not configured.', false);
    if (!address.test(message.to) || /[\r\n]/.test(message.subject)) throw new EmailDeliveryError('Email address or subject is invalid.', false);
    if (this.options.allowedRecipients?.length && !this.options.allowedRecipients.some(a => a.toLowerCase() === message.to.toLowerCase())) throw new EmailDeliveryError('Recipient is outside the configured test allowlist.', false);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json', ...(message.idempotencyKey ? { 'idempotency-key': message.idempotencyKey } : {}) },
        body: JSON.stringify({ from: this.options.from, to: [message.to], subject: message.subject, text: message.body, ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {}) }),
      });
    } catch { throw new EmailDeliveryError('Resend could not be reached; delivery will retry.', true); }
    if (!response.ok) {
      const failure: any = await response.json().catch(() => ({}));
      if (response.status === 403 && typeof failure.message === 'string' && /domain.*not verified/i.test(failure.message)) throw new EmailDeliveryError('Resend sender domain is not verified.', false);
      throw new EmailDeliveryError(`Resend rejected delivery (HTTP ${response.status}).`, [408, 429].includes(response.status) || response.status >= 500);
    }
    const data: any = await response.json().catch(() => ({}));
    if (typeof data.id !== 'string' || !data.id) throw new EmailDeliveryError('Resend returned an incomplete acknowledgement.', true);
    return { id: data.id };
  }
}
export function resendFromEnv(): ResendEmail {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const replyTo = process.env.RESEND_REPLY_TO?.trim();
  const mailbox = from?.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (from && (!mailbox || !address.test(mailbox) || /[\r\n]/.test(from))) throw new Error('RESEND_FROM_EMAIL must be a valid verified sender.');
  if (replyTo && !address.test(replyTo)) throw new Error('RESEND_REPLY_TO must be an email address.');
  const allowedRecipients = (process.env.RESEND_ALLOWED_RECIPIENTS ?? '').split(',').map(a => a.trim()).filter(Boolean);
  if (allowedRecipients.some(a => !address.test(a))) throw new Error('RESEND_ALLOWED_RECIPIENTS must contain email addresses.');
  // A team-test deployment must explicitly allow its recipients before it can send.
  if ((process.env.MANSORA_DEPLOYMENT_MODE === 'team-test' || process.env.MANSORA_STAGING_MODE === 'team-test') && process.env.RESEND_API_KEY && !allowedRecipients.length) throw new Error('Set RESEND_ALLOWED_RECIPIENTS before enabling team-test email.');
  return new ResendEmail({ apiKey: process.env.RESEND_API_KEY, from, replyTo, allowedRecipients });
}
