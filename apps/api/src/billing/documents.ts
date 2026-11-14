import type { Query } from '../db';
import { billingContact, fail, loadSettings, outstanding, payUrl, type Billing } from './core';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cedi = (n: number) => `GH₵${(n / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string | null) => (iso ? String(iso).slice(0, 10) : '');

const STYLE = `@page{size:A4;margin:16mm 14mm 18mm}*{box-sizing:border-box}html{background:#fffaf1}body{font:14px/1.55 'Segoe UI',Arial,sans-serif;color:#221634;max-width:780px;margin:24px auto;padding:24px;background:#fff;overflow-wrap:anywhere}h1{font:600 30px/1.2 Georgia,serif;color:#38145c;margin:0 0 6px}h2{font-size:14px;font-weight:650;color:#5c2d85;margin:22px 0 7px;break-after:avoid}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px 6px;border-bottom:1px solid #e1d7e8;text-align:left;vertical-align:top}th{font-size:12px;font-weight:650;color:#38145c;background:#f8f3fc}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
.top{display:flex;justify-content:space-between;gap:24px;padding-bottom:16px;border-bottom:2px solid #c48b17;break-inside:avoid}.top>div{min-width:0;max-width:55%}.muted{color:#5e5269}.totals{max-width:340px;margin:14px 0 0 auto;break-inside:avoid;page-break-inside:avoid}.total td{font-weight:700;font-size:16px;border-bottom:0;color:#38145c}.badge{display:inline-block;padding:3px 10px;margin-top:6px;border-radius:6px;background:#efe3f8;color:#38145c;font-size:12px;font-weight:650}.metadata{font-size:12px}.metadata td{padding:8px 5px}.notes{white-space:pre-wrap}
.sandbox{background:#fff4d6;color:#633c04;padding:8px 12px;border-radius:6px;margin:12px 0;font-weight:600;break-inside:avoid}.print-help{margin:0 0 20px;padding:10px 12px;background:#f8f3fc;color:#4a2370;font-size:13px;border-radius:6px}
@media print{html,body{background:#fff}body{max-width:none;margin:0;padding:0;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-help{display:none}a{color:inherit}h2{margin-top:18px}}`;
const PRINT_HELP = '<aside class="print-help">Print or save a PDF from your browser’s Print menu.</aside>';


/** A printable invoice. Contains no script and no external resources, so it prints or saves to PDF anywhere. */
export async function invoiceHtml(b: Billing, q: Query, invoiceId: string): Promise<{ html: string; number: string }> {
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  if (!inv) fail(404, 'NOT_FOUND', 'Invoice not found');
  const s = await loadSettings(q), c = await billingContact(q, inv.tenant_id);
  const [acct] = await q(`SELECT * FROM billing_accounts WHERE tenant_id = $1`, [inv.tenant_id]);
  const lines = await q(`SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY position`, [invoiceId]);
  const pays = await q(`SELECT p.receipt_number, p.received_at, p.method, p.sandbox, a.amount, a.refunded FROM payment_allocations a JOIN billing_payments p ON p.id = a.payment_id WHERE a.invoice_id = $1 ORDER BY p.received_at`, [invoiceId]);
  const out = outstanding(inv), payable = ['sent', 'partially_paid', 'disputed'].includes(inv.status) && out > 0;
  const sandbox = pays.some((p: any) => p.sandbox);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(inv.number ?? 'DRAFT')}</title><style>${STYLE}</style></head><body>${PRINT_HELP}<main>
<div class="top"><div><h1>Invoice</h1><div class="muted">${esc(inv.number ?? 'Draft, not yet issued')}</div>${inv.number && inv.status !== 'sent' ? `<div class="badge">${esc(inv.status.replace(/_/g, ' '))}</div>` : ''}</div>
<div style="text-align:right"><strong>${esc(s.issuer.name)}</strong><br>${[s.issuer.address, s.issuer.phone, s.issuer.email].filter(Boolean).map(esc).join('<br>')}${s.issuer.tin ? `<br>TIN: ${esc(s.issuer.tin)}` : ''}</div></div>
${sandbox ? '<div class="sandbox">SANDBOX: test payments appear on this invoice. No real money moved.</div>' : ''}
<h2>Billed to</h2><div><strong>${esc(acct?.billing_name ?? c.business)}</strong><br>${[acct?.address, c.email, c.phone, acct?.tax_id ? `TIN: ${acct.tax_id}` : ''].filter(Boolean).map(esc).join('<br>')}</div>
<table class="metadata" role="presentation"><tr><td class="muted">Issued</td><td>${esc(date(inv.issue_date))}</td><td class="muted">Due</td><td>${esc(date(inv.due_date))}</td><td class="muted">Currency</td><td>GHS</td></tr></table>
<h2>Items</h2><table aria-label="Invoice items"><thead><tr><th scope="col">Description</th><th scope="col" class="r">Qty</th><th scope="col" class="r">Unit price</th><th scope="col" class="r">Discount</th><th scope="col" class="r">Amount</th></tr></thead><tbody>
${lines.map((l: any) => `<tr><td>${esc(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${cedi(l.unit_price)}</td><td class="r">${l.discount ? cedi(l.discount) : ''}</td><td class="r">${cedi(l.line_total)}</td></tr>`).join('')}</tbody></table>
<table class="totals"><tr><td>Subtotal</td><td class="r">${cedi(inv.subtotal)}</td></tr>${inv.discount_total ? `<tr><td>Discounts</td><td class="r">-${cedi(inv.discount_total)}</td></tr>` : ''}${inv.tax_total ? `<tr><td>Tax (${(inv.tax_bps / 100).toFixed(2)}%)</td><td class="r">${cedi(inv.tax_total)}</td></tr>` : ''}
<tr class="total"><td>Total</td><td class="r">${cedi(inv.total)}</td></tr>${inv.amount_paid ? `<tr><td>Paid</td><td class="r">-${cedi(inv.amount_paid - inv.amount_refunded)}</td></tr>` : ''}${inv.amount_credited ? `<tr><td>Credited</td><td class="r">-${cedi(inv.amount_credited)}</td></tr>` : ''}<tr class="total"><td>Balance due</td><td class="r">${cedi(Math.max(0, out))}</td></tr></table>
${pays.length ? `<h2>Payments received</h2><table><tbody>${pays.map((p: any) => `<tr><td>${esc(date(p.received_at))}</td><td>${esc(p.receipt_number)}</td><td>${esc(p.method)}</td><td class="r">${cedi(p.amount - p.refunded)}</td></tr>`).join('')}</tbody></table>` : ''}
${payable ? `<h2>How to pay</h2><p>${esc(s.issuer.paymentInstructions)}</p><p>Secure payment link: ${esc(payUrl(b, invoiceId))}</p>` : ''}
${inv.notes ? `<h2>Notes</h2><p class="notes">${esc(inv.notes)}</p>` : ''}</main></body></html>`;
  return { html, number: inv.number ?? 'draft' };
}

export async function receiptHtml(b: Billing, q: Query, paymentId: string): Promise<{ html: string; number: string }> {
  const [p] = await q(`SELECT * FROM billing_payments WHERE id = $1`, [paymentId]);
  if (!p) fail(404, 'NOT_FOUND', 'Receipt not found');
  const s = await loadSettings(q), c = await billingContact(q, p.tenant_id);
  const allocs = await q(`SELECT i.number, a.amount FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = $1 ORDER BY i.number`, [paymentId]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(p.receipt_number)}</title><style>${STYLE}</style></head><body>${PRINT_HELP}<main>
<div class="top"><div><h1>Receipt</h1><div class="muted">${esc(p.receipt_number)}</div></div><div style="text-align:right"><strong>${esc(s.issuer.name)}</strong><br>${[s.issuer.address, s.issuer.phone, s.issuer.email].filter(Boolean).map(esc).join('<br>')}${s.issuer.tin ? `<br>TIN: ${esc(s.issuer.tin)}` : ''}</div></div>
${p.sandbox ? '<div class="sandbox">SANDBOX: a test payment. No real money moved.</div>' : ''}
<h2>Received from</h2><div><strong>${esc(c.business)}</strong></div>
<table class="metadata" role="presentation"><tr><td class="muted">Date</td><td>${esc(date(p.received_at))}</td><td class="muted">Method</td><td>${esc(p.method)}</td><td class="muted">Reference</td><td>${esc(p.reference ?? '')}</td></tr></table>
<h2>Applied to</h2><table aria-label="Receipt allocations"><thead><tr><th scope="col">Invoice</th><th scope="col" class="r">Amount applied</th></tr></thead><tbody>${allocs.map((a: any) => `<tr><td>Invoice ${esc(a.number)}</td><td class="r">${cedi(a.amount)}</td></tr>`).join('') || '<tr><td class="muted">Not yet applied to an invoice</td><td></td></tr>'}</tbody></table>
<table class="totals"><tr class="total"><td>Amount received</td><td class="r">${cedi(p.amount)}</td></tr>${p.amount_refunded ? `<tr><td>Refunded</td><td class="r">-${cedi(p.amount_refunded)}</td></tr>` : ''}</table>
<p class="muted" style="margin-top:24px">Thank you.</p></main></body></html>`;
  return { html, number: p.receipt_number };
}
