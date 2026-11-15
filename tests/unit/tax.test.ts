import { describe, expect, it } from 'vitest';
import { addTax, defaultTaxConfig, refundTax, taxAmount, taxCart, priceCart } from '../../packages/domain/src';

const c = { ...defaultTaxConfig(), registered: true, registrationDate: '2026-01-01', tin: 'TIN', vatNumber: 'VAT' };
describe('Ghana VAT arithmetic', () => {
  it('matches the supplied workbook in both price modes', () => {
    expect(taxAmount(120000, 'standard', c, '2026-11-15')).toMatchObject({ base: 100000, vat: 15000, nhil: 2500, getfund: 2500, total: 120000 });
    expect(taxAmount(100000, 'standard', { ...c, pricing: 'exclusive' }, '2026-11-15')).toMatchObject({ base: 100000, vat: 15000, nhil: 2500, getfund: 2500, total: 120000 });
  });
  it('keeps exempt, zero-rated and outside-scope treatment distinct and respects effective dates', () => {
    for (const classification of ['zero', 'exempt', 'outside'] as const) expect(taxAmount(1000, classification, c, '2026-11-15')).toMatchObject({ classification, vat: 0, nhil: 0, getfund: 0, total: 1000 });
    expect(taxAmount(1000, 'standard', { ...c, registrationDate: '2026-12-01' }, '2026-11-15')).toMatchObject({ registered: false, vat: 0 });
  });
  it('applies discounts before tax for mixed baskets', () => {
    const cart = priceCart([{ productId: 's', quantity: 1, unitPrice: 10000 }, { productId: 'e', quantity: 1, unitPrice: 10000 }], 2000);
    const priced = taxCart(cart, ['standard', 'exempt'], { ...c, pricing: 'exclusive' }, '2026-11-15');
    expect(priced.total).toBe(19800);
    expect(priced.snapshots[0]).toMatchObject({ base: 9000, vat: 1350, nhil: 225, getfund: 225 });
    expect(priced.snapshots[1].total).toBe(9000);
  });
  it('balances tiny inclusive amounts and repeated partial reversals without losing a pesewa', () => {
    for (let gross = 1; gross <= 400; gross++) {
      const t = taxAmount(gross, 'standard', c, '2026-11-15');
      expect(t.base + t.vat + t.nhil + t.getfund).toBe(gross);
      const parts = Array.from({ length: gross }, (_, previous) => refundTax(t, previous, 1));
      for (const p of parts) {
        expect(p.base + p.vat + p.nhil + p.getfund).toBe(1);
        expect(Math.min(p.base, p.vat, p.nhil, p.getfund)).toBeGreaterThanOrEqual(0);
      }
      expect(addTax(parts)).toEqual({ base: t.base, vat: t.vat, nhil: t.nhil, getfund: t.getfund, total: gross });
    }
  });
});
