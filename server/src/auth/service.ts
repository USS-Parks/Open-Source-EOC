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
  const [person] = await sql`
    select id, password_hash, disabled from persons where lower(email) = lower(${email})`;
  // Verify against a constant dummy hash when the user is unknown so the
  // response time does not disclose account existence.
  const stored =
    (person?.password_hash as string | undefined) ??
    "scrypt:32768:8:1:00000000000000000000000000000000:00";
  const ok = verifyPassword(password, stored);
  if (!person || person.disabled || !ok) throw new AuthError(401, "invalid credentials");
  const access = newToken();
  const resume = newToken();
  const [session] = await sql`
    insert into auth_sessions (person_id, access_hash, resume_hash, access_expires_at)
    values (${person.id as string}, ${access.hash}, ${resume.hash},
            ${new Date(Date.now() + ACCESS_TTL_MS)})
    returning id`;
  return { accessToken: access.token, resumeToken: resume.token, sessionId: session!.id as string };
}

/**
 * Session continuity (INV-8): an expired access token is renewed from the
 * resume token on the SAME session row, so the active position and every
 * piece of session context survive the renewal.
 */
export async function resume(sql: Sql, resumeToken: string): Promise<LoginResult> {
  const access = newToken();
  const [session] = await sql`
    update auth_sessions
    set access_hash = ${access.hash},
        access_expires_at = ${new Date(Date.now() + ACCESS_TTL_MS)},
        resumed_at = now()
    where resume_hash = ${hashToken(resumeToken)} and ended_at is null
    returning id, resume_hash`;
  if (!session) throw new AuthError(401, "invalid resume token");
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
  const [row] = await sql`
    select s.id as session_id, s.access_expires_at, s.active_position_id,
           p.id as person_id, p.email, p.display_name, p.disabled
    from auth_sessions s join persons p on p.id = s.person_id
    where s.access_hash = ${hashToken(token)} and s.ended_at is null`;
  if (!row || row.disabled) throw new AuthError(401, "not authenticated");
  if (new Date(row.access_expires_at as string) < new Date())
    throw new AuthError(401, "session expired");
  const memberships = await sql`
    select jurisdiction_id, role from jurisdiction_memberships
    where person_id = ${row.person_id as string}`;
  let position: Principal["position"] = null;
  if (row.active_position_id) {
    const [pos] = await sql`
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
      id: row.person_id as string,
      email: row.email as string,
      displayName: row.display_name as string,
    },
    position,
    memberships: memberships.map((m) => ({
      jurisdictionId: m.jurisdiction_id as string,
      role: m.role as string,
    })),
  };
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
  await sql.begin(async (tx) => {
    await tx`
      update auth_sessions set active_position_id = ${positionId}
      where id = ${actor.sessionId}`;
    await tx`
      insert into position_signins (session_id, person_id, position_id)
      values (${actor.sessionId}, ${actor.person.id}, ${positionId})`;
  });
}

export async function signOutPosition(sql: Sql, actor: Principal): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update auth_sessions set active_position_id = null where id = ${actor.sessionId}`;
    await tx`
      update position_signins set signed_out_at = now()
      where session_id = ${actor.sessionId} and signed_out_at is null`;
  });
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}
