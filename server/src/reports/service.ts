import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  applyView,
  conditionFitsField,
  deriveRecordValues,
  ViewConditionSchema,
  ViewSortSchema,
  type FieldDef,
  type ViewDef,
  type ViewSort,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type Page, type PageRequest } from "../db/cursor.js";
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { conditionSql, getBoardReadShape, visibleFields } from "../boards/service.js";

/**
 * Saved reports over boards. A report names a board, the columns to show, the
 * view conditions that select records, up to two grouping fields, totals and
 * sort keys. It stores no data: every run reads the board as the person
 * running it, through the same filters and row-level rules as a board view,
 * so a record or field that person cannot read is not in their report. A
 * column they cannot read is left out and the report names it.
 */

/** Records one run may read; the same bound as a board export. */
export const MAX_REPORT_ROWS = 50_000;

export const TOTAL_FUNCTIONS = ["sum", "avg", "min", "max"] as const;
export type TotalFunction = (typeof TOTAL_FUNCTIONS)[number];
const TOTAL_LABELS: Readonly<Record<TotalFunction, string>> = { sum: "sum", avg: "average", min: "minimum", max: "maximum" };

const FieldKey = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const ReportDefinitionSchema = z.object({
  columns: z.array(FieldKey).min(1).max(30),
  where: z.array(ViewConditionSchema).max(16).default([]),
  groupBy: z.array(FieldKey).max(2).default([]),
  totals: z.array(z.object({ field: FieldKey, fn: z.enum(TOTAL_FUNCTIONS) }).strict()).max(16).default([]),
  sorts: z.array(ViewSortSchema).max(4).default([]),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
}).strict();
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;

export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export const CadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(15).max(10_080) }).strict(),
  z.object({
    kind: z.literal("daily"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use a 24-hour time such as 07:30"),
    timeZone: z.string().min(1).max(64).refine(isTimeZone, "unknown time zone"),
  }).strict(),
]);

export const ScheduleSchema = z.object({
  cadence: CadenceSchema,
  format: z.enum(["pdf", "xlsx", "csv"]),
  emails: z.array(z.email()).max(20).default([]),
  contactIds: z.array(z.string().uuid()).max(20).default([]),
  storeFile: z.boolean().default(false),
}).strict().refine((s) => s.emails.length > 0 || s.contactIds.length > 0 || s.storeFile,
  "a schedule sends to at least one address or contact, or stores the file");
export type ReportSchedule = z.infer<typeof ScheduleSchema>;
export type ReportFormat = ReportSchedule["format"];

const SourceShape = {
  boardId: z.string().uuid(),
  incidentId: z.string().uuid().nullable().default(null),
  definition: ReportDefinitionSchema,
};
const PreviewSchema = z.object(SourceShape).strict();
const ReportBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  ...SourceShape,
  schedule: ScheduleSchema.nullable().default(null),
}).strict();
type ReportBody = z.infer<typeof ReportBodySchema>;

/** When a schedule next runs after `after`: an interval later, or the next daily time in its time zone. */
export function nextRunAt(cadence: ReportSchedule["cadence"], after: Date): Date {
  if (cadence.kind === "interval") return new Date(after.getTime() + cadence.minutes * 60_000);
  const [hour, minute] = cadence.time.split(":").map(Number) as [number, number];
  const today = zonedParts(after.getTime(), cadence.timeZone);
  for (let day = 0; day <= 2; day += 1) {
    const wall = Date.UTC(today.year, today.month - 1, today.day + day, hour, minute);
    // The offset at a first guess, then at the corrected instant, settles across a daylight saving change.
    const guess = wall - offsetMs(wall, cadence.timeZone);
    const at = wall - offsetMs(guess, cadence.timeZone);
    if (at > after.getTime()) return new Date(at);
  }
  throw new Error("no daily run within two days");
}

function zonedParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

/** How far a time zone's wall clock is ahead of UTC at an instant. */
function offsetMs(at: number, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (at - (at % 1000));
}

