import type { Query } from '../db';
import { queueEmail } from '../billing/core';

/**
 * The emails a software demo request starts (acquisition spec PR-02, owner decision D02). Fixed templates only:
 * the prospect's own words appear as quoted text, never as subject, recipient or markup (the branded HTML part is
 * built from this plain text with everything escaped).
 *
 *  - to the prospect, at once: acknowledgement with the reference;
 *  - to the team inbox (LEAD_ALERT_EMAIL), at once: the details and where to find the lead;
 *  - to the team after 24 hours, and to the prospect after 48 hours, only if the lead is still "new" then.
 */
export const TEAM_REMINDER_HOURS = 24, CUSTOMER_FOLLOW_UP_HOURS = 48;
const TYPE_LABEL: Record<string, string> = { retail: 'Retail shop', mini_mart: 'Mini mart', general_merchandise: 'General merchandise', wholesale: 'Wholesale', other: 'Other' };
const CONTACT = 'Mansora Consulting and Business Solutions · priscilla@mansora-consulting.com · 024 420 5134';

export interface NewLead { id: string; reference: string; name: string; business: string; email: string; phone: string; message: string; businessType: string | null; source: string }

export function teamInboxes(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.LEAD_ALERT_EMAIL ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}
const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');

export async function queueLeadEmails(q: Query, lead: NewLead, o: { now: Date; adminUrl?: string; env?: NodeJS.ProcessEnv }) {
  const inboxes = teamInboxes(o.env), at = (h: number) => new Date(o.now.getTime() + h * 3_600_000).toISOString();
  const leadsAt = o.adminUrl ? `${o.adminUrl.replace(/\/$/, '')}/ (sign in, then Leads)` : 'the Mansora administration dashboard, under Leads';
  const details = [
    `Reference: ${lead.reference}`,
    `Name: ${lead.name}`,
    `Business: ${lead.business}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone || 'not given'}`,
    `Kind of business: ${lead.businessType ? TYPE_LABEL[lead.businessType] : 'not given'}`,
    `From: ${lead.source === 'website' ? 'the Mansora website' : 'the demo request form'}`,
  ].join('\n');
  const said = lead.message ? `\n\nWhat they would like to see:\n${quote(lead.message)}` : '';

  await queueEmail(q, { kind: 'lead_ack', leadId: lead.id, to: lead.email, subject: `We received your Mansora demo request (${lead.reference})`,
    body: `Hello ${first(lead.name)},\n\nThank you for asking for a demonstration of Mansora Sales & Stock for ${lead.business}. Your request has been received and your reference is ${lead.reference}.\n\nWhat happens next: a member of the Mansora team will contact you by email or phone to agree a convenient time and to understand what matters most in your business.\n\nNothing has been set up or charged: no account or subscription is created by this request.\n\nIf you have a question in the meantime, simply reply to this email.\n\n${CONTACT}` });
  for (const to of inboxes) {
    await queueEmail(q, { kind: 'lead_alert', leadId: lead.id, to, subject: `New software demo request: ${lead.business} (${lead.reference})`,
      body: `A new demo request has arrived.\n\n${details}${said}\n\nOpen it in ${leadsAt}. Record the contact there once you have spoken to them, so the automatic follow-ups stop.` });
    await queueEmail(q, { kind: 'lead_team_reminder', leadId: lead.id, to, sendAfter: at(TEAM_REMINDER_HOURS), subject: `Reminder: ${lead.business} is waiting for a demo (${lead.reference})`,
      body: `${lead.name} of ${lead.business} asked for a demo ${TEAM_REMINDER_HOURS} hours ago and the request is still marked new.\n\n${details}\n\nPlease contact them, then mark the lead as contacted in ${leadsAt}.` });
  }
  await queueEmail(q, { kind: 'lead_customer_followup', leadId: lead.id, to: lead.email, sendAfter: at(CUSTOMER_FOLLOW_UP_HOURS), subject: `Your Mansora demo request (${lead.reference})`,
    body: `Hello ${first(lead.name)},\n\nWe have not yet been able to arrange your Mansora Sales & Stock demonstration for ${lead.business}, and we did not want you to wait without hearing from us.\n\nPlease reply with a good time and the best number to reach you, and we will set it up. If you no longer need a demo, a short reply saying so is enough and we will not contact you again about it.\n\nReference: ${lead.reference}\n\n${CONTACT}` });
}
