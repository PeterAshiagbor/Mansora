import { z } from 'zod';
import { fail } from '@mansora/domain';
import { defineCommands, empty, zId, zText } from '../engine';
import { call } from '../sync';

/**
 * The client's own view of their Mansora subscription.
 *
 * Everything here talks to the Mansora server with the device token; no payment
 * credential, card number or Mobile Money PIN ever reaches this computer. Payment
 * pages open in the client's browser at the provider.
 *
 * Offline, the last summary the server gave is shown, clearly marked, and any
 * action that needs the server says so instead of pretending to work.
 */
const CACHE = 'billing_cache';

function cached(engine: { meta(k: string): string | null | undefined }): { at: string; data: any } | null {
  try { return JSON.parse(engine.meta(CACHE) ?? 'null'); } catch { return null; }
}
/** True for connection problems only, never for an HTTP response from the server. */
function unreachable(e: unknown): boolean {
  const err = e as Error & { cause?: { code?: string } };
  return err?.name === 'TimeoutError' || (err?.name === 'TypeError' && /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(`${err.message} ${err.cause?.code ?? ''}`));
}
function needsServer(e: unknown): never {
  const msg = String((e as Error)?.message ?? '');
  if (unreachable(e)) fail('OFFLINE', 'This needs an internet connection. Please connect and try again.');
  fail('BILLING_FAILED', msg || 'Mansora could not complete that request');
}

export const billingCommands = defineCommands({
  'billing.summary': {
    perm: 'billing.view',
    async: true,
    input: empty,
    run: async (ctx) => {
      const e = ctx.engine;
      try {
        const data = await call(e, '/v1/billing/summary', { method: 'GET' });
        e.setMeta(CACHE, JSON.stringify({ at: e.now().toISOString(), data }));
        return { offline: false, fetchedAt: e.now().toISOString(), ...data };
      } catch (err) {
        // Show the last copy only when the server cannot be reached; a refusal (such as a deactivated laptop) is reported.
        const last = cached(e);
        if (last && unreachable(err)) return { offline: true, fetchedAt: last.at, ...last.data };
        return needsServer(err);
      }
    },
  },
  'billing.pay': {
    perm: 'billing.manage',
    async: true,
    input: z.object({ invoiceId: zId }),
    run: async (ctx, input) => {
      let r: { url: string };
      try { r = await call(ctx.engine, `/v1/billing/invoices/${input.invoiceId}/pay`, { method: 'POST', body: '{}' }); } catch (err) { return needsServer(err); }
      ctx.tx(() => { ctx.audit('billing', input.invoiceId, { action: 'pay_started' }, 'billing.pay_started'); ctx.flush(); });
      return { url: r.url };
    },
  },
  'billing.mandate.start': {
    perm: 'billing.manage',
    async: true,
    input: z.object({ method: z.enum(['card', 'momo']), phone: z.string().trim().max(30).nullish() }),
    run: async (ctx, input) => {
      let r: { url: string };
      try { r = await call(ctx.engine, '/v1/billing/mandate', { method: 'POST', body: JSON.stringify(input) }); } catch (err) { return needsServer(err); }
      ctx.tx(() => { ctx.audit('billing', null, { method: input.method }, 'billing.mandate_started'); ctx.flush(); });
      return { url: r.url };
    },
  },
  'billing.mandate.cancel': {
    perm: 'billing.manage',
    async: true,
    input: empty,
    run: async (ctx) => {
      try { await call(ctx.engine, '/v1/billing/mandate/cancel', { method: 'POST', body: '{}' }); } catch (err) { return needsServer(err); }
      ctx.tx(() => { ctx.audit('billing', null, {}, 'billing.mandate_cancelled'); ctx.flush(); });
      return { ok: true };
    },
  },
  'billing.cancellation.request': {
    perm: 'billing.manage',
    async: true,
    input: z.object({ reason: zText(500) }),
    run: async (ctx, input) => {
      try { await call(ctx.engine, '/v1/billing/cancellation-request', { method: 'POST', body: JSON.stringify(input) }); } catch (err) { return needsServer(err); }
      ctx.tx(() => { ctx.audit('billing', null, { reason: input.reason }, 'billing.cancellation_requested'); ctx.flush(); });
      return { ok: true };
    },
  },
  'billing.document': {
    perm: 'billing.view',
    async: true,
    input: z.object({ kind: z.enum(['invoice', 'receipt']), id: zId }),
    run: async (ctx, input) => {
      const path = input.kind === 'invoice' ? `/v1/billing/invoices/${input.id}/document` : `/v1/billing/payments/${input.id}/receipt`;
      try { return await call(ctx.engine, path, { method: 'GET' }); } catch (err) { return needsServer(err); }
    },
  },
});