export interface ReportColumn { readonly key: string; readonly label: string; readonly type: FieldDef["type"] }
export interface ReportTotal { readonly key: string; readonly field: string; readonly fn: TotalFunction; readonly label: string }
export type Aggregates = Readonly<Record<string, number | null>>;

/** One group, listed before its subgroups; its rows are `count` rows from `first`. */
export interface ReportGroup {
  readonly level: number;
  /** Group values from the outermost level to this one; null for no value. */
  readonly values: readonly unknown[];
  readonly first: number;
  readonly count: number;
  readonly totals: Aggregates;
}

export interface ReportResult {
  readonly board: { readonly id: string; readonly title: string };
  readonly incidentId: string | null;
  readonly generatedAt: string;
  readonly columns: readonly ReportColumn[];
  readonly groupBy: readonly ReportColumn[];
  readonly totals: readonly ReportTotal[];
  /** Fields the definition names that the runner cannot read, left out of this run. */
  readonly omitted: readonly string[];
  /** Each row holds its readable group and column values, in report order. */
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly groups: readonly ReportGroup[];
  readonly total: { readonly count: number; readonly totals: Aggregates };
}

export interface ReportSource {
  readonly boardId: string;
  readonly incidentId: string | null;
  readonly definition: ReportDefinition;
}

/** A group value as compared and returned: an absent or empty value is null. */
const groupValue = (value: unknown) => (value === undefined || value === "" ? null : value);

function aggregate(fn: TotalFunction, values: readonly unknown[]): number | null {
  const numbers = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((a, b) => a + b, 0);
  switch (fn) {
    case "sum": return sum;
    case "avg": return sum / numbers.length;
    case "min": return numbers.reduce((a, b) => Math.min(a, b));
    case "max": return numbers.reduce((a, b) => Math.max(a, b));
  }
}

/**
 * Run a report as `actor`, who must be able to read the board (and, with an
 * incident scope, the incident). Conditions go to SQL as a board view's do;
 * the shared view semantics then filter and order the rows, the group values
 * leading the sort.
 */
