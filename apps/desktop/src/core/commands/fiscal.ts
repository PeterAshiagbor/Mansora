import { z } from 'zod';
import { fail, FISCAL_MODES } from '@mansora/domain';
import { defineCommands, empty, zId, zText } from '../engine';
import { fiscalDocuments, fiscalMode, fiscalProvider, fiscalRequired, fiscalSummary, runFiscalWorker } from '../fiscal';

export const fiscalCommands = defineCommands({
  /** Cheap enough for the status bar. Never reveals credentials or payloads. */
  'fiscal.status': {
    perm: 'auth',
    input: empty,
    run: (ctx) => {
      const mode = fiscalMode(ctx.engine);
      const provider = fiscalProvider(ctx.engine);
      const ready = provider?.readiness() ?? null;
      return { mode, provider: provider?.name ?? null, ready: ready ? ready.ok : null, blockedReason: ready && !ready.ok ? ready.reason : null, applies: fiscalRequired(ctx), summary: fiscalSummary(ctx) };
    },
  },
  /** Owner/admin switch. `live` stays unavailable until the GRA adapter, credentials and sign-off exist. */
  'fiscal.configure': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({ mode: z.enum(FISCAL_MODES), sandboxUrl: z.string().url().max(300).optional(), reason: zText(300) }),
    run: (ctx, input) => {
      if (input.mode === 'live') fail('FISCAL_LIVE_UNAVAILABLE', 'Live GRA reporting is not available yet. It needs the approved GRA specification, credentials and written sign-off.');
      if (input.mode === 'sandbox' && !input.sandboxUrl && !ctx.setting('fiscal_sandbox_url')) fail('INVALID_INPUT', 'Enter the sandbox address');
      const before = fiscalMode(ctx.engine);
      ctx.engine.setMeta('fiscal_mode', input.mode);
      if (input.sandboxUrl) ctx.engine.setMeta('fiscal_sandbox_url', input.sandboxUrl);
      ctx.audit('settings', null, { from: before, to: input.mode, reason: input.reason }, 'fiscal.configure');
      return { mode: input.mode };
    },
  },
  'fiscal.list': {
    perm: 'settings.manage',
    input: z.object({ attentionOnly: z.boolean().default(false), limit: z.number().int().min(1).max(500).default(100) }),
    run: (ctx, input) => {
      const rows = fiscalDocuments(ctx).map(({ payload: _p, ...d }) => d);
      const list = input.attentionOnly ? rows.filter((d) => d.state === 'rejected') : rows;
      return list.slice(-input.limit).reverse();
    },
  },
  'fiscal.run': { perm: 'auth', async: true, input: empty, run: (ctx) => runFiscalWorker(ctx.engine) },
  /** The owner has dealt with a rejected document outside the system (for example, with GRA directly). */
  'fiscal.resolve': {
    perm: 'settings.manage',
    mutates: true,
    input: z.object({ documentId: zId, note: zText(500) }),
    run: (ctx, input) => {
      const d = fiscalDocuments(ctx).find((x) => x.id === input.documentId);
      if (!d) fail('NOT_FOUND', 'Fiscal document not found');
      if (d.state !== 'rejected') fail('INVALID_STATE', 'Only a rejected document can be marked as resolved');
      ctx.insert('fiscal_events', { id: ctx.id(), document_id: d.id, type: 'manual_resolution', attempt_no: d.attempts, occurred_at: ctx.now(), next_attempt_at: null, provider: null, gra_reference: null, gra_signature: null, qr_data: null, gra_timestamp: null, error_code: null, error_detail: input.note });
      ctx.audit('fiscal_document', d.id, { fiscalNumber: d.fiscal_number, note: input.note }, 'fiscal.resolve');
      return { id: d.id };
    },
  },
});
