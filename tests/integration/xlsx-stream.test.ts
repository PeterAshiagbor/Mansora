/** R16-09: the streaming spreadsheet writer must produce the same workbook content as before. */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { toXlsx } from '../../apps/desktop/src/core/importer';

describe('toXlsx (streaming)', () => {
  it('keeps every sheet, cell value and the bold header row, and writes an empty sheet', async () => {
    const sheets = [
      { name: 'Return summary', rows: [['Tax', 'Output', 'Note'], ['vat', 15.5, '-5.00'], ['nhil', -2.5, '=SUM(A1)'], ['getfund', 0, ''], ['blank cell', null, 'end']] },
      { name: 'Sales: Nov/2026 [draft]?', rows: Array.from({ length: 2000 }, (_, i) => [`R-${i}`, i / 100, i % 2 === 0]) },
      { name: 'Empty', rows: [] as unknown[][] },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toXlsx(sheets) as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Return summary', 'Sales  Nov 2026  draft  ', 'Empty']);
    const values = (w: ExcelJS.Worksheet) => { const out: unknown[][] = []; w.eachRow({ includeEmpty: true }, (r) => out.push((r.values as unknown[]).slice(1))); return out; };
    expect(values(wb.worksheets[0])).toEqual([['Tax', 'Output', 'Note'], ['vat', 15.5, '-5.00'], ['nhil', -2.5, '=SUM(A1)'], ['getfund', 0], ['blank cell', undefined, 'end']]); // an empty string is written as a blank cell; Excel and readTable show both as empty
    expect(wb.worksheets[0].getRow(1).font?.bold).toBe(true);
    expect(wb.worksheets[0].getCell('C3').type).toBe(ExcelJS.ValueType.String); // text that looks like a formula stays text
    expect(values(wb.worksheets[1])).toHaveLength(2000);
    expect(values(wb.worksheets[1])[1999]).toEqual(['R-1999', 19.99, false]);
  });
});
