import { randomUUID } from "node:crypto";
import { CUSTODY_STATES, TRACKING_KINDS } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type PageRequest } from "../db/cursor.js";

/**
 * Scan-first tracking and reunification (F11). Every object is a
 * scan tag with one custody chain that any agency appends to. Restricted
 * details (health, full identity) are masked to anyone below operational
 * staff — the need-to-know wall — while whereabouts stays answerable for
 * reunification. Row access is jurisdiction membership; the field-level
 * masking here is the second wall, matching the board masking pattern.
 */

const KINDS = new Set<string>(TRACKING_KINDS.values);
const STATES = new Set<string>(CUSTODY_STATES.values);

function canSeeRestricted(actor: Principal, jurisdictionId: string): boolean {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  return !!m && (m.role === "admin" || m.role === "member");
}

export interface RegisterInput {
  readonly kind: string;
  readonly label: string;
  readonly tag?: string | undefined;
  readonly restricted?: Record<string, unknown> | undefined;
  readonly station?: string | undefined;
  readonly agency?: string | undefined;
  readonly location?: string | undefined;
}

/** Register an object and open its chain with a `registered` event. */
export async function registerObject(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: RegisterInput,
): Promise<{ id: string; tag: string }> {
  requireWriter(actor, jurisdictionId);
  if (!KINDS.has(input.kind)) throw new AuthError(400, "unknown tracking kind");
  const tag = input.tag?.trim() || `TRK-${randomUUID().slice(0, 8).toUpperCase()}`;
  const [existing] = await sql`
    select 1 from tracked_objects where jurisdiction_id = ${jurisdictionId} and tag = ${tag}`;
  if (existing) throw new AuthError(409, "tag already in use");
  const [row] = await sql`
    insert into tracked_objects (jurisdiction_id, tag, kind, label, restricted, created_by)
    values (${jurisdictionId}, ${tag}, ${input.kind}, ${input.label},
            ${sql.json((input.restricted ?? {}) as never)}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await sql`
    insert into tracking_events
      (object_id, jurisdiction_id, custody_state, station, agency, location, recorded_by)
    values (${id}, ${jurisdictionId}, 'registered', ${input.station ?? null},
            ${input.agency ?? null}, ${input.location ?? null}, ${actor.person.id})`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "tracking.registered",
    subjectTable: "tracked_objects",
    subjectId: id,
    payload: { kind: input.kind, tag },
  });
  return { id, tag };
}

export interface ScanInput {
  readonly tag: string;
  readonly custodyState: string;
  readonly station?: string | undefined;
  readonly agency?: string | undefined;
  readonly location?: string | undefined;
  readonly note?: string | undefined;
}

/**
 * A scan at any station, by any agency, appended to the object's chain.
 * The tag is the only handle needed, which is what lets a chain survive
 * cross-agency handoffs.
 */
export async function scanEvent(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: ScanInput,
): Promise<{ eventId: string }> {
  requireWriter(actor, jurisdictionId);
  if (!STATES.has(input.custodyState)) throw new AuthError(400, "unknown custody state");
  const [obj] = await sql`
    select id from tracked_objects
    where jurisdiction_id = ${jurisdictionId} and tag = ${input.tag}`;
  if (!obj) throw new AuthError(404, "no object with that tag");
  const [row] = await sql`
    insert into tracking_events
      (object_id, jurisdiction_id, custody_state, station, agency, location, note, recorded_by)
    values (${obj.id as string}, ${jurisdictionId}, ${input.custodyState}, ${input.station ?? null},
            ${input.agency ?? null}, ${input.location ?? null}, ${input.note ?? null},
            ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "tracking.scan",
    subjectTable: "tracked_objects",
    subjectId: obj.id as string,
    payload: { custodyState: input.custodyState, station: input.station, agency: input.agency },
  });
  return { eventId: row!.id as string };
}

export interface TrackingEventView {
  readonly custodyState: string;
  readonly station: string | null;
  readonly agency: string | null;
  readonly location: string | null;
  readonly note: string | null;
  readonly occurredAt: string;
}

