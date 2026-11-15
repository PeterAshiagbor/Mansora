import { createHash } from 'node:crypto';
import * as zxingModule from '@zxing/library';
import {
  FISCAL_ALERT_HOURS_DEFAULT, FISCAL_MODES, FISCAL_PAYLOAD_FORMAT, retryDelayMs, stateFromEvent, summariseFiscal,
  type FiscalKind, type FiscalMode, type FiscalOutcome, type FiscalProvider, type FiscalRequest, type FiscalState,
} from '@mansora/domain';
import { Ctx, type Engine } from './engine';
import { taxConfig } from './tax';
import { nextNumber } from './stock';

/* ------------------------------------------------------------------ configuration */

export function fiscalMode(engine: Engine): FiscalMode {
  const m = engine.meta('fiscal_mode');
  return (FISCAL_MODES as readonly string[]).includes(m ?? '') ? (m as FiscalMode) : 'off';
}

/**
 * Fiscal reporting applies once the business is VAT-registered for the sale date (the platform's own turnover rules
 * decide that - see tax.ts) AND an administrator has switched fiscal reporting on. Default is off, so no existing
 * client's receipts or sync change until Mansora enables it.
 */
export function fiscalRequired(ctx: Ctx, date = ctx.now().slice(0, 10)): boolean {
  if (fiscalMode(ctx.engine) === 'off') return false;
  const c = taxConfig(ctx, date);
  return c.registered && !!c.registrationDate && c.registrationDate <= date;
}

/* ------------------------------------------------------------------ payloads (PROVISIONAL format) */

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Provisional, Mansora-defined payload. NOT GRA's format: the approved specification replaces this builder.
 * Key order is fixed so the hash is stable. Amounts are integer pesewas.
 */
function lineOf(name: string, sku: string | null, quantity: number, unitPrice: number | null, lineTotal: number, tax: any) {
  return { name, sku, quantity, unitPrice, lineTotal, taxClass: tax?.classification ?? null, base: tax?.base ?? lineTotal, vat: tax?.vat ?? 0, nhil: tax?.nhil ?? 0, getfund: tax?.getfund ?? 0 };
}

function buildInvoice(ctx: Ctx, saleId: string, fiscalNumber: string) {
  const s = ctx.get('SELECT * FROM sales WHERE id = ?', saleId)!;
  const snap = s.tax_snapshot ? JSON.parse(s.tax_snapshot) : {};
  const items = ctx.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid', saleId);
  const payments = ctx.all('SELECT method, amount FROM payments WHERE sale_id = ? ORDER BY rowid', saleId);
  return JSON.stringify({
    format: FISCAL_PAYLOAD_FORMAT, kind: 'invoice', fiscalNumber, receiptNo: s.receipt_no, issuedAt: s.created_at, currency: 'GHS',
    taxpayer: { name: snap.business?.name ?? '', tin: snap.tin ?? '', vatNumber: snap.vatNumber ?? '' },
    customer: snap.customer ? { name: snap.customer.name, phone: snap.customer.phone } : null,
    lines: items.map((i) => lineOf(i.product_name, i.sku, i.quantity, i.unit_price, i.line_total, i.tax_snapshot ? JSON.parse(i.tax_snapshot) : null)),
    totals: { subtotal: s.subtotal, discount: s.discount_total, base: snap.base ?? s.total, vat: snap.vat ?? 0, nhil: snap.nhil ?? 0, getfund: snap.getfund ?? 0, total: s.total },
    payments,
  });
}

