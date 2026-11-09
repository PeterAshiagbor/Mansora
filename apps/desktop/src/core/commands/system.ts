import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { fail, formatGHS, SYNC_TABLES } from '@mansora/domain';
import { createBackupFile, verifyBackupFile } from '../backup';
import { dayBounds, defineCommands, empty, zId, zRange, zText, type Ctx } from '../engine';
import { buildPreview, fileHash, IMPORT_FIELDS, readTable, suggestMapping, TEMPLATE_ROWS, toCsv, toXlsx, type ExistingKeys } from '../importer';
import { syncNow, uploadBackup } from '../sync';
import { createProduct } from './catalog';

const zFile = z.object({ fileName: zText(200), contentBase64: z.string().max(15_000_000) });
const zMapping = z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200));

function file(name: string, mime: string, content: Buffer | string) {
  return { fileName: name, mime, contentBase64: Buffer.from(content).toString('base64') };
}
async function tableFile(base: string, format: 'csv' | 'xlsx', sheets: { name: string; rows: unknown[][] }[]) {
  if (format === 'csv') return file(`${base}.csv`, 'text/csv', toCsv(sheets[0].rows));
  return file(`${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await toXlsx(sheets));
}

function existingKeys(ctx: Ctx): ExistingKeys {
  const rows = ctx.all('SELECT name, sku, barcode FROM products');
  return {
    barcodes: new Set(rows.filter((r) => r.barcode).map((r) => r.barcode)),
    skus: new Set(rows.filter((r) => r.sku).map((r) => String(r.sku).toLowerCase())),
    names: new Set(rows.map((r) => String(r.name).toLowerCase())),
  };
}

async function preview(ctx: Ctx, input: { fileName: string; contentBase64: string; mapping?: Record<string, string> }) {
  const content = Buffer.from(input.contentBase64, 'base64');
  const table = await readTable(input.fileName, content);
  if (table.length < 2) fail('INVALID_FILE', 'The file has no product rows');
  if (table.length > 20_001) fail('FILE_TOO_LARGE', 'Import at most 20,000 products at a time');
  const headers = table[0].map((h) => h.trim());
  table[0] = headers;
  const mapping = input.mapping && Object.keys(input.mapping).length ? input.mapping : suggestMapping(headers);
  const hash = fileHash(content);
  const already = ctx.get('SELECT created_at FROM import_batches WHERE file_hash = ?', hash);
  const needsMapping = !mapping.name || !mapping.selling_price;
  const rows = needsMapping ? [] : buildPreview(table, mapping, existingKeys(ctx));
  return { headers, mapping, needsMapping, hash, rows, alreadyImportedAt: already?.created_at ?? null };
}

export const systemCommands = defineCommands({
  'sync.status': {
    perm: 'auth',
    input: empty,
    run: (ctx) => {
      const n = (sql: string) => (ctx.get(sql) as { v: any }).v;
      const lastBackup = ctx.get(`SELECT created_at, last_outbox_seq, uploaded_at FROM backup_records WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1`);
      const pending = n(`SELECT COUNT(*) AS v FROM outbox WHERE status = 'pending'`) as number;
      const s = ctx.engine.syncState;
      return {
        pending,
        rejected: n(`SELECT COUNT(*) AS v FROM outbox WHERE status = 'rejected'`) as number,
        oldestPendingAt: n(`SELECT MIN(occurred_at) AS v FROM outbox WHERE status = 'pending'`) as string | null,
        lastSyncAt: ctx.setting('last_sync_at') ?? null,
        state: s.running ? 'syncing' : s.online === false ? 'offline' : s.online === true ? 'online' : 'unknown',
        lastError: s.lastError,
        lastBackupAt: lastBackup?.created_at ?? null,
        lastBackupUploadedAt: lastBackup?.uploaded_at ?? null,
        /** Changes that exist only on this laptop: not yet on the server and not in any backup. */
        unprotected: n(`SELECT COUNT(*) AS v FROM outbox WHERE status = 'pending' AND seq > ${Number(lastBackup?.last_outbox_seq ?? 0)}`) as number,
        tenantStatus: ctx.setting('tenant_status') ?? 'active',
        subscription: JSON.parse(ctx.setting('subscription') ?? 'null'),
      };
    },
  },
  'sync.queue': {
    perm: 'auth',
    input: empty,
    run: (ctx) => ctx.all(`SELECT seq, type, occurred_at, status, attempts, last_error, synced_at FROM outbox ORDER BY seq DESC LIMIT 100`),
  },
  'sync.run': { perm: 'auth', async: true, input: empty, run: (ctx) => syncNow(ctx.engine) },

  'backup.list': { perm: 'backup.manage', input: empty, run: (ctx) => ctx.all('SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 50') },
  'backup.create': {
    perm: 'backup.manage',
    async: true,
    input: z.object({ passphrase: z.string().min(1).max(200), remember: z.boolean().default(false) }),
    run: async (ctx, input) => {
      const e = ctx.engine;
      let made;
      try {
        made = createBackupFile(e.db, (e as any).dbKey ?? null, join(e.dataDir, 'backups'), input.passphrase);
      } catch (err) {
        ctx.tx(() => {
          ctx.audit('backup', null, { error: String((err as Error).message) }, 'backup.failed');
          ctx.flush();
        });
        throw err;
      }
      ctx.tx(() => {
        ctx.run(
          `INSERT INTO backup_records (id, file_path, size_bytes, sha256, last_outbox_seq, status, created_at) VALUES (?, ?, ?, ?, ?, 'ok', ?)`,
          made.id, made.path, made.size, made.sha256, made.summary.lastOutboxSeq, ctx.now(),
        );
        if (input.remember) e.setMeta('backup_passphrase', input.passphrase);
        ctx.audit('backup', made.id, { size: made.size, sales: made.summary.sales }, 'backup.created');
        ctx.flush();
      });
      let uploaded = false;
      try {
        await uploadBackup(e, made.id, readFileSync(made.path), made.sha256);
        uploaded = true;
      } catch {
        /* offline: the local encrypted file is still a valid backup */
      }
      return { id: made.id, path: made.path, size: made.size, summary: made.summary, uploaded };
    },
  },
  'backup.verify': {
    perm: 'backup.manage',
    input: z.object({ id: zId, passphrase: z.string().min(1).max(200) }),
    run: (ctx, input) => {
      const rec = ctx.get('SELECT * FROM backup_records WHERE id = ?', input.id);
      if (!rec) fail('NOT_FOUND', 'Backup not found');
      return verifyBackupFile(rec.file_path, input.passphrase);
    },
  },

  'audit.list': {
    perm: 'audit.view',
    input: zRange.extend({ action: z.string().max(60).optional(), limit: z.number().int().min(1).max(2000).default(500) }),
    run: (ctx, input) => {
      const [from, to] = dayBounds(input);
      return ctx.all(
        `SELECT a.*, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.occurred_at >= ? AND a.occurred_at < ? ${input.action ? 'AND a.action LIKE ?' : ''} ORDER BY a.occurred_at DESC, a.rowid DESC LIMIT ?`,
        ...(input.action ? [from, to, `%${input.action}%`] : [from, to]), input.limit,
      );
    },
  },

  /** The owner decides if and when Mansora staff may see business reports. */
  'support.list': {
    perm: 'support.grant',
    input: empty,
    run: (ctx) => ({
      grants: ctx.all('SELECT g.*, u.name AS granted_by_name FROM support_access_grants g JOIN users u ON u.id = g.granted_by ORDER BY g.created_at DESC LIMIT 100'),
      accessLog: ctx.all('SELECT * FROM support_access_log ORDER BY occurred_at DESC LIMIT 200'),
      now: ctx.now(),
    }),
  },
  'support.grant': {
    perm: 'support.grant',
    mutates: true,
    input: z.object({ scope: z.enum(['reports']), purpose: zText(300), hours: z.number().int().min(1).max(72) }),
    run: (ctx, input) => {
      const id = ctx.id();
      const now = ctx.now();
      const expires = new Date(Date.parse(now) + input.hours * 3_600_000).toISOString();
      ctx.insert('support_access_grants', { id, scope: input.scope, purpose: input.purpose, granted_by: ctx.user.id, starts_at: now, expires_at: expires, revoked_at: null, created_at: now });
      ctx.audit('support_access_grant', id, { scope: input.scope, purpose: input.purpose, expiresAt: expires });
      return { id, expiresAt: expires };
    },
  },
  'support.revoke': {
    perm: 'support.grant',
    mutates: true,
    input: z.object({ id: zId }),
    run: (ctx, input) => {
      ctx.update('support_access_grants', input.id, { revoked_at: ctx.now() });
      ctx.audit('support_access_grant', input.id, {});
      return { ok: true };
    },
  },

  /** Turn an on-screen report into a CSV / Excel file. The rows come from a permission-checked report command. */
  'export.table': {
    perm: 'auth',
    async: true,
    input: z.object({
      title: zText(80), format: z.enum(['csv', 'xlsx']),
      columns: z.array(z.string().max(80)).min(1).max(40),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.null()])).max(40)).max(50_000),
    }),
    run: (_ctx, input) => tableFile(input.title.replace(/[^\w-]+/g, '-').toLowerCase(), input.format, [{ name: input.title, rows: [input.columns, ...input.rows] }]),
  },
  /** Full export of the business's own data. Password hashes and device secrets are never included. */
  'export.business': {
    perm: 'data.export',
    async: true,
    input: z.object({ format: z.enum(['xlsx', 'json']) }),
    run: async (ctx, input) => {
      const data: Record<string, any[]> = {};
      for (const [table, spec] of Object.entries(SYNC_TABLES)) data[table] = ctx.all(`SELECT ${Object.keys(spec.cols).join(', ')} FROM ${table}`);
      ctx.tx(() => {
        ctx.audit('business', ctx.setting('tenant_id') ?? null, { format: input.format, tables: Object.keys(data).length }, 'data.exported');
        ctx.flush();
      });
      const base = `mansora-export-${ctx.now().slice(0, 10)}`;
      if (input.format === 'json') return file(`${base}.json`, 'application/json', JSON.stringify({ exportedAt: ctx.now(), business: ctx.setting('business_name'), currency: 'GHS', amountsIn: 'pesewas', data }, null, 2));
      const MONEY = /(^|_)(amount|total|price|cost|balance|float|cash|tendered|given|discount|subtotal|variance|reduction)($|_)/;
      return tableFile(base, 'xlsx', Object.entries(data).map(([name, rows]) => {
        const cols = Object.keys(SYNC_TABLES[name as keyof typeof SYNC_TABLES].cols);
        return { name, rows: [cols, ...rows.map((r) => cols.map((c) => (typeof r[c] === 'number' && MONEY.test(c) ? formatGHS(r[c], false) : r[c])))] };
      }));
    },
  },

  'import.template': { perm: 'data.import', async: true, input: z.object({ format: z.enum(['csv', 'xlsx']) }), run: (_c, input) => tableFile('mansora-product-import-template', input.format, [{ name: 'Products', rows: TEMPLATE_ROWS }]) },
  'import.preview': { perm: 'data.import', async: true, input: zFile.extend({ mapping: zMapping.optional() }), run: (ctx, input) => preview(ctx, input) },
  'import.history': { perm: 'data.import', input: empty, run: (ctx) => ctx.all('SELECT b.*, u.name AS imported_by_name FROM import_batches b JOIN users u ON u.id = b.imported_by ORDER BY b.created_at DESC LIMIT 100') },
  /**
   * Import products (and, when confirmed, their opening stock). Safe to retry:
   * the same file is refused a second time, and rows matching an existing
   * product are skipped, so opening stock can never be added twice.
   */
  'import.commit': {
    perm: 'data.import',
    async: true,
    input: zFile.extend({ mapping: zMapping, confirmOpeningStock: z.boolean() }),
    run: async (ctx, input) => {
      const p = await preview(ctx, input);
      if (p.alreadyImportedAt) fail('ALREADY_IMPORTED', 'This file has already been imported. Nothing was changed.');
      if (p.needsMapping) fail('MAPPING_REQUIRED', 'Choose the product name and selling price columns');
      const invalid = p.rows.filter((r) => r.errors.length);
      if (invalid.length) fail('IMPORT_HAS_ERRORS', `Fix ${invalid.length} row(s) with errors before importing`, invalid.slice(0, 20));
      const good = p.rows.filter((r) => !r.duplicate);
      const withStock = good.some((r) => r.data.openingStock > 0);
      if (withStock && !input.confirmOpeningStock) fail('CONFIRM_OPENING_STOCK', 'Confirm the opening stock quantities before importing');
      if (withStock) ctx.require('stock.adjust');
      if (good.some((r) => r.data.costPrice > 0)) ctx.require('product.cost');
      return ctx.tx(() => {
        const batchId = ctx.id();
        const categories = new Map<string, string>(ctx.all('SELECT id, name FROM categories').map((c) => [String(c.name).toLowerCase(), c.id]));
        for (const row of good) {
          let categoryId: string | null = null;
          if (row.data.category) {
            categoryId = categories.get(row.data.category.toLowerCase()) ?? null;
            if (!categoryId) {
              categoryId = ctx.id();
              ctx.insert('categories', { id: categoryId, name: row.data.category, active: 1, updated_at: ctx.now() });
              categories.set(row.data.category.toLowerCase(), categoryId);
            }
          }
          createProduct(ctx, { ...row.data, categoryId, active: true }, 'import');
        }
        const result = { batchId, created: good.length, skipped: p.rows.length - good.length, openingStockApplied: withStock };
        ctx.run(
          'INSERT INTO import_batches (id, file_name, file_hash, created_count, skipped_count, opening_stock_applied, imported_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          batchId, input.fileName, p.hash, result.created, result.skipped, withStock ? 1 : 0, ctx.user.id, ctx.now(),
        );
        ctx.audit('import', batchId, { fileName: input.fileName, ...result }, 'import.committed');
        ctx.flush();
        return result;
      });
    },
  },
});
