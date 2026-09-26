import { z } from "zod";
import { dictionaryValues, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { insertRecord, validateNewRecord, writableBoard, type EffectiveBoard } from "../boards/service.js";
import { coerceCell, MAX_IMPORT_ROWS, tableCsv } from "../boards/transfer.js";
import { writeImportReport } from "./import-reports.js";
import { taxonomyTemplateCsv } from "./import-template.js";

/**
 * WebEOC board migration, records only. A WebEOC board export is a CSV of the
 * board's records: its own field columns beside WebEOC's bookkeeping columns.
 * A mapping in the data-pack shape names, for each target board field, the
 * CSV column that fills it. A dry run reports every row's outcome and writes
 * nothing. A commit of the same file writes each valid row through the
 * ordinary record write (audit, history, sync log) and reports every rejected
 * row. The bookkeeping columns travel as provenance on the record's creation
 * event, and a dataid already imported to the board is skipped, so an export
 * committed twice creates each record once. WebEOC processes, views, links
 * and menus are not migrated.
 */

/** WebEOC's bookkeeping columns, kept as provenance on the creation event. */
export const WEBEOC_METADATA = ["dataid", "prevdataid", "entrydate", "username", "positionname", "subscribername"] as const;

/** Target board field key to source CSV column, as a data-pack field mapping maps platform field to source path. */
export const WebeocMappingSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().trim().min(1).max(200));
export type WebeocMapping = z.infer<typeof WebeocMappingSchema>;

