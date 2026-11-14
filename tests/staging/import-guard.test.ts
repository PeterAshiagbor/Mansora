import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toXlsx } from '../../apps/desktop/src/core/importer';
import { guardSpreadsheet, SpreadsheetGuardError } from '../../scripts/staging/import-guard';

function zipEntry(data: Buffer, declared = data.length, flags = 0, name = 'xl/worksheets/sheet1.xml') {
  const file = Buffer.from(name), packed = deflateRawSync(data), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(flags, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(file.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(flags, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(declared, 24); central.writeUInt16LE(file.length, 28);
  const start = local.length + file.length + packed.length; end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(start, 16);
  return Buffer.concat([local, file, packed, central, file, end]);
}
const input = (zip: Buffer) => ({ fileName: 'products.xlsx', contentBase64: zip.toString('base64') });
describe('shared browser spreadsheet resource boundary', () => {
  it('accepts actual exported Excel files, including repeated strings and styles', async () => {
    const bytes = await toXlsx([{ name: 'Products', rows: [['Name', 'Cost price', 'Selling price'], ...Array.from({ length: 100 }, (_, i) => ['Product ' + i, '10', '12'])] }]);
    expect(() => guardSpreadsheet(input(bytes))).not.toThrow();
  });
  it('leaves CSV and ordinary input validation to the unchanged engine', () => {
    expect(() => guardSpreadsheet({ fileName: 'products.csv', contentBase64: 'TmFtZQo=' })).not.toThrow(); expect(() => guardSpreadsheet(null)).not.toThrow();
  });
  it('rejects an inflated workbook even when ZIP metadata understates its size', () => {
    try { guardSpreadsheet(input(zipEntry(Buffer.alloc(8192, 65), 1)), 1024); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(SpreadsheetGuardError); expect((error as SpreadsheetGuardError).status).toBe(413); }
  });
  it('checks a workbook whose name has spaces around it, because the engine trims the name', () => {
    expect(() => guardSpreadsheet({ ...input(zipEntry(Buffer.alloc(8192, 65), 1)), fileName: 'products.xlsx  ' }, 1024)).toThrow('expands beyond');
  });
  it('rejects claimed oversized files before opening them and detects false lengths', () => {
    expect(() => guardSpreadsheet(input(zipEntry(Buffer.from('ok'), 2048)), 1024)).toThrow('expands beyond');
    expect(() => guardSpreadsheet(input(zipEntry(Buffer.from('different length'), 1)))).toThrow('safely opened');
  });
  it('refuses encrypted, traversal and truncated archives without logging their contents', () => {
    for (const bytes of [zipEntry(Buffer.from('sample'), 6, 1), zipEntry(Buffer.from('sample'), 6, 0, '../private.xml'), Buffer.from('PK\x03\x04')]) expect(() => guardSpreadsheet(input(bytes))).toThrow('safely opened');
  });
  it('refuses multi-disk and ZIP64 directory sizes', () => {
    const disk = zipEntry(Buffer.from('sample')); disk.writeUInt16LE(1, disk.length - 18); expect(() => guardSpreadsheet(input(disk))).toThrow('safely opened');
    const zip64 = zipEntry(Buffer.from('sample')); zip64.writeUInt32LE(0xffffffff, zip64.length - 10); expect(() => guardSpreadsheet(input(zip64))).toThrow('safely opened');
  });
});
