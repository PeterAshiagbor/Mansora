import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { startStagingGateway } from '../../scripts/staging/gateway';
import { makeShop, tempDir } from '../helpers';
it('finishes existing commands, refuses new work during a snapshot, keeps health available and releases the lock after failure', async () => {
  const shop = await makeShop(), assets = tempDir(); writeFileSync(join(assets, 'index.html'), '<html><head></head><body>Fixture</body></html>');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { entered = resolve; });
  shop.engine.register({ 'test.snapshotWait': { perm: 'public', async: true, input: z.object({}), run: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return {}; } } });
  const gateway = await startStagingGateway({ origin: 'http://127.0.0.1:0', apiUrl: 'http://127.0.0.1:9', clientDir: assets, adminDir: assets, port: 0, workspaces: [{ id: 'shop-a', label: 'Synthetic', engine: shop.engine }] });
  const invoke = (command: string) => fetch(gateway.url + '/client/shop-a/invoke', { method: 'POST', headers: { origin: gateway.publicOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ command }) });
  try {
    const pending = invoke('test.snapshotWait'); await held; let captured = false;
    const snapshot = gateway.withSnapshotLock(async () => { captured = true; expect((await invoke('app.state')).status).toBe(503); throw new Error('Synthetic capture failure'); });
    const result = snapshot.catch(error => error.message);
    expect(captured).toBe(false); expect((await invoke('app.state')).status).toBe(503); expect((await fetch(gateway.url + '/healthz')).status).toBe(200);
    release(); expect((await pending).status).toBe(200); expect(await result).toBe('Synthetic capture failure'); expect(captured).toBe(true);
    expect((await invoke('app.state')).status).toBe(200);
  } finally { release?.(); await gateway.close(); shop.engine.db.close(); }
});
