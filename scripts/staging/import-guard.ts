import { inflateRawSync } from 'node:zlib';

export class SpreadsheetGuardError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const invalid = () => new SpreadsheetGuardError(400, 'UNSAFE_SPREADSHEET', 'This spreadsheet could not be safely opened. Save a fresh .xlsx or CSV file and try again.');
const oversized = () => new SpreadsheetGuardError(413, 'SPREADSHEET_TOO_LARGE', 'This spreadsheet expands beyond the 32 MB browser import limit. Split it into smaller files or use CSV.');

/** Bound ZIP expansion before ExcelJS loads an entire workbook into the shared process. */
export function guardSpreadsheet(input: unknown, maxExpandedBytes = 32 * 1024 * 1024): void {
  const payload = input as { fileName?: unknown; contentBase64?: unknown } | null;
  if (!payload || typeof payload.fileName !== 'string' || !/\.xlsx$/i.test(payload.fileName.trim()) /* the engine trims the name before choosing the reader */ || typeof payload.contentBase64 !== 'string') return;
  // Match the engine's existing compressed-file limit before allocating a decoded buffer.
  if (payload.contentBase64.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw oversized();
  const zip = Buffer.from(payload.contentBase64, 'base64');
  if (zip.length > 10 * 1024 * 1024) throw oversized();
  try {
    let end = -1;
    for (let at = zip.length - 22; at >= Math.max(0, zip.length - 65557); at--) {
      if (zip.readUInt32LE(at) === 0x06054b50 && at + 22 + zip.readUInt16LE(at + 20) === zip.length) { end = at; break; }
    }
    if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw invalid();
    const count = zip.readUInt16LE(end + 10), directorySize = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16);
    if (!count || count > 2048 || count !== zip.readUInt16LE(end + 8) || start === 0xffffffff || directorySize === 0xffffffff || start + directorySize > end) throw invalid();
    let cursor = start, total = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > start + directorySize || zip.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
      const flags = zip.readUInt16LE(cursor + 8), method = zip.readUInt16LE(cursor + 10), compressed = zip.readUInt32LE(cursor + 20), expanded = zip.readUInt32LE(cursor + 24);
      const nameLength = zip.readUInt16LE(cursor + 28), extraLength = zip.readUInt16LE(cursor + 30), commentLength = zip.readUInt16LE(cursor + 32), local = zip.readUInt32LE(cursor + 42);
      if (flags & 0x41 || ![0, 8].includes(method) || zip.readUInt16LE(cursor + 34) || compressed === 0xffffffff || local === 0xffffffff || cursor + 46 + nameLength + extraLength + commentLength > start + directorySize) throw invalid();
      if (expanded > maxExpandedBytes || total + expanded > maxExpandedBytes) throw oversized();
      const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) throw invalid();
      if (local + 30 > start || zip.readUInt32LE(local) !== 0x04034b50 || zip.readUInt16LE(local + 8) !== method || zip.readUInt16LE(local + 6) !== flags) throw invalid();
      const localNameLength = zip.readUInt16LE(local + 26), dataStart = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
      if (dataStart + compressed > start || localNameLength !== nameLength || !zip.subarray(local + 30, local + 30 + localNameLength).equals(zip.subarray(cursor + 46, cursor + 46 + nameLength))) throw invalid();
      const bytes = zip.subarray(dataStart, dataStart + compressed);
      let actual: number;
      try { actual = method === 0 ? bytes.length : inflateRawSync(bytes, { maxOutputLength: Math.max(1, maxExpandedBytes - total) }).length; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw oversized(); throw invalid(); }
      if (actual !== expanded) throw invalid();
      total += actual; cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== start + directorySize) throw invalid();
  } catch (error) { if (error instanceof SpreadsheetGuardError) throw error; throw invalid(); }
}
