import { haveToXml, type FacilitySnapshot } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type PageRequest } from "../db/cursor.js";

/**
 * Facility status networks (F10) — the EMResource pattern. A
 * standing registry, an always-on status board, event-driven "report now"
 * queries with response tracking, and EDXL-HAVE export. Staleness is
 * computed against each facility's freshness window.
 */

export interface FacilityInput {
  readonly name: string;
  readonly kind: string;
  readonly contact?: string | undefined;
  readonly staleAfterSeconds?: number | undefined;
  readonly location?: { lon: number; lat: number } | undefined;
}

export async function registerFacility(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: FacilityInput,
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  const geom = input.location
    ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
    : null;
  const [row] = await sql`
    insert into facilities (jurisdiction_id, name, kind, contact, geom, stale_after_seconds, created_by)
    values (${jurisdictionId}, ${input.name}, ${input.kind}, ${input.contact ?? null}, ${geom},
            ${input.staleAfterSeconds ?? 3600}, ${actor.person.id})
    returning id`;
  return { id: row!.id as string };
}

/** The registry fields an edit replaces; a null contact or location clears it. */
export interface FacilityEdit {
  readonly name: string;
  readonly kind: string;
  readonly contact: string | null;
  readonly staleAfterSeconds: number;
  readonly location: { lon: number; lat: number } | null;
}

async function activeFacility(sql: Sql, actor: Principal, facilityId: string): Promise<string> {
  const [facility] = await sql`select jurisdiction_id, retired_at from facilities where id = ${facilityId}`;
  if (!facility) throw new AuthError(404, "facility not found");
  requireWriter(actor, facility.jurisdiction_id as string);
  if (facility.retired_at) throw new AuthError(409, "facility has been removed from the registry");
  return facility.jurisdiction_id as string;
}

export async function updateFacility(
  sql: Sql,
  actor: Principal,
  facilityId: string,
  input: FacilityEdit,
): Promise<void> {
  const jurisdictionId = await activeFacility(sql, actor, facilityId);
  const geom = input.location
    ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
    : null;
  await sql`
    update facilities set name = ${input.name}, kind = ${input.kind}, contact = ${input.contact},
      stale_after_seconds = ${input.staleAfterSeconds}, geom = ${geom}
    where id = ${facilityId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "facility.updated",
    subjectTable: "facilities",
    subjectId: facilityId,
    payload: { name: input.name, kind: input.kind, contact: input.contact,
      staleAfterSeconds: input.staleAfterSeconds, location: input.location },
  });
}

/**
 * Remove a facility from the registry. The row stays, retired, so its status
 * reports and the requests that asked it keep their history; it leaves the
 * board, the map, HAVE and new requests, and no longer holds a request open.
 */
export async function retireFacility(sql: Sql, actor: Principal, facilityId: string): Promise<void> {
  const jurisdictionId = await activeFacility(sql, actor, facilityId);
  await sql`update facilities set retired_at = now(), retired_by = ${actor.person.id} where id = ${facilityId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "facility.retired",
    subjectTable: "facilities",
    subjectId: facilityId,
  });
}

export interface StatusInput {
  readonly operatingStatus: string;
  readonly emsTraffic?: string | undefined;
  readonly beds?: ReadonlyArray<{ bedType: string; available: number; baseline: number }> | undefined;
  readonly capabilities?: readonly string[] | undefined;
  readonly note?: string | undefined;
}

/**
 * Report a facility's current status. If any open query targets this
 * facility, the report answers it (response tracking closes the loop).
 */
