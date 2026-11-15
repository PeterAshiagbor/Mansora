import { defaultTaxConfig } from '../../packages/domain/src';
import { fakeActivationFetch, makeShop, uuid, type TestShop } from '../helpers';
import { createFakeGra } from './fake-gra';

export interface FiscalShop extends TestShop {
  gra: ReturnType<typeof createFakeGra>;
  clock: { now: Date };
  sell: (qty?: number) => Promise<{ id: string; receiptNo: string }>;
  receipt: (id: string) => Promise<string>;
}

/** An activated shop, VAT-registered (unless `registered: false`), with fiscal reporting in sandbox mode (unless `mode: 'off'`). */
export async function makeFiscalShop(opts: { registered?: boolean; mode?: 'off' | 'sandbox'; beforeCommit?: (c: string) => void; apiUrl?: string; code?: string; fetch?: typeof fetch } = {}): Promise<FiscalShop> {
  const gra = createFakeGra();
  const clock = { now: new Date('2026-11-15T12:00:00Z') };
  const activation = fakeActivationFetch();
  const fetchAll = (opts.fetch ? ((u: any, i: any) => (String(u).startsWith(gra.url) ? gra.fetch(u, i) : opts.fetch!(u, i))) : ((u: any, i: any) => (String(u).startsWith(gra.url) ? gra.fetch(u, i) : activation(u, i)))) as typeof fetch;
  const shop = await makeShop({ fetch: fetchAll, now: () => clock.now, beforeCommit: opts.beforeCommit, apiUrl: opts.apiUrl, code: opts.code });
  shop.engine.setMeta('lock_minutes', '1000000'); // tests move the clock by days
  if (opts.registered !== false) {
    await shop.run(shop.owner, 'tax.configure', { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'C0001234567', vatNumber: 'V0001234567', reason: 'Verified registration' });
  }
  await shop.run(shop.owner, 'product.save', { id: shop.products.milk, name: 'Milk tin', sellingPrice: 1250, taxClass: 'standard' });
  if ((opts.mode ?? 'sandbox') !== 'off') await shop.run(shop.owner, 'fiscal.configure', { mode: 'sandbox', sandboxUrl: gra.url, reason: 'Testing' });
  return {
    ...shop, gra, clock,
    sell: async (qty = 1) => {
      const id = uuid();
      const r = await shop.run(shop.cashier, 'sale.complete', { id, lines: [{ productId: shop.products.milk, quantity: qty }], tenders: [{ method: 'cash', amount: 1250 * qty }] });
      return { id, receiptNo: r.receiptNo };
    },
    receipt: async (id) => (await shop.run(shop.cashier, 'sale.receipt', { id })).html,
  };
}