export const TimeZoneSchema = z.string().min(1).max(64).refine((zone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, "unknown time zone");

export interface WebeocRowOutcome {
  /** The row's position in the file, counting the heading row as row 1. */
  readonly row: number;
  readonly dataid: string | null;
  readonly outcome: "create" | "skip" | "reject";
  readonly reasons: readonly string[];
  /** The record created by a commit, or the one an earlier import created. */
  readonly recordId?: string;
}

export interface WebeocImportReport {
  readonly dryRun: boolean;
  /** Every column heading of the file, in file order. */
  readonly columns: readonly string[];
  /** Board field to column, as applied to this file. */
  readonly mapping: Readonly<Record<string, string>>;
  /** Bookkeeping columns kept as provenance. */
  readonly provenance: readonly string[];
  /** Columns neither mapped nor kept, so not imported. */
  readonly dropped: readonly string[];
  /** Non-blank data rows read. */
  readonly rows: number;
  /** Rows that pass: created by a commit, or that a commit would create. */
  readonly valid: number;
  /** Records written by this request; zero on a dry run. */
  readonly created: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly outcomes: readonly WebeocRowOutcome[];
  /** Every rejected row as CSV: its row number, the reasons, then its original cells. Empty when none. */
  readonly rejectionCsv: string;
  /** The import report a commit kept (VC-13); absent on a dry run. */
  readonly reportId?: string;
}

export interface SavedWebeocMapping {
  readonly mapping: WebeocMapping | null;
  readonly timeZone: string | null;
  readonly updatedAt: string | null;
}

const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The board's writable fields; a calculated field is never written. */
function writableFields(board: EffectiveBoard): FieldDef[] {
  return board.fields.filter((field) => !field.calculation);
}

function checkMapping(board: EffectiveBoard, mapping: WebeocMapping): void {
  const keys = new Set(writableFields(board).map((field) => field.key));
  for (const key of Object.keys(mapping))
    if (!keys.has(key)) throw new AuthError(400, `mapping names unknown field ${key}`);
}

/** The board's saved WebEOC mapping; only a writer of the board reads it. */
export async function getWebeocMapping(sql: Sql, actor: Principal, boardId: string): Promise<SavedWebeocMapping> {
  await writableBoard(sql, actor, boardId);
  return readSaved(sql, boardId);
}

async function readSaved(sql: Sql, boardId: string): Promise<SavedWebeocMapping> {
  const [row] = await sql`select mapping, time_zone, updated_at from webeoc_mappings where board_id = ${boardId}`;
  if (!row) return { mapping: null, timeZone: null, updatedAt: null };
  return {
    mapping: row.mapping as WebeocMapping,
    timeZone: (row.time_zone as string | null) ?? null,
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/** Save the board's WebEOC mapping, replacing any earlier one. */
export async function saveWebeocMapping(
  sql: Sql,
  actor: Principal,
  boardId: string,
  input: { mapping: WebeocMapping; timeZone: string | null },
): Promise<SavedWebeocMapping> {
  const board = await writableBoard(sql, actor, boardId);
  checkMapping(board, input.mapping);
  await sql`
    insert into webeoc_mappings (board_id, jurisdiction_id, mapping, time_zone, updated_by)
    values (${boardId}, ${board.jurisdictionId}, ${sql.json(input.mapping)}, ${input.timeZone}, ${actor.person.id})
    on conflict (board_id) do update
      set mapping = excluded.mapping, time_zone = excluded.time_zone,
          updated_by = excluded.updated_by, updated_at = now()`;
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    category: "board.webeoc_mapping.saved",
    subjectTable: "webeoc_mappings",
    subjectId: boardId,
    payload: { board: board.template.key, mapping: input.mapping, timeZone: input.timeZone },
  });
  return readSaved(sql, boardId);
}

/**
 * A fixed-taxonomy import template for a board (VC-13): a column per field a
 * file can fill, headed by the field key, which the WebEOC and board imports
 * both match. An enumerated field's column lists its allowed values: the
 * product dictionary it names, or its own list. Only a writer of the board
 * reads it.
 */
export async function boardImportTemplate(sql: Sql, actor: Principal, boardId: string): Promise<{ csv: string; fileName: string }> {
  const board = await writableBoard(sql, actor, boardId);
  const fields = writableFields(board).filter((field) => field.type !== "signature" && field.type !== "attachment");
  const values = Object.fromEntries(fields.filter((field) => field.type === "enum")
    .map((field) => [field.key, (field.enumId ? dictionaryValues(field.enumId) : field.values) ?? []]));
  return { csv: taxonomyTemplateCsv(fields.map((field) => field.key), values), fileName: `${board.template.key}-import-template.csv` };
}

/**
 * Dry-run or commit a WebEOC export into a board. The mapping is the one
 * given, else the board's saved mapping, else each field matched to a column
 * of the same key or label. A commit writes the valid rows in the caller's
 * transaction and leaves the rejected ones out.
 */
export async function importWebeocRecords(
  sql: Sql,
  actor: Principal,
  boardId: string,
  table: { headers: readonly string[]; rows: ReadonlyArray<Record<string, string>> },
  options: { dryRun: boolean; mapping?: WebeocMapping | undefined; timeZone?: string | undefined; sourceName?: string | undefined },
): Promise<{ report: WebeocImportReport; created: Array<{ id: string; data: Record<string, unknown> }>; boardKey: string; jurisdictionId: string }> {
  // A caller may import only into a board they write; no jurisdiction is taken from the request.
  const board = await writableBoard(sql, actor, boardId);
  const fields = writableFields(board);
  const columns = table.headers.filter((header) => header !== "");
  const saved = options.mapping && options.timeZone ? null : await readSaved(sql, boardId);
  const requested = options.mapping ?? saved?.mapping ?? null;
  if (requested) checkMapping(board, requested);
  const timeZone = options.timeZone ?? saved?.timeZone ?? null;

  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const column = requested
      ? requested[field.key]
      : columns.find((c) => normalized(c) === normalized(field.key) || normalized(c) === normalized(field.label));
    if (column !== undefined && columns.includes(column)) mapping[field.key] = column;
  }
  const metadata = new Map<string, string>();
  for (const name of WEBEOC_METADATA) {
    const column = columns.find((c) => c.trim().toLowerCase() === name);
    if (column) metadata.set(name, column);
  }
  const mappedColumns = new Set(Object.values(mapping));
  const provenance = [...metadata.values()];
  const dropped = columns.filter((c) => !mappedColumns.has(c) && !provenance.includes(c));

  const rows = table.rows.flatMap((row, index) =>
    Object.values(row).some((value) => value.trim() !== "") ? [{ row, rowNumber: index + 2 }] : []);
  if (rows.length > MAX_IMPORT_ROWS) throw new AuthError(413, `import exceeds ${MAX_IMPORT_ROWS} rows`);

  const dataidColumn = metadata.get("dataid");
  const dataidOf = (row: Record<string, string>) => (dataidColumn ? row[dataidColumn]?.trim() || null : null);
  const ids = rows.map(({ row }) => dataidOf(row)).filter((id): id is string => id !== null);
  const imported = new Map<string, string>();
  if (ids.length) {
    for (const hit of await sql`
      select dataid, record_id from webeoc_imported_rows where board_id = ${boardId} and dataid = any(${ids})`)
      imported.set(hit.dataid as string, hit.record_id as string);
  }

  const byKey = new Map(fields.map((field) => [field.key, field]));
  const firstRow = new Map<string, number>();
  const outcomes: WebeocRowOutcome[] = [];
  const valid: Array<{ index: number; data: Record<string, unknown>; source: Record<string, string> }> = [];
  for (const { row, rowNumber } of rows) {
    const dataid = dataidOf(row);
    const earlier = imported.get(dataid ?? "");
    if (dataid && earlier) {
      outcomes.push({ row: rowNumber, dataid, outcome: "skip", reasons: [`dataid ${dataid} was imported earlier`], recordId: earlier });
      continue;
    }
    const reasons: string[] = [];
    if (dataid && firstRow.has(dataid)) reasons.push(`dataid ${dataid} repeats row ${firstRow.get(dataid)!}`);
    if (dataid && !firstRow.has(dataid)) firstRow.set(dataid, rowNumber);
    const data: Record<string, unknown> = {};
    const unreadable = new Set<string>();
    for (const [key, column] of Object.entries(mapping)) {
      const raw = row[column];
      if (raw === undefined || raw.trim() === "") continue;
      try {
        data[key] = cellValue(byKey.get(key)!, raw, timeZone);
      } catch (error) {
        unreadable.add(key);
        reasons.push((error as Error).message);
      }
    }
    for (const field of fields) {
      if (!field.required || field.condition || data[field.key] !== undefined || unreadable.has(field.key)) continue;
      reasons.push(mapping[field.key]
        ? `${field.label} is required and this row leaves it empty`
        : `${field.label} is required and no column is mapped to it`);
    }
    if (!reasons.length) {
      try {
        const parsed = await validateNewRecord(sql, actor, board, data);
        const source: Record<string, string> = { system: "webeoc" };
        for (const [name, column] of metadata) if (row[column]?.trim()) source[name] = row[column]!.trim();
        valid.push({ index: outcomes.length, data: parsed, source });
      } catch (error) {
        if (error instanceof z.ZodError) {
          for (const issue of error.issues) {
            const label = byKey.get(String(issue.path[0] ?? ""))?.label;
            reasons.push(label ? `${label}: ${issue.message}` : issue.message);
          }
        } else if (error instanceof AuthError) {
          reasons.push(error.message);
        } else {
          throw error;
        }
      }
    }
    outcomes.push({ row: rowNumber, dataid, outcome: reasons.length ? "reject" : "create", reasons });
  }

  const created: Array<{ id: string; data: Record<string, unknown> }> = [];
  let reportId: string | undefined;
  if (!options.dryRun) {
    for (const item of valid) {
      const id = await insertRecord(sql, actor, board, item.data, undefined, "import", item.source);
      if (item.source.dataid) {
        await sql`
          insert into webeoc_imported_rows (board_id, dataid, jurisdiction_id, record_id, imported_by)
          values (${boardId}, ${item.source.dataid}, ${board.jurisdictionId}, ${id}, ${actor.person.id})`;
      }
      outcomes[item.index] = { ...outcomes[item.index]!, recordId: id };
      created.push({ id, data: item.data });
    }
    reportId = await writeImportReport(sql, actor, {
      jurisdictionId: board.jurisdictionId,
      kind: "webeoc",
      subject: board.title,
      sourceName: options.sourceName,
      mapping: fields.filter((field) => mapping[field.key]).map((field) => ({ field: field.label, column: mapping[field.key]! })),
      rows: outcomes.map((o) => ({
        row: o.row,
        ...(o.dataid ? { item: `dataid ${o.dataid}` } : {}),
        outcome: o.outcome === "create" ? "created" : o.outcome === "skip" ? "skipped" : "refused",
        ...(o.reasons.length ? { reason: o.reasons.join("; ") } : {}),
      })),
    });
  }

  const rejectedRows = rows.flatMap(({ row, rowNumber }, i) => outcomes[i]!.outcome !== "reject" ? []
    : [[rowNumber, outcomes[i]!.reasons.join("; "), ...columns.map((column) => row[column] ?? "")]]);
  const rejectionCsv = rejectedRows.length === 0 ? ""
    : tableCsv({ headers: ["Rejected row", "Rejection reason", ...columns], rows: rejectedRows });
  return {
    report: {
      dryRun: options.dryRun,
      columns,
      mapping,
      provenance,
      dropped,
      rows: rows.length,
      valid: valid.length,
      created: created.length,
      skipped: outcomes.filter((o) => o.outcome === "skip").length,
      rejected: rejectedRows.length,
      outcomes,
      rejectionCsv,
      ...(reportId ? { reportId } : {}),
    },
    created,
    boardKey: board.template.key,
    jurisdictionId: board.jurisdictionId,
  };
}

