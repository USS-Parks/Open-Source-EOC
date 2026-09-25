import type { Sql } from "../db/client.js";
import {
  AuthError,
  requireAdmin,
  requireMember,
  requireWriter,
  type Principal,
} from "../auth/service.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type PageRequest } from "../db/cursor.js";

/**
 * Staffing. Check-in/out is bound to a position and lands in the
 * activity log; badge scans drive fast check-in and carry a client id so a
 * replayed offline scan reconciles to one row; shifts schedule coverage
 * with overlap conflict detection; the staffing summary shows who is on
 * duty, where the coverage gaps are, and which positions sit vacant.
 */

export async function issueBadge(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { personId: string; label?: string | undefined },
): Promise<{ id: string; token: string }> {
  requireAdmin(actor, jurisdictionId);
  const token = newToken();
  const [row] = await sql`
    insert into badges (jurisdiction_id, person_id, token_hash, label, issued_by)
    values (${jurisdictionId}, ${input.personId}, ${token.hash}, ${input.label ?? null},
            ${actor.person.id})
    returning id`;
  return { id: row!.id as string, token: token.token };
}

export interface BadgeEntry {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly label: string | null;
  readonly issuedAt: string;
  readonly revokedAt: string | null;
}

/** The jurisdiction's badges, newest first; a badge's code is never returned. */
export async function listBadges(sql: Sql, actor: Principal, jurisdictionId: string): Promise<BadgeEntry[]> {
  requireAdmin(actor, jurisdictionId);
  const rows = await sql`
    select b.id, b.person_id, p.display_name, b.label, b.created_at, b.revoked_at
    from badges b join persons p on p.id = b.person_id
    where b.jurisdiction_id = ${jurisdictionId}
    order by b.created_at desc, b.id desc limit 500`;
  return rows.map((row) => ({
    id: row.id as string,
    personId: row.person_id as string,
    personName: row.display_name as string,
    label: (row.label as string | null) ?? null,
    issuedAt: new Date(row.created_at as string).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string).toISOString() : null,
  }));
}

/** Revoke a lost or retired badge: its code no longer checks anyone in. */
export async function revokeBadge(sql: Sql, actor: Principal, badgeId: string): Promise<void> {
  const [badge] = await sql`select jurisdiction_id, person_id, revoked_at from badges where id = ${badgeId}`;
  if (!badge) throw new AuthError(404, "badge not found");
  requireAdmin(actor, badge.jurisdiction_id as string);
  if (badge.revoked_at) throw new AuthError(409, "badge already revoked");
  await sql`update badges set revoked_at = now() where id = ${badgeId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: badge.jurisdiction_id as string,
    category: "staff.badge_revoked",
    subjectTable: "badges",
    subjectId: badgeId,
    payload: { personId: badge.person_id as string },
  });
}

export interface CheckInInput {
  readonly personId: string;
  readonly positionId: string;
  readonly method?: "manual" | "scan";
  readonly clientCheckinId?: string | undefined;
  readonly incidentId?: string | undefined;
}

/**
 * Open a check-in. Idempotent on clientCheckinId (a replayed offline scan
 * returns the same row); a person cannot hold two open check-ins on one
 * position. Feeds the activity log.
 */
export async function checkIn(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: CheckInInput,
): Promise<{ id: string; deduplicated: boolean }> {
  requireWriter(actor, jurisdictionId);
  if (input.clientCheckinId) {
    const [existing] = await sql`
      select id from staff_checkins
      where jurisdiction_id = ${jurisdictionId} and client_checkin_id = ${input.clientCheckinId}`;
    if (existing) return { id: existing.id as string, deduplicated: true };
  }
  const [open] = await sql`
    select id from staff_checkins
    where jurisdiction_id = ${jurisdictionId} and person_id = ${input.personId}
      and position_id = ${input.positionId} and checked_out_at is null`;
  if (open) return { id: open.id as string, deduplicated: true };

  const [row] = await sql`
    insert into staff_checkins
      (jurisdiction_id, incident_id, person_id, position_id, method, client_checkin_id,
       checked_in_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.personId}, ${input.positionId},
       ${input.method ?? "manual"}, ${input.clientCheckinId ?? null}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "staff.checkin",
    subjectTable: "staff_checkins",
    subjectId: id,
    payload: { personId: input.personId, positionId: input.positionId, method: input.method ?? "manual" },
  });
  return { id, deduplicated: false };
}

