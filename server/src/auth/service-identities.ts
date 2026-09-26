import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SERVICE_IDENTITY_MAX_DAYS,
  ServiceIdentityCreateSchema,
  type ServiceIdentity,
  type ServiceIdentityRole,
  type ServiceIdentityStop,
} from "@openeoc/shared";
import { recordAudit } from "../audit/service.js";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { checkAllowed, recordFailure } from "./rate-limit.js";
import { AuthError, requireAdmin, type Principal } from "./service.js";
import { hashToken, newToken } from "./tokens.js";

/**
 * Service identities (VC-25): named integrations that are not people. Each
 * acts through a backing row in persons with one membership, the identity's
 * jurisdiction at its role (migration 0167), so row-level security holds it
 * to that scope with no policy of its own. A token reads
 * `oeoc-svc.<identity id>.<secret>`; only the secret's SHA-256 is stored, and
 * the database matches the hash the server computes, so no stored hash ever
 * leaves it. An identity acts only while it is not revoked, expired or
 * disabled and its creator still administers its jurisdiction.
 */

const PREFIX = "oeoc-svc.";
const TOKEN = /^oeoc-svc\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
/** Matches no session, so a query that joins on the session finds nothing. */
const NO_SESSION = "00000000-0000-0000-0000-000000000000";
const DAY_MS = 86_400_000;

const STOPPED: Readonly<Record<ServiceIdentityStop, string>> = {
  revoked: "this service identity was revoked",
  expired: "this service identity has expired",
  creator: "this service identity is stopped: the administrator who created it no longer administers its jurisdiction",
  disabled: "this service identity is disabled",
};

export function isServiceToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

/**
 * The principal behind a service token, or null when the token is not one
 * this instance issued. An identity that may not act is refused outright,
 * with the reason: its holder presented the right secret.
 */
export async function servicePrincipal(sql: Sql, token: string): Promise<Principal | null> {
  const match = TOKEN.exec(token);
  if (!match) return null;
  const id = match[1]!;
  const [row] = await sql`select * from service_identity_credential(${id}::uuid, ${hashToken(match[2]!)})`;
  if (!row) return null;
  if (row.stopped) throw new AuthError(401, STOPPED[row.stopped as ServiceIdentityStop]);
  const personId = row.person_id as string;
  // Memberships are read under the identity's own context, the wall it acts behind.
  const memberships = await sql.begin(async (tx) => {
    await tx`select set_config('app.person_id', ${personId}, true)`;
    return tx`select jurisdiction_id, role from jurisdiction_memberships where person_id = ${personId}`;
  });
  return {
    sessionId: NO_SESSION,
    person: { id: personId, email: row.email as string, displayName: row.display_name as string },
    position: null,
    memberships: memberships.map((m) => ({ jurisdictionId: m.jurisdiction_id as string, role: m.role as string })),
    isInstanceAdmin: false,
    guests: [],
    service: { id, name: row.name as string, expiresAt: new Date(row.expires_at as string) },
  };
}

/**
 * Authenticate a request carrying a service token. The token is checked
 * first, so a valid one always passes; only failed tokens count against the
 * source address with the sign-in backoff (threat rows B11, B17), and once
 * an address is locked its failures answer 429. The shared flood limiter
 * bounds the load either way. An identity with the viewer role may only
 * read, whatever a route would allow a viewer.
 */
export async function authenticateServiceToken(
  sql: Sql,
  token: string,
  request: { readonly ip: string; readonly method: string },
): Promise<Principal> {
  const principal = await servicePrincipal(sql, token);
  if (!principal) {
    const key = `service-token:${request.ip}`;
    if (!checkAllowed(key)) throw new AuthError(429, "too many attempts, retry later");
    recordFailure(key);
    throw new AuthError(401, "not authenticated");
  }
  const reads = request.method === "GET" || request.method === "HEAD";
  if (!reads && principal.memberships.every((m) => m.role === "viewer")) {
    throw new AuthError(403, "this service identity may only read");
  }
  return principal;
}

