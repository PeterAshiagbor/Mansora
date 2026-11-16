/** Audit F18: Mansora's own invoices carry VAT, NHIL and GETFund separately once Mansora is VAT registered. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceInvoice } from '../../apps/api/src/billing/invoices';
import { startCloud, type Cloud } from '../cloud';
import { admin, at, GHS, mkClient } from './helpers';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

describe('Mansora invoice VAT', () => {
  it('prices GHS 1,000 taxable at 150 VAT, 25 NHIL, 25 GETFund', () => {
    expect(priceInvoice([{ description: 'Plan', quantity: 1, unitPrice: 100_000 }], 0, 0, true)).toMatchObject({ taxTotal: 20_000, total: 120_000, taxBps: 2000, breakdown: { vat: 15_000, nhil: 2500, getfund: 2500 } });
    // After a GHS 100 discount the taxable value is 900: 135 / 22.50 / 22.50.
    expect(priceInvoice([{ description: 'Plan', quantity: 1, unitPrice: 100_000 }], 10_000, 0, true).breakdown).toEqual({ vat: 13_500, nhil: 2250, getfund: 2250 });
  });

  it('applies to new invoices only when the registration is switched on, and prints each levy', async () => {
    at(cloud, '2026-11-10');
    const client = await mkClient(cloud, 'VAT Invoice Shop');
    const post = async () => (await admin(cloud).post('/invoices', { tenantId: client.id, lines: [{ description: 'Subscription', quantity: 1, unitPrice: GHS(500), serviceCode: 'software' }], dueDate: '2026-11-20', issue: true })).body.id as string;
    const before = await post();
    const settings = (await admin(cloud).get('/settings')).body;
    const put = await admin(cloud).put('/settings', { ...settings, issuer: { ...settings.issuer, vatRegistered: true, vatNumber: 'V-MANSORA' } });
    expect(put.status).toBe(200);
    const after = await post();
    expect((await admin(cloud).get(`/invoices/${before}`)).body.total).toBe(GHS(500));
    expect((await admin(cloud).get(`/invoices/${after}`)).body).toMatchObject({ total: GHS(600), tax_total: GHS(100) });
    const doc = (await admin(cloud).get(`/invoices/${after}/document`)).body.html as string;
    for (const text of ['VAT (15%)', 'GH₵75.00', 'NHIL (2.5%)', 'GH₵12.50', 'GETFund (2.5%)', 'V-MANSORA']) expect(doc).toContain(text);
    await admin(cloud).put('/settings', settings);
  });
});
