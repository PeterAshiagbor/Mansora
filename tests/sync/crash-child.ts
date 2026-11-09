/** Child process for the crash test: completes one sale, then is killed in the middle of the next one. */
import { randomUUID } from 'node:crypto';
import { openEngine } from '../../apps/desktop/src/core';

const [dir, key, productId] = process.argv.slice(2);
let armed = false;
const engine = openEngine({
  dataDir: dir,
  dbKey: key,
  beforeCommit: (cmd) => {
    // All rows of the sale are written inside the open transaction at this point. Die without warning.
    if (armed && cmd === 'sale.complete') process.kill(process.pid, 'SIGKILL');
  },
});
const { token } = await engine.execute(null, 'auth.login', { username: 'esi', password: 'cashier-pass-1' });
const sale = (qty: number) => engine.execute(token, 'sale.complete', { id: randomUUID(), lines: [{ productId, quantity: qty }], tenders: [{ method: 'cash', amount: 100_000 }] });
await sale(1);
process.send?.('first-sale-committed');
armed = true;
await sale(5);
process.send?.('should-never-get-here');