function buildCreditNote(ctx: Ctx, refundId: string, fiscalNumber: string, original: { fiscalNumber: string; receiptNo: string }) {
  const r = ctx.get('SELECT * FROM refunds WHERE id = ?', refundId)!;
  const items = ctx.all('SELECT ri.*, si.product_name, si.sku FROM refund_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE ri.refund_id = ? ORDER BY ri.rowid', refundId);
  const lines = items.map((i) => lineOf(i.product_name, i.sku, i.quantity, null, i.amount, i.tax_snapshot ? JSON.parse(i.tax_snapshot) : null));
  const sum = (k: 'base' | 'vat' | 'nhil' | 'getfund') => lines.reduce((a, l) => a + l[k], 0);
  return JSON.stringify({
    format: FISCAL_PAYLOAD_FORMAT, kind: 'credit_note', fiscalNumber, refundNo: r.refund_no, issuedAt: r.created_at, currency: 'GHS',
    original: { fiscalNumber: original.fiscalNumber, receiptNo: original.receiptNo }, reason: r.reason,
    lines, totals: { base: sum('base'), vat: sum('vat'), nhil: sum('nhil'), getfund: sum('getfund'), total: r.amount },
  });
}

/* ------------------------------------------------------------------ writing (inside the caller's transaction) */

interface EventInput {
  type: string; attempt: number; provider?: string | null; nextAttemptAt?: string | null;
  outcome?: Extract<FiscalOutcome, { status: 'acknowledged' }>; errorCode?: string | null; errorDetail?: string | null;
}
function addEvent(ctx: Ctx, documentId: string, e: EventInput) {
  ctx.insert('fiscal_events', {
    id: ctx.id(), document_id: documentId, type: e.type, attempt_no: e.attempt, occurred_at: ctx.now(), next_attempt_at: e.nextAttemptAt ?? null,
    provider: e.provider ?? null, gra_reference: e.outcome?.reference ?? null, gra_signature: e.outcome?.signature ?? null, qr_data: e.outcome?.qrData ?? null,
    gra_timestamp: e.outcome?.graTimestamp ?? null, error_code: e.errorCode ?? null, error_detail: e.errorDetail ? e.errorDetail.slice(0, 1500) : null,
  });
}

function addDocument(ctx: Ctx, kind: FiscalKind, saleId: string, refundId: string | null, payload: string, fiscalNumber: string) {
  const id = ctx.id();
  ctx.insert('fiscal_documents', { id, kind, sale_id: saleId, refund_id: refundId, fiscal_number: fiscalNumber, payload_hash: sha256(payload), payload, created_at: ctx.now() });
  addEvent(ctx, id, { type: 'queued', attempt: 0 });
  return id;
}

/** Called by sale.complete inside its transaction: the sale and its fiscal document commit together or not at all. */
export function queueFiscalInvoice(ctx: Ctx, saleId: string): string | null {
  if (!fiscalRequired(ctx)) return null;
  const fiscalNumber = nextNumber(ctx, 'FD');
  return addDocument(ctx, 'invoice', saleId, null, buildInvoice(ctx, saleId, fiscalNumber), fiscalNumber);
}

/** Called by refund.create. Only a sale that was itself reported can have a credit note. */
export function queueFiscalCreditNote(ctx: Ctx, refundId: string, saleId: string): string | null {
  const invoice = ctx.get('SELECT d.fiscal_number, s.receipt_no FROM fiscal_documents d JOIN sales s ON s.id = d.sale_id WHERE d.sale_id = ? AND d.kind = ?', saleId, 'invoice');
  if (!invoice) return null;
  const fiscalNumber = nextNumber(ctx, 'FD');
  return addDocument(ctx, 'credit_note', saleId, refundId, buildCreditNote(ctx, refundId, fiscalNumber, { fiscalNumber: invoice.fiscal_number, receiptNo: invoice.receipt_no }), fiscalNumber);
}

/* ------------------------------------------------------------------ reading */

export interface FiscalDoc {
  id: string; kind: FiscalKind; sale_id: string; refund_id: string | null; fiscal_number: string; payload: string; payload_hash: string; created_at: string;
  state: FiscalState; attempts: number; next_attempt_at: string | null; gra_reference: string | null; gra_signature: string | null; qr_data: string | null;
  gra_timestamp: string | null; provider: string | null; error_code: string | null; error_detail: string | null; last_at: string;
}