export async function reportStatus(
  sql: Sql,
  actor: Principal,
  facilityId: string,
  input: StatusInput,
): Promise<{ reportId: string }> {
  const jurisdictionId = await activeFacility(sql, actor, facilityId);
  const [row] = await sql`
    insert into facility_status_reports
      (facility_id, jurisdiction_id, operating_status, ems_traffic, beds, capabilities, note,
       reported_by)
    values
      (${facilityId}, ${jurisdictionId}, ${input.operatingStatus}, ${input.emsTraffic ?? null},
       ${sql.json((input.beds ?? []) as never)}, ${sql.json((input.capabilities ?? []) as never)},
       ${input.note ?? null}, ${actor.person.id})
    returning id`;
  const reportId = row!.id as string;
  // Close out any open query targets for this facility.
  await sql`
    update status_query_targets t
    set responded_report = ${reportId}, responded_at = now()
    from status_queries q
    where t.query_id = q.id and q.jurisdiction_id = ${jurisdictionId}
      and t.facility_id = ${facilityId} and t.responded_at is null`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "facility.status.reported",
    subjectTable: "facilities",
    subjectId: facilityId,
    payload: { operatingStatus: input.operatingStatus },
  });
  return { reportId };
}

/**
 * A board row: the HAVE snapshot plus the registry fields the operator
 * screen lists and maps. HAVE export serializes only the snapshot fields.
 */
export interface BoardFacility extends FacilitySnapshot {
  readonly contact: string | null;
  readonly location: { lon: number; lat: number } | null;
  readonly staleAfterSeconds: number;
}

async function currentSnapshots(
  sql: Sql,
  jurisdictionId: string,
  kind: string | undefined,
  now: Date,
): Promise<BoardFacility[]> {
  const facilities = kind
    ? await sql`
        select id, name, kind, contact, stale_after_seconds, ST_X(geom) as lon, ST_Y(geom) as lat
        from facilities
        where jurisdiction_id = ${jurisdictionId} and kind = ${kind} and retired_at is null order by name`
    : await sql`
        select id, name, kind, contact, stale_after_seconds, ST_X(geom) as lon, ST_Y(geom) as lat
        from facilities
        where jurisdiction_id = ${jurisdictionId} and retired_at is null order by name`;
  const snapshots: BoardFacility[] = [];
  for (const f of facilities) {
    const [latest] = await sql`
      select operating_status, ems_traffic, beds, capabilities, reported_at
      from facility_status_reports where facility_id = ${f.id as string}
      order by reported_at desc limit 1`;
    const reportedAt = latest ? new Date(latest.reported_at as string) : null;
    const ageSec = reportedAt ? (now.getTime() - reportedAt.getTime()) / 1000 : Infinity;
    snapshots.push({
      organizationId: f.id as string,
      organizationName: f.name as string,
      facilityKind: f.kind as string,
      operatingStatus: (latest?.operating_status as string) ?? "unknown",
      emsTraffic: (latest?.ems_traffic as string | null) ?? undefined,
      beds: (latest?.beds as { bedType: string; available: number; baseline: number }[]) ?? [],
      capabilities: (latest?.capabilities as string[]) ?? [],
      lastUpdate: reportedAt ? reportedAt.toISOString() : "",
      stale: ageSec > (f.stale_after_seconds as number),
      contact: (f.contact as string | null) ?? null,
      location: f.lon === null ? null : { lon: f.lon as number, lat: f.lat as number },
      staleAfterSeconds: f.stale_after_seconds as number,
    });
  }
  return snapshots;
}

/** The always-on status board: every facility's current status + staleness. */
export async function statusBoard(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  kind?: string,
  now = new Date(),
): Promise<BoardFacility[]> {
  requireMember(actor, jurisdictionId);
  return currentSnapshots(sql, jurisdictionId, kind, now);
}

export async function exportHave(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  kind?: string,
  now = new Date(),
): Promise<string> {
  requireMember(actor, jurisdictionId);
  return haveToXml(await currentSnapshots(sql, jurisdictionId, kind, now));
}

