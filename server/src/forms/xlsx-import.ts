import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { importXlsForm, type FormDefinition, type SheetRow, type XlsFormSheets } from "@openeoc/shared";

/**
 * Real .xlsx import. An .xlsx is a zip of XML parts; this reads only the
 * three parts an XLSForm needs (the workbook index, its relationships, the
 * shared string table) plus the survey, choices and settings worksheets, and
 * hands normalized string rows to the pure isomorphic importer. Keeping the
 * binary reader here leaves the shared package free of Node dependencies.
 *
 * The buffer arrives from an operator upload, so every bound below is a trust
 * boundary, not a performance tuning knob: a zip can claim any uncompressed
 * size and any entry count, and a worksheet can claim any cell reference.
 */

/** Entry count, single-part size, and total inflated size accepted from one upload. */
const MAX_ENTRIES = 512;
const MAX_PART_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Worksheet shape accepted; XLSForm sheets are far smaller than either. */
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 512;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ["sheet", "Relationship", "si", "row", "c", "r"].includes(name),
});

type Parts = Readonly<Record<string, Uint8Array>>;

function decode(parts: Parts, name: string): string | undefined {
  const bytes = parts[name];
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

function parseXml(text: string): Record<string, unknown> {
  return parser.parse(text) as Record<string, unknown>;
}

function asArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as T];
}

/**
 * Concatenated text of a shared-string item: a plain <t>, or the runs of a
 * rich-text string, whose pieces must join in document order.
 */
function sharedStringText(item: unknown): string {
  if (item === null || typeof item !== "object") return String(item ?? "");
  const node = item as Record<string, unknown>;
  if (typeof node.t === "string") return node.t;
  if (node.t && typeof node.t === "object") {
    const inner = (node.t as Record<string, unknown>)["#text"];
    if (typeof inner === "string") return inner;
  }
  const runs = asArray(node.r as Record<string, unknown> | Record<string, unknown>[] | undefined);
  if (runs.length > 0) return runs.map((run) => sharedStringText(run)).join("");
  const text = node["#text"];
  return typeof text === "string" ? text : "";
}

function sharedStrings(parts: Parts): readonly string[] {
  const text = decode(parts, "xl/sharedStrings.xml");
  if (!text) return [];
  const doc = parseXml(text);
  const sst = doc.sst as Record<string, unknown> | undefined;
  return asArray(sst?.si as unknown[] | undefined).map((item) => sharedStringText(item));
}

/** Zero-based column index from the letters of a cell reference such as "AB12". */
function columnIndex(reference: string): number {
  let index = 0;
  for (const character of reference) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** The single cell value as text, resolving shared and inline string forms. */
function cellText(cell: Record<string, unknown>, strings: readonly string[]): string {
  const type = cell["@t"];
  if (type === "inlineStr") {
    return sharedStringText(cell.is);
  }
  const raw = cell.v;
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["#text"] : raw;
  if (value === undefined || value === null) return "";
  if (type === "s") {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= strings.length) return "";
    return strings[index] ?? "";
  }
  return String(value);
}

/**
 * Worksheet rows keyed by the first row's header text, matching the previous
 * reader: every cell is read as a trimmed string and empty cells are dropped.
 */
