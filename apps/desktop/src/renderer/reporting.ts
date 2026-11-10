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
