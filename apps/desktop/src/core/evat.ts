import { createHash } from 'node:crypto';
import { fail } from '@mansora/domain';
import { Ctx, type Engine } from './engine';

/**
 * Audit F01: GRA E-VAT submission pipeline.
 *
 * Every invoice and credit note issued while the business is VAT registered is queued here in the same transaction
 * as the sale or refund, so none can be skipped. A provider submits the queued documents in order, retries after
 * connection failures and records the fiscal identifiers it returns. Receipts print those identifiers once accepted.
 *
 * Status of the live connection: GRA issues its E-VAT API specification, test credentials and go-live sign-off to
 * each taxpayer or integrator through its onboarding process. Until Mansora has completed that process there is no
 * live provider: `live` mode is refused, and the `test` provider issues clearly marked TEST identifiers that are not
 * valid for tax. Plugging in the GRA connector means implementing EvatProvider against the issued specification.
 */
export type EvatMode = 'off' | 'test' | 'live';
export interface EvatDocument {
  type: 'invoice' | 'credit_note';
  number: string;
  issuedAt: string;
  seller: { name: string; tin: string; vatNumber: string; address: string; phone: string };
  buyer: { name: string | null; tin: string | null } | null;
  originalNumber: string | null;
  lines: { description: string; quantity: number; unitPrice: number; classification: string; base: number; vat: number; nhil: number; getfund: number; total: number }[];
  totals: { base: number; vat: number; nhil: number; getfund: number; total: number };
  currency: 'GHS';
}
export type EvatResult = { status: 'accepted'; fiscalId: string; qr: string; signature: string } | { status: 'rejected'; reason: string };
export interface EvatProvider {
  id: string;
  /** Resolves with the authority's decision; throws when the authority could not be reached (the document stays queued). */
  submit(doc: EvatDocument, sha256: string): Promise<EvatResult>;
}

/** Simulator for rehearsal and training. Its identifiers start with TEST- and are printed as not valid for tax. */
export const testProvider: EvatProvider = {
  id: 'test',
  async submit(doc, sha) {
    if (!doc.seller.tin) return { status: 'rejected', reason: 'Seller TIN missing' };
    const fiscalId = `TEST-${sha.slice(0, 12).toUpperCase()}`;
    return { status: 'accepted', fiscalId, qr: `TEST|${fiscalId}|${doc.number}|${doc.seller.tin}|${(doc.totals.total / 100).toFixed(2)}`, signature: createHash('sha256').update(`test-signature:${sha}`).digest('hex') };
  },
};

const providers = new WeakMap<Engine, EvatProvider>();
/** Tests and a future GRA connector register a provider here; `test` mode falls back to the simulator. */
export function setEvatProvider(engine: Engine, provider: EvatProvider | null): void {
  if (provider) providers.set(engine, provider); else providers.delete(engine);
}
export function evatMode(engine: Engine): EvatMode {
  const m = engine.meta('evat_mode');
  return m === 'test' || m === 'live' ? m : 'off';
}
function providerFor(engine: Engine): EvatProvider | null {
  const mode = evatMode(engine);
  if (mode === 'off') return null;
  const p = providers.get(engine);
  if (mode === 'live') return p && p.id !== 'test' ? p : null;
  return p ?? testProvider;
}

/** Canonical document built only from the immutable sale or refund snapshots. */
export function buildDocument(ctx: Ctx, type: EvatDocument['type'], id: string): EvatDocument | null {
  if (type === 'invoice') {
    const s = ctx.get('SELECT * FROM sales WHERE id = ?', id);
    const snap = s?.tax_snapshot ? JSON.parse(s.tax_snapshot) : null;
    if (!snap?.registered) return null;
    const items = ctx.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid', id);
    return document(type, s.receipt_no, s.created_at, snap, null, items.map((i: any) => ({ description: i.product_name, quantity: i.quantity, unitPrice: i.unit_price, snap: JSON.parse(i.tax_snapshot ?? 'null'), total: i.line_total })));
  }
  const r = ctx.get('SELECT r.*, s.receipt_no, s.tax_snapshot FROM refunds r JOIN sales s ON s.id = r.sale_id WHERE r.id = ?', id);
  const snap = r?.tax_snapshot ? JSON.parse(r.tax_snapshot) : null;
  if (!snap?.registered) return null;
  const items = ctx.all('SELECT ri.*, i.product_name, i.unit_price FROM refund_items ri JOIN sale_items i ON i.id = ri.sale_item_id WHERE ri.refund_id = ? ORDER BY ri.rowid', id);
  return document(type, r.refund_no, r.created_at, snap, r.receipt_no, items.map((i: any) => ({ description: i.product_name, quantity: i.quantity, unitPrice: i.unit_price, snap: JSON.parse(i.tax_snapshot ?? 'null'), total: i.amount })));
}
function document(type: EvatDocument['type'], number: string, issuedAt: string, snap: any, original: string | null, rows: { description: string; quantity: number; unitPrice: number; snap: any; total: number }[]): EvatDocument {
  const lines = rows.map((r) => ({ description: r.description, quantity: r.quantity, unitPrice: r.unitPrice, classification: r.snap?.classification ?? 'standard', base: r.snap?.base ?? r.total, vat: r.snap?.vat ?? 0, nhil: r.snap?.nhil ?? 0, getfund: r.snap?.getfund ?? 0, total: r.total }));
  const sumOf = (k: 'base' | 'vat' | 'nhil' | 'getfund' | 'total') => lines.reduce((t, l) => t + l[k], 0);
  return {
    type, number, issuedAt, originalNumber: original, currency: 'GHS',
    seller: { name: snap.business?.name ?? '', tin: snap.tin ?? '', vatNumber: snap.vatNumber ?? '', address: snap.business?.address ?? '', phone: snap.business?.phone ?? '' },
    buyer: snap.customer ? { name: snap.customer.name ?? null, tin: snap.customer.tin ?? null } : null,
    lines, totals: { base: sumOf('base'), vat: sumOf('vat'), nhil: sumOf('nhil'), getfund: sumOf('getfund'), total: sumOf('total') },
  };
}

