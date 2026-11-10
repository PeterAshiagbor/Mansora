import { randomBytes, randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS } from '@mansora/domain';
import { openEngine, type Engine } from '../../apps/desktop/src/core';
import { hashPassword } from '../../apps/desktop/src/core/passwords';
import { REPORT_INDEX_CANDIDATES } from './candidates';

export const YEAR = { from: '2025-01-01', to: '2025-12-31' };
export const MONTH = { from: '2025-01-01', to: '2025-01-31' };
export const DAY = { from: '2025-01-15', to: '2025-01-15' };
export interface FixtureOptions { products?: number; sales?: number; customers?: number; candidateIndexes?: boolean; }

/** Synthetic, encrypted, internally reconciled fixture. No real client data. */
export function seedFixture(directory: string, options: FixtureOptions = {}) {
  const products = options.products ?? 20_000, sales = options.sales ?? 200_000, customers = options.customers ?? 2_000;
  if (!Number.isSafeInteger(products) || products < 3 || !Number.isSafeInteger(sales) || sales < 12 || !Number.isSafeInteger(customers) || customers < 1) throw new Error('Invalid performance fixture counts');
  const engine = openEngine({ dataDir: directory, dbKey: randomBytes(32).toString('hex'), now: () => new Date('2026-01-02T12:00:00Z') });
  const db = engine.db, ownerId = randomUUID(), activeShift = randomUUID();
  const ids = Array.from({ length: products }, () => randomUUID());
  const customerIds = Array.from({ length: customers }, () => randomUUID());
  const shifts = Array.from({ length: 12 }, () => randomUUID());
  const sold = Array<number>(products).fill(0), salesByMonth = Array<number>(12).fill(0);
  const start = Date.parse('2025-01-01T00:00:00Z'), end = Date.parse('2026-01-01T00:00:00Z');
  const initialQuantity = Math.ceil(sales * 3 / products) + 1000;
  const insertProduct = db.prepare('INSERT INTO products (id,sku,barcode,name,cost_price,selling_price,reorder_level,created_at,updated_at) VALUES (?,?,?,?,300,500,10,?,?)');
  const insertBalance = db.prepare('INSERT INTO stock_balances (product_id,quantity,average_cost,version,updated_at) VALUES (?, ?,300,1,?)');
  const insertMovement = db.prepare('INSERT INTO inventory_movements (id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,actor_id,occurred_at) VALUES (?,?,?,?,300,?,?,?,?)');
  const insertSale = db.prepare('INSERT INTO sales (id,receipt_no,shift_id,cashier_id,customer_id,subtotal,total,cash_tendered,cost_total,created_at) VALUES (?,?,?,?,?,1500,1500,1500,900,?)');
  const insertLine = db.prepare('INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price,cost_snapshot,line_total) VALUES (?,?,?,?,?,1,500,300,500)');
  const insertPayment = db.prepare("INSERT INTO payments (id,sale_id,method,amount) VALUES (?,?,'cash',1500)");
  const insertAudit = db.prepare("INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,detail,occurred_at) VALUES (?,?,'sale.complete','sale',?,'{}',?)");
  const name = (i: number) => `Performance Product ${String(i).padStart(5, '0')} ${i % 2 ? 'Tea' : 'Rice'}`;
  try {
    if (options.candidateIndexes) db.exec(REPORT_INDEX_CANDIDATES);
    db.transaction(() => {
      db.prepare("INSERT INTO users (id,username,name,role,permissions,password_hash,created_at,updated_at) VALUES (?, 'benchmark-owner','Synthetic benchmark owner','owner',?,?,?,?)").run(ownerId, JSON.stringify(ALL_PERMISSIONS), hashPassword(randomBytes(24).toString('hex')), YEAR.from, YEAR.from);
      const customer = db.prepare('INSERT INTO customers (id,name,created_at,updated_at) VALUES (?,?,?,?)');
      for (let i = 0; i < customers; i++) customer.run(customerIds[i], `Synthetic Customer ${String(i).padStart(4, '0')}`, YEAR.from, YEAR.from);
      const shift = db.prepare('INSERT INTO shifts (id,cashier_id,status,opening_float,opened_at,closed_at,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?)');
      for (let i = 0; i < 12; i++) shift.run(shifts[i], ownerId, 'reviewed', 10_000, new Date(Date.UTC(2025, i, 1)).toISOString(), new Date(Date.UTC(2025, i + 1, 1) - 1).toISOString(), ownerId, new Date(Date.UTC(2025, i + 1, 1)).toISOString());
      shift.run(activeShift, ownerId, 'open', 10_000, engine.now().toISOString(), null, null, null);
      for (let i = 0; i < products; i++) {
        insertProduct.run(ids[i], `SKU-${i}`, `PERF-${i}`, name(i), YEAR.from, YEAR.from);
        insertBalance.run(ids[i], initialQuantity, YEAR.from);
        insertMovement.run(randomUUID(), ids[i], 'OPENING_STOCK', initialQuantity, 'product', ids[i], ownerId, `${YEAR.from}T00:00:00.000Z`);
      }
      engine.setMeta('business_name', 'Synthetic performance fixture');
      engine.setMeta('seq_R', String(sales));
      engine.setMeta('tenant_id', randomUUID());
      engine.setMeta('device_token', randomBytes(32).toString('base64url'));
    }).immediate();
    for (let offset = 0; offset < sales; offset += 1000) {
      db.transaction(() => {
        for (let i = offset; i < Math.min(offset + 1000, sales); i++) {
          const id = randomUUID(), timestamp = new Date(start + Math.floor(i * (end - start) / sales)).toISOString();
          const month = Number(timestamp.slice(5, 7)) - 1;
          salesByMonth[month]++;
          insertSale.run(id, `R-${String(i + 1).padStart(6, '0')}`, shifts[month], ownerId, customerIds[i % customers], timestamp);
          for (let j = 0; j < 3; j++) {
            const p = (i * 3 + j) % products;
            sold[p]++;
            insertLine.run(randomUUID(), id, ids[p], name(p), `SKU-${p}`);
            insertMovement.run(randomUUID(), ids[p], 'SALE', -1, 'sale', id, ownerId, timestamp);
          }
          insertPayment.run(randomUUID(), id);
          insertAudit.run(randomUUID(), ownerId, id, timestamp);
        }
      }).immediate();
      if (sales >= 20_000 && (offset + 1000) % 20_000 === 0) console.log(`Seeded ${offset + 1000}/${sales} sales`);
    }
    db.transaction(() => {
      const balance = db.prepare('UPDATE stock_balances SET quantity=?, version=?, updated_at=? WHERE product_id=?');
      for (let i = 0; i < products; i++) balance.run(initialQuantity - sold[i], 1 + sold[i], '2025-12-31T23:59:59.999Z', ids[i]);
      const shift = db.prepare('UPDATE shifts SET expected_cash=?,counted_cash=?,variance=0 WHERE id=?');
      for (let i = 0; i < 12; i++) shift.run(10_000 + salesByMonth[i] * 1500, 10_000 + salesByMonth[i] * 1500, shifts[i]);
    }).immediate();
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('ANALYZE');
    return { engine, token: engine.createSession(ownerId), productIds: ids, salesByMonth, counts: { products, sales, saleItems: sales * 3, customers }, expected: { revenue: sales * 1500, cogs: sales * 900, stockUnits: products * initialQuantity - sales * 3 } };
  } catch (err) { db.close(); throw err; }
}
export type Fixture = ReturnType<typeof seedFixture>;
