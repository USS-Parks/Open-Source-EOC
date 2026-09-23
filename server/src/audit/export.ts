import { createHmac, hkdfSync } from "node:crypto";
import type { Sql } from "../db/client.js";
import type { PageRequest } from "../db/cursor.js";
import { AuthError, requireAdmin, type Principal } from "../auth/service.js";
import { listChronology, type ChronologyEntry } from "./service.js";

/**
 * Audit trail export for jurisdiction admins, one chronology page at a time,
 * as CSV or as signed JSON. A JSON page names the cursor it was read from and
 * the cursor for the next page, and the signature covers both, so a verifier
 * can prove a sequence of pages is complete and in order: each page's `cursor`
 * equals the previous page's `nextCursor`, and the last page's is null.
 */

export interface AuditExportPage {
  readonly jurisdictionId: string;
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly firstSeq: number | null;
  readonly lastSeq: number | null;
  readonly entries: readonly ChronologyEntry[];
}

export interface SignedAuditPage {
  readonly page: AuditExportPage;
  readonly signature: { readonly algorithm: "HMAC-SHA256"; readonly value: string };
}

export async function auditExportPage(
  sql: Sql,
  actor: Principal,
  query: PageRequest & { readonly jurisdictionId: string },
): Promise<AuditExportPage> {
  requireAdmin(actor, query.jurisdictionId);
  const page = await listChronology(sql, actor, query);
  return {
    jurisdictionId: query.jurisdictionId,
    cursor: query.cursor ?? null,
    nextCursor: page.nextCursor,
    firstSeq: page.entries[0]?.seq ?? null,
    lastSeq: page.entries.at(-1)?.seq ?? null,
    entries: page.entries,
  };
}

const CSV_HEADER = [
  "seq", "id", "at", "person", "person_id", "position", "position_id", "category",
  "incident_id", "subject_table", "subject_id", "corrects", "payload",
];

/** One CSV document per page: a header row, then one row per event. */
export function auditCsv(entries: readonly ChronologyEntry[]): string {
  const rows = entries.map((e) => [
    String(e.seq), e.id, e.at, e.person, e.personId, e.position ?? "", e.positionId ?? "",
    e.category, e.incidentId ?? "", e.subjectTable ?? "", e.subjectId ?? "", e.corrects ?? "",
    JSON.stringify(e.payload),
  ]);
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * RFC 4180 quoting. A cell a spreadsheet would read as a formula gains a
 * leading single quote, so opening an export never runs one.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Sign a page: HMAC-SHA256 over its RFC 8785 canonical JSON, keyed by HKDF
 * from OPENEOC_SECRET_KEY under its own label, so the signing key is never
 * the key that wraps stored secrets.
 */
export function signAuditPage(page: AuditExportPage): SignedAuditPage {
  const secret = process.env.OPENEOC_SECRET_KEY;
  if (!secret) throw new AuthError(409, "OPENEOC_SECRET_KEY is not set; signed export is unavailable");
  const key = Buffer.from(hkdfSync("sha256", secret, "", "openeoc audit export v1", 32));
  const value = createHmac("sha256", key).update(canonicalJson(page)).digest("hex");
  return { page, signature: { algorithm: "HMAC-SHA256", value } };
}

/** JSON with object keys sorted and no whitespace (RFC 8785 for this data). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
