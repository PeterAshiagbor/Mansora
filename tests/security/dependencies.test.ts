import { createRequire } from 'node:module';
import { join } from 'node:path';
import { statSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readTable, toXlsx } from '../../apps/desktop/src/core/importer';
import { tempDir } from '../helpers';

const require = createRequire(import.meta.url);

describe('patched dependency compatibility', () => {
  it('round-trips spreadsheets and writes conditional formatting that uses uuid', async () => {
    const content = await toXlsx([{ name: 'Products', rows: [['Name', 'Price'], ['Rice', 80]] }]);
    expect(await readTable('products.xlsx', content)).toEqual([['Name', 'Price'], ['Rice', '80']]);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');
    sheet.addRow([20]);
    sheet.addConditionalFormatting({ ref: 'A1:A1', rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }] }] });
    const saved = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(saved);
    expect(loaded.worksheets[0].getCell('A1').value).toBe(20);
  });
  it('keeps desktop packaging inclusion and exclusion rules working', () => {
    const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
    const dir = tempDir('mansora-packaging-');
    const include = join(dir, 'main.cjs');
    const exclude = join(dir, 'main.test.cjs');
    writeFileSync(include, ''); writeFileSync(exclude, '');
    const filter = new FileMatcher(dir, dir, (pattern: string) => pattern, ['**/*.cjs', '!**/*.test.cjs']).createFilter();
    expect(filter(include, statSync(include))).toBe(true);
    expect(filter(exclude, statSync(exclude))).toBe(false);
    const universalRequire = createRequire(require.resolve('@electron/universal'));
    const { minimatch } = universalRequire('minimatch');
    expect(minimatch('app/helper.node', '**/*.node', { matchBase: true })).toBe(true);
    expect(minimatch('app/main.js', '**/*.node', { matchBase: true })).toBe(false);
  });
});
