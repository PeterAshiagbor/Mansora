import { SYNC_PROTOCOL_VERSION, type SyncPullResult, type SyncPushResult } from '@mansora/domain';
import type { Engine } from './engine';
import { maybeSendDailySummary } from './summary';

const BATCH = 50;

export interface SyncOutcome {
  ok: boolean;
  pushed: number;
  rejected: number;
  pending: number;
  error?: string;
}

function pendingCount(engine: Engine): number {
  return (engine.db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'`).get() as { n: number }).n;
}

export async function call(engine: Engine, path: string, init: RequestInit): Promise<any> {
  const res = await engine.fetch(`${engine.meta('api_url')}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${engine.meta('device_token')}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Server responded ${res.status}`);
  }
  return res.json();
}

/**
 * Push pending outbox events in order, then pull account status.
 *
 * An event is marked synced ONLY after the server has confirmed it durably
 * stored it. If the connection drops at any point the events simply stay
 * pending and are sent again later; the server ignores ones it already has.
 */
export async function syncNow(engine: Engine): Promise<SyncOutcome> {
  const state = engine.syncState;
  if (!engine.activated) return { ok: false, pushed: 0, rejected: 0, pending: 0, error: 'Not activated' };
  if (state.running) return { ok: true, pushed: 0, rejected: 0, pending: pendingCount(engine) };
  state.running = true;
  state.lastAttemptAt = engine.now().toISOString();
  let pushed = 0;
  let rejected = 0;
  try {
    for (let first = true; ; first = false) {
      const rows = engine.db.prepare(`SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?`).all(BATCH) as any[];
      if (rows.length === 0 && !first) break;
      const lastBackup = engine.db.prepare(`SELECT MAX(created_at) AS t FROM backup_records WHERE status = 'ok'`).get() as { t: string | null };
      let result: SyncPushResult;
      try {
        result = await call(engine, '/v1/sync/events', {
          method: 'POST',
          body: JSON.stringify({
            protocol: SYNC_PROTOCOL_VERSION,
            device: { appVersion: engine.appVersion, pendingCount: pendingCount(engine), lastBackupAt: lastBackup.t },
            events: rows.map((r) => ({ id: r.id, seq: r.seq, type: r.type, occurredAt: r.occurred_at, actorId: r.actor_id, payload: JSON.parse(r.payload) })),
          }),
        });
      } catch (e) {
        if (rows.length) engine.db.prepare(`UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE seq BETWEEN ? AND ? AND status = 'pending'`).run(String((e as Error).message), rows[0].seq, rows[rows.length - 1].seq);
        throw e;
      }
      const now = engine.now().toISOString();
      engine.db.transaction(() => {
        const ok = engine.db.prepare(`UPDATE outbox SET status = 'synced', synced_at = ?, last_error = NULL WHERE id = ? AND status = 'pending'`);
        const bad = engine.db.prepare(`UPDATE outbox SET status = 'rejected', last_error = ? WHERE id = ? AND status = 'pending'`);
        for (const id of result.accepted) pushed += ok.run(now, id).changes;
        for (const r of result.rejected) rejected += bad.run(r.reason, r.id).changes;
      })();
      const handled = result.accepted.length + result.rejected.length;
      if (rows.length === 0 || handled === 0) break; // nothing left, or the server made no progress
    }

    const pull: SyncPullResult = await call(engine, '/v1/sync/pull', { method: 'GET' });
    engine.db.transaction(() => {
      engine.setMeta('tenant_status', pull.tenant.status);
      engine.setMeta('subscription', JSON.stringify(pull.subscription));
      // Only the server can replace the standing; an older server that omits it leaves the last one in place.
      if (pull.standing !== undefined) engine.setMeta('service_standing', JSON.stringify(pull.standing));
      const ins = engine.db.prepare('INSERT OR IGNORE INTO support_access_log (id, admin_name, action, grant_id, occurred_at) VALUES (?, ?, ?, ?, ?)');
      for (const l of pull.supportAccessLog) ins.run(l.id, l.adminName, l.action, l.grantId, l.occurredAt);
      engine.setMeta('last_sync_at', engine.now().toISOString());
    })();
    state.online = true;
    // The owner's opt-in closing summary rides on a successful sync; a failure only waits for the next one.
    await maybeSendDailySummary(engine).catch(() => {});
    state.lastError = null;
    return { ok: true, pushed, rejected, pending: pendingCount(engine) };
  } catch (e) {
    const message = (e as Error).name === 'TimeoutError' || (e as Error).name === 'TypeError' ? 'No connection to the Mansora server' : (e as Error).message;
    state.online = false;
    state.lastError = message;
    return { ok: false, pushed, rejected, pending: pendingCount(engine), error: message };
  } finally {
    state.running = false;
  }
}

/** Upload an (already passphrase-encrypted) backup file to Mansora cloud storage. */
export async function uploadBackup(engine: Engine, backupId: string, content: Buffer, sha256: string): Promise<void> {
  await call(engine, `/v1/backups/${backupId}`, { method: 'PUT', body: content as any, headers: { 'content-type': 'application/octet-stream', 'x-sha256': sha256 } });
  engine.db.prepare('UPDATE backup_records SET uploaded_at = ? WHERE id = ?').run(engine.now().toISOString(), backupId);
}
