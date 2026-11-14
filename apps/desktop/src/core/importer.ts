import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DomainError, fail, parseGHS, unitCostFromCarton } from '@mansora/domain';

export const IMPORT_FIELDS = ['name', 'sku', 'barcode', 'category', 'unit', 'cost_price', 'carton_cost', 'units_per_carton', 'selling_price', 'opening_stock', 'reorder_level'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Partial<Record<ImportField, string>>;

const ALIASES: Record<ImportField, string[]> = {
  // Includes the column names QuickBooks (Products and Services export) and Xero (Inventory items export) use.
  name: ['name', 'product', 'product name', 'item', 'item name', 'description', 'product/service name', 'product/service', 'itemname', 'item description'],
  sku: ['sku', 'code', 'item code', 'product code', '*itemcode', 'itemcode'],
  barcode: ['barcode', 'bar code', 'ean', 'upc'],
  category: ['category', 'group', 'department', 'type of item'],
  unit: ['unit', 'uom', 'unit of measure'],
  cost_price: ['cost price', 'cost', 'cost_price', 'buying price', 'purchase price', 'purchase cost', 'purchasesunitprice', 'purchases unit price', 'unit cost'],
  carton_cost: ['carton cost', 'carton_cost', 'carton purchase cost'],
  units_per_carton: ['units per carton', 'units_per_carton', 'items per carton'],
  selling_price: ['selling price', 'price', 'selling_price', 'retail price', 'sale price', 'sales price / rate', 'sales price', 'rate', 'salesunitprice', 'sales unit price', 'unit price'],
  opening_stock: ['opening stock', 'opening_stock', 'quantity', 'qty', 'stock', 'opening quantity', 'in stock', 'qty on hand', 'quantity on hand', 'quantityonhand'],
  reorder_level: ['reorder level', 'reorder_level', 'reorder', 'low stock', 'reorder threshold', 'minimum stock', 'reorder point'],
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true; // a quote opens a quoted cell only at its start (TV 32" stays literal)
    else if (ch === ',') (row.push(cell), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function toCsv(rows: unknown[][]): string {
  const q = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // Neutralise spreadsheet formula injection in exported text.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export async function toXlsx(sheets: { name: string; rows: unknown[][] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mansora Sales & Stock';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    // ExcelJS stores strings as text, never as formulas, so values such as -5.00 are written exactly as they are.
    s.rows.forEach((r) => ws.addRow(r));
    if (s.rows.length) ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 18));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Read the first sheet of an .xlsx or a .csv into rows of strings. */
export async function readTable(fileName: string, content: Buffer): Promise<string[][]> {
  if (content.length > 10 * 1024 * 1024) fail('FILE_TOO_LARGE', 'The file is larger than 10 MB');
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(content as any);
    } catch {
      fail('INVALID_FILE', 'This Excel file could not be read');
    }
    const ws = wb.worksheets[0];
    if (!ws) fail('INVALID_FILE', 'The workbook has no sheets');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const val: any = r.getCell(c).value;
        cells.push(val == null ? '' : typeof val === 'object' ? String(val.result ?? val.text ?? (val.richText ? val.richText.map((t: any) => t.text).join('') : '')) : String(val));
      }
      rows.push(cells);
    });
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }
  if (/\.csv$/i.test(fileName)) return parseCsv(content.toString('utf8'));
  fail('INVALID_FILE', 'Only .xlsx and .csv files are supported');
}

export function suggestMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  for (const f of IMPORT_FIELDS) {
    const hit = headers.find((h) => ALIASES[f].includes(h.trim().toLowerCase()));
    if (hit) out[f] = hit;
  }
  return out;
}

export interface ImportRow {
  rowNo: number;
  data: { name: string; sku: string | null; barcode: string | null; category: string | null; unit: string; costPrice: number; sellingPrice: number; openingStock: number; reorderLevel: number };
  errors: string[];
  duplicate: string | null;
}

