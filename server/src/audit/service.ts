import type { Sql } from "../db/client.js";
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor, type PageRequest } from "../db/cursor.js";
import { AuthError, requireWriter, type Principal } from "../auth/service.js";

export interface AuditInput {
  readonly jurisdictionId: string;
  readonly category: string;
  readonly subjectTable?: string;
  readonly subjectId?: string;
  readonly payload?: Record<string, unknown>;
  readonly corrects?: string;
  readonly incidentId?: string;
}

/**
 * Append one audit event as the acting principal. Person, position, and
 * the server-side timestamp are never caller-supplied (INV-2). Callers run
 * inside withPerson, so the RLS append policy holds a fourth line.
 */
export async function recordAudit(sql: Sql, actor: Principal, input: AuditInput): Promise<string> {
  const [row] = await sql`
    insert into audit_events
      (jurisdiction_id, incident_id, person_id, position_id, category,
       subject_table, subject_id, payload, corrects)
    values
      (${input.jurisdictionId}, ${input.incidentId ?? null}, ${actor.person.id},
       ${actor.position?.id ?? null}, ${input.category},
       ${input.subjectTable ?? null}, ${input.subjectId ?? null},
       ${sql.json((input.payload ?? {}) as never)}, ${input.corrects ?? null})
    returning id`;
  return row!.id as string;
}

/**
 * A correction never touches the original: it is a new event pointing at
 * it. The chronology renders both, in order, forever.
 */
export async function correctAudit(
  sql: Sql,
  actor: Principal,
  originalEventId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const [original] = await sql`
    select jurisdiction_id, incident_id from audit_events where id = ${originalEventId}`;
  if (!original) throw new AuthError(404, "audit event not found");
  // A correction is a write to the record: viewers may read it, not amend it.
  requireWriter(actor, original.jurisdiction_id as string);
  const incidentId = original.incident_id as string | null;
  return recordAudit(sql, actor, {
    jurisdictionId: original.jurisdiction_id as string,
    ...(incidentId ? { incidentId } : {}),
    category: "correction",
    corrects: originalEventId,
    payload,
  });
}

export interface ChronologyEntry {
  readonly seq: number;
  readonly id: string;
  readonly at: string;
  readonly personId: string;
  readonly person: string;
  readonly positionId: string | null;
  readonly position: string | null;
  readonly incidentId: string | null;
  readonly category: string;
  readonly subjectTable: string | null;
  readonly subjectId: string | null;
  readonly payload: Record<string, unknown>;
  readonly corrects: string | null;
  readonly line: string;
}

export interface ChronologyQuery extends PageRequest {
  readonly jurisdictionId: string;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly positionId?: string | undefined;
  readonly incidentId?: string | undefined;
  readonly category?: readonly string[] | undefined;
}

export interface ChronologyPage {
  readonly entries: ChronologyEntry[];
  /** Opaque cursor for the next page; null on the last page. */
  readonly nextCursor: string | null;
}

/** The whole chronology for a documentation package, read page by page. */
export async function exportChronology(
  sql: Sql,
  actor: Principal,
  query: Omit<ChronologyQuery, "cursor" | "limit">,
): Promise<ChronologyEntry[]> {
  const entries: ChronologyEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await listChronology(sql, actor, { ...query, cursor, limit: 500 });
    entries.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}

/**
 * The reimbursement-grade chronology (F2): ordered, attributed, and
 * renderable as one line per event for documentation packages. Paged in
 * sequence order, so walking every cursor reproduces the whole record.
 */
export async function listChronology(
  sql: Sql,
  actor: Principal,
  query: ChronologyQuery,
): Promise<ChronologyPage> {
  const member = actor.memberships.some((m) => m.jurisdictionId === query.jurisdictionId);
  if (!member) throw new AuthError(403, "no access to this jurisdiction");
  const after = decodeCursor(query.cursor, ["seq"]);
  const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
  const categories = query.category?.length ? query.category : null;
  const rows = await sql`
    select e.seq, e.id, e.created_at, e.person_id, e.position_id, e.incident_id,
           e.category, e.subject_table, e.subject_id, e.payload, e.corrects,
           p.display_name as person, pos.title as position_title
    from audit_events e
    join persons p on p.id = e.person_id
    left join positions pos on pos.id = e.position_id
    where e.jurisdiction_id = ${query.jurisdictionId}
      and (${query.from ?? null}::timestamptz is null or e.created_at >= ${query.from ?? null})
      and (${query.to ?? null}::timestamptz is null or e.created_at <= ${query.to ?? null})
      and (${query.positionId ?? null}::uuid is null or e.position_id = ${query.positionId ?? null})
      and (${query.incidentId ?? null}::uuid is null or e.incident_id = ${query.incidentId ?? null})
      and (${categories}::text[] is null or e.category = any(${categories}::text[]))
      ${after ? sql`and e.seq > ${after[0]!}::bigint` : sql``}
    order by e.seq asc
    limit ${limit + 1}`;
  const entries = rows.slice(0, limit).map((r) => {
    const at = new Date(r.created_at as string).toISOString();
    const position = (r.position_title as string | null) ?? null;
    const who = position ? `${r.person as string} (${position})` : (r.person as string);
    return {
      seq: Number(r.seq),
      id: r.id as string,
      at,
      personId: r.person_id as string,
      person: r.person as string,
      positionId: (r.position_id as string | null) ?? null,
      position,
      incidentId: (r.incident_id as string | null) ?? null,
      category: r.category as string,
      subjectTable: (r.subject_table as string | null) ?? null,
      subjectId: (r.subject_id as string | null) ?? null,
      payload: r.payload as Record<string, unknown>,
      corrects: (r.corrects as string | null) ?? null,
      line: `${at} ${who}: ${r.category as string}${r.corrects ? " (correction)" : ""}`,
    };
  });
  return {
    entries,
    nextCursor: rows.length > limit ? encodeCursor([String(entries.at(-1)!.seq)]) : null,
  };
}
