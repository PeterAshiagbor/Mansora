import { addDaysIso, computeStanding, DEFAULT_STANDING_POLICY, MAX_HOLD_DAYS, type ServiceStanding, type StandingPolicy } from '@mansora/domain';
import type { Query } from '../db';
import { audit, fail, loadSettings, OUTSTANDING_SQL, today, type Actor, type Billing } from './core';

/**
 * Server side of the non-payment policy (D-28). The stage comes only from issued invoices that are
 * overdue, still owed and not disputed. Payment arrangements live in billing_settings under
 * `service_hold:<tenantId>`; every change is written to the append-only billing audit log.
 */
const holdKey = (tenantId: string) => `service_hold:${tenantId}`;

export async function standingPolicy(q: Query): Promise<StandingPolicy> {
  return { ...DEFAULT_STANDING_POLICY, ...(await loadSettings(q)).standing };
}

export async function serviceHold(q: Query, tenantId: string): Promise<{ until: string; reason: string } | null> {
  const [row] = await q(`SELECT value FROM billing_settings WHERE key = $1`, [holdKey(tenantId)]);
  return row ? JSON.parse(row.value) : null;
}

export async function tenantStanding(b: Billing, q: Query, tenantId: string): Promise<ServiceStanding> {
  const day = today(b);
  const [oldest] = await q(`SELECT i.number, i.due_date::text AS due_date FROM invoices i WHERE i.tenant_id = $1 AND i.status IN ('sent','partially_paid')
    AND ${OUTSTANDING_SQL} > 0 AND i.due_date < $2::date ORDER BY i.due_date, i.number LIMIT 1`, [tenantId, day]);
  const hold = await serviceHold(q, tenantId);
  return computeStanding(await standingPolicy(q), day, oldest ? { number: oldest.number, dueDate: String(oldest.due_date).slice(0, 10) } : null, hold?.until ?? null);
}

/** Agree a payment arrangement: no restrictions up to and including `until` (at most MAX_HOLD_DAYS ahead). */
export async function setServiceHold(b: Billing, q: Query, tenantId: string, until: string, reason: string, actor: Actor): Promise<ServiceStanding> {
  const day = today(b);
  if (until < day) fail(400, 'INVALID_INPUT', 'The arrangement must end today or later');
  if (until > addDaysIso(day, MAX_HOLD_DAYS)) fail(400, 'INVALID_INPUT', `An arrangement can last at most ${MAX_HOLD_DAYS} days. Agree a new one when it ends.`);
  const [tenant] = await q(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
  if (!tenant) fail(404, 'NOT_FOUND', 'Client not found');
  await q(`INSERT INTO billing_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [holdKey(tenantId), JSON.stringify({ until, reason })]);
  await audit(q, { actor, action: 'service_hold.set', entityType: 'tenant', entityId: tenantId, tenantId, detail: { until, reason } });
  return tenantStanding(b, q, tenantId);
}

export async function clearServiceHold(b: Billing, q: Query, tenantId: string, reason: string, actor: Actor): Promise<ServiceStanding> {
  // The platform role cannot delete settings rows, so an ended arrangement is overwritten with null.
  const previous = await serviceHold(q, tenantId);
  if (previous) {
    await q(`UPDATE billing_settings SET value = 'null', updated_at = now() WHERE key = $1`, [holdKey(tenantId)]);
    await audit(q, { actor, action: 'service_hold.cleared', entityType: 'tenant', entityId: tenantId, tenantId, detail: { reason, previous } });
  }
  return tenantStanding(b, q, tenantId);
}
