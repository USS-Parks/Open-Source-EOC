import { COMMAND_STAFF, GENERAL_STAFF } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { addMembership, AuthError, createJurisdiction, type Principal } from "./service.js";

/** Human titles for the standard ICS position set (keys from the dictionary). */
const STANDARD_TITLES: Readonly<Record<string, string>> = {
  incident_commander: "Incident Commander",
  public_information_officer: "Public Information Officer",
  safety_officer: "Safety Officer",
  liaison_officer: "Liaison Officer",
  operations_section_chief: "Operations Section Chief",
  planning_section_chief: "Planning Section Chief",
  logistics_section_chief: "Logistics Section Chief",
  finance_admin_section_chief: "Finance/Admin Section Chief",
};

/**
 * One-action provisioning (F16): a new jurisdiction arrives with the ICS
 * Command and General Staff position set and its first admin in a single
 * call. Instance administrators only; the RLS wall enforces the same.
 */
export async function provisionJurisdiction(
  sql: Sql,
  actor: Principal,
  input: { slug: string; name: string; adminPersonId: string },
): Promise<{ jurisdictionId: string; positions: number }> {
  if (!actor.isInstanceAdmin) throw new AuthError(403, "requires instance admin");
  const jurisdictionId = await createJurisdiction(sql, input.slug, input.name);
  await addMembership(sql, input.adminPersonId, jurisdictionId, "admin");
  const keys = [...COMMAND_STAFF.values, ...GENERAL_STAFF.values];
  for (const key of keys) {
    await sql`
      insert into positions (jurisdiction_id, key, title)
      values (${jurisdictionId}, ${key}, ${STANDARD_TITLES[key] ?? key})`;
  }
  return { jurisdictionId, positions: keys.length };
}

/** Mutual-aid guest grant (R3): time-boxed, scope-limited, admin-issued. */
export async function createGuestGrant(
  sql: Sql,
  actor: Principal,
  input: {
    jurisdictionId: string;
    personId: string;
    scopes: readonly string[];
    expiresAt: Date;
  },
): Promise<string> {
  requireAdmin(actor, input.jurisdictionId);
  if (input.expiresAt.getTime() <= Date.now())
    throw new AuthError(400, "grant expiry must be in the future");
  const [row] = await sql`
    insert into guest_grants (jurisdiction_id, person_id, scopes, expires_at, created_by)
    values (${input.jurisdictionId}, ${input.personId}, ${input.scopes as string[]},
            ${input.expiresAt}, ${actor.person.id})
    returning id`;
  return row!.id as string;
}

export async function revokeGuestGrant(
  sql: Sql,
  actor: Principal,
  grantId: string,
): Promise<void> {
  const [grant] = await sql`select jurisdiction_id from guest_grants where id = ${grantId}`;
  if (!grant) throw new AuthError(404, "grant not found");
  requireAdmin(actor, grant.jurisdiction_id as string);
  await sql`
    update guest_grants set revoked_at = now(), revoked_by = ${actor.person.id}
    where id = ${grantId} and revoked_at is null`;
}

/**
 * Read access to a jurisdiction's positions: members always, guests with
 * the positions:read scope while unexpired. First wall here; RLS repeats
 * the same test underneath.
 */
export async function listPositions(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<ReadonlyArray<{ id: string; key: string; title: string }>> {
  const member = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId);
  const guest = actor.guests.some(
    (g) =>
      g.jurisdictionId === jurisdictionId &&
      g.scopes.includes("positions:read") &&
      g.expiresAt.getTime() > Date.now(),
  );
  if (!member && !guest) throw new AuthError(403, "no access to this jurisdiction");
  const rows = await sql`
    select id, key, title from positions where jurisdiction_id = ${jurisdictionId}
    order by key`;
  return rows.map((r) => ({ id: r.id as string, key: r.key as string, title: r.title as string }));
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}
