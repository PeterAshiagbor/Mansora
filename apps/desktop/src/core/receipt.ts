import { formatGHS, PAYMENT_LABELS, type PaymentMethod } from '@mansora/domain';

export interface ReceiptData {
  business: { name: string; phone: string; address: string; footer: string };
  sale: { receipt_no: string; created_at: string; cashier_name: string; customer_name: string | null; customer_phone: string | null; subtotal: number; discount_total: number; total: number; cash_tendered: number; change_given: number; tax_snapshot?: string | null };
  items: { product_name: string; quantity: number; unit_price: number; discount: number; line_total: number; tax_snapshot?: string | null }[];
  payments: { method: string; amount: number; reference: string | null }[];
  refunds: { refund_no: string; amount: number; created_at: string }[];
  reprint: boolean;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => formatGHS(n, false);

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Self-contained receipt document sized for 80 mm thermal paper. It also
 * prints acceptably on A4 and is the source for PDF receipts. No scripts,
 * no external resources.
 */
export function renderReceiptHtml(r: ReceiptData): string {
  const tax = r.sale.tax_snapshot ? JSON.parse(r.sale.tax_snapshot) : null;
  const rows = r.items
    .map(
      (i) => `<tr><td colspan="3" class="name">${esc(i.product_name)}${tax?.registered && i.tax_snapshot ? ` <span class="muted">(${esc(({ standard: 'standard-rated', zero: 'zero-rated', exempt: 'exempt', outside: 'outside scope' } as Record<string, string>)[JSON.parse(i.tax_snapshot).classification])})</span>` : ''}</td></tr>
<tr><td>${i.quantity} x ${money(i.unit_price)}</td><td class="r">${i.discount ? `-${money(i.discount)}` : ''}</td><td class="r">${money(i.line_total)}</td></tr>`,
    )
    .join('');
  const pays = r.payments
    .map((p) => `<tr><td>${esc(PAYMENT_LABELS[p.method as PaymentMethod] ?? p.method)}${p.reference ? ` <span class="muted">(${esc(p.reference)})</span>` : ''}</td><td class="r">${money(p.amount)}</td></tr>`)
    .join('');
  const refunds = r.refunds.map((f) => `<tr><td>Refund ${esc(f.refund_no)} ${esc(formatDateTime(f.created_at))}</td><td class="r">-${money(f.amount)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.sale.receipt_no)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
@page { size: 80mm auto; margin: 3mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; padding: 2mm 0; }
h1 { font-size: 16px; margin: 0 0 2px; text-align: center; }
.c { text-align: center; } .r { text-align: right; white-space: nowrap; } .muted { color: #444; font-size: 11px; }
table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
.name { font-weight: 600; padding-top: 4px; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.total td { font-size: 16px; font-weight: 700; padding-top: 4px; }
</style></head><body>
<h1>${esc(r.business.name)}</h1>
<div class="c muted">${[r.business.address, r.business.phone].filter(Boolean).map(esc).join('<br>')}</div>
<hr>
<table>
<tr><td>Receipt</td><td class="r"><strong>${esc(r.sale.receipt_no)}</strong></td></tr>
<tr><td>Date</td><td class="r">${esc(formatDateTime(r.sale.created_at))}</td></tr>
${tax?.registered ? `<tr><td>TIN</td><td class="r">${esc(tax.tin)}</td></tr><tr><td>VAT registration</td><td class="r">${esc(tax.vatNumber)}</td></tr>` : ''}
<tr><td>Cashier</td><td class="r">${esc(r.sale.cashier_name)}</td></tr>
${r.sale.customer_name ? `<tr><td>Customer</td><td class="r">${esc(r.sale.customer_name)}${r.sale.customer_phone ? `<br>${esc(r.sale.customer_phone)}` : ''}</td></tr>` : ''}
${tax?.registered && tax?.customer?.tin ? `<tr><td>Customer TIN</td><td class="r">${esc(tax.customer.tin)}</td></tr>` : ''}
</table>
<hr>
<table>${rows}</table>
<hr>
<table>
<tr><td>Subtotal</td><td class="r">${money(r.sale.subtotal)}</td></tr>
${r.sale.discount_total ? `<tr><td>Discount</td><td class="r">-${money(r.sale.discount_total)}</td></tr>` : ''}
${tax?.registered ? `<tr><td>Value excluding taxes</td><td class="r">${money(tax.base)}</td></tr><tr><td>VAT (${tax.rates[0] / 100}%)</td><td class="r">${money(tax.vat)}</td></tr><tr><td>NHIL (${tax.rates[1] / 100}%)</td><td class="r">${money(tax.nhil)}</td></tr><tr><td>GETFund (${tax.rates[2] / 100}%)</td><td class="r">${money(tax.getfund)}</td></tr>` : ''}

<tr class="total"><td>TOTAL (GHS)</td><td class="r">${money(r.sale.total)}</td></tr>
</table>
<hr>
<table>
${pays}
${r.sale.cash_tendered ? `<tr><td>Cash received</td><td class="r">${money(r.sale.cash_tendered)}</td></tr>` : ''}
<tr><td>Change</td><td class="r">${money(r.sale.change_given)}</td></tr>
${refunds}
</table>
<hr>
<div class="c">${esc(r.business.footer || 'Thank you for your purchase')}</div>
${r.reprint ? '<div class="c muted">Reprinted copy</div>' : ''}
${tax?.registered ? `<div class="c muted">${EVAT_NOTE}</div>` : ''}
</body></html>`;
}

/** Audit F01: until GRA E-VAT onboarding is complete, printed documents must not pass as certified invoices. */
export const EVAT_NOTE = 'VAT shown for information. Not issued through GRA E-VAT.';

export interface CreditNoteData {
  business: { name: string; phone: string; address: string };
  refund: { refund_no: string; created_at: string; amount: number; reason: string; payout_method: string | null; payout_amount: number; credit_reduction: number; authorised_by_name: string };
  sale: { receipt_no: string; created_at: string; tax_snapshot?: string | null };
  items: { product_name: string; quantity: number; amount: number; restocked: number; tax_snapshot?: string | null }[];
}

/**
 * Audit F15: a separate credit-note document for a refund, referencing the original receipt and showing the VAT,
 * NHIL and GETFund reversed (from the refund's own snapshots, never recalculated at today's rates).
 */
export function renderCreditNoteHtml(c: CreditNoteData): string {
  const tax = c.sale.tax_snapshot ? JSON.parse(c.sale.tax_snapshot) : null;
  const parts = c.items.map((i) => (i.tax_snapshot ? JSON.parse(i.tax_snapshot) : null));
  const total = (k: 'base' | 'vat' | 'nhil' | 'getfund') => parts.reduce((t, p, n) => t + (p ? Number(p[k]) || 0 : k === 'base' ? c.items[n].amount : 0), 0);
  const rows = c.items.map((i) => `<tr><td>${esc(i.product_name)}${i.restocked ? '' : ' <span class="muted">(not returned to stock)</span>'}</td><td class="r">${i.quantity}</td><td class="r">${money(i.amount)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Credit note ${esc(c.refund.refund_no)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>@page { size: 80mm auto; margin: 3mm; } body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; }
h1 { font-size: 16px; margin: 0 0 2px; text-align: center; } .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .muted { color: #444; font-size: 11px; }
table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .total td { font-size: 15px; font-weight: 700; }</style></head><body>
<h1>${esc(c.business.name)}</h1><div class="c muted">${[c.business.address, c.business.phone].filter(Boolean).map(esc).join('<br>')}</div><hr>
<div class="c"><strong>CREDIT NOTE</strong></div>
<table><tr><td>Credit note</td><td class="r"><strong>${esc(c.refund.refund_no)}</strong></td></tr><tr><td>Date</td><td class="r">${esc(formatDateTime(c.refund.created_at))}</td></tr>
<tr><td>Original receipt</td><td class="r">${esc(c.sale.receipt_no)} (${esc(formatDateTime(c.sale.created_at))})</td></tr>
${tax?.registered ? `<tr><td>TIN</td><td class="r">${esc(tax.tin)}</td></tr><tr><td>VAT registration</td><td class="r">${esc(tax.vatNumber)}</td></tr>` : ''}
${tax?.customer?.name ? `<tr><td>Customer</td><td class="r">${esc(tax.customer.name)}${tax.customer.tin ? `<br>TIN ${esc(tax.customer.tin)}` : ''}</td></tr>` : ''}
<tr><td>Reason</td><td class="r">${esc(c.refund.reason)}</td></tr><tr><td>Authorised by</td><td class="r">${esc(c.refund.authorised_by_name)}</td></tr></table><hr>
<table><tr><td><strong>Item</strong></td><td class="r"><strong>Qty</strong></td><td class="r"><strong>GHS</strong></td></tr>${rows}</table><hr>
<table>${tax?.registered ? `<tr><td>Value excluding taxes</td><td class="r">${money(total('base'))}</td></tr><tr><td>VAT reversed</td><td class="r">${money(total('vat'))}</td></tr><tr><td>NHIL reversed</td><td class="r">${money(total('nhil'))}</td></tr><tr><td>GETFund reversed</td><td class="r">${money(total('getfund'))}</td></tr>` : ''}
<tr class="total"><td>TOTAL CREDITED (GHS)</td><td class="r">${money(c.refund.amount)}</td></tr>
${c.refund.credit_reduction ? `<tr><td>Taken off amount owed</td><td class="r">${money(c.refund.credit_reduction)}</td></tr>` : ''}
${c.refund.payout_amount ? `<tr><td>Paid back by ${esc(PAYMENT_LABELS[c.refund.payout_method as PaymentMethod] ?? c.refund.payout_method)}</td><td class="r">${money(c.refund.payout_amount)}</td></tr>` : ''}</table>
${tax?.registered ? `<hr><div class="c muted">${EVAT_NOTE}</div>` : ''}
</body></html>`;
}
