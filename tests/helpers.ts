import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEngine, type Engine } from '../apps/desktop/src/core';

export const OWNER = { name: 'Ama Owusu', username: 'ama', password: 'owner-pass-1' };
export const MANAGER = { name: 'Kofi Mensah', username: 'kofi', password: 'manager-pass-1' };
export const CASHIER = { name: 'Esi Boateng', username: 'esi', password: 'cashier-pass-1' };
export const TEST_DB_KEY = 'test-device-key-0123456789';

export function tempDir(prefix = 'mansora-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A fetch that only knows how to activate a device - for engine tests that need no real server. */
export function fakeActivationFetch(tenantName = 'Test Mini Mart'): typeof fetch {
  return (async (url: any) => {
    if (String(url).endsWith('/v1/devices/activate')) {
      return new Response(JSON.stringify({ deviceId: randomUUID(), deviceToken: 'fake-token', tenant: { id: randomUUID(), name: tenantName, phone: '0240000000', address: 'Osu, Accra' } }), { status: 200 });
    }
    throw new TypeError('fetch failed (offline)');
  }) as typeof fetch;
}

export interface TestShop {
  engine: Engine;
  dir: string;
  owner: string;
  manager: string;
  cashier: string;
  run: <T = any>(token: string | null, cmd: string, input?: unknown) => Promise<T>;
  products: Record<'rice' | 'milk' | 'soap', string>;
}

export async function login(engine: Engine, who: { username: string; password: string }): Promise<string> {
  return (await engine.execute(null, 'auth.login', who)).token;
}

/** An activated shop with an owner, manager, cashier, three products and (optionally) an open cashier shift. */
export async function makeShop(opts: { dir?: string; fetch?: typeof fetch; now?: () => Date; beforeCommit?: (c: string) => void; apiUrl?: string; code?: string; openShift?: boolean } = {}): Promise<TestShop> {
  const dir = opts.dir ?? tempDir();
  const engine = openEngine({ dataDir: dir, dbKey: TEST_DB_KEY, fetch: opts.fetch ?? fakeActivationFetch(), now: opts.now, beforeCommit: opts.beforeCommit });
  const run = (token: string | null, cmd: string, input?: unknown) => engine.execute(token, cmd, input);
  await run(null, 'activation.activate', { apiUrl: opts.apiUrl ?? 'http://localhost:9', code: opts.code ?? 'TEST-CODE', deviceName: 'Test laptop', owner: OWNER });
  const owner = await login(engine, OWNER);
  await run(owner, 'staff.save', { ...MANAGER, role: 'manager' });
  await run(owner, 'staff.save', { ...CASHIER, role: 'cashier' });
  const mk = async (name: string, barcode: string, cost: number, price: number, stock: number) =>
    (await run(owner, 'product.save', { name, barcode, sku: name.slice(0, 4).toUpperCase(), costPrice: cost, sellingPrice: price, openingStock: stock, reorderLevel: 5 })).id as string;
  const products = {
    rice: await mk('Rice 5kg', '6001000000011', 6000, 8000, 20),
    milk: await mk('Milk tin', '6001000000028', 900, 1250, 50),
    soap: await mk('Soap bar', '6001000000035', 333, 500, 30),
  };
  const manager = await login(engine, MANAGER);
  const cashier = await login(engine, CASHIER);
  if (opts.openShift !== false) await run(cashier, 'shift.open', { openingFloat: 10_000 });
  return { engine, dir, owner, manager, cashier, run, products };
}

export const uuid = () => randomUUID();

export function stockOf(engine: Engine, productId: string): number {
  return (engine.db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(productId) as any).quantity;
}

export async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e: any) {
    if (e.code !== code) throw new Error(`Expected error ${code} but got ${e.code}: ${e.message}`);
    return;
  }
  throw new Error(`Expected error ${code} but the call succeeded`);
}
