import { escapeText } from "@openeoc/shared";

/**
 * A small tabular PDF writer: PDF 1.4, landscape US Letter, in the standard
 * Helvetica fonts with WinAnsi encoding, so nothing is embedded. Every page
 * repeats the title and the subtitle lines. A chart, when there is one, is
 * drawn in vector paths on the pages before the table. Every table page
 * repeats the column headings; cells wrap within their column, and group
 * headings and totals span the page.
 */

export type PdfLine =
  | { readonly kind: "row"; readonly cells: readonly string[] }
  | { readonly kind: "group" | "total"; readonly level: number; readonly text: string };

/** Counts per group, drawn as horizontal bars or a donut with a legend. */
export interface PdfChart {
  readonly title: string;
  readonly display: "bar" | "donut";
  readonly groups: ReadonlyArray<{ readonly value: string; readonly count: number }>;
}

export interface PdfTable {
  readonly title: string;
  readonly subtitle: readonly string[];
  readonly headers: readonly string[];
  readonly lines: readonly PdfLine[];
  readonly chart?: PdfChart;
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
  // Chart pages repeat the title and subtitle, without the column headings.
  const titleBlock = [...head];
  const charts = table.chart ? chartPages(table.chart, y - 4) : [];
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

  const all: Page[] = [...charts, ...pages.map((texts) => ({ texts, paths: [], table: true }))];
  const streams = all.map((page, index) => [
    "q 0.5 w 0.6 G",
    ...(page.table ? [`${MARGIN} ${num(rule)} m ${WIDTH - MARGIN} ${num(rule)} l S`] : []),
    `${MARGIN} ${MARGIN} m ${WIDTH - MARGIN} ${MARGIN} l S`,
    "Q",
    ...page.paths,
    ...[...(page.table ? head : titleBlock), ...page.texts].map((t) =>
      `BT /${t.bold ? "F2" : "F1"} ${t.size} Tf ${num(t.x)} ${num(t.y)} Td (${escapeText(t.text)}) Tj ET`),
    `BT /F1 7 Tf ${MARGIN} ${MARGIN - 12} Td (Open Source EOC) Tj ET`,
    `BT /F1 7 Tf ${WIDTH - MARGIN - 60} ${MARGIN - 12} Td (Page ${index + 1} of ${all.length}) Tj ET`,
  ].join("\n"));
  return assemble(streams);
}

interface Page { readonly texts: Text[]; readonly paths: string[]; readonly table: boolean }

// The dashboard chart colors: the light theme's status info, warning, success, critical and unknown.
const PALETTE = ["#1d4ed8", "#92400e", "#166534", "#b91c1c", "#4b5563"].map((hex) =>
  [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(" "));
const LABEL_WIDTH = 200;
const BAR_X = MARGIN + LABEL_WIDTH + 10;
const BAR_WIDTH = USABLE - LABEL_WIDTH - 10 - 50;
const BAR_ROW = 13;

/** A filled rectangle in one palette color, the color scoped so the text after it stays black. */
const box = (color: string, x: number, y: number, w: number, h: number) =>
  `q ${color} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f Q`;

/** Cubic curves along a circle from one angle to another, in degrees counterclockwise from east. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string[] {
  const parts = Math.max(1, Math.ceil(Math.abs(to - from) / 90));
  const step = ((to - from) / parts) * (Math.PI / 180);
  const k = (4 / 3) * Math.tan(step / 4);
  return Array.from({ length: parts }, (_, i) => {
    const a = from * (Math.PI / 180) + i * step;
    const b = a + step;
    const [x1, y1, x2, y2] = [cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)];
    return `${num(x1 - k * r * Math.sin(a))} ${num(y1 + k * r * Math.cos(a))} ` +
      `${num(x2 + k * r * Math.sin(b))} ${num(y2 - k * r * Math.cos(b))} ${num(x2)} ${num(y2)} c`;
  });
}

/** One donut slice between two angles: out along the outer edge, back along the inner. */
function slice(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
  const at = (r: number, angle: number) =>
    `${num(cx + r * Math.cos(angle * (Math.PI / 180)))} ${num(cy + r * Math.sin(angle * (Math.PI / 180)))}`;
  return [`${at(outer, from)} m`, ...arc(cx, cy, outer, from, to), `${at(inner, to)} l`, ...arc(cx, cy, inner, to, from), "h f"].join(" ");
}

/**
 * The chart below `top`: a bar per group with its count, continued on further
 * pages when the groups outrun one, or a donut from twelve o'clock clockwise
 * with the total in its center and a legend of counts and shares.
 */
function chartPages(chart: PdfChart, top: number): Page[] {
  const total = chart.groups.reduce((sum, group) => sum + group.count, 0);
  const heading = (continued: boolean): Text[] => [
    { x: MARGIN, y: top, text: `${chart.title}${continued ? " (continued)" : ""}`, size: 10, bold: true },
    { x: MARGIN, y: top - 12, text: `${total} record${total === 1 ? "" : "s"}`, size: SIZE, bold: false },
  ];
  const first = top - 32;
  if (chart.groups.length === 0 || total === 0) {
    return [{ texts: [...heading(false), { x: MARGIN, y: first, text: "No records to chart.", size: SIZE, bold: false }], paths: [], table: false }];
  }
  if (chart.display === "bar") {
    const max = Math.max(...chart.groups.map((group) => group.count));
    const pages: Page[] = [{ texts: heading(false), paths: [], table: false }];
    let y = first;
    for (const group of chart.groups) {
      if (y < BODY_BOTTOM) {
        pages.push({ texts: heading(true), paths: [], table: false });
        y = first;
      }
      const page = pages.at(-1)!;
      const width = (group.count / max) * BAR_WIDTH;
      page.texts.push({ x: MARGIN, y, text: wrap(group.value, LABEL_WIDTH, SIZE, false, 1)[0]!, size: SIZE, bold: false });
      if (width > 0) page.paths.push(box(PALETTE[0]!, BAR_X, y - 1, width, 8));
      page.texts.push({ x: BAR_X + width + 4, y, text: String(group.count), size: SIZE, bold: false });
      y -= BAR_ROW;
    }
    return pages;
  }
  const outer = Math.min(110, (first - BODY_BOTTOM) / 2);
  const [cx, cy] = [MARGIN + outer + 20, first - outer];
  const page: Page = { texts: heading(false), paths: [], table: false };
  let angle = 90;
  const legendX = cx + outer + 40;
  chart.groups.forEach((group, i) => {
    const color = PALETTE[i % PALETTE.length]!;
    const sweep = (group.count / total) * 360;
    if (sweep > 0) page.paths.push(`q ${color} rg ${slice(cx, cy, outer, outer * 0.55, angle, angle - sweep)} Q`);
    angle -= sweep;
    const y = first - i * 16;
    page.paths.push(box(color, legendX, y - 1, 8, 8));
    const text = `${group.value}: ${group.count} (${Math.round((group.count / total) * 100)}%)`;
    page.texts.push({ x: legendX + 14, y, text: wrap(text, WIDTH - MARGIN - legendX - 14, SIZE, false, 1)[0]!, size: SIZE, bold: false });
  });
  const center = String(total);
  page.texts.push({ x: cx - textWidth(center, 14, true) / 2, y: cy - 5, text: center, size: 14, bold: true });
  return [page];
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