export async function runReport(sql: Sql, actor: Principal, source: ReportSource, now = new Date()): Promise<ReportResult> {
  const { board } = await getBoardReadShape(sql, actor, source.boardId, source.incidentId ?? undefined);
  const def = source.definition;
  const readable = new Map(visibleFields(board).map((field) => [field.key, field]));
  const keys = new Set(readable.keys());
  const pick = (wanted: readonly string[]): ReportColumn[] => [...new Set(wanted)].flatMap((key) => {
    const field = readable.get(key);
    return field ? [{ key, label: field.label, type: field.type }] : [];
  });
  const columns = pick(def.columns);
  const groupBy = pick(def.groupBy);
  const totals = [...new Map(def.totals.flatMap((t) => {
    const field = readable.get(t.field);
    return field?.type === "number"
      ? [[`${t.field}:${t.fn}`, { key: `${t.field}:${t.fn}`, field: t.field, fn: t.fn, label: `${field.label} ${TOTAL_LABELS[t.fn]}` }] as const]
      : [];
  })).values()];
  const named = [...def.columns, ...def.groupBy, ...def.totals.map((t) => t.field), ...def.sorts.map((s) => s.field)];
  const omitted = [...new Set(named)].filter((key) => !keys.has(key));

  const fields = new Map(board.fields.map((field) => [field.key, field]));
  const filters = def.where.reduce(
    (clauses, condition) => sql`${clauses} ${conditionSql(sql, condition, fields, keys, now)}`, sql``);
  const archived = def.archived === "include" ? sql``
    : def.archived === "only" ? sql`and archived_at is not null` : sql`and archived_at is null`;
  const found = await sql`
    select id, data from board_records
    where board_id = ${board.id}
      and (${source.incidentId}::uuid is null or incident_id = ${source.incidentId})
      ${archived} ${filters}
    order by created_at desc, id desc
    limit ${MAX_REPORT_ROWS + 1}`;
  if (found.length > MAX_REPORT_ROWS)
    throw new AuthError(413, `the report reads more than ${MAX_REPORT_ROWS} records; add conditions to narrow it`);
  const masked = found.map((row) => {
    const data = deriveRecordValues(board.fields, row.data as Record<string, unknown>);
    return { id: row.id as string, ...Object.fromEntries(Object.entries(data).filter(([key]) => keys.has(key))) };
  });
  const order: ViewSort[] = [
    ...groupBy.map((group) => ({ field: group.key, dir: def.sorts.find((s) => s.field === group.key)?.dir ?? "asc" as const })),
    ...def.sorts.filter((s) => keys.has(s.field) && !groupBy.some((group) => group.key === s.field)),
  ];
  const view: ViewDef = {
    key: "report", title: "Report", kind: "list", columns: [...def.columns], filter: [], where: [...def.where],
    ...(order.length ? { sorts: order } : {}),
  };
  const records = applyView(view, masked, { fields: board.fields, now });

  const sums = (slice: ReadonlyArray<Record<string, unknown>>): Aggregates =>
    Object.fromEntries(totals.map((t) => [t.key, aggregate(t.fn, slice.map((row) => row[t.field]))]));
  const groups: ReportGroup[] = [];
  const cut = (level: number, from: number, to: number, prefix: readonly unknown[]) => {
    const key = groupBy[level - 1]?.key;
    if (!key) return;
    let start = from;
    for (let i = from + 1; i <= to; i += 1) {
      if (i < to && isDeepStrictEqual(groupValue(records[i]![key]), groupValue(records[start]![key]))) continue;
      const values = [...prefix, groupValue(records[start]![key])];
      groups.push({ level, values, first: start, count: i - start, totals: sums(records.slice(start, i)) });
      cut(level + 1, start, i, values);
      start = i;
    }
  };
  if (records.length > 0) cut(1, 0, records.length, []);

  const shown = [...new Set([...groupBy, ...columns].map((column) => column.key))];
  return {
    board: { id: board.id, title: board.title },
    incidentId: source.incidentId,
    generatedAt: now.toISOString(),
    columns,
    groupBy,
    totals,
    omitted,
    rows: records.map((row) => Object.fromEntries(shown.flatMap((key) => (row[key] === undefined ? [] : [[key, row[key]]])))),
    groups,
    total: { count: records.length, totals: sums(records) },
  };
}

/**
 * Check a definition against the board as the author reads it: every field
 * exists and is readable, conditions suit their fields, totals are numeric,
 * and named contacts belong to the jurisdiction.
 */
async function checkReport(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  body: Pick<ReportBody, "boardId" | "incidentId" | "definition"> & { schedule?: ReportSchedule | null },
): Promise<void> {
  const { board } = await getBoardReadShape(sql, actor, body.boardId, body.incidentId ?? undefined);
  if (board.jurisdictionId !== jurisdictionId) throw new AuthError(400, "the board belongs to another jurisdiction");
  const readable = new Map(visibleFields(board).map((field) => [field.key, field]));
  const field = (key: string): FieldDef => {
    const found = readable.get(key);
    if (!found) throw new AuthError(400, `the board has no field ${key} that you can read`);
    return found;
  };
  const def = body.definition;
  for (const key of [...def.columns, ...def.groupBy, ...def.sorts.map((s) => s.field)]) field(key);
  if (new Set(def.groupBy).size !== def.groupBy.length) throw new AuthError(400, "group by two different fields");
  for (const condition of def.where) {
    if (!conditionFitsField(condition, field(condition.field)))
      throw new AuthError(400, `the condition ${condition.op} does not suit the field ${condition.field}`);
  }
  for (const total of def.totals) {
    if (field(total.field).type !== "number") throw new AuthError(400, `totals need a number field; ${total.field} is not one`);
  }
  const contactIds = [...new Set(body.schedule?.contactIds ?? [])];
  if (contactIds.length > 0) {
    const found = await sql`
      select id from contacts where jurisdiction_id = ${jurisdictionId} and id = any(${contactIds}::uuid[])`;
    if (found.length !== contactIds.length) throw new AuthError(400, "every contact must be in this jurisdiction");
  }
}

