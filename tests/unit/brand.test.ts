import { describe, expect, it, vi } from 'vitest';
import { BRAND, brandEmailHtml, brandPage } from '../../apps/api/src/brand';
import { ResendEmail } from '../../apps/api/src/email';

const invoiceText = [
  'Hello Ama,', 'Your Mansora invoice is ready. You can pay it online by card or Mobile Money.',
  'Invoice: INV-2026-000003\nBusiness: Mansora TSB\nAmount due: GHS 100.00\nDue date: 2026-11-14',
  'Pay securely here: https://app.example.test/api/pay/abc.def', 'Thank you,\nMansora Consulting and Business Solutions',
].join('\n\n');

describe('Mansora-branded emails and payment pages', () => {
  it('turns a plain-text invoice email into branded HTML with a details table and a pay button', () => {
    const html = brandEmailHtml('Invoice INV-2026-000003 from Mansora', invoiceText, { logoUrl: 'https://app.example.test/api/brand/mansora-logo.png' });
    expect(html).toContain(BRAND.purple900); expect(html).toContain(BRAND.gold); expect(html).toContain(BRAND.cream);
    expect(html).toContain('MANSORA'); expect(html).toContain('src="https://app.example.test/api/brand/mansora-logo.png"');
    expect(html).toMatch(/<td[^>]*>Amount due<\/td><td[^>]*>GHS 100\.00<\/td>/);
    expect(html).toMatch(/<a href="https:\/\/app\.example\.test\/api\/pay\/abc\.def"[^>]*>Pay securely<\/a>/);
    expect(html).toContain('Hello Ama,');
  });

  it('escapes content, keeps other links clickable and works without a logo', () => {
    const html = brandEmailHtml('Hi <b>', 'Note: <script>x</script> see https://example.test/a?b=1');
    expect(html).not.toContain('<script>x'); expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://example.test/a?b=1"');
    expect(html).not.toContain('<img');
    expect(html).toContain('Hi &lt;b&gt;');
  });

  it('sends every email with the branded HTML part as well as the original text', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    const email = new ResendEmail({ apiKey: 're_test', from: 'Mansora <billing@example.test>', fetch: fetch as any, logoUrl: 'https://app.example.test/api/brand/mansora-logo.png' });
    await email.send({ to: 'client@example.test', subject: 'Invoice INV-1', body: invoiceText });
    const sent = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(sent.text).toBe(invoiceText);
    expect(sent.html).toContain('Pay securely');
    expect(sent.html).toContain(BRAND.purple900);
  });

  it('gives payment pages the logo, brand colours and font, with a clear test-mode notice', () => {
    const html = brandPage('Pay invoice', '<h1>Invoice INV-1</h1>', { base: 'https://app.example.test/api', notice: 'Paystack test mode: no real money moves.' });
    expect(html).toContain('https://app.example.test/api/brand/mansora-logo.png');
    expect(html).toContain('https://app.example.test/api/brand/dm-sans-latin.woff2');
    expect(html).toContain(BRAND.purple700); expect(html).toContain('Paystack test mode');
    expect(html).toContain(BRAND.company.replace('&', '&amp;'));
  });
});
