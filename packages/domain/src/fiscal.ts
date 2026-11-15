/**
 * Fiscal reporting (GRA) - provider-independent rules.
 *
 * Nothing here knows GRA's wire format: that arrives with the approved
 * integration specification and lives in a provider adapter. What lives here
 * is the part that does not depend on it: the document lifecycle, retry
 * timing and the "attention" rules. See docs/fiscal/gra-fiscalisation-design.md.
 *
 * A document's state is DERIVED from its latest event; events are insert-only.
 */
export const FISCAL_MODES = ['off', 'sandbox', 'live'] as const;
export type FiscalMode = (typeof FISCAL_MODES)[number];

export const FISCAL_KINDS = ['invoice', 'credit_note'] as const;
export type FiscalKind = (typeof FISCAL_KINDS)[number];

export const FISCAL_EVENT_TYPES = ['queued', 'submitted', 'acknowledged', 'rejected', 'retry_scheduled', 'manual_resolution'] as const;
export type FiscalEventType = (typeof FISCAL_EVENT_TYPES)[number];

/** `waiting` is a derived state: a credit note whose original invoice is not yet acknowledged. */
export type FiscalState = 'queued' | 'submitting' | 'acknowledged' | 'retrying' | 'rejected' | 'resolved' | 'waiting';

export const FISCAL_BACKOFF_BASE_MS = 30_000;
export const FISCAL_BACKOFF_CAP_MS = 15 * 60_000;
/** Unacknowledged for longer than this and the owner is told. Replace with GRA's maximum once known (design F-1). */
export const FISCAL_ALERT_HOURS_DEFAULT = 24;

export function stateFromEvent(type: FiscalEventType | null): Exclude<FiscalState, 'waiting'> {
  switch (type) {
    case 'acknowledged': return 'acknowledged';
    case 'submitted': return 'submitting';
    case 'retry_scheduled': return 'retrying';
    case 'rejected': return 'rejected';
    case 'manual_resolution': return 'resolved';
    default: return 'queued';
  }
}

/** Terminal for the worker: nothing more will be sent automatically. */
export const isSettled = (s: FiscalState) => s === 'acknowledged' || s === 'rejected' || s === 'resolved';

/**
 * Exponential backoff with jitter, capped. `attempt` is the number of attempts already made (1 after the first failure).
 * `random` is injected so tests are deterministic; it must return a value in [0, 1).
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(FISCAL_BACKOFF_CAP_MS, FISCAL_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  // 50%-100% of the exponential step, so a fleet of laptops does not retry in lock step.
  return Math.round(exp * (0.5 + random() / 2));
}

export interface FiscalSummaryRow { state: FiscalState; created_at: string }
export interface FiscalSummary {
  total: number;
  acknowledged: number;
  pending: number; // queued + submitting + retrying + waiting
  rejected: number; // needs attention
  resolved: number;
  oldestUnacknowledgedAt: string | null;
  overdue: number;
}

export function summariseFiscal(rows: FiscalSummaryRow[], nowIso: string, alertHours = FISCAL_ALERT_HOURS_DEFAULT): FiscalSummary {
  const limit = Date.parse(nowIso) - alertHours * 3_600_000;
  const open = rows.filter((r) => r.state !== 'acknowledged' && r.state !== 'resolved' && r.state !== 'rejected');
  const oldest = open.map((r) => r.created_at).sort()[0] ?? null;
  return {
    total: rows.length,
    acknowledged: rows.filter((r) => r.state === 'acknowledged').length,
    pending: open.length,
    rejected: rows.filter((r) => r.state === 'rejected').length,
    resolved: rows.filter((r) => r.state === 'resolved').length,
    oldestUnacknowledgedAt: oldest,
    overdue: open.filter((r) => Date.parse(r.created_at) < limit).length,
  };
}

/** What a provider tells the worker. Exactly one of three outcomes. */
export type FiscalOutcome =
  | { status: 'acknowledged'; reference: string; signature: string | null; qrData: string | null; graTimestamp: string | null }
  | { status: 'rejected'; code: string; detail: string }
  | { status: 'transient'; detail: string };

export interface FiscalRequest {
  idempotencyKey: string;
  kind: FiscalKind;
  fiscalNumber: string;
  payload: string;
  /** For a credit note: the acknowledged reference of the invoice it reverses. */
  originalReference: string | null;
}

export interface FiscalProvider {
  readonly name: string;
  /** `blocked` providers never send anything and say why (missing specification, credentials, sign-off). */
  readiness(): { ok: true } | { ok: false; reason: string };
  submit(req: FiscalRequest): Promise<FiscalOutcome>;
  /** Ask the authority whether it already holds this document. `null` = unknown / no such document. Optional [GRA-TBC]. */
  query?(idempotencyKey: string): Promise<FiscalOutcome | null>;
}

export const FISCAL_PAYLOAD_FORMAT = 'mansora-fiscal-draft/1';