export interface TrackedObjectView {
  readonly id: string;
  readonly tag: string;
  readonly kind: string;
  readonly label: string;
  /** Present only when the actor is cleared for restricted details. */
  readonly restricted?: Record<string, unknown>;
  readonly restrictedRedacted: boolean;
  /** One page of the custody chain, oldest first. */
  readonly chain: readonly TrackingEventView[];
  /** Cursor for the next page of `chain`; null on the last page. */
  readonly nextCursor: string | null;
}

/** The object with a page of its custody chain; restricted masked by role. */
export async function getObject(
  sql: Sql,
  actor: Principal,
  objectId: string,
  page: PageRequest,
): Promise<TrackedObjectView> {
  const [obj] = await sql`
    select id, jurisdiction_id, tag, kind, label, restricted
    from tracked_objects where id = ${objectId}`;
  if (!obj) throw new AuthError(404, "object not found");
  const jurisdictionId = obj.jurisdiction_id as string;
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select id, custody_state, station, agency, location, note, occurred_at,
      to_char(occurred_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_occurred,
      to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from tracking_events where object_id = ${objectId}
      ${after ? sql`and (occurred_at, created_at, id) > (${after[0]!}::text::timestamptz,
        ${after[1]!}::text::timestamptz, ${after[2]!}::uuid)` : sql``}
    order by occurred_at, created_at, id limit ${limit + 1}`;
  const events = cutPage(rows, limit, (r) => [r.page_occurred as string, r.page_at as string, r.id as string]);
  const cleared = canSeeRestricted(actor, jurisdictionId);
  return {
    id: obj.id as string,
    tag: obj.tag as string,
    kind: obj.kind as string,
    label: obj.label as string,
    ...(cleared ? { restricted: obj.restricted as Record<string, unknown> } : {}),
    restrictedRedacted: !cleared,
    chain: events.items.map((r) => ({
      custodyState: r.custody_state as string,
      station: (r.station as string | null) ?? null,
      agency: (r.agency as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      occurredAt: new Date(r.occurred_at as string).toISOString(),
    })),
    nextCursor: events.nextCursor,
  };
}

export interface ReunificationAnswer {
  readonly tag: string;
  readonly kind: string;
  readonly label: string;
  readonly latest: {
    readonly custodyState: string;
    readonly station: string | null;
    readonly location: string | null;
    readonly occurredAt: string;
  } | null;
}

/**
 * Reunification query: answers where an object is now, by tag or by a
 * label search, for anyone with jurisdiction access. It never reads the
 * restricted column, so it cannot leak health or identity even to a
 * caller who could not open the full record.
 */
export async function reunify(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  query: { tag?: string | undefined; label?: string | undefined },
): Promise<ReunificationAnswer[]> {
  requireMember(actor, jurisdictionId);
  const rows = query.tag
    ? await sql`
        select id, tag, kind, label from tracked_objects
        where jurisdiction_id = ${jurisdictionId} and tag = ${query.tag}`
    : await sql`
        select id, tag, kind, label from tracked_objects
        where jurisdiction_id = ${jurisdictionId}
          and label ilike ${"%" + (query.label ?? "") + "%"}
        order by created_at desc limit 25`;
  const answers: ReunificationAnswer[] = [];
  for (const obj of rows) {
    const [latest] = await sql`
      select custody_state, station, location, occurred_at from tracking_events
      where object_id = ${obj.id as string} order by occurred_at desc, created_at desc limit 1`;
    answers.push({
      tag: obj.tag as string,
      kind: obj.kind as string,
      label: obj.label as string,
      latest: latest
        ? {
            custodyState: latest.custody_state as string,
            station: (latest.station as string | null) ?? null,
            location: (latest.location as string | null) ?? null,
            occurredAt: new Date(latest.occurred_at as string).toISOString(),
          }
        : null,
    });
  }
  return answers;
}
