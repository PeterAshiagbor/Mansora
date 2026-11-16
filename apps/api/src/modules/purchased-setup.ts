/** Email-proof setup for an existing paid software purchase; never a free activation endpoint. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import type { Query } from '../db';
import { httpError, newActivationCode, RateLimiter, sha256 } from '../security';

export async function paidPurchaseEligible(q: Query, tenantId: string): Promise<boolean> {
  return (await q(`SELECT 1 FROM tenants t JOIN client_subscriptions s ON s.tenant_id = t.id
    JOIN invoices i ON i.subscription_id = s.id AND i.tenant_id = t.id
    WHERE t.id = $1 AND t.status NOT IN ('closed', 'suspended') AND s.status IN ('active', 'trial')
      AND i.status = 'paid' AND i.total > 0 AND i.amount_paid - i.amount_refunded >= i.total
      AND i.amount_credited = 0 AND i.amount_written_off = 0 LIMIT 1`, [tenantId])).length > 0;
}

export function registerPurchasedSetupRoutes(app: FastifyInstance, ctx: AppContext) {
  const ip = new RateLimiter(12, 15 * 60_000), emails = new RateLimiter(3, 30 * 60_000);
  app.post('/v1/accounts/purchased-setup', async (req, reply) => {
    ip.check(req.ip);
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).parse(req.body);
    emails.check(sha256(email));
    if (!ctx.browserWorkspaces || !ctx.purchasedSetupIssuerId || !ctx.email?.configured()) httpError(503, 'SETUP_UNAVAILABLE', 'Account setup is temporarily unavailable. Contact Mansora support.');
    const response = { message: 'If this email matches an eligible paid purchase, we will email a private setup link. Otherwise, contact Mansora support.' };
    // Duplicate business contacts are not resolved by a password or disclosed publicly.
    const tenants = await ctx.db.platform(q => q<{ id: string; name: string; owner_name: string; email: string }>("SELECT id, name, owner_name, email FROM tenants WHERE lower(email) = $1 AND status NOT IN ('closed', 'suspended') LIMIT 2", [email]));
    if (tenants.length !== 1) return reply.code(202).send(response);
    const tenant = tenants[0];
    const allowed = await ctx.db.platform(q => paidPurchaseEligible(q, tenant.id));
    if (!allowed) return reply.code(202).send(response);
    const code = newActivationCode();
    const binding = await ctx.db.platform(async q => {
      const [operator] = await q<{ id: string }>("SELECT id FROM admins WHERE id = $1 AND status = 'active'", [ctx.purchasedSetupIssuerId]);
      if (!operator || !await paidPurchaseEligible(q, tenant.id)) return undefined;
      const hasDevice = (await q("SELECT 1 FROM devices WHERE tenant_id = $1 AND status = 'active'", [tenant.id])).length > 0;
      // Existing installations use sign-in/recovery, never a second empty workspace.
      if (hasDevice) return undefined;
      await q('INSERT INTO activation_codes (code_hash, tenant_id, expires_at, created_by) VALUES ($1, $2, $3, $4)', [sha256(code), tenant.id, new Date(Date.now() + 30 * 60_000).toISOString(), operator.id]);
      await q('INSERT INTO admin_audit_logs (id, admin_id, action, tenant_id, detail) VALUES ($1, NULL, $2, $3, $4)', [randomUUID(), 'account.purchased_setup_requested', tenant.id, JSON.stringify({ source: 'paid-purchase-email-proof' })]);
      return { hasDevice };
    });
    if (binding) {
      try {
        const setup = await ctx.browserWorkspaces!.invite({ tenantId: tenant.id, label: tenant.name, ownerName: tenant.owner_name, ownerEmail: tenant.email, activationCode: code, requiresPaidPurchase: true });
        if (setup.status === 'pending') await ctx.email!.send({ to: tenant.email, subject: 'Set up your Mansora Sales & Stock account', idempotencyKey: 'mansora-purchased-setup/' + sha256(setup.url), body: `Hello ${tenant.owner_name},\n\nSet up the account for your paid Mansora Sales & Stock purchase using this private link:\n${setup.url}\n\nChoose your username and password, then invite your team. The link works once and expires at ${setup.expiresAt}. If you did not request this, ignore this email. Never share your password or this link.\n\nMansora Consulting and Business Solutions Limited` });
      } catch {
        // No email, token, password or provider response is logged or returned to a public caller.
        app.log.warn({ event: 'purchased_setup_delivery_needs_review' }, 'Purchased-account setup needs operator review');
      }
    }
    return reply.code(202).send(response);
  });
}
