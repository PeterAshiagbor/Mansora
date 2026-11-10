import type { Query } from '../db';
import { billingContact, loadSettings, outstanding, payUrl, type Billing } from './core';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cedi = (n: number) => `GH₵${(n / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string | null) => (iso ? String(iso).slice(0, 10) : '');

const STYLE = `*{box-sizing:border-box}body{font:14px/1.5 'Segoe UI',Arial,sans-serif;color:#14211f;max-width:780px;margin:24px auto;padding:0 20px}h1{font-size:26px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#1f5f5b;margin:22px 0 6px}
table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid #d3dfdc;text-align:left}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#4a5f5c}td.r,th.r{text-align:right}
.top{display:flex;justify-content:space-between;gap:24px}.muted{color:#4a5f5c}.total td{font-weight:700;font-size:16px;border-bottom:0}.badge{display:inline-block;padding:2px 10px;border-radius:99px;background:#e0f0ed;font-weight:600}
.sandbox{background:#fff0d6;color:#8a5200;padding:8px 12px;border-radius:6px;margin:12px 0;font-weight:600}@media print{body{margin:0}}`;

/** A printable invoice. Contains no script and no external resources, so it prints or saves to PDF anywhere. */
export async function invoiceHtml(b: Billing, q: Query, invoiceId: string): Promise<{ html: string; number: string }> {
  const [inv] = await q(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  const s = await loadSettings(q), c = await billingContact(q, inv.tenant_id);
  const [acct] = await q(`SELECT * FROM billing_accounts WHERE tenant_id = $1`, [inv.tenant_id]);
  const lines = await q(`SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY position`, [invoiceId]);
  const pays = await q(`SELECT p.receipt_number, p.received_at, p.method, p.sandbox, a.amount, a.refunded FROM payment_allocations a JOIN billing_payments p ON p.id = a.payment_id WHERE a.invoice_id = $1 ORDER BY p.received_at`, [invoiceId]);
  const out = outstanding(inv), payable = ['sent', 'partially_paid', 'disputed'].includes(inv.status) && out > 0;
  const sandbox = pays.some((p: any) => p.sandbox);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(inv.number ?? 'DRAFT')}</title><style>${STYLE}</style></head><body>
<div class="top"><div><h1>Invoice</h1><div class="muted">${esc(inv.number ?? 'Draft, not yet issued')}</div>${inv.status !== 'sent' ? `<div class="badge">${esc(inv.status.replace(/_/g, ' '))}</div>` : ''}</div>
<div style="text-align:right"><strong>${esc(s.issuer.name)}</strong><br>${[s.issuer.address, s.issuer.phone, s.issuer.email].filter(Boolean).map(esc).join('<br>')}${s.issuer.tin ? `<br>TIN: ${esc(s.issuer.tin)}` : ''}</div></div>
${sandbox ? '<div class="sandbox">SANDBOX: test payments appear on this invoice. No real money moved.</div>' : ''}
<h2>Billed to</h2><div><strong>${esc(acct?.billing_name ?? c.business)}</strong><br>${[acct?.address, c.email, c.phone, acct?.tax_id ? `TIN: ${acct.tax_id}` : ''].filter(Boolean).map(esc).join('<br>')}</div>
<table style="margin-top:14px"><tr><td class="muted">Issued</td><td>${esc(date(inv.issue_date))}</td><td class="muted">Due</td><td>${esc(date(inv.due_date))}</td><td class="muted">Currency</td><td>GHS</td></tr></table>
<h2>Items</h2><table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Discount</th><th class="r">Amount</th></tr></thead><tbody>
${lines.map((l: any) => `<tr><td>${esc(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${cedi(l.unit_price)}</td><td class="r">${l.discount ? cedi(l.discount) : ''}</td><td class="r">${cedi(l.line_total)}</td></tr>`).join('')}</tbody></table>
<table style="margin-top:10px;max-width:340px;margin-left:auto"><tr><td>Subtotal</td><td class="r">${cedi(inv.subtotal)}</td></tr>${inv.discount_total ? `<tr><td>Discounts</td><td class="r">-${cedi(inv.discount_total)}</td></tr>` : ''}${inv.tax_total ? `<tr><td>Tax (${(inv.tax_bps / 100).toFixed(2)}%)</td><td class="r">${cedi(inv.tax_total)}</td></tr>` : ''}
<tr class="total"><td>Total</td><td class="r">${cedi(inv.total)}</td></tr>${inv.amount_paid ? `<tr><td>Paid</td><td class="r">-${cedi(inv.amount_paid - inv.amount_refunded)}</td></tr>` : ''}${inv.amount_credited ? `<tr><td>Credited</td><td class="r">-${cedi(inv.amount_credited)}</td></tr>` : ''}<tr class="total"><td>Balance due</td><td class="r">${cedi(Math.max(0, out))}</td></tr></table>
${pays.length ? `<h2>Payments received</h2><table><tbody>${pays.map((p: any) => `<tr><td>${esc(date(p.received_at))}</td><td>${esc(p.receipt_number)}</td><td>${esc(p.method)}</td><td class="r">${cedi(p.amount - p.refunded)}</td></tr>`).join('')}</tbody></table>` : ''}
${payable ? `<h2>How to pay</h2><p>${esc(s.issuer.paymentInstructions)}</p><p>Secure payment link: ${esc(payUrl(b, invoiceId))}</p>` : ''}
${inv.notes ? `<h2>Notes</h2><p>${esc(inv.notes)}</p>` : ''}</body></html>`;
  return { html, number: inv.number ?? 'draft' };
}

export async function receiptHtml(b: Billing, q: Query, paymentId: string): Promise<{ html: string; number: string }> {
  const [p] = await q(`SELECT * FROM billing_payments WHERE id = $1`, [paymentId]);
  const s = await loadSettings(q), c = await billingContact(q, p.tenant_id);
  const allocs = await q(`SELECT i.number, a.amount FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = $1 ORDER BY i.number`, [paymentId]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(p.receipt_number)}</title><style>${STYLE}</style></head><body>
<div class="top"><div><h1>Receipt</h1><div class="muted">${esc(p.receipt_number)}</div></div><div style="text-align:right"><strong>${esc(s.issuer.name)}</strong><br>${[s.issuer.address, s.issuer.phone, s.issuer.email].filter(Boolean).map(esc).join('<br>')}</div></div>
${p.sandbox ? '<div class="sandbox">SANDBOX: a test payment. No real money moved.</div>' : ''}
<h2>Received from</h2><div><strong>${esc(c.business)}</strong></div>
<table style="margin-top:14px"><tr><td class="muted">Date</td><td>${esc(date(p.received_at))}</td><td class="muted">Method</td><td>${esc(p.method)}</td><td class="muted">Reference</td><td>${esc(p.reference ?? '')}</td></tr></table>
<h2>Applied to</h2><table><tbody>${allocs.map((a: any) => `<tr><td>Invoice ${esc(a.number)}</td><td class="r">${cedi(a.amount)}</td></tr>`).join('') || '<tr><td class="muted">Not yet applied to an invoice</td><td></td></tr>'}</tbody></table>
<table style="margin-top:10px;max-width:340px;margin-left:auto"><tr class="total"><td>Amount received</td><td class="r">${cedi(p.amount)}</td></tr>${p.amount_refunded ? `<tr><td>Refunded</td><td class="r">-${cedi(p.amount_refunded)}</td></tr>` : ''}</table>
<p class="muted" style="margin-top:24px">Thank you.</p></body></html>`;
  return { html, number: p.receipt_number };
}