/** Every document with its derived state, in issue order. `waiting` = a credit note whose invoice is not yet acknowledged. */
export function fiscalDocuments(ctx: Ctx, includePayload = false): FiscalDoc[] {
  const rows = ctx.all(
    `SELECT d.id, d.kind, d.sale_id, d.refund_id, d.fiscal_number, d.payload_hash, d.created_at ${includePayload ? ', d.payload' : ", '' AS payload"},
            e.type AS last_type, e.next_attempt_at, e.gra_reference, e.gra_signature, e.qr_data, e.gra_timestamp, e.provider, e.error_code, e.error_detail, e.occurred_at AS last_at,
            (SELECT COUNT(*) FROM fiscal_events x WHERE x.document_id = d.id AND x.type = 'submitted') AS attempts,
            (SELECT x.gra_reference FROM fiscal_events x WHERE x.document_id = d.id AND x.type = 'acknowledged' ORDER BY x.rowid DESC LIMIT 1) AS ack_reference
       FROM fiscal_documents d JOIN fiscal_events e ON e.rowid = (SELECT MAX(rowid) FROM fiscal_events WHERE document_id = d.id)
      ORDER BY d.rowid`,
  );
  const docs: FiscalDoc[] = rows.map((r) => ({ ...r, state: stateFromEvent(r.last_type) }));
  const invoiceState = new Map(docs.filter((d) => d.kind === 'invoice').map((d) => [d.sale_id, d.state]));
  for (const d of docs) if (d.kind === 'credit_note' && d.state === 'queued' && invoiceState.get(d.sale_id) !== 'acknowledged') d.state = 'waiting';
  return docs;
}

export function fiscalSummary(ctx: Ctx) {
  const hours = Number(ctx.setting('fiscal_alert_hours') ?? FISCAL_ALERT_HOURS_DEFAULT);
  return summariseFiscal(fiscalDocuments(ctx).map((d) => ({ state: d.state, created_at: d.created_at })), ctx.now(), hours);
}

/** What the receipt of a sale should say about its fiscal status; `null` when the sale was never subject to fiscal reporting. */
export function receiptFiscal(ctx: Ctx, saleId: string) {
  const d = fiscalDocuments(ctx).find((x) => x.sale_id === saleId && x.kind === 'invoice');
  if (!d) return null;
  const ack = d.state === 'acknowledged';
  return {
    state: d.state, fiscalNumber: d.fiscal_number, reference: ack ? d.gra_reference : null, signature: ack ? d.gra_signature : null, qrData: ack ? d.qr_data : null,
    graTimestamp: ack ? d.gra_timestamp : null, sandbox: d.provider === 'sandbox',
  };
}

/* ------------------------------------------------------------------ QR */

// @zxing/library is CommonJS/UMD: plain Node ESM exposes it only as `default`, bundlers and Vitest expose named exports.
const zxing: typeof import('@zxing/library') = (zxingModule as any).QRCodeWriter ? (zxingModule as any) : (zxingModule as any).default;

/** QR code as a self-contained SVG (no scripts, no external resources). `null` when there is nothing to encode. */
export function qrSvg(text: string | null | undefined, mm = 28): string | null {
  if (!text) return null;
  const { BarcodeFormat, EncodeHintType, QRCodeDecoderErrorCorrectionLevel, QRCodeWriter } = zxing;
  const hints = new Map<any, unknown>([[EncodeHintType.ERROR_CORRECTION, QRCodeDecoderErrorCorrectionLevel.M], [EncodeHintType.MARGIN, 2]]);
  const m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints as any);
  const w = m.getWidth(), h = m.getHeight();
  let path = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges" role="img" aria-label="Fiscal QR code"><rect width="${w}" height="${h}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/* ------------------------------------------------------------------ providers */

