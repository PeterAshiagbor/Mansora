import { fail } from '@mansora/domain';

/**
 * Read a statement table out of a PDF (owner approval 2026-11-14: MTN MoMo and Telecel Cash send statements as PDF).
 *
 * A PDF has no rows or columns, only words placed on a page. The words are grouped into lines by their height on
 * the page; the line with the most recognised column names is the header, and each header word marks where a
 * column starts. Every later line is split into those columns. A line whose date column holds a date starts a new
 * row; a line without one (a name or description that wrapped) is added to the row above. Repeated headers on later
 * pages and page footers are skipped. Scanned (photographed) statements have no words and cannot be read.
 */
interface Word { text: string; x: number; end: number; y: number; page: number }

export async function readPdfTable(content: Buffer, o: { isHeader: (cell: string) => boolean; isDate: (cell: string) => boolean }): Promise<string[][]> {
  if (content.length > 10 * 1024 * 1024) fail('FILE_TOO_LARGE', 'The file is larger than 10 MB');
  let words: Word[] = [];
  try {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(content));
    if (pdf.numPages > 200) fail('FILE_TOO_LARGE', 'The statement has more than 200 pages. Download a shorter period.');
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const text = await page.getTextContent();
      for (const item of text.items as any[]) {
        const s = String(item.str ?? '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        const x = item.transform[4], y = item.transform[5];
        words.push({ text: s, x, end: x + (item.width ?? s.length * 4), y, page: p });
      }
    }
    await (pdf as any).destroy?.();
  } catch (e: any) {
    if (e?.code) throw e;
    fail('INVALID_FILE', 'This PDF could not be read. If it is password-protected, open it and save a copy without the password.');
  }
  if (!words.length) fail('INVALID_FILE', 'This PDF has no readable text: it may be a scan or photo. Download the statement again from the app or by email.');

  // Lines: same page, nearly the same height. Top of the page first, words left to right.
  words = words.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Word[][] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last[0].page === w.page && Math.abs(last[0].y - w.y) <= 2.5) last.push(w); else lines.push([w]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  // Words written in pieces ("TRANS." "TYPE") become one cell when the gap between them is small.
  const cells = (l: Word[], gap = 3) => l.reduce<Word[]>((out, w) => {
    const prev = out[out.length - 1];
    if (prev && w.x - prev.end <= gap) { prev.text += ' ' + w.text; prev.end = Math.max(prev.end, w.end); } else out.push({ ...w });
    return out;
  }, []);

  let headerAt = -1, best = 0;
  lines.forEach((l, i) => { const n = cells(l).filter((c) => o.isHeader(c.text)).length; if (n > best) { best = n; headerAt = i; } });
  if (headerAt < 0 || best < 2) fail('INVALID_FILE', 'No table of transactions was found in this PDF. Download the statement as Excel or CSV if your bank offers it.');
  const header = cells(lines[headerAt]);
  const headerKey = header.map((h) => h.text.toLowerCase()).join('|');
  const starts = header.map((h) => h.x);
  const column = (w: Word) => {
    // The column whose header starts at or just left of this word (a little slack for right-aligned amounts).
    let i = 0;
    for (let c = 0; c < starts.length; c++) if (w.x >= starts[c] - 4) i = c;
    return i;
  };
  const dateCol = header.findIndex((h) => /date/i.test(h.text));
  const rows: string[][] = [header.map((h) => h.text)];
  let current: string[] | null = null, currentPage = 0, lastY = 0;
  for (const l of lines.slice(headerAt + 1)) {
    if (cells(l).map((c) => c.text.toLowerCase()).join('|') === headerKey) { current = null; continue; } // header repeated on a new page
    // Each word goes to its own column first, so neighbouring cells printed close together never run into one.
    const values: string[] = Array(header.length).fill('');
    for (const w of l) { const i = column(w); values[i] = values[i] ? `${values[i]} ${w.text}` : w.text; }
    const startsRow = dateCol >= 0 ? o.isDate(values[dateCol]) : values.slice(0, 2).some(o.isDate);
    if (startsRow) { current = values; rows.push(current); currentPage = l[0].page; lastY = l[0].y; continue; }
    // A wrapped line belongs to the row just above it on the same page; anything else (totals, footers) is ignored.
    if (current && l[0].page === currentPage && lastY - l[0].y < 20) {
      values.forEach((v, i) => { if (v) current![i] = current![i] ? `${current![i]} ${v}` : v; });
      lastY = l[0].y;
    } else current = null;
  }
  if (rows.length < 2) fail('INVALID_FILE', 'No transactions were found in this PDF.');
  return rows;
}