/** A cell as a field value. Dates and choices get WebEOC's forms; the rest is read as a board import reads it. */
function cellValue(field: FieldDef, raw: string, timeZone: string | null): unknown {
  const text = raw.trim();
  if (field.type === "datetime") return webeocDate(field, text, timeZone);
  if (field.type === "enum") {
    const options = (field.enumId ? dictionaryValues(field.enumId) : field.values) ?? [];
    const loose = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
    const matches = options.includes(text) ? [text] : options.filter((option) => loose(option) === loose(text));
    if (matches.length !== 1) throw new Error(`${field.label} "${text}" is not one of its options: ${options.join(", ")}`);
    return matches[0];
  }
  if (field.type === "text" && raw.length > (field.maxLength ?? 4000))
    throw new Error(`${field.label} is longer than ${field.maxLength ?? 4000} characters`);
  return coerceCell(field, raw);
}

const ISO_WITH_OFFSET = z.iso.datetime({ offset: true });
const LOCAL_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;
const LOCAL_US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

/**
 * A date as an ISO timestamp. One carrying an offset is kept as written. A
 * local date and time, as WebEOC writes them (2026-09-23 14:05:00.000 or
 * 9/23/2026 2:05 PM), is read in the time zone the WebEOC server used.
 */
function webeocDate(field: FieldDef, text: string, timeZone: string | null): string {
  if (ISO_WITH_OFFSET.safeParse(text).success) return text;
  const iso = LOCAL_ISO.exec(text);
  const us = iso ? null : LOCAL_US.exec(text);
  if (!iso && !us) throw new Error(`${field.label} is not a date`);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]].map(Number) : [us![3], us![1], us![2]].map(Number);
  let hour = Number((iso ? iso[4] : us![4]) ?? 0);
  const minute = Number((iso ? iso[5] : us![5]) ?? 0);
  const second = Number((iso ? iso[6] : us![6]) ?? 0);
  const ms = Number(((iso?.[7]) ?? "0").padEnd(3, "0"));
  const meridiem = us?.[7]?.toLowerCase();
  if (meridiem && (hour < 1 || hour > 12)) throw new Error(`${field.label} is not a date`);
  if (meridiem) hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  const wall = Date.UTC(year!, month! - 1, day!, hour, minute, second, ms);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month! - 1 || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second)
    throw new Error(`${field.label} is not a date`);
  if (!timeZone) throw new Error(`${field.label} has no time zone; choose the time zone the WebEOC server used`);
  // ponytail: two passes settle the zone offset; a wall time skipped by a
  // daylight-saving change lands an hour off, as it has no true instant.
  const first = wall - zoneOffset(wall, timeZone);
  return new Date(wall - zoneOffset(first, timeZone)).toISOString();
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return local - Math.floor(instant / 1000) * 1000;
}
