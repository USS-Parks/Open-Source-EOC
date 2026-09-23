import { aarToTextLines, type AarDocument } from "../aar/aar.js";
import { iapToTextLines, type IapDocument } from "./forms.js";

/** Metadata must come from the stored export record. Handling is omitted unless the record marks it. */
export interface PdfExportMetadata {
  readonly incident?: string | undefined;
  readonly operationalPeriod?: string | undefined;
  readonly source?: string | undefined;
  readonly sourceTime?: string | undefined;
  readonly revision?: string | undefined;
  readonly handling?: string | undefined;
}

type LineStyle = "title" | "metadata" | "heading" | "body";
interface PhysicalLine { readonly text: string; readonly style: LineStyle }

const PAGE_HEIGHT = 792; // US Letter, points
const BODY_TOP = 694;
const BODY_BOTTOM = 58;
const LEFT = 50;
const LEADING = 13;
const FONT_SIZE = 10;
const LINES_PER_PAGE = Math.floor((BODY_TOP - BODY_BOTTOM) / LEADING);
const PHYSICAL_LINE_LIMIT = 50;

const WIN_ANSI_SPECIAL = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** Text as a PDF string body in WinAnsi, for the standard Helvetica fonts. */
export function escapeText(s: string): string {
  // Standard Helvetica with WinAnsi faithfully covers Western accented names
  // and common punctuation. Characters outside WinAnsi become "?" rather than
  // claiming arbitrary Unicode support without an embedded licensed font.
  const encoded = [...s].map((character) => {
    const codePoint = character.codePointAt(0)!;
    if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff))
      return String.fromCharCode(codePoint);
    const byte = WIN_ANSI_SPECIAL.get(codePoint);
    return byte === undefined ? "?" : String.fromCharCode(byte);
  }).join("");
  return encoded
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function paginate(lines: readonly PhysicalLine[]): PhysicalLine[][] {
  const pages: PhysicalLine[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE) as PhysicalLine[]);
  }
  return pages.length > 0 ? pages : [[]];
}

function fontFor(style: LineStyle): string {
  return style === "title" || style === "heading" ? "/F2" : "/F1";
}

function contentStream(
  lines: readonly PhysicalLine[],
  pageNumber: number,
  pageCount: number,
  metadata: PdfExportMetadata,
): string {
  const body = lines.map((line, index) => {
    const move = index === 0 ? "" : "T* ";
    const size = line.style === "title" ? 12 : line.style === "metadata" ? 9 : FONT_SIZE;
    return `${move}${fontFor(line.style)} ${size} Tf (${escapeText(line.text)}) Tj`;
  }).join("\n");
  const handling = metadata.handling
    ? `BT /F2 8 Tf 414 758 Td (Handling: ${escapeText(metadata.handling)}) Tj ET\n`
    : "";
  return [
    "q 0 G 0 g 1 w",
    "73 762 m 73 766.971 68.971 771 64 771 c 59.029 771 55 766.971 55 762 c 55 757.029 59.029 753 64 753 c 68.971 753 73 757.029 73 762 c S",
    "64 749 m 64 756 l 64 768 m 64 775 l 51 762 m 58 762 l 70 762 m 77 762 l S",
    "66.5 762 m 66.5 763.381 65.381 764.5 64 764.5 c 62.619 764.5 61.5 763.381 61.5 762 c 61.5 760.619 62.619 759.5 64 759.5 c 65.381 759.5 66.5 760.619 66.5 762 c S",
    "BT /F2 13 Tf 82 758 Td (Open Source EOC) Tj ET",
    handling.trimEnd(),
    "0.65 G 50 742 m 562 742 l S 0 G",
    `BT ${LEADING} TL ${LEFT} ${BODY_TOP} Td ${body} ET`,
    "0.65 G 50 44 m 562 44 l S 0 G",
    `BT /F1 8 Tf 50 30 Td (Open Source EOC) Tj ET`,
    `BT /F1 8 Tf 500 30 Td (Page ${pageNumber} of ${pageCount}) Tj ET`,
    "Q",
  ].filter(Boolean).join("\n");
}

