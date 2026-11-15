import { formatGHS, PAYMENT_LABELS, type PaymentMethod } from '@mansora/domain';

export interface ReceiptData {
  business: { name: string; phone: string; address: string; footer: string };
  sale: { receipt_no: string; created_at: string; cashier_name: string; customer_name: string | null; customer_phone: string | null; subtotal: number; discount_total: number; total: number; cash_tendered: number; change_given: number; tax_snapshot?: string | null; customer_tin?: string | null; customer_address?: string | null };
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
${r.sale.customer_tin ? `<tr><td>Customer TIN</td><td class="r">${esc(r.sale.customer_tin)}</td></tr>` : ''}
${r.sale.customer_address ? `<tr><td>Customer address</td><td class="r">${esc(r.sale.customer_address)}</td></tr>` : ''}
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
</body></html>`;
}


/** Working paper carrying Fourth Schedule particulars; fiscal certification still requires GRA integration. */
export function renderCreditNoteHtml(data: { sale: any; refund: any; items: any[]; priorRefunds: any[] }): string {
  const tax = data.sale.tax_snapshot ? JSON.parse(data.sale.tax_snapshot) : null;
  const source = tax?.business ?? {}, buyer = tax?.customer ?? {};
  const originalBase = tax?.base ?? data.sale.total;
  const part = (r: any, key: string) => r.tax_snapshot ? JSON.parse(r.tax_snapshot)[key] ?? 0 : key === 'base' ? r.amount : 0;
  const reducedBase = data.priorRefunds.reduce((n,r) => n + part(r,'base'),0);
  const difference = data.items.reduce((n,r) => n + part(r,'base'),0);
  const total = (key: string) => data.items.reduce((n,r) => n + part(r,key),0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tax credit note ${esc(data.refund.refund_no)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:14px Arial;max-width:800px;margin:24px auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style></head><body>
<h1>Tax credit note — working paper</h1><p>Number: ${esc(data.refund.refund_no)} · Issued: ${esc(formatDateTime(data.refund.created_at))}</p>
<p>Supplier: ${esc(source.name)} · ${esc(source.address)} · TIN ${esc(tax?.tin)}</p>
<p>Recipient: ${esc(buyer.name || 'Walk-in / identity not recorded')} · ${esc(buyer.address || 'Address not recorded')} · TIN ${esc(buyer.tin || 'Not recorded')}</p>
<p>Original invoice: ${esc(data.sale.receipt_no)} · ${esc(formatDateTime(data.sale.created_at))}</p><p>Reason: ${esc(data.refund.reason)}</p>
<table><thead><tr><th>Item</th><th>Quantity returned</th><th>Value reduction GHS</th></tr></thead><tbody>${data.items.map(r=>`<tr><td>${esc(r.product_name)}</td><td>${r.quantity}</td><td>${money(part(r,'base'))}</td></tr>`).join('')}</tbody></table>
${tax?.originalCapturedBase != null ? `<p>Originally captured invoice base: ${money(tax.originalCapturedBase)}. Reconciled base below includes the documented tax adjustment.</p>` : ''}
<p>Original invoice value excluding taxes: ${money(originalBase)} · Adjusted value after this credit note: ${money(originalBase-reducedBase)} · This value reduction: ${money(difference)}</p>
<p>VAT reversal: ${money(total('vat'))} · NHIL reversal: ${money(total('nhil'))} · GETFund reversal: ${money(total('getfund'))} · Total credit: ${money(data.refund.amount)}</p>
<p>Reconcile this document and recipient particulars with the GRA-approved invoicing system. This document has no GRA fiscal signature or QR certification.</p></body></html>`;
}
