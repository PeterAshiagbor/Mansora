import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../db';
import { queueEmail } from '../billing/core';
import { HttpError, httpError } from '../security';
import { insertClient } from './admin';

/**
 * Convert a qualified lead into a client (acquisition spec PR-04/PR-05, owner decision D03).
 *
 * Only on an administrator's explicit approval, in one transaction: the lead is locked and re-checked, possible
 * duplicates stop the conversion for a person to decide, the client is created with the existing onboarding
 * checklist (and a draft subscription if a plan was agreed: nothing is invoiced or charged), the lead is linked,
 * the conversion is recorded, and the welcome email is queued, all committing together. Repeating the request
 * returns the same client; a later email failure never undoes the client.
 */
export const BUSINESS_TYPES = ['retail', 'mini_mart', 'general_merchandise', 'wholesale', 'other'] as const;
export const convertBody = z.object({
  name: z.string().trim().min(1).max(120), ownerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).nullish().transform((v) => v || null),
  email: z.string().trim().toLowerCase().email().max(200),
  address: z.string().trim().max(300).nullish().transform((v) => v || null),
  businessType: z.enum(BUSINESS_TYPES), planId: z.string().uuid().nullish(),
  detailsConfirmed: z.literal(true, { message: 'Confirm the details with the prospect first' }),
}).strict();
const digits = (s: string | null | undefined) => { const d = (s ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };

export async function findPossibleDuplicates(q: Query, b: { name: string; email: string | null; phone: string | null }) {
  const rows = await q(`SELECT id, name, owner_name, email, phone, status FROM tenants WHERE lower(email) = lower($1) OR lower(name) = lower($2) OR ($3::text IS NOT NULL AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $3)`, [b.email ?? '', b.name, digits(b.phone)]);
  return rows;
}

const PLAN_LINE = (plan: any) => (plan ? `Service plan: ${plan.name}. Your subscription is prepared but not started: nothing is charged until Mansora confirms the start date and sends your first invoice.` : 'Service plan: to be confirmed with you. Nothing is charged until you agree a plan and Mansora sends your first invoice.');
export function onboardingEmail(o: { ownerName: string; business: string; plan: any; support: string }) {
  const first = o.ownerName.trim().split(/\s+/)[0] || o.ownerName;
  return {
    subject: `Welcome to Mansora Sales & Stock, ${o.business}`,
    body: `Hello ${first},\n\nWelcome to Mansora. ${o.business} is now set up as a Mansora client, and we look forward to working with you.\n\n${PLAN_LINE(o.plan)}\n\nYour Mansora contact: ${o.support}. Reply to this email at any time.\n\nWhat happens next\n\n1. Setting up your shop. We agree with you how you will use Mansora (on a laptop, or in the browser) and prepare it. You will receive your own private setup instructions in a separate message; you choose your own password. We will never ask you for your password.\n\n2. Your products and opening stock. Prepare a list of what you sell: name, selling price, cost price if you know it, barcode if the item has one, and how many you have in stock today. A spreadsheet is ideal; we can provide a template and help you import it.\n\n3. Your staff. Tell us who will use Mansora (owner, managers, cashiers). Each person gets their own login, so every sale, discount and refund shows who did it.\n\n4. Training and go-live. We train you and your staff, run a test sale with you, check your printer and scanner if you have them, and agree the day you start.\n\nThis email does not contain any password or setup code, and nothing has been charged.\n\nMansora Consulting and Business Solutions Limited · priscilla@mansora-consulting.com · 024 420 5134`,
  };
}

export async function convertLead(q: Query, actor: { id: string; name: string }, leadId: string, input: z.infer<typeof convertBody>) {
  const [lead] = await q(`SELECT d.*, a.name AS assigned_name FROM demo_requests d LEFT JOIN admins a ON a.id = d.assigned_admin_id WHERE d.id = $1 FOR UPDATE OF d`, [leadId]);
  if (!lead) httpError(404, 'NOT_FOUND', 'Demo request not found');
  if (lead.tenant_id) return { tenantId: lead.tenant_id as string, alreadyConverted: true };
  if (lead.status !== 'qualified') httpError(409, 'NOT_QUALIFIED', 'Only a qualified lead can be converted. Mark it qualified once you have agreed to go ahead.');
  const matches = await findPossibleDuplicates(q, input);
  if (matches.length) {
    throw new HttpError(409, 'POSSIBLE_DUPLICATE', 'This may be an existing client. Check the matches, then link the lead to the right client or change the details.', { matches });
  }
  const plan = input.planId ? (await q(`SELECT id, name FROM service_plans WHERE id = $1 AND active`, [input.planId]))[0] : null;
  if (input.planId && !plan) httpError(400, 'UNKNOWN_PLAN', 'Choose an offered service plan');
  const support = lead.assigned_name ?? actor.name;
  const tenantId = await insertClient(q, actor, { name: input.name, ownerName: input.ownerName, phone: input.phone, email: input.email, address: input.address, businessType: input.businessType, supportContact: support, planId: input.planId ?? null, leadId });
  await q(`UPDATE demo_requests SET tenant_id = $2, converted_at = now(), converted_by = $3, updated_at = now() WHERE id = $1`, [leadId, tenantId, actor.id]);
  await q(`INSERT INTO lead_events (id, lead_id, kind, body, actor_admin_id, occurred_at) VALUES ($1,$2,'conversion',$3,$4,now())`, [randomUUID(), leadId, `Converted to client ${input.name}${plan ? ` (draft ${plan.name} subscription)` : ''}`, actor.id]);
  // One logical welcome email per client: its id is fixed by the client, so a retry can never queue a second one.
  const mail = onboardingEmail({ ownerName: input.ownerName, business: input.name, plan, support: `${support}, Mansora` });
  await queueEmail(q, { id: tenantId, kind: 'client_onboarding', tenantId, leadId, to: input.email, ...mail });
  return { tenantId, alreadyConverted: false };
}

/** Link a lead to a client that already exists (found as a possible duplicate), as an explicit, audited action. */
export async function linkLead(q: Query, actor: { id: string; name: string }, leadId: string, tenantId: string) {
  const [lead] = await q(`SELECT id, tenant_id FROM demo_requests WHERE id = $1 FOR UPDATE`, [leadId]);
  if (!lead) httpError(404, 'NOT_FOUND', 'Demo request not found');
  if (lead.tenant_id) httpError(409, 'ALREADY_CONVERTED', 'This lead is already linked to a client');
  const [t] = await q(`SELECT id, name, lead_id FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
  if (!t) httpError(404, 'NOT_FOUND', 'Client not found');
  if (t.lead_id) httpError(409, 'CLIENT_HAS_LEAD', 'That client is already linked to another lead');
  await q(`UPDATE tenants SET lead_id = $2 WHERE id = $1`, [tenantId, leadId]);
  await q(`UPDATE demo_requests SET tenant_id = $2, converted_at = now(), converted_by = $3, updated_at = now() WHERE id = $1`, [leadId, tenantId, actor.id]);
  await q(`INSERT INTO lead_events (id, lead_id, kind, body, actor_admin_id, occurred_at) VALUES ($1,$2,'conversion',$3,$4,now())`, [randomUUID(), leadId, `Linked to existing client ${t.name} (no new client created, no email sent)`, actor.id]);
  await q('INSERT INTO admin_audit_logs (id, admin_id, action, tenant_id, detail) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), actor.id, 'lead.linked_to_client', tenantId, JSON.stringify({ leadId })]);
  return { tenantId };
}
