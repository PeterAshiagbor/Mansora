import { fork } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openEngine, summarise } from '../../apps/desktop/src/core';
import { makeShop, TEST_DB_KEY } from '../helpers';

describe('TEST 15 - the process is killed in the middle of a sale', () => {
  it('keeps every committed sale and no trace of the interrupted one', async () => {
    const s = await makeShop();
    s.engine.db.close();

    const messages: string[] = [];
    const signal = await new Promise<string | null>((resolve, reject) => {
      const child = fork(join(import.meta.dirname, 'crash-child.ts'), [s.dir, TEST_DB_KEY, s.products.rice], { execArgv: ['--import', 'tsx'], stdio: 'inherit' });
      child.on('message', (m) => messages.push(String(m)));
      child.on('exit', (_code, sig) => resolve(sig));
      child.on('error', reject);
    });
    expect(signal).toBe('SIGKILL');
    expect(messages).toEqual(['first-sale-committed']);

    // "Restart the laptop": reopen the same database file.
    const engine = openEngine({ dataDir: s.dir, dbKey: TEST_DB_KEY });
    const db = engine.db;
    expect(summarise(db)).toMatchObject({ sales: 1, salesTotal: 8000 });
    expect(db.prepare('SELECT quantity FROM stock_balances WHERE product_id = ?').get(s.products.rice)).toEqual({ quantity: 19 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM inventory_movements WHERE type = 'SALE'`).get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sale_items').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE type = 'sale.complete'`).get()).toEqual({ n: 1 });
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });
});
