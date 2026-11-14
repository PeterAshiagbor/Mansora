import { z } from 'zod';
import { fail } from '@mansora/domain';
import { defineCommands } from '../engine';

const text = (max: number) => z.string().trim().max(max);
const zArea = z.strictObject({
  label: text(160).optional(), text: text(160).optional(), path: text(400).optional(),
  x: z.number().int().min(0).max(100_000).optional(), y: z.number().int().min(0).max(100_000).optional(),
  width: z.number().int().min(0).max(100_000).optional(), height: z.number().int().min(0).max(100_000).optional(),
  viewport: text(40).optional(),
});

/**
 * "Tell Mansora about a problem": any signed-in person can send a short report, optionally pointing at part of
 * the screen. The laptop adds who sent it and the app version; Mansora receives the day's reports by email at 7pm.
 * Needs the internet: the screen keeps the draft if the report cannot be sent.
 */
export const feedbackCommands = defineCommands({
  'bug.report': {
    perm: 'auth',
    async: true,
    input: z.object({
      description: z.string().trim().min(3, 'Describe the problem').max(2000),
      severity: z.enum(['blocking', 'normal', 'idea']).default('normal'),
      page: text(120).optional(),
      area: zArea.nullish(),
    }),
    run: async (ctx, input) => {
      if (!ctx.engine.activated) fail('NOT_ACTIVATED', 'Activate this laptop before sending reports');
      let res: Response;
      try {
        res = await ctx.engine.fetch(`${ctx.setting('api_url')}/v1/devices/bug-reports`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.setting('device_token')}` },
          body: JSON.stringify({ ...input, reporterName: ctx.user.name, reporterRole: ctx.user.role, appVersion: ctx.engine.appVersion }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        fail('OFFLINE', 'The report could not be sent because the internet is not available. Your text is kept: try again when you are back online.');
      }
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) fail(body.code ?? 'REPORT_FAILED', body.message ?? 'The report could not be sent');
      ctx.tx(() => ctx.audit('bug_report', body.id ?? null, { severity: input.severity, page: input.page ?? null, pointed: !!input.area }));
      return { id: body.id, sendsAt: body.sendsAt ?? '19:00' };
    },
  },
});
