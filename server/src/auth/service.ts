import type { Sql } from "../db/client.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { hashToken, newToken } from "./tokens.js";

const ACCESS_TTL_MS = 15 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Principal {
  readonly sessionId: string;
  readonly person: { id: string; email: string; displayName: string };
  readonly position: { id: string; key: string; title: string; jurisdictionId: string } | null;
  readonly memberships: ReadonlyArray<{ jurisdictionId: string; role: string }>;
  readonly isInstanceAdmin: boolean;
  readonly guests: ReadonlyArray<{
    jurisdictionId: string;
    scopes: readonly string[];
    expiresAt: Date;
  }>;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly resumeToken: string;
  readonly sessionId: string;
}

export async function createJurisdiction(sql: Sql, slug: string, name: string): Promise<string> {
  const [row] = await sql`
    insert into jurisdictions (slug, name) values (${slug}, ${name}) returning id`;
  return row!.id as string;
}

export async function createPerson(
  sql: Sql,
  input: { email: string; displayName: string; password: string },
): Promise<string> {
  const [row] = await sql`
    insert into persons (email, display_name, password_hash)
    values (${input.email}, ${input.displayName}, ${hashPassword(input.password)})
    returning id`;
  return row!.id as string;
}

export async function addMembership(
  sql: Sql,
  personId: string,
  jurisdictionId: string,
  role: "admin" | "member" | "viewer",
): Promise<void> {
  await sql`
    insert into jurisdiction_memberships (person_id, jurisdiction_id, role)
    values (${personId}, ${jurisdictionId}, ${role})`;
}

export async function login(sql: Sql, email: string, password: string): Promise<LoginResult> {
  // Pre-authentication read: no person context exists yet, so this goes
  // through the SECURITY DEFINER helper (0034) rather than a direct select,
  // which row-level security would now deny.
  const [person] = await sql`
    select id, password_hash, disabled from find_person_by_email(${email})`;
  // Verify against a constant dummy hash when the user is unknown so the
  // response time does not disclose account existence.
  const stored =
    (person?.password_hash as string | undefined) ??
    "scrypt:32768:8:1:00000000000000000000000000000000:00";
  const ok = verifyPassword(password, stored);
  if (!person || person.disabled || !ok) throw new AuthError(401, "invalid credentials");
  return createSession(sql, person.id as string);
}

/** Mint a fresh session for an already-authenticated person. */
export async function createSession(sql: Sql, personId: string): Promise<LoginResult> {
  const access = newToken();
  const resume = newToken();
  // Session rows are minted before a person context exists, through the
  // definer helper (0034); the app role has no direct insert on auth_sessions.
  const [session] = await sql`
    select create_auth_session(${personId}, ${access.hash}, ${resume.hash},
      ${new Date(Date.now() + ACCESS_TTL_MS)}) as id`;
  return { accessToken: access.token, resumeToken: resume.token, sessionId: session!.id as string };
}

/**
 * Session continuity (INV-8): an expired access token is renewed from the
 * resume token on the SAME session row, so the active position and every
 * piece of session context survive the renewal.
 */
export async function resume(sql: Sql, resumeToken: string): Promise<LoginResult> {
  const access = newToken();
  // Resume runs on the resume-token hash alone, before a person context, so
  // it goes through the definer helper (0034); a null id means no live match.
  const [session] = await sql`
    select resume_auth_session(${hashToken(resumeToken)}, ${access.hash},
      ${new Date(Date.now() + ACCESS_TTL_MS)}) as id`;
  if (!session?.id) throw new AuthError(401, "invalid resume token");
  return {
    accessToken: access.token,
    resumeToken,
    sessionId: session.id as string,
  };
}

export async function logout(sql: Sql, sessionId: string): Promise<void> {
  await sql`update auth_sessions set ended_at = now() where id = ${sessionId}`;
  await sql`
    update position_signins set signed_out_at = now()
    where session_id = ${sessionId} and signed_out_at is null`;
}

/** Derive the principal from a bearer token. Server-side only (INV-7). */
export async function principalFromToken(sql: Sql, token: string): Promise<Principal> {
  // Token resolution precedes the person context, so the session/person join
  // runs through the definer helper (0034); RLS then applies to every read
  // below, once the context is set.
  const [row] = await sql`select * from resolve_auth_session(${hashToken(token)})`;
  if (!row || row.disabled) throw new AuthError(401, "not authenticated");
  if (new Date(row.access_expires_at as string) < new Date())
    throw new AuthError(401, "session expired");
  const personId = row.person_id as string;
  // Membership, guest, and position reads run under the person's own RLS
  // context: the principal is derived through the same wall it will act
  // behind, never around it.
  return sql.begin(async (tx) => {
    await tx`select set_config('app.person_id', ${personId}, true)`;
    const memberships = await tx`
      select jurisdiction_id, role from jurisdiction_memberships
      where person_id = ${personId}`;
    const guests = await tx`
      select jurisdiction_id, scopes, expires_at from guest_grants
      where person_id = ${personId} and revoked_at is null and expires_at > now()`;
    const [flags] = await tx`select is_instance_admin from persons where id = ${personId}`;
    let position: Principal["position"] = null;
    if (row.active_position_id) {
      const [pos] = await tx`
        select id, key, title, jurisdiction_id from positions
        where id = ${row.active_position_id as string}`;
      if (pos)
        position = {
          id: pos.id as string,
          key: pos.key as string,
          title: pos.title as string,
          jurisdictionId: pos.jurisdiction_id as string,
        };
    }
    return {
      sessionId: row.session_id as string,
      person: {
        id: personId,
        email: row.email as string,
        displayName: row.display_name as string,
      },
      position,
      memberships: memberships.map((m) => ({
        jurisdictionId: m.jurisdiction_id as string,
        role: m.role as string,
      })),
      isInstanceAdmin: Boolean(flags?.is_instance_admin),
      guests: guests.map((g) => ({
        jurisdictionId: g.jurisdiction_id as string,
        scopes: g.scopes as string[],
        expiresAt: new Date(g.expires_at as string),
      })),
    } satisfies Principal;
  }) as Promise<Principal>;
}

