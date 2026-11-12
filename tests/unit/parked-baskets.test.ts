import { beforeEach, expect, it } from 'vitest';
import { clearParkedBaskets, parkBasket, parkedBaskets, takeParkedBasket } from '../../apps/desktop/src/renderer/parked-baskets';
beforeEach(clearParkedBaskets);
const draft = (id = 'sale-a') => ({ id, createdAt: '2026-11-11T09:00:00Z', lines: [{ productId: 'product-a', quantity: 2 }], cartDiscount: 0, customerId: '', customer: null, requestingDiscount: false });
it('isolates drafts by business and actor and consumes the same sale identifier only once', () => {
  parkBasket('shop-a:cashier-a', draft());
  expect(parkedBaskets('shop-b:cashier-a')).toEqual([]);
  expect(parkedBaskets('shop-a:cashier-b')).toEqual([]);
  expect(takeParkedBasket('shop-a:cashier-a', 'sale-a')).toMatchObject({ id: 'sale-a', lines: [{ quantity: 2 }] });
  expect(takeParkedBasket('shop-a:cashier-a', 'sale-a')).toBeUndefined();
});
it('copies editable data and bounds draft storage without replacing existing unfinished work', () => {
  const value = draft(); parkBasket('scope', value); value.lines[0].quantity = 99;
  expect(parkedBaskets<any>('scope')[0].lines[0].quantity).toBe(2);
  expect(() => parkBasket('scope', draft())).toThrow('already parked');
  for (let n = 1; n < 10; n++) parkBasket('scope', draft(String(n)));
  expect(() => parkBasket('scope', draft('overflow'))).toThrow('Resume or discard');
  expect(parkedBaskets('scope')).toHaveLength(10);
  clearParkedBaskets(); expect(parkedBaskets('scope')).toEqual([]);
});
