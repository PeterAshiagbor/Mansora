import { expect, it } from 'vitest';
import { SYNC_TABLES } from '../../packages/domain/src';
import { Ctx, createEngine, fiscalDocuments, openDatabase, runFiscalWorker, syncNow } from '../../apps/desktop/src/core';
import { importSnapshot } from '../../apps/desktop/src/core/restore';
import { startCloud } from '../cloud';
import { tempDir } from '../helpers';
import { makeFiscalShop } from '../fiscal/helpers';

it('syncs fiscal documents and events to the cloud once, isolates tenants, and restores the full history', async () => {
  const cloud = await startCloud();
  const client = await cloud.createClient('Fiscal sync shop');
  const other = await cloud.createClient('Other shop');
  const shop = await makeFiscalShop({ apiUrl: cloud.url, code: client.code, fetch });
  const restored = createEngine({ db: openDatabase(':memory:'), dataDir: tempDir(), now: () => shop.clock.now });
  try {
    await shop.sell();
    await shop.sell();
    await runFiscalWorker(shop.engine);
    expect(await syncNow(shop.engine)).toMatchObject({ ok: true, pending: 0, rejected: 0 });
    expect(await syncNow(shop.engine)).toMatchObject({ ok: true, pushed: 0 });

    const mine = await cloud.db.tenant(client.id, async (q) => ({
      documents: await q('SELECT * FROM fiscal_documents ORDER BY fiscal_number'),
      events: await q('SELECT type FROM fiscal_events ORDER BY occurred_at, type'),
    }));
    expect(mine.documents.map((d: any) => d.fiscal_number)).toEqual(['FD-000001', 'FD-000002']);
    expect(mine.events.filter((e: any) => e.type === 'acknowledged')).toHaveLength(2);
    expect(await cloud.db.tenant(other.id, (q) => q('SELECT * FROM fiscal_documents'))).toEqual([]);
    expect(await cloud.db.tenant(other.id, (q) => q('SELECT * FROM fiscal_events'))).toEqual([]);

    // A replacement laptop rebuilt from the cloud keeps every document, its state and its numbering.
    const snapshot = await cloud.db.tenant(client.id, async (q) => {
      const result: Record<string, unknown> = {};
      for (const [table, spec] of Object.entries(SYNC_TABLES)) result[table] = await q(`SELECT ${Object.keys(spec.cols).join(', ')} FROM ${table}`);
      return result;
    });
    importSnapshot(new Ctx(restored, 'restore', null), snapshot);
    const before = fiscalDocuments(new Ctx(shop.engine, 't', null), true).map(({ id, state, gra_reference, payload_hash }) => ({ id, state, gra_reference, payload_hash }));
    const after = fiscalDocuments(new Ctx(restored, 't', null), true).map(({ id, state, gra_reference, payload_hash }) => ({ id, state, gra_reference, payload_hash }));
    expect(after).toEqual(before);
    expect(after.map((d) => d.state)).toEqual(['acknowledged', 'acknowledged']);
    expect(restored.meta('seq_FD')).toBe('2'); // the next fiscal number continues the sequence
  } finally {
    restored.db.close(); shop.engine.db.close(); await cloud.close();
  }
}, 120_000);