/** Launch a "report now" query, fanning out to facilities of a kind. */
export async function launchQuery(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { prompt: string; kind?: string | undefined; dueInSeconds?: number | undefined; incidentId?: string | undefined },
): Promise<{ id: string; targets: number }> {
  requireWriter(actor, jurisdictionId);
  const dueAt = input.dueInSeconds
    ? new Date(Date.now() + input.dueInSeconds * 1000).toISOString()
    : null;
  const [q] = await sql`
    insert into status_queries (jurisdiction_id, incident_id, prompt, target_kind, due_at, created_by)
    values (${jurisdictionId}, ${input.incidentId ?? null}, ${input.prompt},
            ${input.kind ?? null}, ${dueAt}, ${actor.person.id})
    returning id`;
  const queryId = q!.id as string;
  const targets = input.kind
    ? await sql`
        insert into status_query_targets (query_id, facility_id)
        select ${queryId}, id from facilities
        where jurisdiction_id = ${jurisdictionId} and kind = ${input.kind} and retired_at is null
        returning facility_id`
    : await sql`
        insert into status_query_targets (query_id, facility_id)
        select ${queryId}, id from facilities where jurisdiction_id = ${jurisdictionId} and retired_at is null
        returning facility_id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "facility.query.launched",
    subjectTable: "status_queries",
    subjectId: queryId,
    payload: { prompt: input.prompt, kind: input.kind, targets: targets.length },
  });
  return { id: queryId, targets: targets.length };
}

export interface QueryStatus {
  readonly id: string;
  readonly prompt: string;
  readonly total: number;
  readonly responded: number;
  readonly complete: boolean;
  readonly outstanding: ReadonlyArray<{ facilityId: string; name: string }>;
}

/** Response completeness for a query: who has reported, who is outstanding. */
export async function queryStatus(
  sql: Sql,
  actor: Principal,
  queryId: string,
): Promise<QueryStatus> {
  const [q] = await sql`
    select id, jurisdiction_id, prompt from status_queries where id = ${queryId}`;
  if (!q) throw new AuthError(404, "query not found");
  requireMember(actor, q.jurisdiction_id as string);
  // A facility removed before it answered no longer holds the request open.
  const targets = await sql`
    select t.facility_id, t.responded_at, f.name
    from status_query_targets t join facilities f on f.id = t.facility_id
    where t.query_id = ${queryId} and (t.responded_at is not null or f.retired_at is null)
    order by f.name`;
  const responded = targets.filter((t) => t.responded_at !== null).length;
  return {
    id: queryId,
    prompt: q.prompt as string,
    total: targets.length,
    responded,
    complete: targets.length > 0 && responded === targets.length,
    outstanding: targets
      .filter((t) => t.responded_at === null)
      .map((t) => ({ facilityId: t.facility_id as string, name: t.name as string })),
  };
}

export interface StatusQuerySummary extends QueryStatus {
  readonly createdAt: string;
}

/**
 * The jurisdiction's status requests, newest first, each with its answers so
 * far; with an incident, the requests made for it.
 */
export async function listStatusQueries(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId: string | null,
  page: PageRequest,
): Promise<{ queries: StatusQuerySummary[]; nextCursor: string | null }> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select q.id, q.prompt, q.created_at,
      to_char(q.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at,
      -- A facility removed before it answered no longer counts, as in queryStatus.
      count(t.facility_id) filter (where t.responded_at is not null or f.retired_at is null)::int as total,
      count(t.responded_at)::int as responded,
      coalesce(jsonb_agg(jsonb_build_object('facilityId', f.id, 'name', f.name) order by f.name)
        filter (where t.responded_at is null and f.id is not null and f.retired_at is null), '[]') as outstanding
    from status_queries q
    left join status_query_targets t on t.query_id = q.id
    left join facilities f on f.id = t.facility_id
    where q.jurisdiction_id = ${jurisdictionId}
      ${incidentId ? sql`and q.incident_id = ${incidentId}` : sql``}
      ${after ? sql`and (q.created_at, q.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    group by q.id
    order by q.created_at desc, q.id desc limit ${limit + 1}`;
  const cut = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    queries: cut.items.map((r) => ({
      id: r.id as string,
      prompt: r.prompt as string,
      createdAt: new Date(r.created_at as string).toISOString(),
      total: r.total as number,
      responded: r.responded as number,
      complete: (r.total as number) > 0 && r.responded === r.total,
      outstanding: r.outstanding as Array<{ facilityId: string; name: string }>,
    })),
    nextCursor: cut.nextCursor,
  };
}
