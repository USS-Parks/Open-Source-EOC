import type { Sql } from "../db/client.js";
import { recordAudit } from "../audit/service.js";
import {
  CURSOR_AT_FORMAT,
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  type PageRequest,
} from "../db/cursor.js";
import { AuthError, requireAdmin, type Principal } from "./service.js";

/**
 * Jurisdiction administration behind the operator screen: people and their
 * roles, account disable, second-factor reset, guest grants and position
 * holders. Every function runs inside withPerson; row-level security and the
 * functions of migration 0113 repeat each check underneath. Routes forget the
 * affected person's cached principals after the transaction commits.
 */

export type Role = "admin" | "member" | "viewer";

export interface Member {
  readonly personId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: Role;
  readonly disabled: boolean;
  readonly mfaEnrolled: boolean;
  readonly instanceAdmin: boolean;
}

export async function listMembers(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
): Promise<{
  jurisdiction: { id: string; slug: string; name: string };
  members: Member[];
  nextCursor: string | null;
}> {
  requireAdmin(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["key", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const [jurisdiction] = await sql`select id, slug, name from jurisdictions where id = ${jurisdictionId}`;
  const rows = await sql`
    select p.id, p.display_name, p.email, p.disabled, p.is_instance_admin, m.role,
      p.id in (select members_with_mfa(${jurisdictionId})) as mfa_enrolled
    from jurisdiction_memberships m join persons p on p.id = m.person_id
    where m.jurisdiction_id = ${jurisdictionId}
      ${after ? sql`and (p.display_name, p.id) > (${after[0]!}, ${after[1]!}::uuid)` : sql``}
    order by p.display_name, p.id
    limit ${limit + 1}`;
  const members = rows.slice(0, limit).map((r) => ({
    personId: r.id as string,
    displayName: r.display_name as string,
    email: r.email as string,
    role: r.role as Role,
    disabled: Boolean(r.disabled),
    mfaEnrolled: Boolean(r.mfa_enrolled),
    instanceAdmin: Boolean(r.is_instance_admin),
  }));
  const last = rows.length > limit ? members.at(-1)! : null;
  return {
    jurisdiction: {
      id: jurisdiction!.id as string,
      slug: jurisdiction!.slug as string,
      name: jurisdiction!.name as string,
    },
    members,
    nextCursor: last ? encodeCursor([last.displayName, last.personId]) : null,
  };
}

/** An account by email, so an admin can add, grant to or provision an existing person. */
export async function findPerson(
  sql: Sql,
  actor: Principal,
  email: string,
): Promise<{ id: string; displayName: string; email: string }> {
  if (!actor.isInstanceAdmin && !actor.memberships.some((m) => m.role === "admin"))
    throw new AuthError(403, "requires an administrator");
  const [row] = await sql`
    select id, display_name, email from persons where lower(email) = lower(${email})`;
  if (!row) throw new AuthError(404, "no account uses that email");
  return { id: row.id as string, displayName: row.display_name as string, email: row.email as string };
}

/**
 * Hold the jurisdiction's admin set still for this transaction, and refuse a
 * change that would leave it with no admin. Called before `personId` loses
 * the admin role or its membership.
 */
async function keepAnAdmin(sql: Sql, jurisdictionId: string, personId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`admins:${jurisdictionId}`}, 0))`;
  const [row] = await sql`
    select count(*)::int as n from jurisdiction_memberships
    where jurisdiction_id = ${jurisdictionId} and role = 'admin' and person_id <> ${personId}`;
  if (row!.n === 0) throw new AuthError(409, "the jurisdiction must keep at least one administrator");
}

async function currentRole(sql: Sql, jurisdictionId: string, personId: string): Promise<Role | null> {
  const [row] = await sql`
    select role from jurisdiction_memberships
    where jurisdiction_id = ${jurisdictionId} and person_id = ${personId}`;
  return (row?.role as Role | undefined) ?? null;
}

/** Add a person to the jurisdiction, or change the role they hold there. */
export async function setMemberRole(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  personId: string,
  role: Role,
): Promise<void> {
  requireAdmin(actor, jurisdictionId);
  const [person] = await sql`select id from persons where id = ${personId}`;
  if (!person) throw new AuthError(404, "person not found");
  if (role !== "admin") await keepAnAdmin(sql, jurisdictionId, personId);
  const previous = await currentRole(sql, jurisdictionId, personId);
  if (previous === role) return;
  await sql`
    insert into jurisdiction_memberships (person_id, jurisdiction_id, role)
    values (${personId}, ${jurisdictionId}, ${role})
    on conflict (person_id, jurisdiction_id) do update set role = excluded.role`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: previous ? "membership.role.changed" : "membership.added",
    subjectTable: "persons",
    subjectId: personId,
    payload: { role, previousRole: previous },
  });
}

/** Remove a membership and end the person's position assignments in the jurisdiction. */
export async function removeMember(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  personId: string,
): Promise<void> {
  requireAdmin(actor, jurisdictionId);
  await keepAnAdmin(sql, jurisdictionId, personId);
  const previous = await currentRole(sql, jurisdictionId, personId);
  if (!previous) throw new AuthError(404, "not a member of this jurisdiction");
  // Audit first: an admin removing their own membership loses the right to append.
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "membership.removed",
    subjectTable: "persons",
    subjectId: personId,
    payload: { previousRole: previous },
  });
  await sql`
    update position_assignments set revoked_at = now(), revoked_by = ${actor.person.id}
    where person_id = ${personId} and revoked_at is null
      and position_id in (select id from positions where jurisdiction_id = ${jurisdictionId})`;
  await sql`
    delete from jurisdiction_memberships
    where jurisdiction_id = ${jurisdictionId} and person_id = ${personId}`;
}

/** Shared guard for acts on the person rather than the membership. */
async function requirePersonAuthority(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  personId: string,
): Promise<void> {
  requireAdmin(actor, jurisdictionId);
  if (personId === actor.person.id) throw new AuthError(409, "ask another administrator to change your own account");
  if (!(await currentRole(sql, jurisdictionId, personId)))
    throw new AuthError(404, "not a member of this jurisdiction");
  const [row] = await sql`select may_administer_person(${personId}) as ok`;
  if (!row!.ok)
    throw new AuthError(403, "this account belongs to a jurisdiction you do not administer");
}

/** Disable or re-enable sign-in for a person everywhere. */
export async function setPersonDisabled(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  personId: string,
  disabled: boolean,
): Promise<void> {
  await requirePersonAuthority(sql, actor, jurisdictionId, personId);
  await sql`select set_person_disabled(${personId}, ${disabled})`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: disabled ? "person.disabled" : "person.enabled",
    subjectTable: "persons",
    subjectId: personId,
  });
}

/** Remove a person's second factor and recovery codes; they enroll again at the next sign-in. */
export async function resetPersonMfa(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  personId: string,
  reason: string,
): Promise<void> {
  await requirePersonAuthority(sql, actor, jurisdictionId, personId);
  const [row] = await sql`select reset_person_mfa(${personId}) as existed`;
  if (!row!.existed) throw new AuthError(409, "this person has no second factor to reset");
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "person.mfa.reset",
    subjectTable: "persons",
    subjectId: personId,
    payload: { reason },
  });
}

export interface GuestGrantRow {
  readonly id: string;
  readonly person: { id: string; displayName: string; email: string };
  readonly scopes: string[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

/** Guest grants of the jurisdiction, newest first, active and ended alike. */
export async function listGuestGrants(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
): Promise<{ grants: GuestGrantRow[]; nextCursor: string | null }> {
  requireAdmin(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select g.id, g.person_id, p.display_name, p.email, g.scopes, g.expires_at, g.created_at,
      g.revoked_at, to_char(g.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from guest_grants g join persons p on p.id = g.person_id
    where g.jurisdiction_id = ${jurisdictionId}
      ${after ? sql`and (g.created_at, g.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by g.created_at desc, g.id desc
    limit ${limit + 1}`;
  const last = rows.length > limit ? rows[limit - 1]! : null;
  return {
    grants: rows.slice(0, limit).map((r) => ({
      id: r.id as string,
      person: { id: r.person_id as string, displayName: r.display_name as string, email: r.email as string },
      scopes: r.scopes as string[],
      expiresAt: new Date(r.expires_at as string).toISOString(),
      createdAt: new Date(r.created_at as string).toISOString(),
      revokedAt: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
    })),
    nextCursor: last ? encodeCursor([last.page_at as string, last.id as string]) : null,
  };
}

/** Current holders of the jurisdiction's positions. Bounded by the position set. */
export async function listPositionHolders(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<Array<{ positionId: string; personId: string; displayName: string; assignedAt: string }>> {
  requireAdmin(actor, jurisdictionId);
  const rows = await sql`
    select a.position_id, a.person_id, p.display_name, a.assigned_at
    from position_assignments a
    join positions pos on pos.id = a.position_id
    join persons p on p.id = a.person_id
    where pos.jurisdiction_id = ${jurisdictionId} and a.revoked_at is null
    order by pos.key, p.display_name`;
  return rows.map((r) => ({
    positionId: r.position_id as string,
    personId: r.person_id as string,
    displayName: r.display_name as string,
    assignedAt: new Date(r.assigned_at as string).toISOString(),
  }));
}

/** End one person's assignment to a position. */
export async function revokePosition(
  sql: Sql,
  actor: Principal,
  positionId: string,
  personId: string,
): Promise<void> {
  const [pos] = await sql`select jurisdiction_id from positions where id = ${positionId}`;
  if (!pos) throw new AuthError(404, "position not found");
  requireAdmin(actor, pos.jurisdiction_id as string);
  const revoked = await sql`
    update position_assignments set revoked_at = now(), revoked_by = ${actor.person.id}
    where position_id = ${positionId} and person_id = ${personId} and revoked_at is null
    returning id`;
  if (revoked.length === 0) throw new AuthError(404, "no current assignment for this person");
  // The person stops acting in the position now, not at their next sign-out.
  await sql`select end_position_signins(${positionId}, ${personId})`;
  await recordAudit(sql, actor, {
    jurisdictionId: pos.jurisdiction_id as string,
    category: "position.revoked",
    subjectTable: "positions",
    subjectId: positionId,
    payload: { personId },
  });
}
