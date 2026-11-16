import { z } from 'zod';
import { fail, zDateRange } from '@mansora/domain';
import { defineCommands, empty, type Ctx } from '../engine';
import { disconnectXero, pushToXero, setXeroMapping, xeroAuthUrl, xeroExchange, xeroJournals, xeroStatus } from '../xero';

function owner(ctx: Ctx) { if (ctx.user.role !== 'owner') fail('PERMISSION_DENIED', 'Only the owner can manage the Xero connection'); }

/** Audit F08: owner-controlled Xero connection for the accountant's books. */
export const xeroCommands = defineCommands({
  'xero.status': { perm: 'data.export', input: empty, run: (ctx) => ({ ...xeroStatus(ctx.engine), pushed: ctx.all(`SELECT journal_date, status, external_id, last_error, created_at FROM accounting_exports WHERE provider = 'xero' ORDER BY journal_date DESC LIMIT 60`) }) },
  'xero.authUrl': {
    perm: 'data.export', input: z.object({ clientId: z.string().trim().min(8).max(100), redirectUri: z.string().url().max(300) }),
    run: (ctx, input) => { owner(ctx); return { url: xeroAuthUrl(ctx.engine, input.clientId, input.redirectUri) }; },
  },
  'xero.connect': {
    perm: 'data.export', async: true, input: z.object({ code: z.string().trim().min(4).max(2000), state: z.string().trim().min(4).max(200) }),
    run: async (ctx, input) => {
      owner(ctx);
      const r = await xeroExchange(ctx.engine, input.code, input.state);
      ctx.tx(() => ctx.audit('business', null, { tenant: r.tenant }, 'accounting.xero_connected'));
      return r;
    },
  },
  'xero.mapping': {
    perm: 'data.export', mutates: true, input: z.object({ mapping: z.record(z.string(), z.string().trim()) }),
    run: (ctx, input) => { owner(ctx); setXeroMapping(ctx.engine, input.mapping); ctx.audit('business', null, { mapping: input.mapping }, 'accounting.xero_mapping'); return xeroStatus(ctx.engine); },
  },
  'xero.preview': { perm: 'data.export', input: zDateRange(), run: (ctx, input) => xeroJournals(ctx, input.from, input.to) },
  'xero.push': {
    perm: 'data.export', async: true, input: zDateRange(),
    run: async (ctx, input) => { owner(ctx); return pushToXero(ctx.engine, ctx, input.from, input.to); },
  },
  'xero.disconnect': {
    perm: 'data.export', mutates: true, input: empty,
    run: (ctx) => { owner(ctx); disconnectXero(ctx.engine); ctx.audit('business', null, {}, 'accounting.xero_disconnected'); return { connected: false }; },
  },
});
