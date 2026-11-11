import { isCalendarDate } from './dates';

/**
 * Non-payment policy (decision D-28, approved by the owner on 2026-11-11).
 *
 * The till never stops. Selling, refunds, shifts, stock, customers, sync, backups, the full
 * business data export and paying Mansora always work, whatever is owed. When a Mansora invoice
 * stays unpaid the client is told, then warned, and only after the grace period are management
 * reports and report exports paused until it is paid.
 *
 * Hardening:
 *  - The server decides the stage from the oldest overdue, undisputed invoice. The laptop cannot
 *    write its own standing; only a sync with the server replaces it.
 *  - The laptop also stores the date restrictions begin, so going offline does not postpone them.
 *  - A disputed invoice never escalates. A payment arrangement (hold) is time-limited and audited.
 *  - Thresholds are bounded so a mistaken setting cannot restrict a client early or without warning.
 */
export const STANDING_STAGES = ['good', 'notice', 'warning', 'restricted'] as const;
export type StandingStage = (typeof STANDING_STAGES)[number];

export interface StandingPolicy {
  /** Days after the due date before the client sees a notice. */
  noticeAfterDays: number;
  /** Days after the due date before the notice becomes a warning naming the restriction date. */
  warnAfterDays: number;
  /** Days after the due date before management reports and report exports pause. */
  restrictAfterDays: number;
}
export const DEFAULT_STANDING_POLICY: StandingPolicy = { noticeAfterDays: 1, warnAfterDays: 15, restrictAfterDays: 30 };
/** Restrictions can never start sooner than this many days after the due date. */
export const MIN_RESTRICT_AFTER_DAYS = 21;
/** A warning always runs for at least this many days before restrictions start. */
export const MIN_WARNING_DAYS = 7;
/** Longest payment arrangement an administrator can grant at once. */
export const MAX_HOLD_DAYS = 60;

/** Commands paused while a client is restricted. Everything else keeps working. */
export const RESTRICTED_COMMANDS = ['report.sales', 'report.profit', 'report.stock', 'report.wallet', 'export.table'] as const;

export interface ServiceStanding {
  stage: StandingStage;
  /** The oldest overdue, undisputed Mansora invoice, if any. */
  invoiceNumber: string | null;
  dueDate: string | null;
  daysOverdue: number;
  warnFrom: string | null;
  restrictFrom: string | null;
  /** Last day of an agreed payment arrangement; restrictions do not apply up to and including it. */
  holdUntil: string | null;
  asOf: string;
}

export function policyProblem(p: StandingPolicy): string | null {
  const whole = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 365;
  if (!whole(p.noticeAfterDays) || !whole(p.warnAfterDays) || !whole(p.restrictAfterDays)) return 'Use whole numbers of days between 0 and 365';
  if (p.restrictAfterDays < MIN_RESTRICT_AFTER_DAYS) return `Restrictions cannot start sooner than ${MIN_RESTRICT_AFTER_DAYS} days after the due date`;
  if (p.noticeAfterDays > p.warnAfterDays) return 'The notice must come before the warning';
  if (p.restrictAfterDays - p.warnAfterDays < MIN_WARNING_DAYS) return `Warn the client at least ${MIN_WARNING_DAYS} days before restrictions start`;
  return null;
}

export function addDaysIso(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The stage on `today`, given the oldest overdue invoice's due date and any payment arrangement. */
export function computeStanding(policy: StandingPolicy, today: string, oldest: { number: string; dueDate: string } | null, holdUntil: string | null): ServiceStanding {
  const hold = holdUntil && holdUntil >= today ? holdUntil : null;
  if (!oldest || oldest.dueDate >= today) return { stage: 'good', invoiceNumber: null, dueDate: null, daysOverdue: 0, warnFrom: null, restrictFrom: null, holdUntil: hold, asOf: today };
  const daysOverdue = daysBetween(oldest.dueDate, today);
  const warnFrom = addDaysIso(oldest.dueDate, policy.warnAfterDays);
  // An arrangement moves the restriction date to the day after it ends, never earlier than the policy date.
  const policyRestrict = addDaysIso(oldest.dueDate, policy.restrictAfterDays);
  const restrictFrom = hold && addDaysIso(hold, 1) > policyRestrict ? addDaysIso(hold, 1) : policyRestrict;
  let stage: StandingStage = 'good';
  if (daysOverdue >= policy.noticeAfterDays) stage = 'notice';
  if (today >= warnFrom) stage = 'warning';
  if (today >= restrictFrom) stage = 'restricted';
  return { stage, invoiceNumber: oldest.number, dueDate: oldest.dueDate, daysOverdue, warnFrom, restrictFrom, holdUntil: hold, asOf: today };
}

/**
 * What applies on this laptop today, from the last standing the server sent. Dates keep moving
 * while offline: a warning becomes a restriction on its date even without a connection, and an
 * expired arrangement stops protecting the client. Unreadable data counts as no information.
 */
export function effectiveStanding(stored: unknown, today: string): ServiceStanding | null {
  if (!stored || typeof stored !== 'object') return null;
  const s = stored as ServiceStanding;
  if (!STANDING_STAGES.includes(s.stage)) return null;
  const date = (v: unknown) => (typeof v === 'string' && isCalendarDate(v) ? v : null);
  const restrictFrom = date(s.restrictFrom), warnFrom = date(s.warnFrom), dueDate = date(s.dueDate);
  const holdUntil = date(s.holdUntil) && date(s.holdUntil)! >= today ? date(s.holdUntil) : null;
  let stage: StandingStage = s.stage;
  if (stage !== 'good') {
    if (warnFrom && today >= warnFrom && stage === 'notice') stage = 'warning';
    if (restrictFrom && today >= restrictFrom) stage = 'restricted';
  }
  return {
    stage, invoiceNumber: typeof s.invoiceNumber === 'string' ? s.invoiceNumber : null, dueDate,
    daysOverdue: dueDate && today > dueDate ? daysBetween(dueDate, today) : 0, warnFrom, restrictFrom, holdUntil, asOf: date(s.asOf) ?? today,
  };
}

export function restrictionMessage(s: ServiceStanding): string {
  const invoice = s.invoiceNumber ? `Mansora invoice ${s.invoiceNumber}` : 'your Mansora invoice';
  return `Reports and report exports are paused because ${invoice} is overdue. Selling, stock, customers and backups keep working. Pay from Billing & payments, or contact Mansora to agree a payment arrangement.`;
}
