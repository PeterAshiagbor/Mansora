import { z } from 'zod';
import { fail, sum } from '@mansora/domain';
import { defineCommands, empty, zId, zMoney, zOptText, zQty, zText, type Ctx } from '../engine';
import { moveStock } from '../stock';

const productInput = z.object({
  id: zId.optional(),
  name: zText(160),
  sku: zOptText(60),
  barcode: zOptText(60),
  categoryId: zId.nullish(),
  unit: z.string().trim().min(1).max(20).default('each'),
  costPrice: zMoney.optional(),
  sellingPrice: zMoney,
  reorderLevel: z.number().int().nonnegative().max(1_000_000).default(0),
  active: z.boolean().default(true),
  openingStock: z.number().int().nonnegative().max(10_000_000).optional(),
});

export function createProduct(ctx: Ctx, input: z.infer<typeof productInput>, refType = 'product'): string {
  const now = ctx.now();
  const id = ctx.id();
  const cost = input.costPrice ?? 0;
  ctx.insert('products', {
    id, sku: input.sku, barcode: input.barcode, name: input.name, category_id: input.categoryId ?? null, unit: input.unit, cost_price: cost,
    selling_price: input.sellingPrice, reorder_level: input.reorderLevel, active: input.active ? 1 : 0, version: 1, created_at: now, updated_at: now,
  });
  ctx.insert('stock_balances', { product_id: id, quantity: 0, average_cost: cost, version: 0, updated_at: now });
  if (input.openingStock) moveStock(ctx, { productId: id, type: 'OPENING_STOCK', delta: input.openingStock, unitCost: cost, refType, refId: id });
  return id;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.category_id, c.name AS category_name, p.unit, p.cost_price, p.selling_price, p.reorder_level,
         p.active, p.version, p.updated_at, COALESCE(b.quantity, 0) AS quantity, COALESCE(b.average_cost, p.cost_price) AS average_cost
  FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN stock_balances b ON b.product_id = p.id`;

/** Cost data is stripped at the data layer for users without the cost permission. */
function hideCost(ctx: Ctx, rows: any[]): any[] {
  if (ctx.can('product.cost')) return rows;
  return rows.map(({ cost_price, average_cost, ...rest }) => rest);
}

export const catalogCommands = defineCommands({
  'category.list': { perm: 'product.view', input: empty, run: (ctx) => ctx.all('SELECT id, name, active FROM categories ORDER BY name') },
  'category.save': {
    perm: 'product.manage',
    mutates: true,
    input: z.object({ id: zId.optional(), name: zText(80), active: z.boolean().default(true) }),
    run: (ctx, input) => {
      const id = input.id ?? ctx.id();
      if (input.id) ctx.update('categories', id, { name: input.name, active: input.active ? 1 : 0, updated_at: ctx.now() });
      else ctx.insert('categories', { id, name: input.name, active: input.active ? 1 : 0, updated_at: ctx.now() });
      ctx.audit('category', id, { name: input.name, active: input.active });
      return { id };
    },
  },

  'product.list': {
    perm: 'product.view',
    input: z.object({ search: z.string().max(100).optional(), categoryId: zId.optional(), includeInactive: z.boolean().optional(), limit: z.number().int().min(1).max(1000).default(200) }),
    run: (ctx, input) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (!input.includeInactive) where.push('p.active = 1');
      if (input.categoryId) (where.push('p.category_id = ?'), params.push(input.categoryId));
      const q = input.search?.trim();
      if (q) {
        where.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode = ?)`);
        const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
        params.push(like, like, q);
      }
      const rows = ctx.all(`${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT ?`, ...params, input.limit);
      return hideCost(ctx, rows);
    },
  },
  /** Exact barcode / SKU match - used by the scanner. */
  'product.lookup': {
    perm: 'product.view',
    input: z.object({ code: z.string().trim().min(1).max(60) }),
    run: (ctx, input) => hideCost(ctx, ctx.all(`${PRODUCT_SELECT} WHERE p.active = 1 AND (p.barcode = ? OR p.sku = ?) LIMIT 1`, input.code, input.code))[0] ?? null,
  },
  'product.save': {
    perm: 'product.manage',
    mutates: true,
    input: productInput,
    run: (ctx, input) => {
      if (!input.id) {
        if (input.costPrice && !ctx.can('product.cost')) fail('PERMISSION_DENIED', 'You do not have permission to set cost prices', { permission: 'product.cost' });
        if (input.openingStock) ctx.require('stock.adjust');
        const id = createProduct(ctx, input);
        ctx.audit('product', id, { name: input.name, sellingPrice: input.sellingPrice, openingStock: input.openingStock ?? 0 }, 'product.created');
        return { id };
      }
      const p = ctx.get('SELECT * FROM products WHERE id = ?', input.id);
      if (!p) fail('NOT_FOUND', 'Product not found');
      const cost = input.costPrice ?? p.cost_price;
      if (cost !== p.cost_price) ctx.require('product.cost');
      ctx.update('products', p.id, {
        sku: input.sku, barcode: input.barcode, name: input.name, category_id: input.categoryId ?? null, unit: input.unit, cost_price: cost,
        selling_price: input.sellingPrice, reorder_level: input.reorderLevel, active: input.active ? 1 : 0, version: p.version + 1, updated_at: ctx.now(),
      });
      // With no stock on hand there is nothing to average against, so the reference cost becomes the stock cost.
      if (cost !== p.cost_price) {
        const bal = ctx.get('SELECT * FROM stock_balances WHERE product_id = ?', p.id);
        if (bal && bal.quantity <= 0) ctx.update('stock_balances', p.id, { average_cost: cost, version: bal.version + 1, updated_at: ctx.now() });
      }
      const changes: Record<string, unknown> = {};
      if (p.selling_price !== input.sellingPrice) changes.sellingPrice = { from: p.selling_price, to: input.sellingPrice };
      if (p.cost_price !== cost) changes.costPrice = { from: p.cost_price, to: cost };
      if (p.name !== input.name) changes.name = { from: p.name, to: input.name };
      if (!!p.active !== input.active) changes.active = input.active;
      ctx.audit('product', p.id, changes, 'product.updated');
      return { id: p.id };
    },
  },

  'stock.overview': {
    perm: 'stock.view',
    input: z.object({ filter: z.enum(['all', 'low', 'out']).default('all') }),
    run: (ctx, input) => {
      // One read serves the rows and the summary. "Low" means in stock but at or below reorder level, in both.
      const all = ctx.all(`${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.name`);
      const rows = hideCost(ctx, all.map((r) => ({ ...r }))).filter((r) =>
        input.filter === 'out' ? r.quantity <= 0 : input.filter === 'low' ? r.quantity > 0 && r.quantity <= r.reorder_level : true,
      );
      return {
        rows,
        summary: {
          products: all.length,
          low: all.filter((r) => r.quantity > 0 && r.quantity <= r.reorder_level).length,
          out: all.filter((r) => r.quantity <= 0).length,
          valuation: ctx.can('product.cost') ? sum(all.map((r) => Math.max(0, r.quantity) * r.average_cost)) : null,
        },
      };
    },
  },
  'stock.movements': {
    perm: 'stock.view',
    input: z.object({ productId: zId.optional(), type: z.string().max(40).optional(), limit: z.number().int().min(1).max(1000).default(200) }),
    run: (ctx, input) => {
      const where = ['1=1'];
      const params: unknown[] = [];
      if (input.productId) (where.push('m.product_id = ?'), params.push(input.productId));
      if (input.type) (where.push('m.type = ?'), params.push(input.type));
      const rows = ctx.all(
        `SELECT m.*, p.name AS product_name, u.name AS actor_name FROM inventory_movements m
         JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.actor_id
         WHERE ${where.join(' AND ')} ORDER BY m.occurred_at DESC, m.rowid DESC LIMIT ?`,
        ...params, input.limit,
      );
      return ctx.can('product.cost') ? rows : rows.map(({ unit_cost, ...r }) => r);
    },
  },
  /** Damages and manual corrections. A reason is always required. */
  'stock.adjust': {
    perm: 'stock.adjust',
    mutates: true,
    input: z.object({ productId: zId, type: z.enum(['DAMAGE', 'MANUAL_CORRECTION']), delta: z.number().int().min(-10_000_000).max(10_000_000), reason: zText(300) }),
    run: (ctx, input) => {
      if (input.delta === 0) fail('INVALID_QUANTITY', 'Enter a quantity other than zero');
      if (input.type === 'DAMAGE' && input.delta > 0) fail('INVALID_QUANTITY', 'Damaged stock must reduce the quantity');
      const refId = ctx.id();
      const r = moveStock(ctx, { productId: input.productId, type: input.type, delta: input.delta, refType: 'adjustment', refId, reason: input.reason });
      ctx.audit('product', input.productId, { type: input.type, delta: input.delta, reason: input.reason, newQuantity: r.quantity });
      return { quantity: r.quantity };
    },
  },
  /** Physical stock count: records the difference between counted and system quantity for each product. */
  'stock.count': {
    perm: 'stock.adjust',
    mutates: true,
    input: z.object({ note: zOptText(300), lines: z.array(z.object({ productId: zId, counted: z.number().int().nonnegative().max(10_000_000) })).min(1).max(5000) }),
    run: (ctx, input) => {
      // One physical count per product: two lines for the same product would compound into extra adjustments.
      if (new Set(input.lines.map((l) => l.productId)).size !== input.lines.length) fail('INVALID_INPUT', 'Each product may appear only once in a stock count');
      const countId = ctx.id();
      const adjustments: { productId: string; system: number; counted: number; delta: number }[] = [];
      for (const line of input.lines) {
        if (!ctx.get('SELECT 1 FROM products WHERE id = ?', line.productId)) fail('NOT_FOUND', 'Product not found');
        const bal = ctx.get('SELECT quantity FROM stock_balances WHERE product_id = ?', line.productId);
        const system = bal?.quantity ?? 0;
        const delta = line.counted - system;
        if (delta === 0) continue;
        moveStock(ctx, { productId: line.productId, type: 'STOCK_COUNT_ADJUSTMENT', delta, refType: 'stock_count', refId: countId, reason: input.note ?? 'Stock count' });
        adjustments.push({ productId: line.productId, system, counted: line.counted, delta });
      }
      ctx.audit('stock_count', countId, { counted: input.lines.length, adjustments });
      return { id: countId, adjusted: adjustments.length };
    },
  },

  /** Suppliers with how often and how recently the shop bought from them. Amounts only for staff who may see costs. */
  'supplier.list': {
    perm: 'purchase.manage',
    input: empty,
    run: (ctx) => {
      const rows = ctx.all(`SELECT s.*, COUNT(p.id) AS purchases, COALESCE(SUM(p.total_cost), 0) AS total_bought, MAX(p.received_at) AS last_purchase_at
        FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id GROUP BY s.id ORDER BY s.name`);
      return ctx.can('product.cost') ? rows : rows.map((r: any) => ({ ...r, total_bought: null }));
    },
  },
  /** C60: one supplier's purchases, newest first, and the products usually bought from them. */
  'supplier.get': {
    perm: 'purchase.manage',
    input: z.object({ id: zId }),
    run: (ctx, input) => {
      const supplier = ctx.get('SELECT * FROM suppliers WHERE id = ?', input.id);
      if (!supplier) fail('NOT_FOUND', 'Supplier not found');
      const costs = ctx.can('product.cost');
      const purchases = ctx.all(`SELECT p.id, p.reference, p.received_at, p.total_cost, (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS lines
        FROM purchases p WHERE p.supplier_id = ? ORDER BY p.received_at DESC LIMIT 200`, input.id).map((r: any) => (costs ? r : { ...r, total_cost: null }));
      const products = ctx.all(`SELECT pr.id, pr.name, SUM(i.quantity) AS quantity, MAX(p.received_at) AS last_received_at, COALESCE(b.quantity, 0) AS in_stock, pr.reorder_level
        FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id JOIN products pr ON pr.id = i.product_id LEFT JOIN stock_balances b ON b.product_id = pr.id
        WHERE p.supplier_id = ? GROUP BY pr.id ORDER BY pr.name`, input.id);
      return { supplier, purchases, products };
    },
  },
  /**
   * C60: what to reorder. Every active product at or below its reorder level, with the supplier it was last bought
   * from and a suggested quantity that brings stock back to twice the reorder level.
   */
  'stock.reorderList': {
    perm: 'stock.view',
    input: empty,
    run: (ctx) => ctx.all(`SELECT pr.id, pr.name, pr.sku, pr.unit, pr.reorder_level, COALESCE(b.quantity, 0) AS quantity,
        (SELECT p.supplier_id FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id WHERE i.product_id = pr.id AND p.supplier_id IS NOT NULL ORDER BY p.received_at DESC LIMIT 1) AS supplier_id
      FROM products pr LEFT JOIN stock_balances b ON b.product_id = pr.id
      WHERE pr.active = 1 AND pr.reorder_level > 0 AND COALESCE(b.quantity, 0) <= pr.reorder_level ORDER BY pr.name`)
      .map((r: any) => {
        const supplier = r.supplier_id ? ctx.get('SELECT id, name, phone FROM suppliers WHERE id = ?', r.supplier_id) : null;
        return { ...r, supplier, suggested: Math.max(1, r.reorder_level * 2 - Math.max(0, r.quantity)) };
      }),
  },
  'supplier.save': {
    perm: 'purchase.manage',
    mutates: true,
    input: z.object({ id: zId.optional(), name: zText(120), phone: zOptText(40), momoNumber: zOptText(40), location: zOptText(160), supplies: zOptText(300), notes: zOptText(500) }),
    run: (ctx, input) => {
      const id = input.id ?? ctx.id();
      const row = { name: input.name, phone: input.phone, momo_number: input.momoNumber ?? null, location: input.location ?? null, supplies: input.supplies ?? null, notes: input.notes, updated_at: ctx.now() };
      if (input.id) ctx.update('suppliers', id, row);
      else ctx.insert('suppliers', { id, ...row });
      ctx.audit('supplier', id, { name: input.name });
      return { id };
    },
  },
  'purchase.list': {
    perm: 'purchase.manage',
    input: empty,
    run: (ctx) => {
      const rows = ctx.all(
        `SELECT pu.*, s.name AS supplier_name, u.name AS created_by_name,
           (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) AS item_count
         FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id JOIN users u ON u.id = pu.created_by
         ORDER BY pu.received_at DESC LIMIT 300`,
      );
      // Purchase costs reveal cost prices: only people allowed to see costs get them.
      if (!ctx.can('product.cost')) for (const r of rows) delete r.total_cost;
      return rows;
    },
  },
  'purchase.get': {
    perm: 'purchase.manage',
    input: z.object({ id: zId }),
    run: (ctx, input) => {
      const purchase = ctx.get('SELECT pu.*, s.name AS supplier_name FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.id = ?', input.id);
      if (!purchase) fail('NOT_FOUND', 'Purchase not found');
      const items = ctx.all('SELECT i.*, p.name AS product_name FROM purchase_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_id = ?', input.id);
      if (!ctx.can('product.cost')) { delete purchase.total_cost; for (const i of items) delete i.unit_cost; }
      return { purchase, items };
    },
  },
  /** Receive stock from a supplier: increases stock and re-averages cost. */
  'purchase.receive': {
    perm: 'purchase.manage',
    mutates: true,
    input: z.object({
      id: zId.optional(), supplierId: zId.nullish(), reference: zOptText(80),
      items: z.array(z.object({ productId: zId, quantity: zQty, unitCost: zMoney })).min(1).max(1000),
    }),
    run: (ctx, input) => {
      const id = input.id ?? ctx.id();
      if (ctx.get('SELECT 1 FROM purchases WHERE id = ?', id)) return { id, duplicate: true };
      // Receiving sets catalogue costs and the moving average, so it needs permission to edit cost prices.
      ctx.require('product.cost');
      const now = ctx.now();
      const totalCost = sum(input.items.map((i) => i.quantity * i.unitCost));
      if (!Number.isSafeInteger(totalCost)) fail('INVALID_AMOUNT', 'This purchase is too large to record. Split it into smaller purchases.');
      ctx.insert('purchases', {
        id, supplier_id: input.supplierId ?? null, reference: input.reference, status: 'received',
        total_cost: totalCost, received_at: now, created_by: ctx.user.id,
      });
      for (const item of input.items) {
        ctx.insert('purchase_items', { id: ctx.id(), purchase_id: id, product_id: item.productId, quantity: item.quantity, unit_cost: item.unitCost });
        moveStock(ctx, { productId: item.productId, type: 'PURCHASE_RECEIVED', delta: item.quantity, unitCost: item.unitCost, refType: 'purchase', refId: id });
        const p = ctx.get('SELECT version FROM products WHERE id = ?', item.productId);
        ctx.update('products', item.productId, { cost_price: item.unitCost, version: p.version + 1, updated_at: now });
      }
      ctx.audit('purchase', id, { items: input.items.length, reference: input.reference });
      return { id };
    },
  },
});