/** Create an identity; the token in the result is never shown again. */
export async function createServiceIdentity(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  raw: unknown,
): Promise<{ identity: ServiceIdentity; token: string }> {
  requireAdmin(actor, jurisdictionId);
  const parsed = ServiceIdentityCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AuthError(400, `${issue?.path.join(".") || "identity"}: ${issue?.message ?? "invalid"}`);
  }
  const input = parsed.data;
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= Date.now()) throw new AuthError(400, "the expiry must be in the future");
  if (expiresAt.getTime() > Date.now() + SERVICE_IDENTITY_MAX_DAYS * DAY_MS) {
    throw new AuthError(400, `the expiry must be within ${SERVICE_IDENTITY_MAX_DAYS} days`);
  }
  const id = randomUUID();
  const secret = newToken();
  const [person] = await sql`
    insert into persons (email, display_name, password_hash, service_identity)
    values (${`${id}@service-identity.invalid`}, ${`${input.name} (service identity)`}, '!service-identity', true)
    returning id`;
  const personId = person!.id as string;
  const [row] = await sql`
    insert into service_identities (id, jurisdiction_id, person_id, name, role, token_hash, created_by, expires_at)
    values (${id}, ${jurisdictionId}, ${personId}, ${input.name}, ${input.role}, ${secret.hash},
            ${actor.person.id}, ${expiresAt})
    returning created_at`;
  await sql`
    insert into jurisdiction_memberships (person_id, jurisdiction_id, role)
    values (${personId}, ${jurisdictionId}, ${input.role})`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "service_identity.created",
    subjectTable: "service_identities",
    subjectId: id,
    payload: { name: input.name, role: input.role, expiresAt: expiresAt.toISOString() },
  });
  return {
    identity: {
      id,
      name: input.name,
      role: input.role,
      createdAt: new Date(row!.created_at as string).toISOString(),
      createdBy: actor.person.displayName,
      expiresAt: expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
      stopped: null,
    },
    token: `${PREFIX}${id}.${secret.token}`,
  };
}

/** The jurisdiction's identities, newest first, live and ended alike. */
export async function listServiceIdentities(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<ServiceIdentity[]> {
  requireAdmin(actor, jurisdictionId);
  // ponytail: unpaged; a jurisdiction keeps a handful of integrations. Page it if that changes.
  const rows = await sql`
    select s.id, s.name, s.role, s.created_at, creator.display_name as created_by, s.expires_at,
      s.last_used_at, s.revoked_at, revoker.display_name as revoked_by,
      coalesce(service_identity_stopped(s.person_id), case when backing.disabled then 'disabled' end) as stopped
    from service_identities s
    join persons backing on backing.id = s.person_id
    join persons creator on creator.id = s.created_by
    left join persons revoker on revoker.id = s.revoked_by
    where s.jurisdiction_id = ${jurisdictionId}
    order by s.created_at desc, s.id desc`;
  const at = (value: unknown) => (value ? new Date(value as string).toISOString() : null);
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as ServiceIdentityRole,
    createdAt: at(r.created_at)!,
    createdBy: r.created_by as string,
    expiresAt: at(r.expires_at)!,
    lastUsedAt: at(r.last_used_at),
    revokedAt: at(r.revoked_at),
    revokedBy: (r.revoked_by as string | null) ?? null,
    stopped: (r.stopped as ServiceIdentityStop | null) ?? null,
  }));
}

/** Revoke at once: the identity's next request is refused. */
export async function revokeServiceIdentity(sql: Sql, actor: Principal, identityId: string): Promise<void> {
  const [identity] = await sql`select jurisdiction_id, name, revoked_at from service_identities where id = ${identityId}`;
  if (!identity) throw new AuthError(404, "service identity not found");
  const jurisdictionId = identity.jurisdiction_id as string;
  requireAdmin(actor, jurisdictionId);
  if (identity.revoked_at) throw new AuthError(409, "this service identity is already revoked");
  const [row] = await sql`select revoke_service_identity(${identityId}) as revoked`;
  if (!row?.revoked) throw new AuthError(409, "this service identity is already revoked");
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "service_identity.revoked",
    subjectTable: "service_identities",
    subjectId: identityId,
    payload: { name: identity.name as string },
  });
}

const Id = z.string().uuid();

/**
 * Administration routes. `authenticatePerson` refuses a service identity, so
 * one can never create, list or revoke identities, whatever its role.
 */
export function serviceIdentityRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticatePerson: (req: FastifyRequest) => Promise<void>,
): void {
  app.get("/api/v1/jurisdictions/:jurisdictionId/service-identities", { preHandler: authenticatePerson }, async (req) => {
    const jurisdictionId = Id.parse((req.params as { jurisdictionId: string }).jurisdictionId);
    const identities = await withPerson(sql, req.principal.person.id, (tx) =>
      listServiceIdentities(tx, req.principal, jurisdictionId));
    return { identities };
  });

  app.post("/api/v1/jurisdictions/:jurisdictionId/service-identities", { preHandler: authenticatePerson }, async (req, reply) => {
    const jurisdictionId = Id.parse((req.params as { jurisdictionId: string }).jurisdictionId);
    try {
      const created = await withPerson(sql, req.principal.person.id, (tx) =>
        createServiceIdentity(tx, req.principal, jurisdictionId, req.body));
      return reply.status(201).header("cache-control", "no-store").send(created);
    } catch (error) {
      if ((error as { code?: unknown }).code === "23505") {
        throw new AuthError(409, "a live service identity in this jurisdiction already has that name");
      }
      throw error;
    }
  });

  app.delete("/api/v1/service-identities/:identityId", { preHandler: authenticatePerson }, async (req) => {
    const identityId = Id.parse((req.params as { identityId: string }).identityId);
    await withPerson(sql, req.principal.person.id, (tx) => revokeServiceIdentity(tx, req.principal, identityId));
    return { ok: true };
  });
}