function worksheetRows(text: string, strings: readonly string[]): SheetRow[] {
  const doc = parseXml(text);
  const worksheet = doc.worksheet as Record<string, unknown> | undefined;
  const sheetData = worksheet?.sheetData as Record<string, unknown> | undefined;
  const rows = asArray(sheetData?.row as Record<string, unknown>[] | undefined);
  if (rows.length > MAX_ROWS) throw new Error("XLSForm worksheet exceeds the accepted row count");

  let headers: string[] = [];
  const result: SheetRow[] = [];
  for (const [rowNumber, row] of rows.entries()) {
    const cells = asArray(row.c as Record<string, unknown>[] | undefined);
    if (cells.length > MAX_COLUMNS) {
      throw new Error("XLSForm worksheet exceeds the accepted column count");
    }
    const values: string[] = [];
    for (const cell of cells) {
      const reference = cell["@r"];
      const index = typeof reference === "string" ? columnIndex(reference) : values.length;
      if (index < 0 || index >= MAX_COLUMNS) continue;
      values[index] = cellText(cell, strings).trim();
    }
    if (rowNumber === 0) {
      headers = values.map((value) => (value ?? "").trim());
      continue;
    }
    const record: Record<string, string> = {};
    for (const [index, header] of headers.entries()) {
      if (!header) continue;
      const value = values[index];
      if (value !== undefined && value !== "") record[header] = value;
    }
    result.push(record);
  }
  return result;
}

/** Worksheet part path for each XLSForm sheet name present in the workbook. */
function worksheetPaths(parts: Parts): ReadonlyMap<string, string> {
  const workbook = decode(parts, "xl/workbook.xml");
  const rels = decode(parts, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return new Map();

  const targets = new Map<string, string>();
  const relationships = asArray(
    (parseXml(rels).Relationships as Record<string, unknown> | undefined)?.Relationship as
      Record<string, unknown>[] | undefined,
  );
  for (const relationship of relationships) {
    const id = relationship["@Id"];
    const target = relationship["@Target"];
    if (typeof id !== "string" || typeof target !== "string") continue;
    // Targets are relative to xl/ and may be written with or without a leading
    // slash or "/xl" prefix; normalize to the part name the zip actually holds.
    const clean = target.replace(/^\/?(xl\/)?/u, "");
    targets.set(id, `xl/${clean}`);
  }

  const sheets = asArray(
    ((parseXml(workbook).workbook as Record<string, unknown> | undefined)?.sheets as
      Record<string, unknown> | undefined)?.sheet as Record<string, unknown>[] | undefined,
  );
  const paths = new Map<string, string>();
  for (const sheet of sheets) {
    const name = sheet["@name"];
    const id = sheet["@r:id"] ?? sheet["@id"];
    if (typeof name !== "string" || typeof id !== "string") continue;
    const path = targets.get(id);
    if (path) paths.set(name, path);
  }
  return paths;
}

export function readXlsFormWorkbook(buffer: Buffer): XlsFormSheets {
  let entries = 0;
  let inflated = 0;
  let parts: Parts;
  try {
    parts = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        if (++entries > MAX_ENTRIES) throw new Error("XLSForm workbook has too many parts");
        if (file.originalSize > MAX_PART_BYTES) {
          throw new Error("XLSForm workbook part exceeds the accepted size");
        }
        inflated += file.originalSize;
        if (inflated > MAX_TOTAL_BYTES) {
          throw new Error("XLSForm workbook exceeds the accepted total size");
        }
        // Only the parts below are ever inflated; everything else in the
        // container, including any embedded media or macro part, is skipped.
        return file.name === "xl/workbook.xml"
          || file.name === "xl/_rels/workbook.xml.rels"
          || file.name === "xl/sharedStrings.xml"
          || file.name.startsWith("xl/worksheets/");
      },
    });
  } catch (error) {
    throw new Error(`not a readable .xlsx workbook: ${(error as Error).message}`, { cause: error });
  }

  const paths = worksheetPaths(parts);
  const strings = sharedStrings(parts);
  const read = (name: string): SheetRow[] => {
    const path = paths.get(name);
    const text = path ? decode(parts, path) : undefined;
    return text ? worksheetRows(text, strings) : [];
  };
  const settingsRows = read("settings");
  return { survey: read("survey"), choices: read("choices"), settings: settingsRows[0] };
}

export function importXlsFormWorkbook(
  buffer: Buffer,
  meta: { key: string; version?: number; title?: string; boardTemplate?: string },
): FormDefinition {
  return importXlsForm(readXlsFormWorkbook(buffer), meta);
}