/**
 * Talks to a Mansora SANDBOX endpoint (the fake GRA used in tests, or a stand-in). The protocol is Mansora's own,
 * documented in docs/fiscal/gra-fiscalisation-design.md; it is NOT GRA's. Results it produces are marked `sandbox`
 * and printed as test receipts.
 */
export class SandboxFiscalProvider implements FiscalProvider {
  readonly name = 'sandbox';
  constructor(private baseUrl: string | undefined, private doFetch: typeof fetch, private timeoutMs = 20_000) {}
  readiness() {
    return this.baseUrl ? { ok: true as const } : { ok: false as const, reason: 'No sandbox address is set. Set one in Fiscal settings.' };
  }
  private async call(path: string, init: RequestInit) {
    return this.doFetch(`${this.baseUrl!.replace(/\/$/, '')}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
  }
  private async read(res: Response): Promise<FiscalOutcome> {
    const body: any = await res.json().catch(() => ({}));
    if (res.ok && typeof body.reference === 'string') return { status: 'acknowledged', reference: body.reference, signature: body.signature ?? null, qrData: body.qr ?? null, graTimestamp: body.timestamp ?? null };
    // 4xx (except timeouts / rate limits) is the authority saying "no": retrying the same document cannot help.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return { status: 'rejected', code: String(body.code ?? res.status), detail: String(body.message ?? `Rejected (${res.status})`) };
    return { status: 'transient', detail: `Server responded ${res.status}` };
  }
  async submit(req: FiscalRequest): Promise<FiscalOutcome> {
    try {
      const res = await this.call('/invoices', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': req.idempotencyKey }, body: JSON.stringify({ kind: req.kind, fiscalNumber: req.fiscalNumber, originalReference: req.originalReference, payload: JSON.parse(req.payload) }) });
      return await this.read(res);
    } catch (e) {
      return { status: 'transient', detail: String((e as Error).message ?? e) };
    }
  }
  async query(key: string): Promise<FiscalOutcome | null> {
    const res = await this.call(`/invoices/${encodeURIComponent(key)}`, { method: 'GET' });
    if (res.status === 404) return null;
    return this.read(res);
  }
}

/** The real GRA adapter does not exist until Mansora holds the approved specification and credentials. It never sends anything. */
export class BlockedGraProvider implements FiscalProvider {
  readonly name = 'gra';
  readiness() {
    return { ok: false as const, reason: 'Live GRA reporting is not available yet: the approved GRA specification, credentials and sign-off are outstanding.' };
  }
  async submit(): Promise<FiscalOutcome> {
    throw new Error('GRA provider is blocked');
  }
}

export function fiscalProvider(engine: Engine): FiscalProvider | null {
  const mode = fiscalMode(engine);
  if (mode === 'off') return null;
  if (mode === 'sandbox') return new SandboxFiscalProvider(engine.meta('fiscal_sandbox_url'), engine.fetch);
  return new BlockedGraProvider();
}

/* ------------------------------------------------------------------ worker */

const running = new WeakSet<Engine>();
export interface FiscalRunResult { ran: boolean; reason?: string; acknowledged: number; rejected: number; retrying: number; remaining: number }

/**
 * Send queued documents in issue order. Safe to call at any time and from several places: only one pass runs at once.
 * - Offline / server trouble: the document is scheduled for retry with backoff and the pass stops, so order is kept.
 * - Rejected by the authority: recorded once, never retried automatically, and it does not block later documents.
 * - A document found mid-submission (crash or lost reply) is first looked up by its idempotency key, so a resend can never duplicate it.
 */
export async function runFiscalWorker(engine: Engine, random: () => number = Math.random): Promise<FiscalRunResult> {
  const out: FiscalRunResult = { ran: false, acknowledged: 0, rejected: 0, retrying: 0, remaining: 0 };
  const provider = fiscalProvider(engine);
  if (!provider) return { ...out, reason: 'Fiscal reporting is off' };
  const ready = provider.readiness();
  if (!ready.ok) return { ...out, reason: ready.reason };
  if (running.has(engine)) return { ...out, reason: 'Already running' };
  running.add(engine);
  out.ran = true;
  const system = () => new Ctx(engine, 'fiscal.worker', null);
  // One Ctx per transaction, so each write flushes its own outbox event.
  const write = (fn: (ctx: Ctx) => void) => { const c = system(); c.tx(() => fn(c)); };
  async function sendQueued(): Promise<'done' | 'stop'> {
    for (const doc of fiscalDocuments(system(), true)) {
      if (['acknowledged', 'rejected', 'resolved', 'waiting'].includes(doc.state)) continue;
      const nowIso = engine.now().toISOString();
      if (doc.state === 'retrying' && doc.next_attempt_at && doc.next_attempt_at > nowIso) return 'stop'; // head of line is not due: keep order
      let attempt = doc.attempts;
      const finish = (o: FiscalOutcome) => {
        if (o.status === 'acknowledged') { write((c) => addEvent(c, doc.id, { type: 'acknowledged', attempt, provider: provider!.name, outcome: o })); out.acknowledged++; return 'ok' as const; }
        if (o.status === 'rejected') {
          write((c) => { addEvent(c, doc.id, { type: 'rejected', attempt, provider: provider!.name, errorCode: o.code, errorDetail: o.detail }); c.audit('fiscal_document', doc.id, { fiscalNumber: doc.fiscal_number, code: o.code }, 'fiscal.rejected'); });
          out.rejected++; return 'ok' as const;
        }
        const next = new Date(engine.now().getTime() + retryDelayMs(Math.max(1, attempt), random)).toISOString();
        write((c) => addEvent(c, doc.id, { type: 'retry_scheduled', attempt, provider: provider!.name, nextAttemptAt: next, errorCode: 'TRANSIENT', errorDetail: o.detail }));
        out.retrying++; return 'stop' as const;
      };
      // Integrity: what we send must be exactly what was frozen when the sale was made.
      if (sha256(doc.payload) !== doc.payload_hash) { attempt++; finish({ status: 'rejected', code: 'LOCAL_INTEGRITY', detail: 'The stored document does not match its hash; it was not sent.' }); continue; }
      if (doc.state === 'submitting' && provider!.query) {
        let known: FiscalOutcome | null;
        try { known = await provider!.query(doc.id); } catch (e) { known = { status: 'transient', detail: String((e as Error).message ?? e) }; }
        if (known) { if (finish(known) === 'stop') return 'stop'; continue; }
      }
      let originalReference: string | null = null;
      if (doc.kind === 'credit_note') originalReference = fiscalDocuments(system()).find((d) => d.kind === 'invoice' && d.sale_id === doc.sale_id)?.gra_reference ?? null;
      attempt++;
      write((c) => addEvent(c, doc.id, { type: 'submitted', attempt, provider: provider!.name }));
      let outcome: FiscalOutcome;
      try { outcome = await provider!.submit({ idempotencyKey: doc.id, kind: doc.kind, fiscalNumber: doc.fiscal_number, payload: doc.payload, originalReference }); }
      catch (e) { outcome = { status: 'transient', detail: String((e as Error).message ?? e) }; }
      if (finish(outcome) === 'stop') return 'stop';
    }
    return 'done';
  }
  try {
    // A credit note waits for its invoice, which is always issued first, so a second look at the queue is enough.
    for (let pass = 0; pass < 2; pass++) {
      const acknowledgedBefore = out.acknowledged;
      if ((await sendQueued()) === 'stop') break;
      if (out.acknowledged === acknowledgedBefore) break;
    }
  } finally {
    running.delete(engine);
    out.remaining = fiscalDocuments(system()).filter((d) => !['acknowledged', 'rejected', 'resolved'].includes(d.state)).length;
  }
  return out;
}
