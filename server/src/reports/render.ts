import { tableCsv, tableXlsx, type BoardTable } from "../boards/transfer.js";
import { tablePdf, type PdfLine } from "./pdf.js";
import type { Aggregates, ReportFormat, ReportGroup, ReportResult } from "./service.js";

/**
 * A report run as a file. PDF lays the rows out under group headings with a
 * total line after each group and one for all records. CSV and Excel carry
 * the rows as one plain table, group fields first, and below it, after a
 * blank row, a second table of counts and totals per group and for all
 * records, so the rows stay easy to sort and filter in a spreadsheet.
 */

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface ReportFile {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

export interface ReportMeta {
  readonly name: string;
  /** Who the report was run as. */
  readonly runAs: string;
}

/** A cell value as text: yes or no for booleans, JSON for objects. */
export function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const groupText = (value: unknown) => (value === null ? "(no value)" : cellText(value));
const records = (count: number) => `${count} record${count === 1 ? "" : "s"}`;

function totalsText(result: ReportResult, totals: Aggregates): string {
  return result.totals.map((t) => `; ${t.label} ${totals[t.key] === null ? "none" : cellText(totals[t.key])}`).join("");
}

export function reportTable(result: ReportResult): BoardTable {
  const shown = [...result.groupBy, ...result.columns.filter((c) => !result.groupBy.some((g) => g.key === c.key))];
  const rows: unknown[][] = result.rows.map((row) => shown.map((column) => row[column.key]));
  if (result.groupBy.length === 0 && result.totals.length === 0) return { headers: shown.map((c) => c.label), rows };
  const aggregates = (totals: Aggregates) => result.totals.map((t) => totals[t.key]);
  return {
    headers: shown.map((c) => c.label),
    rows: [
      ...rows,
      [],
      [result.groupBy.map((g) => g.label).join(" / ") || "Group", "Records", ...result.totals.map((t) => t.label)],
      ...result.groups.map((g) => [g.values.map(groupText).join(" / "), g.count, ...aggregates(g.totals)]),
      ["All records", result.total.count, ...aggregates(result.total.totals)],
    ],
  };
}

export function reportPdf(result: ReportResult, meta: ReportMeta): Uint8Array {
  const opening = new Map<number, ReportGroup[]>();
  const closing = new Map<number, ReportGroup[]>();
  for (const group of result.groups) {
    opening.set(group.first, [...(opening.get(group.first) ?? []), group]);
    const last = group.first + group.count - 1;
    // Inner groups close before the group holding them.
    closing.set(last, [group, ...(closing.get(last) ?? [])]);
  }
  const lines: PdfLine[] = [];
  result.rows.forEach((row, i) => {
    for (const group of opening.get(i) ?? []) {
      lines.push({ kind: "group", level: group.level,
        text: `${result.groupBy[group.level - 1]!.label}: ${groupText(group.values.at(-1))} (${records(group.count)})` });
    }
    lines.push({ kind: "row", cells: result.columns.map((column) => cellText(row[column.key])) });
    for (const group of closing.get(i) ?? []) {
      lines.push({ kind: "total", level: group.level,
        text: `Total for ${groupText(group.values.at(-1))}: ${records(group.count)}${totalsText(result, group.totals)}` });
    }
  });
  lines.push({ kind: "total", level: 0,
    text: `All records: ${records(result.total.count)}${totalsText(result, result.total.totals)}` });
  const generated = `${result.generatedAt.slice(0, 16).replace("T", " ")} UTC`;
  return tablePdf({
    title: meta.name,
    subtitle: [
      `Board: ${result.board.title}${result.incidentId ? " (one incident)" : ""} · ${records(result.total.count)} · generated ${generated} for ${meta.runAs}`,
      ...(result.omitted.length ? [`Left out because ${meta.runAs} cannot read them: ${result.omitted.join(", ")}`] : []),
    ],
    headers: result.columns.map((column) => column.label),
    lines,
  });
}

export function renderReport(result: ReportResult, format: ReportFormat, meta: ReportMeta): ReportFile {
  const stamp = result.generatedAt.slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const base = meta.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "report";
  const filename = `${base}-${stamp}.${format}`;
  if (format === "pdf") return { filename, contentType: "application/pdf", content: reportPdf(result, meta) };
  const table = reportTable(result);
  if (format === "xlsx") return { filename, contentType: XLSX_TYPE, content: tableXlsx(table) };
  return { filename, contentType: "text/csv", content: Buffer.from(tableCsv(table), "utf8") };
}
