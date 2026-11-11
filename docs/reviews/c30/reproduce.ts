/** Local-only review probe. Creates disposable synthetic records; sends no email or provider request. */
import assert from 'node:assert/strict';
import { startCloud } from '../../../tests/cloud';
import { admin, at, mkClient } from '../../../tests/billing/helpers';

const cloud = await startCloud();
const a = admin(cloud);
const ok = (r: { status: number; body: any }) => { assert.equal(r.status, 200); return r.body; };
try {
  at(cloud, '2026-11-10');
  const client = await mkClient(cloud, 'C30 synthetic reporting review');
  const invoice = ok(await a.post('/invoices', {
    tenantId: client.id, lines: [{ description: 'Synthetic service', quantity: 1, unitPrice: 10_000, serviceCode: 'review' }],
    dueDate: '2026-11-20', issue: true,
  }));
  const payment = ok(await a.post(`/invoices/${invoice.id}/payment`, { amount: 10_000, method: 'cash' }));
  at(cloud, '2026-12-10');
  ok(await a.post(`/payments/${payment.paymentId}/refund`, { amount: 2_000, reason: 'Synthetic later-period refund', viaProvider: false }));
  const periods = [];
  for (const [from, to] of [['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31']]) {
    const report = ok(await a.get(`/reports/summary?from=${from}&to=${to}`));
    const clientRefunds = report.byClient.reduce((n: number, r: any) => n + r.refunded, 0);
    const serviceCash = Object.values(report.collectedByService).reduce((n: number, v: any) => n + v, 0);
    periods.push({ from, to, headlineNet: report.period.cash.net, headlineRefunds: report.period.cash.refunds, clientRefunds, serviceCash,
      clientRefundsReconcile: clientRefunds === report.period.cash.refunds, serviceCashReconciles: serviceCash === report.period.cash.net });
  }
  const invalidDate = await a.get('/reports/summary?from=2026-99-01&to=2026-99-30');
  const reversed = await a.get('/reports/summary?from=2026-12-31&to=2026-12-01');
  console.log(JSON.stringify({ units: 'integer pesewas', periods, invalidCalendarDate: { status: invalidDate.status, code: invalidDate.body.code },
    reversedRange: { status: reversed.status, net: reversed.body.period?.cash.net },
    writes: 'disposable local fixture only; no external email or payment calls' }, null, 2));
} finally { await cloud.close(); }
