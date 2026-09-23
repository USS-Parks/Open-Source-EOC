import { escapeText } from "@openeoc/shared";

/**
 * A small tabular PDF writer: PDF 1.4, landscape US Letter, text only, in the
 * standard Helvetica fonts with WinAnsi encoding, so nothing is embedded.
 * Every page repeats the title, the subtitle lines and the column headings.
 * Cells wrap within their column; group headings and totals span the page.
 */

export type PdfLine =
  | { readonly kind: "row"; readonly cells: readonly string[] }
  | { readonly kind: "group" | "total"; readonly level: number; readonly text: string };

export interface PdfTable {
  readonly title: string;
  readonly subtitle: readonly string[];
  readonly headers: readonly string[];
  readonly lines: readonly PdfLine[];
}

const WIDTH = 792;
const HEIGHT = 612;
const MARGIN = 36;
const USABLE = WIDTH - 2 * MARGIN;
const SIZE = 8;
const LEADING = 10;
/** Space kept clear at the right of each column. */
const GAP = 6;
const MAX_CELL_LINES = 6;
/** Lowest body baseline; the footer sits below it. */
const BODY_BOTTOM = MARGIN + 12;

// Helvetica advance widths in thousandths of the font size, for ASCII 32 to 126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    units += code >= 32 && code <= 126 ? HELVETICA[code - 32]! : 556;
  }
  // ponytail: bold measured as 8% wider than regular; use the Helvetica-Bold table if headings ever clip.
  return (units * size * (bold ? 1.08 : 1)) / 1000;
}

/** Lines no wider than `width`, splitting words that do not fit; at most `max`, the last marked when cut. */
function wrap(text: string, width: number, size: number, bold: boolean, max: number): string[] {
  const fits = (s: string) => textWidth(s, size, bold) <= width;
  const lines: string[] = [];
  // Only the first few hundred characters can reach the page.
  for (const paragraph of text.slice(0, 600).split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const joined = line ? `${line} ${word}` : word;
      if (fits(joined)) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (!fits(rest)) {
        let cut = Math.max(1, rest.length - 1);
        while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1]!.slice(0, -3)}...`;
  return kept;
}

/** Column widths from the headings and a sample of rows, shrunk together to fit the page. */
function columnWidths(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): number[] {
  const natural = headers.map((header, i) => {
    let width = textWidth(header, SIZE, true);
    // ponytail: sizes from the first 200 rows; a later, longer value wraps.
    for (const row of rows.slice(0, 200)) width = Math.max(width, textWidth(row[i] ?? "", SIZE, false));
    return Math.min(Math.max(width + GAP, 40), 280);
  });
  const total = natural.reduce((a, b) => a + b, 0);
  return total > USABLE ? natural.map((w) => (w * USABLE) / total) : natural;
}

interface Text { readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly bold: boolean }

const num = (n: number) => (Math.round(n * 100) / 100).toString();

export function tablePdf(table: PdfTable): Uint8Array {
  const rows = table.lines.flatMap((line) => (line.kind === "row" ? [line.cells] : []));
  const widths = columnWidths(table.headers, rows);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

  // The heading block every page repeats.
  const head: Text[] = [];
  let y = HEIGHT - MARGIN - 10;
  for (const text of wrap(table.title, USABLE, 12, true, 2)) {
    head.push({ x: MARGIN, y, text, size: 12, bold: true });
    y -= 15;
  }
  for (const line of table.subtitle) {
    for (const text of wrap(line, USABLE, SIZE, false, 3)) {
      head.push({ x: MARGIN, y, text, size: SIZE, bold: false });
      y -= LEADING;
    }
  }
  y -= 6;
  const headings = table.headers.map((header, i) => wrap(header, widths[i]! - GAP, SIZE, true, 3));
  headings.forEach((lines, i) => lines.forEach((text, k) =>
    head.push({ x: xs[i]!, y: y - k * LEADING, text, size: SIZE, bold: true })));
  y -= (Math.max(1, ...headings.map((lines) => lines.length)) - 1) * LEADING;
  const rule = y - 4;
  const bodyTop = rule - LEADING - 1;

  const pages: Text[][] = [[]];
  let at = bodyTop;
  const room = (depth: number) => {
    if (at - (depth - 1) * LEADING >= BODY_BOTTOM) return;
    pages.push([]);
    at = bodyTop;
  };
  for (const line of table.lines) {
    const page = () => pages.at(-1)!;
    if (line.kind === "row") {
      const cells = table.headers.map((_, i) => wrap(line.cells[i] ?? "", widths[i]! - GAP, SIZE, false, MAX_CELL_LINES));
      const depth = Math.max(1, ...cells.map((c) => c.length));
      room(depth);
      cells.forEach((lines, i) => lines.forEach((text, k) =>
        page().push({ x: xs[i]!, y: at - k * LEADING, text, size: SIZE, bold: false })));
      at -= depth * LEADING;
      continue;
    }
    const indent = Math.max(0, line.level - 1) * 12;
    const texts = wrap(line.text, USABLE - indent, SIZE, true, 4);
    if (at !== bodyTop) at -= line.kind === "group" ? 4 : 1;
    room(texts.length);
    texts.forEach((text, k) => page().push({ x: MARGIN + indent, y: at - k * LEADING, text, size: SIZE, bold: true }));
    at -= texts.length * LEADING + (line.kind === "total" ? 3 : 0);
  }

  const streams = pages.map((texts, index) => [
    "q 0.5 w 0.6 G",
    `${MARGIN} ${num(rule)} m ${WIDTH - MARGIN} ${num(rule)} l S`,
    `${MARGIN} ${MARGIN} m ${WIDTH - MARGIN} ${MARGIN} l S`,
    "Q",
    ...[...head, ...texts].map((t) =>
      `BT /${t.bold ? "F2" : "F1"} ${t.size} Tf ${num(t.x)} ${num(t.y)} Td (${escapeText(t.text)}) Tj ET`),
    `BT /F1 7 Tf ${MARGIN} ${MARGIN - 12} Td (Open Source EOC) Tj ET`,
    `BT /F1 7 Tf ${WIDTH - MARGIN - 60} ${MARGIN - 12} Td (Page ${index + 1} of ${pages.length}) Tj ET`,
  ].join("\n"));
  return assemble(streams);
}

/** Objects 1 to 4 are the catalog, the page tree and the two fonts; each page adds a page and its content. */
function assemble(streams: readonly string[]): Uint8Array {
  const kids = streams.map((_, i) => 5 + i * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(" ")}] /Count ${kids.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ...streams.flatMap((stream, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${kids[i]! + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ]),
  ];
  // Every character is one byte (escapeText keeps to WinAnsi), so string offsets are byte offsets.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (ch) => ch.charCodeAt(0) & 0xff);
}
