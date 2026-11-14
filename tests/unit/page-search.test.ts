import { describe, expect, it } from 'vitest';
import { searchPages } from '../../packages/ui/src/page-search';

// The client workspace pages as the menu lists them, with their keywords (abridged from apps/desktop App.tsx).
const pages = [
  { id: 'dashboard', label: 'Dashboard', group: 'Workspace', keywords: ['overview', 'today', 'payment mix'] },
  { id: 'checkout', label: 'New sale', group: 'Sell', keywords: ['sell', 'till', 'pos', 'credit sale'] },
  { id: 'sales', label: 'Sales history', group: 'Sell', keywords: ['receipts', 'transactions', 'refund', 'income', 'takings'] },
  { id: 'shifts', label: 'Cashier shifts', group: 'Sell', keywords: ['till', 'cash up', 'end of day'] },
  { id: 'customers', label: 'Customers', group: 'Customers', keywords: ['clients', 'buyers'] },
  { id: 'credit', label: 'Credit & repayments', group: 'Customers', keywords: ['debt', 'debtors', 'owing', 'outstanding'] },
  { id: 'products', label: 'Products', group: 'Stock', keywords: ['items', 'goods', 'price list'] },
  { id: 'stock', label: 'Stock', group: 'Stock', keywords: ['inventory', 'stock count', 'reorder', 'low stock'] },
  { id: 'purchases', label: 'Purchases & suppliers', group: 'Stock', keywords: ['suppliers', 'receive stock', 'restock'] },
  { id: 'reports', label: 'Reports', group: 'Business', keywords: ['sales report', 'income', 'revenue', 'profit', 'gross profit', 'best sellers'] },
  { id: 'expenses', label: 'Expenses', group: 'Business', keywords: ['spending', 'costs', 'bills', 'rent'] },
  { id: 'statements', label: 'Bank & MoMo statements', group: 'Business', keywords: ['mobile money', 'mtn', 'reconcile'] },
  { id: 'staff', label: 'Staff', group: 'Manage', keywords: ['employees', 'permissions'] },
  { id: 'backup', label: 'Backup & recovery', group: 'Manage', keywords: ['restore', 'lost laptop'] },
];
const ids = (q: string) => searchPages(pages, q).map((m) => m.page.id);

describe('Find a page (owner request 2026-11-14)', () => {
  it('puts the page with that name first', () => {
    expect(ids('stock')[0]).toBe('stock');
    expect(ids('reports')[0]).toBe('reports');
    expect(ids('new sale')[0]).toBe('checkout');
  });
  it('finds pages by what they do: income, revenue and sales lead to sales and reports', () => {
    for (const q of ['income', 'revenue', 'takings', 'turnover']) {
      const found = ids(q);
      expect(found, q).toContain('reports');
      expect(found, q).toContain('sales');
    }
    expect(ids('revenue reports')[0]).toBe('reports');
    expect(ids('sales')).toEqual(expect.arrayContaining(['sales', 'reports', 'checkout']));
    expect(ids('profit')[0]).toBe('reports');
  });
  it('understands everyday words for the same thing', () => {
    expect(ids('inventory')[0]).toBe('stock');
    expect(ids('debtors')[0]).toBe('credit');
    expect(ids('who owes')).toContain('credit');
    expect(ids('spending')[0]).toBe('expenses');
    expect(ids('employees')[0]).toBe('staff');
    expect(ids('momo')[0]).toBe('statements');
    expect(ids('money in')).toEqual(expect.arrayContaining(['sales', 'reports']));
    expect(ids('vendors')).toContain('purchases');
  });
  it('forgives small typing mistakes', () => {
    expect(ids('reveune')).toContain('reports');
    expect(ids('invetory')[0]).toBe('stock');
    expect(ids('custmers')[0]).toBe('customers');
  });
  it('says why a related page was found', () => {
    const m = searchPages(pages, 'turnover').find((x) => x.page.id === 'reports');
    expect(m?.reason).toMatch(/turnover/);
  });
  it('shows every page for an empty search and nothing for nonsense', () => {
    expect(ids('')).toHaveLength(pages.length);
    expect(ids('zzqx')).toEqual([]);
  });
});
