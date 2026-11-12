import { formatGHS, sum } from '@mansora/domain';
export const MAX_WHATSAPP_TEXT = 6000;
export function whatsappPhone(value: string): string | null {
  let digits = value.trim().replace(/[ ()-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
}
export function whatsappUrl(phone: string, text: string): string {
  const number = whatsappPhone(phone);
  if (!number) throw new Error('Enter the intended customer’s full international number, including country code.');
  if (!text.trim() || text.length > MAX_WHATSAPP_TEXT) throw new Error('This message is too long. Save or print the statement and attach it manually.');
  const url = new URL(`https://wa.me/${number}`); url.searchParams.set('text', text); return url.toString();
}
const money = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('The authorised record contains an invalid amount. Refresh it before sharing.'); return formatGHS(value); };
export function receiptMessage(business: string, data: any): string {
  const { sale, items, payments, refunds, credit } = data;
  return [business, `Receipt ${sale.receipt_no} · ${sale.created_at.slice(0, 10)}`, sale.customer_name ? `Customer: ${sale.customer_name}` : 'Walk-in sale',
    ...items.map((i: any) => `${i.quantity} × ${i.product_name}: ${money(i.line_total)}`),
    `Original sale total: ${money(sale.total)}`, ...payments.map((p: any) => `${p.method === 'credit' ? 'Sold on credit (not money received)' : `Recorded ${p.method} payment`}: ${money(p.amount)}`),
    ...(refunds.length ? [`Refunds recorded: ${money(sum(refunds.map((r: any) => r.amount)))}`] : []),
    ...(credit ? [`Credit still owed: ${money(credit.outstanding_balance)}`] : []),
    'Copy of an existing receipt. This does not record or request another payment.'].join('\n');
}
export function debtMessage(business: string, account: any): string {
  return [business, `Hello ${account.customer_name},`, `Our records show ${money(account.outstanding_balance)} still owed on receipt ${account.receipt_no}.`,
    ...(account.due_date ? [`Due date: ${account.due_date}`] : []), 'If you have already paid or disagree with this balance, please contact us so we can check the record.',
    'Never share a payment PIN or password.'].join('\n');
}
export function statementMessage(business: string, data: any, asOf: string): string {
  const total = sum(data.credit.map((c: any) => c.outstanding_balance));
  return [business, `Customer statement · ${data.customer.name}`, `Current position as of ${asOf}`, ...data.credit.map((c: any) => `${c.receipt_no}: ${money(c.outstanding_balance)} still owed${c.due_date ? ` · due ${c.due_date}` : ''}`),
    `Total currently owed: ${money(total)}`, 'Current balances, not a reconstructed historical statement. Contact us if a payment is missing or a balance is disputed.'].join('\n');
}
