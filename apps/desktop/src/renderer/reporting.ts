/** Display-only summaries of authorised report responses. All amounts remain integer pesewas. */
export function collectionSummary(payments: { sales: { method: string; total: number }[]; repayments: { total: number }[]; refundPayouts: { total: number }[] }) {
  const saleCollections = payments.sales.filter((r) => r.method !== 'credit').reduce((total, r) => total + r.total, 0);
  const newCredit = payments.sales.filter((r) => r.method === 'credit').reduce((total, r) => total + r.total, 0);
  const repayments = payments.repayments.reduce((total, r) => total + r.total, 0);
  const refundsPaid = payments.refundPayouts.reduce((total, r) => total + r.total, 0);
  return { saleCollections, newCredit, repayments, refundsPaid, netCollections: saleCollections + repayments - refundsPaid };
}
export function reportPresets(day: string) {
  const date = new Date(day + 'T00:00:00Z');
  const week = new Date(date); week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
  const previousStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  const previousEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [{ label: 'Today', from: day, to: day }, { label: 'This week', from: iso(week), to: day }, { label: 'This month', from: day.slice(0, 8) + '01', to: day }, { label: 'Last month', from: iso(previousStart), to: iso(previousEnd) }];
}

/** Print the complete authorised view, not just its current table page. Escape every dynamic value. */
export function tableReportHtml({ title, businessName, columns, rows, generatedAt = new Date().toISOString() }: { title: string; businessName: string; columns: string[]; rows: (string | number | null)[][]; generatedAt?: string }) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>@page{size:A4 landscape;margin:15mm}body{font:11px/1.5 Arial,sans-serif;color:#25324b}h1{font-size:21px;margin:4px 0}header{border-bottom:2px solid #5c2d85;padding-bottom:14px;margin-bottom:18px}header p{margin:4px 0;color:#526078}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #dbe1e9;overflow-wrap:anywhere}th{background:#f3f0f8}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:18px;color:#526078;font-size:10px}</style></head><body><header><strong>${escape(businessName)}</strong><h1>${escape(title)}</h1><p>Prepared from authorised business records · ${escape(generatedAt)} (UTC)</p><p>${rows.length} loaded record(s) · export includes all loaded rows, across table pages.</p></header><table><thead><tr>${columns.map((column) => `<th scope="col">${escape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((_, i) => `<td>${escape(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table><footer>Mansora Sales &amp; Stock · ${escape(businessName)} · Refer to the report heading and column labels for date scope and units. This export is not a statutory financial statement.</footer></body></html>`;
}
