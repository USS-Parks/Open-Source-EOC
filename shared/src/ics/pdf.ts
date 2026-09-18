/**
 * A minimal, dependency-free PDF writer (VEOC-34). It renders a title and
 * a list of text lines into a valid, uncompressed PDF using the standard
 * Helvetica font, paginating as needed. Output is deterministic (no dates,
 * no ordering surprises), so PDF export is snapshot-testable and nothing is
 * vendored to produce it.
 */

const PAGE_HEIGHT = 792; // US Letter, points
const TOP = 760;
const LEFT = 50;
const LEADING = 13;
const FONT_SIZE = 10;
const LINES_PER_PAGE = Math.floor((TOP - 60) / LEADING);

function escapeText(s: string): string {
  // Keep to WinAnsi-safe ASCII; escape the PDF string delimiters.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7e]/g, "?");
}

function paginate(lines: readonly string[]): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE) as string[]);
  }
  return pages.length > 0 ? pages : [[]];
}

function contentStream(lines: readonly string[]): string {
  const body = lines
    .map((l, i) => (i === 0 ? `(${escapeText(l)}) Tj` : `T* (${escapeText(l)}) Tj`))
    .join("\n");
  return `BT /F1 ${FONT_SIZE} Tf ${LEADING} TL ${LEFT} ${TOP} Td\n${body}\nET`;
}

/** Render a title and text lines into a deterministic PDF byte array. */
export function renderPdf(title: string, lines: readonly string[]): Uint8Array {
  const allLines = [title, "", ...lines];
  const pages = paginate(allLines);

  const objects: string[] = [];
  // 1 = Catalog, 2 = Pages, 3 = Font, then page/content pairs.
  const pageObjNums: number[] = [];
  let nextObj = 4;
  const pageChunks: string[] = [];
  for (const pageLines of pages) {
    const pageNum = nextObj;
    const contentNum = nextObj + 1;
    nextObj += 2;
    pageObjNums.push(pageNum);
    const stream = contentStream(pageLines);
    pageChunks.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );
    pageChunks.push(
      `${contentNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] ` +
      `/Count ${pageObjNums.length} >>\nendobj\n`,
  );
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  for (const chunk of pageChunks) objects.push(chunk);

  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  const count = objects.length + 1; // + the free object 0
  pdf += `xref\n0 ${count}\n`;
  pdf += `0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
