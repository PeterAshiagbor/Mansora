import { describe, expect, it } from 'vitest';
import { readPdfTable } from '../../apps/desktop/src/core/pdf-table';
import { tablePdf } from '../../apps/desktop/src/core/pdf-write';
import { isStatementHeader, parseStatementDate, readStatementRows, suggestStatementMapping } from '../../apps/desktop/src/core/statements';

const opts = { isHeader: isStatementHeader, isDate: (c: string) => !!parseStatementDate(c) };
const header = ['TRANSACTION DATE', 'FROM NAME', 'TRANS. TYPE', 'AMOUNT', 'FEES', 'E-LEVY', 'BAL BEFORE', 'BAL AFTER', 'TO NAME', 'F_ID', 'REF'];
const widths = [80, 80, 60, 50, 40, 40, 55, 55, 90, 70, 60];

describe('reading Mobile Money statements from PDF (owner approval 2026-11-14)', () => {
  it('rebuilds the table from an MTN-style PDF, across pages, and reads it like the Excel version', async () => {
    const body: string[][] = [];
    for (let i = 0; i < 45; i++) body.push([`2026-11-${String(1 + (i % 28)).padStart(2, '0')} 09:1${i % 10}:00`, i % 2 ? 'AMA MENSAH' : 'MY SHOP', 'TRANSFER', `${10 + i}.00`, '0.00', '0.00', `${1000 + i}.00`, i % 2 ? `${1010 + 2 * i}.00` : `${990}.00`, i % 2 ? 'MY SHOP' : 'ECG PREPAID', `6100000${String(i).padStart(4, '0')}`, ''])
    const pdf = tablePdf('MTN Mobile Money statement', [header, ...body], widths);
    const table = await readPdfTable(pdf, opts);
    expect(table[0]).toEqual(header);
    expect(table).toHaveLength(46); // the header once, then every line, though the PDF has several pages
    expect(table[1]).toEqual(body[0]);
    expect(table[45]).toEqual(body[44]);
    const rows = readStatementRows(table, suggestStatementMapping(table[0]));
    expect(rows.filter((r) => r.errors.length)).toEqual([]);
    expect(rows[0]).toMatchObject({ date: '2026-11-01', amountIn: 0, amountOut: 1000, reference: '61000000000' });
    expect(rows[1]).toMatchObject({ date: '2026-11-02', amountIn: 1100, amountOut: 0 });
  });

  it('joins a description that wrapped onto a second line to its row', async () => {
    const rows = [['Date', 'Description', 'Debit', 'Credit'], ['14/11/2026', 'Transfer to Kofi', '500.00', ''], ['', 'Wholesale Ltd', '', ''], ['15/11/2026', 'Deposit', '', '20.00']];
    const table = await readPdfTable(tablePdf('Bank statement', rows, [80, 160, 60, 60]), opts);
    expect(table.slice(1)).toEqual([['14/11/2026', 'Transfer to Kofi Wholesale Ltd', '500.00', ''], ['15/11/2026', 'Deposit', '', '20.00']]);
  });

  it('explains a PDF with no transaction table, and one that is not a PDF', async () => {
    await expect(readPdfTable(tablePdf('Letter', [['Dear customer'], ['Thank you']], [200]), opts)).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(readPdfTable(Buffer.from('not a pdf'), opts)).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});