/** A report as returned: its definition, schedule and owner, and whether the caller may change it. */
export interface ReportView {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly boardId: string;
  readonly boardTitle: string | null;
  readonly incidentId: string | null;
  readonly definition: ReportDefinition;
  readonly schedule: ReportSchedule | null;
  readonly nextRunAt: string | null;
  readonly owner: { readonly personId: string; readonly displayName: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canEdit: boolean;
}

export interface ReportRun {
  readonly id: string;
  readonly ranAt: string;
  readonly ranAs: string;
  readonly rows: number | null;
  readonly outcome: "delivered" | "partial" | "failed";
  readonly detail: Readonly<Record<string, unknown>>;
}

function reportSelect(sql: Sql) {
  return sql`
    select r.id, r.jurisdiction_id, r.name, r.board_id, b.title as board_title, r.incident_id,
      r.definition, r.schedule, r.next_run_at, r.created_by, p.display_name as owner_name,
      r.created_at, r.updated_at,
      to_char(r.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from reports r
    join persons p on p.id = r.created_by
    left join boards b on b.id = r.board_id`;
}

/** The owner while still a writer, or an admin of the jurisdiction, as the row-level policy says. */
function mayEdit(actor: Principal, row: Record<string, unknown>): boolean {
  const role = actor.memberships.find((m) => m.jurisdictionId === row.jurisdiction_id)?.role;
  return role === "admin" || (row.created_by === actor.person.id && role === "member");
}

function viewOf(actor: Principal, row: Record<string, unknown>): ReportView {
  return {
    id: row.id as string,
    jurisdictionId: row.jurisdiction_id as string,
    name: row.name as string,
    boardId: row.board_id as string,
    boardTitle: (row.board_title as string | null) ?? null,
    incidentId: (row.incident_id as string | null) ?? null,
    definition: ReportDefinitionSchema.parse(row.definition),
    schedule: row.schedule ? ScheduleSchema.parse(row.schedule) : null,
    nextRunAt: row.next_run_at ? (row.next_run_at as Date).toISOString() : null,
    owner: { personId: row.created_by as string, displayName: row.owner_name as string },
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    canEdit: mayEdit(actor, row),
  };
}

async function loadRow(sql: Sql, reportId: string): Promise<Record<string, unknown>> {
  const [row] = await sql`${reportSelect(sql)} where r.id = ${reportId}`;
  if (!row) throw new AuthError(404, "report not found");
  return row;
}

export async function listReports(
  sql: Sql, actor: Principal, jurisdictionId: string, page: PageRequest,
): Promise<Page<ReportView>> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`${reportSelect(sql)}
    where r.jurisdiction_id = ${jurisdictionId}
      ${after ? sql`and (r.created_at, r.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by r.created_at desc, r.id desc
    limit ${limit + 1}`;
  const cut = cutPage(rows, limit, (row) => [row.page_at as string, row.id as string]);
  return { items: cut.items.map((row) => viewOf(actor, row)), nextCursor: cut.nextCursor };
}

/** A report with its most recent scheduled runs. */
export async function getReport(sql: Sql, actor: Principal, reportId: string): Promise<ReportView & { runs: ReportRun[] }> {
  const report = viewOf(actor, await loadRow(sql, reportId));
  const runs = await sql`
    select rr.id, rr.ran_at, rr.row_count, rr.outcome, rr.detail, p.display_name
    from report_runs rr join persons p on p.id = rr.run_by
    where rr.report_id = ${reportId}
    order by rr.ran_at desc, rr.id desc
    limit 20`;
  return {
    ...report,
    runs: runs.map((run) => ({
      id: run.id as string,
      ranAt: (run.ran_at as Date).toISOString(),
      ranAs: run.display_name as string,
      rows: run.row_count as number | null,
      outcome: run.outcome as ReportRun["outcome"],
      detail: run.detail as Record<string, unknown>,
    })),
  };
}

export async function createReport(
  sql: Sql, actor: Principal, jurisdictionId: string, raw: unknown, now = new Date(),
): Promise<ReportView> {
  requireWriter(actor, jurisdictionId);
  const body = ReportBodySchema.parse(raw);
  await checkReport(sql, actor, jurisdictionId, body);
  const [row] = await sql`
    insert into reports
      (jurisdiction_id, board_id, incident_id, name, definition, schedule, next_run_at, created_by, updated_by)
    values
      (${jurisdictionId}, ${body.boardId}, ${body.incidentId}, ${body.name}, ${sql.json(body.definition as never)},
       ${body.schedule ? sql.json(body.schedule as never) : null},
       ${body.schedule ? nextRunAt(body.schedule.cadence, now) : null}, ${actor.person.id}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "report.created",
    subjectTable: "reports",
    subjectId: id,
    payload: { name: body.name, boardId: body.boardId, scheduled: body.schedule !== null },
  });
  return viewOf(actor, await loadRow(sql, id));
}