/** Queue a document inside the caller's transaction. No-op when E-VAT is off or the sale was not VAT registered. */
export function queueEvat(ctx: Ctx, type: EvatDocument['type'], id: string): void {
  const mode = evatMode(ctx.engine);
  if (mode === 'off') return;
  const doc = buildDocument(ctx, type, id);
  if (!doc) return;
  const payload = JSON.stringify(doc);
  const now = ctx.now();
  ctx.insert('evat_submissions', {
    id: ctx.id(), document_type: type, document_id: id, document_no: doc.number, payload, payload_sha256: createHash('sha256').update(payload).digest('hex'),
    status: 'pending', provider: mode, attempts: 0, fiscal_id: null, qr: null, signature: null, last_error: null, created_at: now, submitted_at: null, updated_at: now,
  });
}

/** Submit queued documents in issue order. Stops at the first connection failure so order is preserved. */
export async function runEvatQueue(engine: Engine): Promise<{ accepted: number; rejected: number; pending: number; error: string | null }> {
  const provider = providerFor(engine);
  const out = { accepted: 0, rejected: 0, pending: 0, error: null as string | null };
  const pending = () => (engine.db.prepare(`SELECT COUNT(*) AS n FROM evat_submissions WHERE status = 'pending'`).get() as { n: number }).n;
  if (!provider) return { ...out, pending: pending(), error: evatMode(engine) === 'live' ? 'No GRA E-VAT connector is installed' : null };
  const rows = engine.db.prepare(`SELECT * FROM evat_submissions WHERE status = 'pending' ORDER BY created_at, rowid LIMIT 200`).all() as any[];
  for (const row of rows) {
    const ctx = new Ctx(engine, 'evat.submit', null);
    let result: EvatResult;
    try {
      result = await provider.submit(JSON.parse(row.payload), row.payload_sha256);
    } catch (e) {
      ctx.tx(() => ctx.update('evat_submissions', row.id, { attempts: row.attempts + 1, last_error: String((e as Error).message).slice(0, 500), updated_at: ctx.now() }));
      out.error = String((e as Error).message);
      break;
    }
    ctx.tx(() => {
      if (result.status === 'accepted') {
        ctx.update('evat_submissions', row.id, { status: 'accepted', attempts: row.attempts + 1, fiscal_id: result.fiscalId, qr: result.qr, signature: result.signature, last_error: null, submitted_at: ctx.now(), updated_at: ctx.now() });
        out.accepted++;
      } else {
        ctx.update('evat_submissions', row.id, { status: 'rejected', attempts: row.attempts + 1, last_error: result.reason.slice(0, 500), submitted_at: ctx.now(), updated_at: ctx.now() });
        ctx.audit('evat_submission', row.id, { documentNo: row.document_no, reason: result.reason }, 'evat.rejected');
        out.rejected++;
      }
    });
  }
  return { ...out, pending: pending() };
}

/** GRA's guideline expects downtime longer than 24 hours to be notified; queued documents that old are flagged. */
export const EVAT_DOWNTIME_MS = 24 * 3_600_000;
export function evatStatus(ctx: Ctx) {
  const counts = Object.fromEntries((ctx.all(`SELECT status, COUNT(*) AS n FROM evat_submissions GROUP BY status`) as any[]).map((r) => [r.status, r.n]));
  const oldest = ctx.get<{ t: string | null }>(`SELECT MIN(created_at) AS t FROM evat_submissions WHERE status = 'pending'`)!.t;
  const overdue = !!oldest && Date.parse(ctx.now()) - Date.parse(oldest) > EVAT_DOWNTIME_MS;
  return {
    mode: evatMode(ctx.engine), liveConnector: !!providers.get(ctx.engine) && providers.get(ctx.engine)!.id !== 'test',
    pending: counts.pending ?? 0, accepted: counts.accepted ?? 0, rejected: counts.rejected ?? 0, oldestPendingAt: oldest, downtimeNoticeRequired: overdue,
    rejectedDocuments: ctx.all(`SELECT id, document_type, document_no, last_error, submitted_at FROM evat_submissions WHERE status = 'rejected' ORDER BY created_at DESC LIMIT 50`),
  };
}

export function requireEvatMode(mode: string): EvatMode {
  if (mode === 'live') fail('GRA_ONBOARDING_REQUIRED', 'Live E-VAT needs the GRA-issued API specification, taxpayer credentials and GRA sign-off. Complete GRA onboarding first; until then use Off or Test.');
  if (mode !== 'off' && mode !== 'test') fail('INVALID_INPUT', 'Choose Off or Test');
  return mode;
}
