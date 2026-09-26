import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor, type PageRequest } from "../db/cursor.js";

/**
 * Validated migration (VC-13). Every import that writes keeps a report of
 * what it read and did: each row or part created, updated, skipped or
 * refused, a refusal with its reason, and the mapping of file columns to
 * fields it used, with who ran it. A jurisdiction administrator signs the
 * report off on screen, once, in their own name. A dry run keeps no report.
 */

export const IMPORT_KINDS = ["webeoc", "board_records", "solution_package", "form", "parcel_baseline", "people"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type RowOutcome = "created" | "updated" | "skipped" | "refused";

export interface ReportRow {
  /** The row's number in the file, the heading row being row 1. */
  readonly row?: number;
  /** What the row or part names: an email, a parcel, a template and its version. */
  readonly item?: string;
  readonly outcome: RowOutcome;
  /** Why a row was refused or skipped, or what an update changed. */
  readonly reason?: string;
}

/** One field and the file column that filled it. */
export interface MappedColumn {
  readonly field: string;
  readonly column: string;
}

export interface ImportReportSummary {
  readonly id: string;
  readonly kind: ImportKind;
  readonly subject: string;
  readonly sourceName: string | null;
  readonly read: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly refused: number;
  readonly runBy: string;
  readonly runAt: string;
  readonly signOff: { readonly by: string; readonly at: string; readonly note: string | null } | null;
}

export interface ImportReport extends ImportReportSummary {
  readonly mapping: readonly MappedColumn[];
  readonly rows: readonly ReportRow[];
}

/** A file name as a person gave it, without control characters, or null. */
function cleanName(name: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const text = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return text || null;
}

/** Keep the report of an import that wrote, in the caller's transaction. */
export async function writeImportReport(
  sql: Sql,
  actor: Principal,
  input: {
    jurisdictionId: string;
    kind: ImportKind;
    subject: string;
    sourceName?: string | null | undefined;
    mapping?: readonly MappedColumn[];
    rows: readonly ReportRow[];
  },
): Promise<string> {
  const count = (outcome: RowOutcome) => input.rows.filter((row) => row.outcome === outcome).length;
  const [row] = await sql`
    insert into import_reports
      (jurisdiction_id, kind, subject, source_name, read_count, created_count, updated_count,
       skipped_count, refused_count, mapping, row_outcomes, run_by)
    values
      (${input.jurisdictionId}, ${input.kind}, ${input.subject.slice(0, 300)}, ${cleanName(input.sourceName)},
       ${input.rows.length}, ${count("created")}, ${count("updated")}, ${count("skipped")}, ${count("refused")},
       ${sql.json((input.mapping ?? []) as never)}, ${sql.json(input.rows as never)}, ${actor.person.id})
    returning id`;
  return row!.id as string;
}

const SUMMARY = (sql: Sql) => sql`
  r.id, r.kind, r.subject, r.source_name, r.read_count, r.created_count, r.updated_count, r.skipped_count,
  r.refused_count, r.run_at, runner.display_name as run_by_name, r.signed_off_at, r.sign_off_note,
  signer.display_name as signed_off_by_name`;

function summary(r: Record<string, unknown>): ImportReportSummary {
  return {
    id: r.id as string,
    kind: r.kind as ImportKind,
    subject: r.subject as string,
    sourceName: (r.source_name as string | null) ?? null,
    read: r.read_count as number,
    created: r.created_count as number,
    updated: r.updated_count as number,
    skipped: r.skipped_count as number,
    refused: r.refused_count as number,
    runBy: r.run_by_name as string,
    runAt: new Date(r.run_at as string).toISOString(),
    signOff: r.signed_off_at ? {
      by: r.signed_off_by_name as string,
      at: new Date(r.signed_off_at as string).toISOString(),
      note: (r.sign_off_note as string | null) ?? null,
    } : null,
  };
}

/** The jurisdiction's import reports, newest first, without their rows. Administrators only. */
export async function listImportReports(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
): Promise<{ reports: ImportReportSummary[]; nextCursor: string | null }> {
  requireAdmin(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select ${SUMMARY(sql)}, to_char(r.run_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from import_reports r
    join persons runner on runner.id = r.run_by
    left join persons signer on signer.id = r.signed_off_by
    where r.jurisdiction_id = ${jurisdictionId}
      ${after ? sql`and (r.run_at, r.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by r.run_at desc, r.id desc
    limit ${limit + 1}`;
  const last = rows.length > limit ? rows[limit - 1]! : null;
  return {
    reports: rows.slice(0, limit).map(summary),
    nextCursor: last ? encodeCursor([last.page_at as string, last.id as string]) : null,
  };
}

/** One report with its mapping and rows, for an administrator of its jurisdiction. */
export async function getImportReport(sql: Sql, actor: Principal, reportId: string): Promise<ImportReport> {
  const [row] = await sql`
    select ${SUMMARY(sql)}, r.jurisdiction_id, r.mapping, r.row_outcomes
    from import_reports r
    join persons runner on runner.id = r.run_by
    left join persons signer on signer.id = r.signed_off_by
    where r.id = ${reportId}`;
  if (!row) throw new AuthError(404, "import report not found");
  requireAdmin(actor, row.jurisdiction_id as string);
  return { ...summary(row), mapping: row.mapping as MappedColumn[], rows: row.row_outcomes as ReportRow[] };
}

/** Sign a report off, once, in the administrator's own name. */
export async function signOffImportReport(
  sql: Sql,
  actor: Principal,
  reportId: string,
  note: string | null,
): Promise<ImportReport> {
  const report = await getImportReport(sql, actor, reportId);
  if (report.signOff) throw new AuthError(409, `this report was signed off by ${report.signOff.by}`);
  const [row] = await sql`
    update import_reports
    set signed_off_by = ${actor.person.id}, signed_off_at = now(), sign_off_note = ${note}
    where id = ${reportId} and signed_off_by is null
    returning jurisdiction_id`;
  if (!row) throw new AuthError(409, "this report was signed off by someone else");
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdiction_id as string,
    category: "import.report.signed_off",
    subjectTable: "import_reports",
    subjectId: reportId,
    payload: { kind: report.kind, subject: report.subject },
  });
  return getImportReport(sql, actor, reportId);
}
