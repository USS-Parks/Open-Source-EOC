import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { signatureText, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { csvCell } from "../audit/export.js";
import { readFirstWorksheet } from "../forms/xlsx-import.js";
import { writeImportReport } from "../data-packs/import-reports.js";
import { esriToGeoJson, isEsriGeometry, readEsriFeatureSet } from "../geo/esri.js";
import {
  insertRecord,
  listViewRecords,
  validateNewRecord,
  writableBoard,
  type ViewOptions,
} from "./service.js";

/**
 * Board data in and out of spreadsheets. Export writes one view, through the
 * same page reader as the screen, so its filters, field visibility and
 * record rules hold. Import maps a header row onto fields, validates every
 * row exactly as a created record is validated, and commits all rows or none.
 */

export const MAX_EXPORT_ROWS = 50_000;
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Row errors returned from one import; the count is always complete. */
const MAX_REPORTED_ERRORS = 500;

export interface BoardTable {
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<readonly unknown[]>;
}

/** Every page of one view as a table: the record id, then the view's readable columns. */
export async function exportViewTable(
  sql: Sql,
  actor: Principal,
  boardId: string,
  viewKey: string,
  incidentId: string | undefined,
  options: ViewOptions,
): Promise<BoardTable> {
  const rows: unknown[][] = [];
  let headers: string[];
  let cursor: string | undefined;
  do {
    const page = await listViewRecords(sql, actor, boardId, viewKey, incidentId, { ...options, cursor, limit: 500 });
    headers = ["id", ...page.columns];
    for (const record of page.records) rows.push(headers.map((key) => record[key]));
    if (rows.length > MAX_EXPORT_ROWS)
      throw new AuthError(413, `export exceeds ${MAX_EXPORT_ROWS} rows; narrow the view`);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { headers, rows };
}

/** RFC 4180 CSV. Text a spreadsheet would run as a formula gains a leading quote. */
export function tableCsv(table: BoardTable): string {
  const line = (cells: readonly unknown[]) => cells.map((value) =>
    typeof value === "number" || typeof value === "boolean" ? String(value) : csvCell(cellText(value))).join(",");
  return [table.headers, ...table.rows].map(line).join("\r\n") + "\r\n";
}

/**
 * A single-sheet .xlsx: a zip of five XML parts. Numbers and booleans are
 * typed cells; everything else is an inline string, which a spreadsheet never
 * evaluates, so no formula guard is needed.
 */
export function tableXlsx(table: BoardTable): Uint8Array {
  const sheetRows = [table.headers, ...table.rows].map((cells, r) =>
    `<row r="${r + 1}">${cells.map((value, c) => xlsxCell(value, `${columnName(c)}${r + 1}`)).join("")}</row>`).join("");
  const ns = "http://schemas.openxmlformats.org";
  const xml = (body: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`);
  return zipSync({
    "[Content_Types].xml": xml(`<Types xmlns="${ns}/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      + `</Types>`),
    "_rels/.rels": xml(`<Relationships xmlns="${ns}/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`),
    "xl/workbook.xml": xml(`<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships">`
      + `<sheets><sheet name="Records" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<Relationships xmlns="${ns}/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + `</Relationships>`),
    "xl/worksheets/sheet1.xml": xml(`<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return signatureText(value) ?? (typeof value === "object" ? JSON.stringify(value) : String(value));
}

function xlsxCell(value: unknown, ref: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = cellText(value);
  if (!text) return "";
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

/** XML-escaped text without the control characters XML 1.0 cannot carry. */
function xmlText(text: string): string {
  const kept = [...text].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }).join("");
  return kept.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Spreadsheet column letters for a zero-based index: 0 is A, 26 is AA. */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** RFC 4180 records: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = false;
    } else if (ch === '"' && !started) {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      row.push(cell); cell = ""; started = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row);
      row = []; cell = ""; started = false;
    } else {
      cell += ch;
      started = true;
    }
  }
  if (quoted) throw new AuthError(400, "CSV has an unterminated quoted field");
  if (started || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Header-keyed rows of an import, with the column an Esri file's geometry is in. */
export interface UploadedTable {
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<Record<string, string>>;
  /** The column that goes to the board's geometry field unless mapped otherwise. */
  readonly geometryHeader?: string;
  /** The number reported for the first data row: 2 under a heading row, 1 for a feature list. */
  readonly firstRow?: number;
}

/** A board import's file: an Esri JSON feature set (VC-26) when it opens with `{`, one row per feature, else a table. */
export function readBoardImportFile(buffer: Buffer): UploadedTable {
  return /^\s*\{/.test(buffer.subarray(0, 64).toString("utf8")) ? readEsriFeatureSet(buffer) : readUploadedTable(buffer);
}

/**
 * Header-keyed rows of an uploaded table. A zip signature means .xlsx (its
 * first sheet); anything else is read as UTF-8 CSV, where the export's
 * formula guard is undone so a file exported here imports unchanged.
 */
export function readUploadedTable(buffer: Buffer): { headers: string[]; rows: Array<Record<string, string>> } {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    let rows: Array<Record<string, string>>;
    try {
      rows = readFirstWorksheet(buffer);
    } catch (error) {
      throw new AuthError(400, error instanceof Error ? error.message : "unreadable workbook");
    }
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return { headers, rows };
  }
  const [head = [], ...body] = parseCsv(buffer.toString("utf8"));
  const headers = head.map((header) => header.trim());
  const rows = body.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      const raw = cells[i] ?? "";
      if (header && raw !== "") row[header] = /^'[=+\-@\t\r]/.test(raw) ? raw.slice(1) : raw;
    });
    return row;
  });
  return { headers, rows };
}

