import type { Query } from './db';
export async function vatFeaturePolicy(q: Query, tenantId: string) {
  const rows = await q(`SELECT e.revision, e.id, e.enabled, e.reason, e.occurred_at, a.name AS admin_name FROM tenant_vat_feature_events e JOIN admins a ON a.id=e.admin_id WHERE e.tenant_id=$1 ORDER BY e.revision`,[tenantId]);
  const events = rows.map(r=>({revision:Number(r.revision),id:r.id,enabled:r.enabled,reason:r.reason,occurredAt:new Date(r.occurred_at).toISOString(),adminName:r.admin_name}));
  return { enabled: events.at(-1)?.enabled ?? true, revision:events.at(-1)?.revision ?? 0, events };
}
