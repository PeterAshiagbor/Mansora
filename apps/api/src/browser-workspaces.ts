import { randomUUID } from 'node:crypto';
import type { Database } from './db';
import { httpError, newActivationCode, sha256 } from './security';
/** Server-only adapter: the platform issues a tenant-bound owner setup link. */
export interface BrowserWorkspaceInvite {
  tenantId: string; label: string; ownerName: string; ownerEmail: string; activationCode: string; hasActiveDevice?: boolean;
}
export interface BrowserWorkspaceLink {
  workspaceId: string; url: string; status: 'pending' | 'ready'; expiresAt?: string;
}
export interface BrowserWorkspaceProvisioner {
  invite(input: BrowserWorkspaceInvite): Promise<BrowserWorkspaceLink>;
}

/** Called only after the browser adapter has consumed a valid recorded-owner email proof. */
export function browserOwnerRecoveryIssuer(db: Database, operatorId: string) {
  return async (tenantId: string): Promise<string> => {
    const code = newActivationCode().replace(/^MNS/, 'REC'), expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await db.platform(async q => {
      if (!(await q("SELECT id FROM admins WHERE id = $1 AND status = 'active'", [operatorId])).length) httpError(503, 'RECOVERY_UNAVAILABLE', 'Owner recovery needs operator review.');
      if (!(await q("SELECT d.id FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE d.tenant_id = $1 AND d.status = 'active' AND t.status <> 'closed'", [tenantId])).length) httpError(409, 'RECOVERY_UNAVAILABLE', 'Owner recovery needs an active workspace.');
      await q('UPDATE owner_recovery_codes SET used_at = now() WHERE tenant_id = $1 AND used_at IS NULL', [tenantId]);
      await q('INSERT INTO owner_recovery_codes (code_hash, tenant_id, expires_at, created_by) VALUES ($1, $2, $3, $4)', [sha256(code), tenantId, expiresAt, operatorId]);
      await q('INSERT INTO admin_audit_logs (id, admin_id, action, tenant_id, detail) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), operatorId, 'owner_recovery_code.created', tenantId, JSON.stringify({ source: 'verified-browser-owner-email-proof', expiresAt })]);
    });
    return code;
  };
}