export const ImportMappingSchema = z.record(z.string().max(200), z.string().regex(/^[a-z][a-z0-9_]*$/).nullable());

export interface ImportRowError {
  readonly row: number;
  readonly field?: string;
  readonly message: string;
}

export interface ImportResult {
  readonly dryRun: boolean;
  /** Non-blank data rows read. */
  readonly rows: number;
  /** Records written: zero on a dry run or when any row fails. */
  readonly created: number;
  /** Header to field, as applied. */
  readonly mapping: Readonly<Record<string, string>>;
  /** Headers not imported. */
  readonly ignored: readonly string[];
  readonly errorCount: number;
  readonly errors: readonly ImportRowError[];
  /** The import report a commit kept (VC-13); absent on a dry run or a refused file. */
  readonly reportId?: string;
}

/**
 * Import rows into a board. Each header maps to a field by the given mapping,
 * or else by field key or label, ignoring case; `id` and unmatched headers
 * are ignored. Every row is validated as a new record. A dry run writes
 * nothing; a commit writes every row, in the caller's transaction, only when
 * no row failed. Row numbers count the header as row 1.
 */
/**
 * Where a board import's report is kept: with the board's organization when
 * the importer writes there, or else with the organization the importer
 * contributes to the incident for, whose administrators sign it off.
 */
async function reportJurisdiction(sql: Sql, actor: Principal, boardJurisdictionId: string, incidentId: string | undefined): Promise<string> {
  const writes = (id: string) => actor.memberships.some((membership) =>
    membership.jurisdictionId === id && (membership.role === "admin" || membership.role === "member"));
  if (writes(boardJurisdictionId) || !incidentId) return boardJurisdictionId;
  const [participation] = await sql`
    select organization_id from incident_participants
    where incident_id = ${incidentId} and person_id = ${actor.person.id} and revoked_at is null and expires_at > now()`;
  return (participation?.organization_id as string | undefined) ?? boardJurisdictionId;
}

