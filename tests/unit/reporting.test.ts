import { describe, expect, it } from 'vitest';
import { collectionSummary, reportPresets, tableReportHtml } from '../../apps/desktop/src/renderer/reporting';

describe('display report definitions', () => {
  it('prints every loaded row across pages and escapes business, heading, column and cell content', () => {
    const html = tableReportHtml({ title: 'Products <test>', businessName: 'A & B', columns: ['Name <item>', 'Amount'], rows: Array.from({ length: 61 }, (_, i) => [i === 60 ? '<script>unsafe</script>' : `Item ${i}`, i]), generatedAt: '2026-11-10T00:00:00Z' });
    expect(html).toContain('61 loaded record(s)');
    expect(html.match(/<tr>/g)).toHaveLength(62);
    expect(html).toContain('A &amp; B'); expect(html).toContain('Products &lt;test&gt;'); expect(html).toContain('Name &lt;item&gt;');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;'); expect(html).not.toContain('<script>');
  });
  it('excludes new credit from collections and includes repayments less actual refund payouts', () => {
    expect(collectionSummary({ sales: [{ method: 'cash', total: 10000 }, { method: 'momo', total: 4500 }, { method: 'credit', total: 8000 }], repayments: [{ total: 3000 }], refundPayouts: [{ total: 2500 }] })).toEqual({ saleCollections: 14500, newCredit: 8000, repayments: 3000, refundsPaid: 2500, netCollections: 15000 });
  });
  it('preserves negative collections when refunds exceed receipts', () => {
    expect(collectionSummary({ sales: [], repayments: [], refundPayouts: [{ total: 900 }] }).netCollections).toBe(-900);
  });
  it('handles an empty reporting period without treating credit as received money', () => {
    expect(collectionSummary({ sales: [], repayments: [], refundPayouts: [] }).netCollections).toBe(0);
    expect(collectionSummary({ sales: [{ method: 'credit', total: 1000 }], repayments: [], refundPayouts: [] }).netCollections).toBe(0);
  });
  it('uses Monday week boundaries and handles the previous year', () => {
    const presets = reportPresets('2026-01-01');
    expect(presets.find((p) => p.label === 'This week')).toEqual({ label: 'This week', from: '2025-12-29', to: '2026-01-01' });
    expect(presets.find((p) => p.label === 'Last month')).toEqual({ label: 'Last month', from: '2025-12-01', to: '2025-12-31' });
  });
  it('includes leap day in the last-month preset', () => {
    expect(reportPresets('2024-03-14').find((p) => p.label === 'Last month')).toEqual({ label: 'Last month', from: '2024-02-01', to: '2024-02-29' });
  });
});
