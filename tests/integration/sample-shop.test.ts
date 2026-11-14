import { describe, expect, it } from 'vitest';
import { makeShop } from '../helpers';

describe('C58 sample shop, template and migration imports', () => {
  it('the downloadable sample shop imports with no errors and every product is created', async () => {
    const s = await makeShop();
    const sample = await s.run(s.owner, 'import.sample', { format: 'xlsx' });
    expect(sample.fileName).toBe('mansora-sample-shop.xlsx');
    const p = await s.run(s.owner, 'import.preview', sample);
    expect(p.needsMapping).toBe(false);
    expect(p.rows.length).toBeGreaterThan(130);
    expect(p.rows.filter((r: any) => r.errors.length)).toEqual([]);
    const done = await s.run(s.owner, 'import.commit', { ...sample, mapping: p.mapping, confirmOpeningStock: true });
    expect(done.created).toBe(p.rows.filter((r: any) => !r.duplicate).length);
    const milo = (await s.run(s.owner, 'product.list', { search: 'Milo 400g' }))[0];
    expect(milo).toMatchObject({ selling_price: 4800, cost_price: 4000, category_name: 'Beverages' });
    expect(milo.barcode).toMatch(/^200\d{10}$/);
  });

  it('the Excel template has a sheet explaining each column', async () => {
    const s = await makeShop();
    const t = await s.run(s.owner, 'import.template', { format: 'xlsx' });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(t.contentBase64, 'base64') as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Products', 'How to fill this in']);
  });

  it('recognises QuickBooks and Xero export columns without manual matching', async () => {
    const s = await makeShop();
    const csv = (text: string, name: string) => ({ fileName: name, contentBase64: Buffer.from(text).toString('base64') });
    const qb = await s.run(s.owner, 'import.preview', csv('Product/Service Name,Sales Description,SKU,Type,Sales Price / Rate,Purchase Cost,Qty On Hand,Reorder Point\nSoap bar,,SOAP-1,Inventory,"1,250.00",900.00,12.00,3\n', 'quickbooks.csv'));
    expect(qb.mapping).toMatchObject({ name: 'Product/Service Name', sku: 'SKU', selling_price: 'Sales Price / Rate', cost_price: 'Purchase Cost', opening_stock: 'Qty On Hand', reorder_level: 'Reorder Point' });
    expect(qb.rows[0]).toMatchObject({ errors: [], data: { sellingPrice: 125000, costPrice: 90000, openingStock: 12 } });
    const xero = await s.run(s.owner, 'import.preview', csv('*ItemCode,ItemName,PurchasesUnitPrice,SalesUnitPrice,QuantityOnHand\nMILO1,Milo tin,GH¢40,48,6\n', 'xero.csv'));
    expect(xero.mapping).toMatchObject({ sku: '*ItemCode', name: 'ItemName', cost_price: 'PurchasesUnitPrice', selling_price: 'SalesUnitPrice', opening_stock: 'QuantityOnHand' });
    expect(xero.rows[0]).toMatchObject({ errors: [], data: { costPrice: 4000, sellingPrice: 4800 } });
  });
});
