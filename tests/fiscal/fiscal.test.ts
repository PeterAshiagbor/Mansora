import { afterEach, describe, expect, it } from 'vitest';
import { fiscalDocuments, Ctx, qrSvg, runFiscalWorker } from '../../apps/desktop/src/core';
import { uuid } from '../helpers';
import { makeFiscalShop, type FiscalShop } from './helpers';

const shops: FiscalShop[] = [];
const mk = async (o: Parameters<typeof makeFiscalShop>[0] = {}) => { const s = await makeFiscalShop(o); shops.push(s); return s; };
afterEach(() => { for (const s of shops.splice(0)) s.engine.db.close(); });
const docs = (s: FiscalShop) => fiscalDocuments(new Ctx(s.engine, 't', null), true);
const work = (s: FiscalShop) => runFiscalWorker(s.engine, () => 0.5); // jitter fixed: first retry waits 22.5 s
const advance = (s: FiscalShop, ms: number) => { s.clock.now = new Date(s.clock.now.getTime() + ms); };

describe('when fiscal reporting applies', () => {
  it('does nothing by default, so existing clients are unaffected', async () => {
    const s = await mk({ mode: 'off' });
    const sale = await s.sell();
    expect(docs(s)).toHaveLength(0);
    expect(await s.receipt(sale.id)).not.toMatch(/fiscal/i);
    expect(await work(s)).toMatchObject({ ran: false, reason: 'Fiscal reporting is off' });
  });

  it('applies only to VAT-registered businesses (the platform turnover rules decide that)', async () => {
    const small = await mk({ registered: false });
    await small.sell();
    expect(docs(small)).toHaveLength(0);
    const registered = await mk();
    await registered.sell();
    expect(docs(registered)).toHaveLength(1);
    expect((await registered.run(registered.owner, 'fiscal.status')).applies).toBe(true);
    expect((await small.run(small.owner, 'fiscal.status')).applies).toBe(false);
  });

  it('refuses live mode until GRA integration exists, and only the owner side may configure', async () => {
    const s = await mk();
    await expect(s.run(s.owner, 'fiscal.configure', { mode: 'live', reason: 'Go' })).rejects.toMatchObject({ code: 'FISCAL_LIVE_UNAVAILABLE' });
    await expect(s.run(s.cashier, 'fiscal.configure', { mode: 'off', reason: 'x' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('submission and acknowledgement', () => {
  it('queues with the sale, submits, acknowledges, and the receipt carries the proof and a QR code', async () => {
    const s = await mk();
    const sale = await s.sell();
    expect(docs(s).map((d) => [d.kind, d.state, d.fiscal_number])).toEqual([['invoice', 'queued', 'FD-000001']]);
    expect(await s.receipt(sale.id)).toContain('FISCAL CONFIRMATION PENDING');

    expect(await work(s)).toMatchObject({ ran: true, acknowledged: 1, remaining: 0 });
    const [d] = docs(s);
    expect(d).toMatchObject({ state: 'acknowledged', gra_reference: 'SBX-000001', attempts: 1, provider: 'sandbox' });
    const html = await s.receipt(sale.id);
    expect(html).toContain('SBX-000001');
    expect(html).toContain('<svg');
    expect(html).toContain('TEST MODE - NOT A GRA FISCAL RECEIPT');
    expect(html).not.toContain('PENDING');
    // The frozen payload is what was sent, in pesewas.
    const sent = JSON.parse(d.payload);
    expect(sent).toMatchObject({ kind: 'invoice', receiptNo: sale.receiptNo, taxpayer: { tin: 'C0001234567' }, totals: { total: 1250 } });
    expect(sent.totals.base + sent.totals.vat + sent.totals.nhil + sent.totals.getfund).toBe(1250);
  });

  it('is idempotent: a second pass sends nothing', async () => {
    const s = await mk();
    await s.sell();
    await work(s);
    await work(s);
    expect(s.gra.state.posts).toHaveLength(1);
  });

  it('records history as append-only events and refuses edits and deletes', async () => {
    const s = await mk();
    await s.sell();
    await work(s);
    const types = s.engine.db.prepare('SELECT type FROM fiscal_events ORDER BY rowid').all().map((r: any) => r.type);
    expect(types).toEqual(['queued', 'submitted', 'acknowledged']);
    expect(() => s.engine.db.prepare("UPDATE fiscal_documents SET payload = 'x'").run()).toThrow(/immutable/);
    expect(() => s.engine.db.prepare('DELETE FROM fiscal_events').run()).toThrow(/cannot be deleted/);
  });
});

describe('offline, retries and recovery', () => {
  it('sells while the authority is unreachable, retries with backoff, then catches up in order', async () => {
    const s = await mk();
    s.gra.state.down = true;
    const a = await s.sell(), b = await s.sell();
    expect(await s.receipt(a.id)).toContain('PENDING');

    const r1 = await work(s);
    expect(r1).toMatchObject({ acknowledged: 0, retrying: 1, remaining: 2 });
    expect(docs(s)[0]).toMatchObject({ state: 'retrying', error_code: 'TRANSIENT' });
    expect(docs(s)[0].next_attempt_at).toBe('2026-11-15T12:00:22.500Z');
    expect(docs(s)[1].state).toBe('queued'); // the second sale did not jump the queue

    await work(s); // not due yet: no attempt at all
    expect(s.engine.db.prepare("SELECT COUNT(*) n FROM fiscal_events WHERE type = 'submitted'").get()).toEqual({ n: 1 });

    s.gra.state.down = false;
    advance(s, 23_000);
    expect(await work(s)).toMatchObject({ acknowledged: 2, remaining: 0 });
    expect(docs(s).map((d) => d.gra_reference)).toEqual(['SBX-000001', 'SBX-000002']);
    expect(s.gra.state.posts.map((p) => p.key)).toEqual([docs(s)[0].id, docs(s)[1].id]); // nothing reached the wire while down
    expect(await s.receipt(b.id)).toContain('SBX-000002');
  });

  it('backs off further on each failure, capped at 15 minutes', async () => {
    const s = await mk();
    s.gra.state.down = true;
    await s.sell();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      await work(s);
      const next = Date.parse(docs(s)[0].next_attempt_at!);
      waits.push(next - s.clock.now.getTime());
      s.clock.now = new Date(next);
    }
    expect(waits.slice(0, 4)).toEqual([22_500, 45_000, 90_000, 180_000]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(15 * 60_000);
    expect(waits.at(-1)).toBe(675_000); // 0.75 x 15 min
  });

  it('a reply lost after the authority accepted never creates a duplicate', async () => {
    const s = await mk();
    s.gra.state.dropResponseNext = 1;
    await s.sell();
    await work(s);
    expect(docs(s)[0].state).toBe('retrying');
    expect(s.gra.held.size).toBe(1);
    advance(s, 23_000);
    await work(s);
    expect(docs(s)[0].state).toBe('acknowledged');
    expect(s.gra.held.size).toBe(1); // the retry reused the same idempotency key
    expect(docs(s)[0].gra_reference).toBe('SBX-000001');
  });

  it('a document found mid-submission after a crash is looked up first, not resent', async () => {
    const s = await mk();
    await s.sell();
    const d = docs(s)[0];
    // The authority accepted it, then the laptop died before recording the answer.
    await s.gra.fetch(`${s.gra.url}/invoices`, { method: 'POST', headers: { 'idempotency-key': d.id }, body: d.payload });
    s.engine.db.prepare("INSERT INTO fiscal_events (id, document_id, type, attempt_no, occurred_at) VALUES (?, ?, 'submitted', 1, ?)").run(uuid(), d.id, s.clock.now.toISOString());
    expect(docs(s)[0].state).toBe('submitting');
    const before = s.gra.state.posts.length;
    await work(s);
    expect(s.gra.state.posts.length).toBe(before); // no second POST
    expect(s.gra.state.gets).toBe(1);
    expect(docs(s)[0]).toMatchObject({ state: 'acknowledged', gra_reference: 'SBX-000001' });
  });

  it('keeps sales working and the queue intact through a long outage', async () => {
    const s = await mk();
    s.gra.state.down = true;
    for (let i = 0; i < 5; i++) { await s.sell(); advance(s, 3_600_000); await work(s); }
    expect(docs(s)).toHaveLength(5);
    const status = await s.run(s.owner, 'fiscal.status');
    expect(status.summary).toMatchObject({ pending: 5, acknowledged: 0, rejected: 0 });
    expect(status.summary.overdue).toBe(0); // 5 h at most: below the 24 h alert
    advance(s, 25 * 3_600_000);
    expect((await s.run(s.owner, 'fiscal.status')).summary.overdue).toBe(5);
    s.gra.state.down = false;
    advance(s, 20 * 60_000);
    await work(s);
    expect((await s.run(s.owner, 'fiscal.status')).summary).toMatchObject({ pending: 0, acknowledged: 5, overdue: 0 });
  });
});

describe('rejections', () => {
  it('records a rejection once, never retries it, and does not block later invoices', async () => {
    const s = await mk();
    s.gra.state.reject = { code: 'BAD_TIN', message: 'Taxpayer not found' };
    const a = await s.sell();
    await work(s);
    expect(docs(s)[0]).toMatchObject({ state: 'rejected', error_code: 'BAD_TIN', error_detail: 'Taxpayer not found' });
    s.gra.state.reject = null;
    const b = await s.sell();
    await work(s); await work(s);
    expect(docs(s).map((d) => d.state)).toEqual(['rejected', 'acknowledged']);
    expect(s.gra.state.posts).toHaveLength(2); // the rejected one was not resent
    expect(await s.receipt(a.id)).toContain('Fiscal confirmation failed');
    expect(await s.receipt(b.id)).toContain('Fiscal receipt');
    expect(s.engine.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action = 'fiscal.rejected'").get()).toEqual({ n: 1 });
  });

  it('lets the owner mark a rejected document as handled, with a note, and nothing else', async () => {
    const s = await mk();
    s.gra.state.reject = { code: 'X', message: 'no' };
    const a = await s.sell();
    await work(s);
    const attention = await s.run(s.owner, 'fiscal.list', { attentionOnly: true });
    expect(attention).toHaveLength(1);
    expect(attention[0]).not.toHaveProperty('payload');
    await s.run(s.owner, 'fiscal.resolve', { documentId: attention[0].id, note: 'Filed manually with GRA' });
    expect(docs(s)[0].state).toBe('resolved');
    expect(await s.receipt(a.id)).toContain('handled directly with GRA');
    await expect(s.run(s.owner, 'fiscal.resolve', { documentId: attention[0].id, note: 'again' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('refuses to send a document whose stored copy no longer matches its hash', async () => {
    const s = await mk();
    await s.sell();
    s.engine.db.exec('DROP TRIGGER fiscal_documents_no_update');
    s.engine.db.prepare("UPDATE fiscal_documents SET payload = replace(payload, '1250', '9999')").run();
    await work(s);
    expect(docs(s)[0]).toMatchObject({ state: 'rejected', error_code: 'LOCAL_INTEGRITY' });
    expect(s.gra.state.posts).toHaveLength(0);
  });
});

describe('atomicity', () => {
  it('a crash during the sale leaves neither the sale nor its fiscal document', async () => {
    let boom = false;
    const s = await mk({ beforeCommit: (c) => { if (boom && c === 'sale.complete') throw new Error('power cut'); } });
    boom = true;
    await expect(s.sell()).rejects.toThrow('power cut');
    expect(docs(s)).toHaveLength(0);
    expect(s.engine.db.prepare('SELECT COUNT(*) n FROM sales').get()).toEqual({ n: 0 });
    boom = false;
    await s.sell();
    expect(docs(s).map((d) => d.fiscal_number)).toEqual(['FD-000001']); // numbering has no gap
  });

  it('retrying the same basket cannot create a second fiscal document', async () => {
    const s = await mk();
    const id = uuid();
    const input = { id, lines: [{ productId: s.products.milk, quantity: 1 }], tenders: [{ method: 'cash', amount: 1250 }] };
    await s.run(s.cashier, 'sale.complete', input);
    await s.run(s.cashier, 'sale.complete', input);
    expect(docs(s)).toHaveLength(1);
  });
});

describe('refunds', () => {
  async function doRefund(s: FiscalShop, saleId: string) {
    const item: any = s.engine.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);
    if (!s.engine.db.prepare("SELECT 1 FROM shifts WHERE status = 'open' AND cashier_id = (SELECT id FROM users WHERE role = 'owner')").get()) await s.run(s.owner, 'shift.open', { openingFloat: 0 });
    return s.run(s.owner, 'refund.create', { id: uuid(), saleId, reason: 'Damaged', payoutMethod: 'cash', lines: [{ saleItemId: item.id, quantity: 1 }] });
  }
  it('issues a credit note that waits for, then references, the original invoice', async () => {
    const s = await mk();
    s.gra.state.down = true;
    const sale = await s.sell();
    await doRefund(s, sale.id);
    expect(docs(s).map((d) => [d.kind, d.state])).toEqual([['invoice', 'queued'], ['credit_note', 'waiting']]);
    await work(s); // original cannot be sent; the credit note must not be sent ahead of it
    expect(s.gra.state.posts.every((p) => p.kind === 'invoice')).toBe(true);

    s.gra.state.down = false;
    advance(s, 23_000);
    await work(s);
    expect(docs(s).map((d) => d.state)).toEqual(['acknowledged', 'acknowledged']);
    const note = s.gra.state.posts.find((p) => p.kind === 'credit_note')!;
    expect(note.originalReference).toBe('SBX-000001');
    const sent = JSON.parse(docs(s)[1].payload);
    expect(sent).toMatchObject({ kind: 'credit_note', original: { receiptNo: sale.receiptNo }, totals: { total: 1250 } });
  });

  it('a sale made before fiscal reporting began gets no credit note', async () => {
    const s = await mk({ mode: 'off' });
    const sale = await s.sell();
    await s.run(s.owner, 'fiscal.configure', { mode: 'sandbox', sandboxUrl: s.gra.url, reason: 'Start' });
    await doRefund(s, sale.id);
    expect(docs(s)).toHaveLength(0);
  });
});

describe('receipt QR', () => {
  it('renders a self-contained SVG, or nothing', () => {
    const svg = qrSvg('https://sandbox.invalid/verify/SBX-000001')!;
    expect(svg).toMatch(/^<svg [^>]*viewBox/);
    expect(svg).not.toMatch(/<script|href=|<image/);
    expect(qrSvg(null)).toBeNull();
    expect(qrSvg('')).toBeNull();
  });
});

describe('status in sync.status', () => {
  it('reports the fiscal summary beside the cloud sync summary', async () => {
    const s = await mk();
    await s.sell();
    expect((await s.run(s.owner, 'sync.status')).fiscal).toMatchObject({ mode: 'sandbox', pending: 1, acknowledged: 0, rejected: 0 });
  });
});