/**
 * Replace a report's name, definition and schedule. An unchanged schedule
 * keeps its next run; a changed one is timed afresh from now.
 */
export async function updateReport(
  sql: Sql, actor: Principal, reportId: string, raw: unknown, now = new Date(),
): Promise<ReportView> {
  const existing = await loadRow(sql, reportId);
  if (!mayEdit(actor, existing)) throw new AuthError(403, "only the report's owner or an administrator may change it");
  const body = ReportBodySchema.parse(raw);
  const jurisdictionId = existing.jurisdiction_id as string;
  await checkReport(sql, actor, jurisdictionId, body);
  const previous = existing.schedule ? ScheduleSchema.parse(existing.schedule) : null;
  const next = !body.schedule ? null
    : previous && isDeepStrictEqual(previous, body.schedule) ? (existing.next_run_at as Date)
      : nextRunAt(body.schedule.cadence, now);
  await sql`
    update reports set
      name = ${body.name}, board_id = ${body.boardId}, incident_id = ${body.incidentId},
      definition = ${sql.json(body.definition as never)},
      schedule = ${body.schedule ? sql.json(body.schedule as never) : null}, next_run_at = ${next},
      updated_by = ${actor.person.id}, updated_at = now()
    where id = ${reportId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "report.updated",
    subjectTable: "reports",
    subjectId: reportId,
    payload: { name: body.name, boardId: body.boardId, scheduled: body.schedule !== null },
  });
  return viewOf(actor, await loadRow(sql, reportId));
}

export async function deleteReport(sql: Sql, actor: Principal, reportId: string): Promise<void> {
  const existing = await loadRow(sql, reportId);
  if (!mayEdit(actor, existing)) throw new AuthError(403, "only the report's owner or an administrator may delete it");
  await sql`delete from reports where id = ${reportId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: existing.jurisdiction_id as string,
    category: "report.deleted",
    subjectTable: "reports",
    subjectId: reportId,
    payload: { name: existing.name as string },
  });
}

/** Rows shown by a preview; its groups and totals still cover every record. */
const PREVIEW_ROWS = 25;

/** Run an unsaved definition, checked as a save would be, and return its first rows. */
export async function previewReport(
  sql: Sql, actor: Principal, jurisdictionId: string, raw: unknown,
): Promise<ReportResult> {
  requireMember(actor, jurisdictionId);
  const source = PreviewSchema.parse(raw);
  await checkReport(sql, actor, jurisdictionId, source);
  const result = await runReport(sql, actor, source);
  return { ...result, rows: result.rows.slice(0, PREVIEW_ROWS) };
}

/** Run a saved report as the caller. */
export async function runSavedReport(
  sql: Sql, actor: Principal, reportId: string,
): Promise<{ name: string; result: ReportResult }> {
  const row = await loadRow(sql, reportId);
  const result = await runReport(sql, actor, {
    boardId: row.board_id as string,
    incidentId: (row.incident_id as string | null) ?? null,
    definition: ReportDefinitionSchema.parse(row.definition),
  });
  return { name: row.name as string, result };
}