function renderPhysicalLines(allLines: readonly PhysicalLine[], metadata: PdfExportMetadata): Uint8Array {
  const pages = paginate(allLines);

  const objects: string[] = [];
  // 1 = Catalog, 2 = Pages, 3/4 = standard fonts, then page/content pairs.
  const pageObjNums: number[] = [];
  let nextObj = 5;
  const pageChunks: string[] = [];
  for (const [index, pageLines] of pages.entries()) {
    const pageNum = nextObj;
    const contentNum = nextObj + 1;
    nextObj += 2;
    pageObjNums.push(pageNum);
    const stream = contentStream(pageLines, index + 1, pages.length, metadata);
    pageChunks.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
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
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
  objects.push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);
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

function wrapExportLine(line: string): string[] {
  const wrapped: string[] = [];
  let remaining = line;

  while (remaining.length > PHYSICAL_LINE_LIMIT) {
    let breakAt = remaining.lastIndexOf(" ", PHYSICAL_LINE_LIMIT);
    if (breakAt <= 0) breakAt = PHYSICAL_LINE_LIMIT;

    wrapped.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  wrapped.push(remaining);
  return wrapped;
}

function looksLikeHeading(line: string): boolean {
  const text = line.trim();
  return /^(?:\d+\.|ICS-\d{3}\b|INCIDENT ACTION PLAN$|AFTER-ACTION REPORT|Analytics \()/.test(text);
}

function physicalLines(
  title: string,
  lines: readonly string[],
  metadata: PdfExportMetadata,
): PhysicalLine[] {
  const output: PhysicalLine[] = wrapExportLine(title).map((text) => ({ text, style: "title" }));
  output.push({ text: "", style: "body" });
  const metadataLines = [
    metadata.incident ? `Incident: ${metadata.incident}` : undefined,
    metadata.operationalPeriod ? `Operational period: ${metadata.operationalPeriod}` : undefined,
    metadata.source ? `Source: ${metadata.source}` : undefined,
    metadata.sourceTime ? `Source time: ${metadata.sourceTime}` : undefined,
    metadata.revision ? `Revision: ${metadata.revision}` : undefined,
    metadata.handling ? `Handling: ${metadata.handling}` : undefined,
  ].filter((line): line is string => line !== undefined);
  for (const line of metadataLines)
    output.push(...wrapExportLine(line).map((text) => ({ text, style: "metadata" as const })));
  if (metadataLines.length > 0) output.push({ text: "", style: "body" });
  for (const line of lines) {
    const style: LineStyle = looksLikeHeading(line) ? "heading" : "body";
    output.push(...wrapExportLine(line).map((text) => ({ text, style })));
  }
  return output;
}

/** Render a branded, deterministic, grayscale-safe PDF byte array. */
export function renderPdf(
  title: string,
  lines: readonly string[],
  metadata: PdfExportMetadata = {},
): Uint8Array {
  return renderPhysicalLines(physicalLines(title, lines, metadata), metadata);
}

/** Render an immutable composed AAR snapshot with all operational fields. */
export function renderAarPdf(
  document: AarDocument,
  metadata: PdfExportMetadata = {},
): Uint8Array {
  return renderPdf(`AAR: ${document.incidentName}`, aarToTextLines(document), {
    incident: document.incidentName,
    operationalPeriod: document.period,
    source: "Open Source EOC AAR document",
    ...metadata,
  });
}

/** Render the exact stored IAP revision with bounded, multipage physical lines. */
export function renderIapPdf(
  document: IapDocument,
  metadata: PdfExportMetadata = {},
): Uint8Array {
  return renderPdf(`IAP: ${document.incidentName} - ${document.operationalPeriod}`, iapToTextLines(document), {
    incident: document.incidentName,
    operationalPeriod: document.operationalPeriod,
    source: "Open Source EOC IAP document",
    ...metadata,
  });
}