/** Scan check-in: resolve the person from a badge, then check in. */
export async function scanCheckIn(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { badgeToken: string; positionId: string; clientCheckinId?: string | undefined; incidentId?: string | undefined },
): Promise<{ id: string; deduplicated: boolean; personId: string }> {
  requireWriter(actor, jurisdictionId);
  const [badge] = await sql`
    select person_id from badges
    where jurisdiction_id = ${jurisdictionId} and token_hash = ${hashToken(input.badgeToken)}
      and revoked_at is null`;
  if (!badge) throw new AuthError(404, "unknown or revoked badge");
  const personId = badge.person_id as string;
  const result = await checkIn(sql, actor, jurisdictionId, {
    personId,
    positionId: input.positionId,
    method: "scan",
    ...(input.clientCheckinId ? { clientCheckinId: input.clientCheckinId } : {}),
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
  });
  return { ...result, personId };
}

export async function checkOut(
  sql: Sql,
  actor: Principal,
  checkinId: string,
): Promise<void> {
  const [row] = await sql`
    select jurisdiction_id, incident_id, checked_out_at from staff_checkins where id = ${checkinId}`;
  if (!row) throw new AuthError(404, "check-in not found");
  requireWriter(actor, row.jurisdiction_id as string);
  if (row.checked_out_at) throw new AuthError(409, "already checked out");
  await sql`update staff_checkins set checked_out_at = now() where id = ${checkinId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdiction_id as string,
    ...(row.incident_id ? { incidentId: row.incident_id as string } : {}),
    category: "staff.checkout",
    subjectTable: "staff_checkins",
    subjectId: checkinId,
  });
}

export interface CheckinHistoryEntry {
  readonly checkinId: string;
  readonly personId: string;
  readonly personName: string;
  /** The organization the person checked in with. */
  readonly agency: string;
  readonly positionTitle: string;
  readonly checkedInAt: string;
  readonly checkedOutAt: string | null;
  readonly method: string;
}

/**
 * Every check-in, open and closed, earliest first: the ICS-211 list. With an
 * incident, the check-ins made for it and those made to the jurisdiction as a
 * whole, which is how an EOC activation checks its staff in.
 */
export async function checkinHistory(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId: string | null,
  page: PageRequest,
): Promise<{ checkins: CheckinHistoryEntry[]; nextCursor: string | null }> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select c.id, c.person_id, p.display_name, j.name as agency, pos.title, c.checked_in_at,
      c.checked_out_at, c.method,
      to_char(c.checked_in_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from staff_checkins c
    join persons p on p.id = c.person_id
    join positions pos on pos.id = c.position_id
    join jurisdictions j on j.id = c.jurisdiction_id
    where c.jurisdiction_id = ${jurisdictionId}
      ${incidentId ? sql`and (c.incident_id = ${incidentId} or c.incident_id is null)` : sql``}
      ${after ? sql`and (c.checked_in_at, c.id) > (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by c.checked_in_at, c.id limit ${limit + 1}`;
  const cut = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    checkins: cut.items.map((r) => ({
      checkinId: r.id as string,
      personId: r.person_id as string,
      personName: r.display_name as string,
      agency: r.agency as string,
      positionTitle: r.title as string,
      checkedInAt: new Date(r.checked_in_at as string).toISOString(),
      checkedOutAt: r.checked_out_at ? new Date(r.checked_out_at as string).toISOString() : null,
      method: r.method as string,
    })),
    nextCursor: cut.nextCursor,
  };
}

export interface ShiftInput {
  readonly positionId: string;
  readonly personId?: string | undefined;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly note?: string | undefined;
  readonly incidentId?: string | undefined;
}

/** Schedule a shift, refusing overlaps for the same person or position. */
export async function createShift(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: ShiftInput,
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  if (new Date(input.endsAt) <= new Date(input.startsAt))
    throw new AuthError(400, "shift ends before it starts");
  // Overlap: existing.start < new.end AND existing.end > new.start.
  const [positionClash] = await sql`
    select id from shifts
    where jurisdiction_id = ${jurisdictionId} and position_id = ${input.positionId}
      and starts_at < ${input.endsAt} and ends_at > ${input.startsAt} limit 1`;
  if (positionClash) throw new AuthError(409, "position already scheduled for that window");
  if (input.personId) {
    const [personClash] = await sql`
      select id from shifts
      where jurisdiction_id = ${jurisdictionId} and person_id = ${input.personId}
        and starts_at < ${input.endsAt} and ends_at > ${input.startsAt} limit 1`;
    if (personClash) throw new AuthError(409, "person already scheduled for that window");
  }
  const [row] = await sql`
    insert into shifts
      (jurisdiction_id, incident_id, position_id, person_id, starts_at, ends_at, note, created_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.positionId},
       ${input.personId ?? null}, ${input.startsAt}, ${input.endsAt}, ${input.note ?? null},
       ${actor.person.id})
    returning id`;
  return { id: row!.id as string };
}

export interface StaffingSummary {
  readonly onDuty: ReadonlyArray<{
    checkinId: string;
    personId: string;
    personName: string;
    positionId: string;
    positionTitle: string;
    since: string;
    method: string;
  }>;
  /** Cursor for the next page of `onDuty`; the other lists are whole. */
  readonly nextCursor: string | null;
  readonly vacantPositions: ReadonlyArray<{ id: string; key: string; title: string }>;
  readonly upcomingShifts: ReadonlyArray<{
    id: string;
    positionTitle: string;
    personName: string | null;
    startsAt: string;
    endsAt: string;
  }>;
}

/**
 * Live staffing picture: who is currently on duty (paged, earliest check-in
 * first), which positions have no one checked in (vacancies), and the shifts
 * scheduled ahead.
 */
export async function staffingSummary(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
  now = new Date(),
): Promise<StaffingSummary> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const onDutyRows = await sql`
    select c.id, c.person_id, p.display_name, c.position_id, pos.title, c.checked_in_at, c.method,
      to_char(c.checked_in_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from staff_checkins c
    join persons p on p.id = c.person_id
    join positions pos on pos.id = c.position_id
    where c.jurisdiction_id = ${jurisdictionId} and c.checked_out_at is null
      ${after ? sql`and (c.checked_in_at, c.id) > (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by c.checked_in_at, c.id limit ${limit + 1}`;
  const onDuty = cutPage(onDutyRows, limit, (r) => [r.page_at as string, r.id as string]);
  const positions = await sql`
    select id, key, title from positions pos
    where jurisdiction_id = ${jurisdictionId} and not exists (
      select 1 from staff_checkins c where c.position_id = pos.id and c.checked_out_at is null)
    order by key`;
  const shifts = await sql`
    select s.id, pos.title as position_title, p.display_name, s.starts_at, s.ends_at
    from shifts s
    join positions pos on pos.id = s.position_id
    left join persons p on p.id = s.person_id
    where s.jurisdiction_id = ${jurisdictionId} and s.ends_at > ${now}
    order by s.starts_at limit 50`;
  return {
    onDuty: onDuty.items.map((r) => ({
      checkinId: r.id as string,
      personId: r.person_id as string,
      personName: r.display_name as string,
      positionId: r.position_id as string,
      positionTitle: r.title as string,
      since: new Date(r.checked_in_at as string).toISOString(),
      method: r.method as string,
    })),
    nextCursor: onDuty.nextCursor,
    vacantPositions: positions.map((p) => ({ id: p.id as string, key: p.key as string, title: p.title as string })),
    upcomingShifts: shifts.map((s) => ({
      id: s.id as string,
      positionTitle: s.position_title as string,
      personName: (s.display_name as string | null) ?? null,
      startsAt: new Date(s.starts_at as string).toISOString(),
      endsAt: new Date(s.ends_at as string).toISOString(),
    })),
  };
}