/**
 * Session-less principal for server-internal acts that run AS a person
 * (scheduled feed polls execute under the feed creator's authority). No
 * auth session exists; everything else derives exactly as for a login.
 */
export async function principalForPerson(sql: Sql, personId: string): Promise<Principal> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.person_id', ${personId}, true)`;
    const [person] = await tx`
      select id, email, display_name, disabled, is_instance_admin
      from persons where id = ${personId}`;
    if (!person || person.disabled) throw new AuthError(401, "person unavailable");
    const memberships = await tx`
      select jurisdiction_id, role from jurisdiction_memberships
      where person_id = ${personId}`;
    return {
      sessionId: "system",
      person: {
        id: personId,
        email: person.email as string,
        displayName: person.display_name as string,
      },
      position: null,
      memberships: memberships.map((m) => ({
        jurisdictionId: m.jurisdiction_id as string,
        role: m.role as string,
      })),
      isInstanceAdmin: Boolean(person.is_instance_admin),
      guests: [],
    } satisfies Principal;
  }) as Promise<Principal>;
}

export async function createPosition(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  key: string,
  title: string,
): Promise<string> {
  requireAdmin(actor, jurisdictionId);
  const [row] = await sql`
    insert into positions (jurisdiction_id, key, title)
    values (${jurisdictionId}, ${key}, ${title}) returning id`;
  return row!.id as string;
}

/** Position assignment is an authorized act: jurisdiction admins only. */
export async function assignPosition(
  sql: Sql,
  actor: Principal,
  positionId: string,
  personId: string,
): Promise<void> {
  const [pos] = await sql`select jurisdiction_id from positions where id = ${positionId}`;
  if (!pos) throw new AuthError(404, "position not found");
  requireAdmin(actor, pos.jurisdiction_id as string);
  await sql`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${positionId}, ${personId}, ${actor.person.id})`;
}

/**
 * Reassign a position at shift change: revoke whoever holds it now and
 * assign the incoming person. Distinct from {@link assignPosition}, which is
 * additive; this makes the current holder unambiguous so downstream
 * membership (collaboration channels) tracks the handover.
 */
export async function reassignPosition(
  sql: Sql,
  actor: Principal,
  positionId: string,
  personId: string,
): Promise<void> {
  const [pos] = await sql`select jurisdiction_id from positions where id = ${positionId}`;
  if (!pos) throw new AuthError(404, "position not found");
  requireAdmin(actor, pos.jurisdiction_id as string);
  await sql`
    update position_assignments set revoked_at = now()
    where position_id = ${positionId} and revoked_at is null`;
  await sql`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${positionId}, ${personId}, ${actor.person.id})`;
}

/** Signing into a position requires an active assignment; holding follows. */
export async function signInPosition(
  sql: Sql,
  actor: Principal,
  positionId: string,
): Promise<void> {
  const [assignment] = await sql`
    select id from position_assignments
    where position_id = ${positionId} and person_id = ${actor.person.id}
      and revoked_at is null`;
  if (!assignment) throw new AuthError(403, "not assigned to this position");
  // Callers wrap service calls in withPerson's transaction; these two
  // statements are atomic there.
  await sql`
    update auth_sessions set active_position_id = ${positionId}
    where id = ${actor.sessionId}`;
  await sql`
    insert into position_signins (session_id, person_id, position_id)
    values (${actor.sessionId}, ${actor.person.id}, ${positionId})`;
}

export async function signOutPosition(sql: Sql, actor: Principal): Promise<void> {
  await sql`
    update auth_sessions set active_position_id = null where id = ${actor.sessionId}`;
  await sql`
    update position_signins set signed_out_at = now()
    where session_id = ${actor.sessionId} and signed_out_at is null`;
}

/** Jurisdiction guards shared by every service: admin, writer (admin or member), member. */
export function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}

export function requireWriter(actor: Principal, jurisdictionId: string): "admin" | "member" {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || (m.role !== "admin" && m.role !== "member"))
    throw new AuthError(403, "requires write access to this jurisdiction");
  return m.role;
}

export function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