const wholeNumber = (raw: string, label: string, errors: string[]): number => {
  const s = raw.trim().replace(/,/g, '').replace(/\.0+$/, '');
  if (s === '') return 0;
  if (!/^\d+$/.test(s)) return errors.push(`${label} must be a whole number`), 0;
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return errors.push(`${label} is too large`), 0;
  return value;
};
const cedis = (raw: string, label: string, errors: string[], required = false): number => {
  const s = raw.trim();
  if (s === '') return required ? (errors.push(`${label} is required`), 0) : 0;
  try {
    // Excel may hand back binary-float noise such as 12.100000000000001: round at the third decimal, on the text itself.
    const m = /^(\d+)\.(\d{2})(\d)\d*$/.exec(s.replace(/,/g, ''));
    const v = m ? parseGHS(`${m[1]}.${m[2]}`) + (m[3] >= '5' ? 1 : 0) : parseGHS(s);
    if (v < 0) throw new DomainError('INVALID_AMOUNT', 'negative');
    return v;
  } catch {
    return errors.push(`${label} is not a valid amount`), 0;
  }
};

export interface ExistingKeys {
  barcodes: Set<string>;
  skus: Set<string>;
  names: Set<string>;
}

/** Validate rows and flag duplicates (against the catalogue and within the file). */
export function buildPreview(table: string[][], mapping: Mapping, existing: ExistingKeys): ImportRow[] {
  const headers = table[0] ?? [];
  const idx = (f: ImportField) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const col = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, idx(f)])) as Record<ImportField, number>;
  if (col.name < 0) fail('MAPPING_REQUIRED', 'Choose which column holds the product name');
  if (col.selling_price < 0) fail('MAPPING_REQUIRED', 'Choose which column holds the selling price');
  const seen: ExistingKeys = { barcodes: new Set(), skus: new Set(), names: new Set() };
  return table.slice(1).map((cells, i) => {
    const get = (f: ImportField) => (col[f] >= 0 ? (cells[col[f]] ?? '').trim() : '');
    const errors: string[] = [];
    const name = get('name');
    if (!name) errors.push('Product name is required');
    if (name.length > 160) errors.push('Product name is too long');
    const data = {
      name,
      sku: get('sku') || null,
      barcode: get('barcode') || null,
      category: get('category') || null,
      unit: get('unit') || 'each',
      costPrice: cedis(get('cost_price'), 'Cost price', errors),
      sellingPrice: cedis(get('selling_price'), 'Selling price', errors, true),
      openingStock: wholeNumber(get('opening_stock'), 'Opening stock', errors),
      reorderLevel: wholeNumber(get('reorder_level'), 'Reorder level', errors),
    };
    const cartonRaw = get('carton_cost');
    const unitsRaw = get('units_per_carton');
    if (cartonRaw || unitsRaw) {
      const cartonCost = cedis(cartonRaw, 'Carton cost', errors, true);
      const units = wholeNumber(unitsRaw, 'Units per carton', errors);
      if (units <= 0) errors.push('Units per carton must be a positive whole number');
      if (!errors.length) {
        const derived = unitCostFromCarton(cartonCost, units);
        if (get('cost_price') && data.costPrice !== derived) errors.push('Cost price does not match carton cost divided by units per carton');
        else data.costPrice = derived;
      }
    }
    let duplicate: string | null = null;
    const lname = name.toLowerCase();
    if (data.barcode && existing.barcodes.has(data.barcode)) duplicate = 'Barcode already in your products';
    else if (data.sku && existing.skus.has(data.sku.toLowerCase())) duplicate = 'SKU already in your products';
    else if (existing.names.has(lname)) duplicate = 'Product name already in your products';
    else if (data.barcode && seen.barcodes.has(data.barcode)) duplicate = 'Barcode repeated in this file';
    else if (data.sku && seen.skus.has(data.sku.toLowerCase())) duplicate = 'SKU repeated in this file';
    else if (seen.names.has(lname)) duplicate = 'Product name repeated in this file';
    if (!duplicate && !errors.length) {
      if (data.barcode) seen.barcodes.add(data.barcode);
      if (data.sku) seen.skus.add(data.sku.toLowerCase());
      seen.names.add(lname);
    }
    return { rowNo: i + 2, data, errors, duplicate };
  });
}

export function fileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export const TEMPLATE_ROWS: unknown[][] = [
  ['Name', 'SKU', 'Barcode', 'Category', 'Unit', 'Cost price', 'Selling price', 'Opening stock', 'Reorder level', 'Carton cost', 'Units per carton'],
  ['Example: Milo 400g tin', 'MILO-400', '6001068000012', 'Beverages', 'each', '', '45.00', '24', '6', '924.00', '24'],
];
