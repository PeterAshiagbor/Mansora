/**
 * A very small PDF writer for tables of text (landscape A4, Helvetica). Used for the practice Mobile Money
 * statement, which MTN and Telecel send as PDF, so the import can be tried exactly as a shop will use it.
 */
const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');

export function tablePdf(title: string, rows: string[][], minWidths: number[] = []): Buffer {
  const pageW = 842, pageH = 595, margin = 24, lineH = 14;
  // Each column is as wide as its longest text, and the font shrinks until the whole table fits the page width.
  const longest = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  let size = 7;
  const widthsAt = (sz: number) => longest.map((n, i) => Math.max(minWidths[i] ?? 0, n * sz * 0.72 + 10));
  while (size > 4 && widthsAt(size).reduce((a, b) => a + b, 0) > pageW - margin * 2) size -= 0.25;
  const widths = widthsAt(size);
  const perPage = Math.floor((pageH - margin * 2 - 40) / lineH);
  const header = rows[0], body = rows.slice(1);
  const pages: string[] = [];
  for (let start = 0; start < Math.max(body.length, 1); start += perPage) {
    const ops: string[] = ['BT', `/F1 11 Tf ${margin} ${pageH - margin - 10} Td (${esc(title)}) Tj`, 'ET'];
    const line = (cells: string[], y: number, bold: boolean) => {
      let x = margin;
      cells.forEach((c, i) => { ops.push('BT', `/${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(c)}) Tj`, 'ET'); x += widths[i] ?? 50; });
    };
    let y = pageH - margin - 36;
    line(header, y, true);
    for (const r of body.slice(start, start + perPage)) { y -= lineH; line(r, y, false); }
    ops.push('BT', `/F1 7 Tf ${margin} ${margin} Td (Page ${pages.length + 1}) Tj`, 'ET');
    pages.push(ops.join('\n'));
  }
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add(''), pagesId = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const content of pages) {
    const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