export async function importBoardRecords(
  sql: Sql,
  actor: Principal,
  boardId: string,
  table: UploadedTable,
  options: {
    dryRun: boolean; incidentId?: string | undefined; mapping?: Readonly<Record<string, string | null>> | undefined;
    sourceName?: string | undefined;
  },
): Promise<{ result: ImportResult; created: Array<{ id: string; data: Record<string, unknown> }>; boardKey: string; jurisdictionId: string }> {
  const board = await writableBoard(sql, actor, boardId, options.incidentId);
  const writable = board.fields.filter((field) => !field.calculation);
  const byName = new Map<string, FieldDef>();
  for (const field of writable) {
    byName.set(field.key.toLowerCase(), field);
    if (!byName.has(field.label.toLowerCase())) byName.set(field.label.toLowerCase(), field);
  }
  const mapping: Record<string, string> = {};
  const ignored: string[] = [];
  const geometryKey = writable.find((field) => field.type === "geometry")?.key;
  for (const header of table.headers) {
    if (!header) continue;
    const explicit = options.mapping && Object.hasOwn(options.mapping, header) ? options.mapping[header] : undefined;
    if (explicit !== undefined && explicit !== null && !writable.some((field) => field.key === explicit))
      throw new AuthError(400, `mapping names unknown field ${explicit}`);
    const key = explicit === null ? undefined
      : explicit ?? (header.toLowerCase() === "id" ? undefined
        : header === table.geometryHeader ? geometryKey : byName.get(header.toLowerCase())?.key);
    if (key && !Object.values(mapping).includes(key)) mapping[header] = key;
    else ignored.push(header);
  }
  const fields = new Map(writable.map((field) => [field.key, field]));
  const rows = table.rows.flatMap((row, index) =>
    Object.values(row).some((value) => value.trim() !== "") ? [{ row, rowNumber: index + (table.firstRow ?? 2) }] : []);
  if (rows.length > MAX_IMPORT_ROWS) throw new AuthError(413, `import exceeds ${MAX_IMPORT_ROWS} rows`);
  const errors: ImportRowError[] = [];
  const valid: Array<Record<string, unknown>> = [];
  const shapes: Array<{ row: number; field: FieldDef; geometry: string }> = [];
  for (const { row, rowNumber } of rows) {
    const data: Record<string, unknown> = {};
    const rowErrors: ImportRowError[] = [];
    for (const [header, key] of Object.entries(mapping)) {
      const raw = row[header];
      if (raw === undefined || raw.trim() === "") continue;
      try {
        data[key] = coerceCell(fields.get(key)!, raw);
      } catch (error) {
        rowErrors.push({ row: rowNumber, field: key, message: (error as Error).message });
      }
    }
    if (rowErrors.length === 0) {
      try {
        const record = await validateNewRecord(sql, actor, board, data, options.incidentId);
        valid.push(record);
        for (const field of writable)
          if (field.type === "geometry" && record[field.key] !== undefined)
            shapes.push({ row: rowNumber, field, geometry: JSON.stringify(record[field.key]) });
      } catch (error) {
        if (error instanceof z.ZodError) {
          for (const issue of error.issues) {
            const field = issue.path.map(String).join(".");
            rowErrors.push({ row: rowNumber, ...(field ? { field } : {}), message: issue.message });
          }
        } else if (error instanceof AuthError) {
          rowErrors.push({ row: rowNumber, message: error.message });
        } else {
          throw error;
        }
      }
    }
    errors.push(...rowErrors);
  }
  // An imported shape must be a valid one (a ring that crosses itself, a hole
  // outside its area): it is reported, never repaired. One query for the file.
  if (shapes.length) {
    const invalid = await sql`
      select i::int as i, ST_IsValidReason(g) as reason
      from (select i, ST_GeomFromGeoJSON(j) as g from unnest(${shapes.map((shape) => shape.geometry)}::text[]) with ordinality as t(j, i)) s
      where not ST_IsValid(g)`;
    for (const { i, reason } of invalid) {
      const shape = shapes[(i as number) - 1]!;
      errors.push({ row: shape.row, field: shape.field.key, message: `${shape.field.label} is not a valid shape: ${reason as string}` });
    }
    errors.sort((a, b) => a.row - b.row);
  }
  const created: Array<{ id: string; data: Record<string, unknown> }> = [];
  let reportId: string | undefined;
  if (!options.dryRun && errors.length === 0) {
    for (const data of valid) {
      created.push({ id: await insertRecord(sql, actor, board, data, options.incidentId, "import"), data });
    }
    // Every row passed, so each made one record, in file order (VC-13).
    reportId = await writeImportReport(sql, actor, {
      jurisdictionId: await reportJurisdiction(sql, actor, board.jurisdictionId, options.incidentId),
      kind: "board_records",
      subject: board.title,
      sourceName: options.sourceName,
      mapping: Object.entries(mapping).map(([header, key]) => ({ field: fields.get(key)!.label, column: header })),
      rows: rows.map(({ rowNumber }, i) => ({ row: rowNumber, item: created[i]!.id, outcome: "created" as const })),
    });
  }
  return {
    result: {
      dryRun: options.dryRun,
      rows: rows.length,
      created: created.length,
      mapping,
      ignored,
      errorCount: errors.length,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      ...(reportId ? { reportId } : {}),
    },
    created,
    boardKey: board.template.key,
    jurisdictionId: board.jurisdictionId,
  };
}

/** A cell's text as a field value; the record schema checks everything else. */
export function coerceCell(field: FieldDef, raw: string): unknown {
  const text = raw.trim();
  switch (field.type) {
    case "number": {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`${field.label} is not a number`);
      return value;
    }
    case "boolean": {
      const value = text.toLowerCase();
      if (["true", "yes", "1"].includes(value)) return true;
      if (["false", "no", "0"].includes(value)) return false;
      throw new Error(`${field.label} is not true or false`);
    }
    case "geometry": {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`${field.label} is not GeoJSON`);
      }
      // Esri JSON geometry, as an Esri feature set carries it (VC-26), becomes GeoJSON in WGS 84.
      if (!isEsriGeometry(value)) return value;
      try {
        return esriToGeoJson(value);
      } catch (error) {
        throw new Error(`${field.label}: ${(error as Error).message}`, { cause: error });
      }
    }
    case "text":
      return raw;
    case "signature":
      throw new Error(`${field.label} is a signature, which is signed on screen, not imported`);
    default:
      return text;
  }
}
