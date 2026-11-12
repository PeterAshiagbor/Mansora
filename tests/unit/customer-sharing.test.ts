import { expect, it } from 'vitest';
import { debtMessage, receiptMessage, statementMessage, whatsappPhone, whatsappUrl } from '../../apps/desktop/src/renderer/customer-sharing';
it('requires an explicit international recipient without guessing a local country code or accepting URL content', () => {
  expect(whatsappPhone('020 000 0000')).toBeNull();
  expect(whatsappPhone('+233 (20) 000-0000')).toBe('233200000000');
  expect(whatsappPhone('00233200000000')).toBe('233200000000');
  for (const value of ['javascript:alert(1)', '+233200000000?text=changed', '233letters000', '00000']) expect(whatsappPhone(value)).toBeNull();
  const url = new URL(whatsappUrl('+233200000000', 'Receipt & balance: GHS 1.50\nCheck first'));
  expect(url.origin).toBe('https://wa.me'); expect(url.pathname).toBe('/233200000000'); expect(url.searchParams.get('text')).toBe('Receipt & balance: GHS 1.50\nCheck first');
  expect(() => whatsappUrl('+233200000000', 'x'.repeat(6001))).toThrow('too long');
});
it('shares actual outstanding balances and distinguishes original receipt credit from money received', () => {
  const account = { customer_name: 'Customer', receipt_no: 'R-1', original_balance: 200, outstanding_balance: 150, due_date: '2026-12-01' };
  expect(debtMessage('Shop', account)).toContain('GHS 1.50 still owed');
  const data = { customer: { name: 'Customer' }, credit: [account, { ...account, receipt_no: 'R-2', outstanding_balance: 300 }] };
  expect(statementMessage('Shop', data, '2026-11-11')).toContain('Total currently owed: GHS 4.50');
  const receipt = receiptMessage('Shop', { sale: { receipt_no: 'R-1', created_at: '2026-11-11T09:00:00Z', total: 200 }, items: [{ quantity: 1, product_name: 'Paper', line_total: 200 }], payments: [{ method: 'credit', amount: 200 }], refunds: [], credit: account });
  expect(receipt).toContain('Original sale total: GHS 2.00'); expect(receipt).toContain('Sold on credit (not money received)'); expect(receipt).toContain('Credit still owed: GHS 1.50');
});
