import {
  VolunteerDeploymentSchema,
  VolunteerDeploymentUpdateSchema,
  VolunteerSchema,
  deploymentWarnings,
  type Volunteer,
  type VolunteerAffiliation,
  type VolunteerCredential,
  type VolunteerDeploymentView,
  type VolunteerRoster,
  type VolunteerView,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";

/**
 * Volunteer and CERT roster (VC-20). A jurisdiction's members read its
 * roster and its writers enter and edit it. A partner organization with a
 * grant on one of its incidents enters its own volunteers for that incident
 * and reads only those. How to reach a volunteer is read by the
 * jurisdiction's writers and the entering organization's contributors, and
 * row-level security holds the same line; it never enters an audit payload,
 * since the chronology is read by viewers.
 *
 * Deployments put a volunteer on an incident in a role. Hours are the
 * volunteer's ended deployments, merged where they overlap and cut at local
 * midnight, one row per volunteer per day.
 */

type Row = Record<string, unknown>;
type Scope = { readonly jurisdictionId: string } | { readonly incidentId: string };

interface Reader {
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  /** The partner organization the reader acts for; null for a member of the jurisdiction. */
  readonly organizationId: string | null;
  readonly canWrite: boolean;
}

const iso = (value: unknown): string => new Date(value as string).toISOString();

/**
 * A time zone the database knows by name. An offset such as "+05:30", which
 * a browser accepts, reads with its sign reversed in PostgreSQL, so only
 * names are taken.
 */
async function validTimeZone(sql: Sql, timeZone: string): Promise<string> {
  const [known] = await sql`select 1 from pg_timezone_names where name = ${timeZone}`;
  if (!known) throw new AuthError(400, `timeZone: ${timeZone} is not a time zone name`);
  return timeZone;
}

/** Who is reading, and for what: a member of the jurisdiction, or a partner on one incident. */
async function readerFor(sql: Sql, actor: Principal, scope: Scope): Promise<Reader> {
  const role = (jurisdictionId: string) => actor.memberships.find((m) => m.jurisdictionId === jurisdictionId)?.role;
  if ("jurisdictionId" in scope) {
    const held = role(scope.jurisdictionId);
    if (!held) throw new AuthError(403, "no access to this jurisdiction");
    return { jurisdictionId: scope.jurisdictionId, incidentId: null, organizationId: null, canWrite: held === "admin" || held === "member" };
  }
  const authority = await getIncidentAuthority(sql, actor, scope.incidentId);
  const held = role(authority.jurisdictionId);
  if (held) {
    return { jurisdictionId: authority.jurisdictionId, incidentId: scope.incidentId, organizationId: null, canWrite: held === "admin" || held === "member" };
  }
  if (!authority.participation) throw new AuthError(403, "no access to this incident");
  return {
    jurisdictionId: authority.jurisdictionId,
    incidentId: scope.incidentId,
    organizationId: authority.participation.organizationId,
    canWrite: authority.participation.role !== "viewer",
  };
}

function toView(row: Row, today: string, canSeeContacts: boolean): VolunteerView {
  const credentials = row.credentials as VolunteerCredential[];
  return {
    id: row.id as string,
    name: row.name as string,
    affiliation: row.affiliation as VolunteerAffiliation,
    affiliationName: row.affiliation_name as string,
    skills: row.skills as string[],
    credentials: credentials.map((credential) => ({
      ...credential, expired: credential.expiresOn !== null && credential.expiresOn < today,
    })),
    contact: canSeeContacts && row.phone !== null
      ? { phone: row.phone as string, email: row.email as string } : null,
    enteredBy: row.organization_id ? {
      organizationId: row.organization_id as string,
      organizationName: row.organization_name as string,
      incidentId: row.incident_id as string,
    } : null,
    notes: row.notes as string,
    active: row.active as boolean,
    updatedAt: iso(row.updated_at),
  };
}

/**
 * The roster as the reader may see it. Read for the jurisdiction, it holds
 * every deployment and the hours across incidents; read for an incident, the
 * deployments and hours on that incident, with the whole roster to deploy
 * from for a member, and only the organization's own volunteers for a partner.
 */
export async function volunteerRoster(sql: Sql, actor: Principal, scope: Scope, timeZone: string): Promise<VolunteerRoster> {
  const reader = await readerFor(sql, actor, scope);
  const zone = await validTimeZone(sql, timeZone);
  const [clock] = await sql`select to_char((now() at time zone ${zone})::date, 'YYYY-MM-DD') as today`;
  const today = clock!.today as string;
  const partner = reader.organizationId;
  const volunteerScope = partner
    ? sql`v.organization_id = ${partner} and v.incident_id = ${reader.incidentId}`
    : sql`v.jurisdiction_id = ${reader.jurisdictionId}`;
  const deploymentScope = reader.incidentId
    ? sql`d.incident_id = ${reader.incidentId}`
    : sql`d.jurisdiction_id = ${reader.jurisdictionId}`;
  const ownOnly = partner ? sql`and v.organization_id = ${partner}` : sql``;

  // Contacts are joined under row-level security: a reader who may not see them gets none.
  const volunteers = await sql`
    select v.*, c.phone, c.email, o.name as organization_name
    from volunteers v
    left join volunteer_contacts c on c.volunteer_id = v.id
    left join jurisdictions o on o.id = v.organization_id
    where ${volunteerScope}
    order by v.name, v.id`;

  const deployments = await sql`
    select d.id, d.volunteer_id, v.name as volunteer_name, v.credentials, d.incident_id, i.name as incident_name,
      d.role, d.starts_at, d.ends_at, d.needs, d.note,
      to_char(coalesce(d.ends_at, greatest(d.starts_at, now())) at time zone ${zone}, 'YYYY-MM-DD') as through_day,
      (d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())) as under_way
    from volunteer_deployments d
    join volunteers v on v.id = d.volunteer_id
    join incidents i on i.id = d.incident_id
    where ${deploymentScope} ${ownOnly}
    order by d.starts_at desc, v.name, d.id`;

  // A volunteer's ended deployments are merged where they overlap (two roles
  // at once are one stretch of work) before they are cut into local days.
  const hours = await sql`
    with spans as (
      select d.volunteer_id, d.starts_at as s, d.ends_at as e
      from volunteer_deployments d join volunteers v on v.id = d.volunteer_id
      where ${deploymentScope} ${ownOnly} and d.ends_at is not null and d.ends_at <= now()
    ),
    marked as (
      select sp.*, case when sp.s <= max(sp.e) over (partition by sp.volunteer_id order by sp.s, sp.e
        rows between unbounded preceding and 1 preceding) then 0 else 1 end as starts
      from spans sp
    ),
    islands as (
      select m.*, sum(m.starts) over (partition by m.volunteer_id order by m.s, m.e rows unbounded preceding) as island
      from marked m
    ),
    merged as (
      select volunteer_id, min(s) as s, max(e) as e from islands group by volunteer_id, island
    ),
    cut as (
      select m.volunteer_id, d::date as day,
        greatest(m.s, (d::date)::timestamp at time zone ${zone}) as ds,
        least(m.e, (d::date + 1)::timestamp at time zone ${zone}) as de
      from merged m,
        generate_series((m.s at time zone ${zone})::date, (m.e at time zone ${zone})::date, interval '1 day') d
    )
    select c.volunteer_id, v.name, to_char(c.day, 'YYYY-MM-DD') as day,
      (sum(extract(epoch from (c.de - c.ds))) / 60)::integer as minutes
    from cut c join volunteers v on v.id = c.volunteer_id
    where c.de > c.ds
    group by c.volunteer_id, c.day, v.name
    order by c.day, v.name, c.volunteer_id`;

  return {
    jurisdictionId: reader.jurisdictionId,
    incidentId: reader.incidentId,
    timeZone: zone,
    today,
    volunteers: volunteers.map((row) => toView(row, today, reader.canWrite)),
    deployments: deployments.map((row): VolunteerDeploymentView => ({
      id: row.id as string,
      volunteerId: row.volunteer_id as string,
      volunteerName: row.volunteer_name as string,
      incidentId: row.incident_id as string,
      incidentName: row.incident_name as string,
      role: row.role as string,
      startsAt: iso(row.starts_at),
      endsAt: row.ends_at ? iso(row.ends_at) : null,
      needs: row.needs as string[],
      note: row.note as string,
      warnings: deploymentWarnings(row.credentials as VolunteerCredential[], row.needs as string[], row.through_day as string),
    })),
    hours: hours.map((row) => ({
      volunteerId: row.volunteer_id as string,
      volunteerName: row.name as string,
      date: row.day as string,
      minutes: row.minutes as number,
    })),
    underWay: deployments.filter((row) => row.under_way).map((row) => ({
      deploymentId: row.id as string, volunteerName: row.volunteer_name as string, since: iso(row.starts_at),
    })),
    entry: reader.canWrite ? (partner ? "organization" : "jurisdiction") : null,
    canSeeContacts: reader.canWrite,
  };
}

/** What the chronology keeps of an entry: never how to reach the volunteer. */
const auditOf = (input: Volunteer) => ({
  name: input.name,
  affiliation: input.affiliation,
  active: input.active,
  credentials: input.credentials.map((credential) => ({ name: credential.name, expiresOn: credential.expiresOn })),
});

/**
 * Enter a volunteer: on the jurisdiction's roster by its writers, or, for an
 * incident, by a partner organization's contributor or coordinator as one of
 * that organization's own.
 */
export async function createVolunteer(sql: Sql, actor: Principal, scope: Scope, raw: unknown): Promise<{ id: string }> {
  let jurisdictionId: string;
  let organizationId: string | null = null;
  let incidentId: string | null = null;
  if ("jurisdictionId" in scope) {
    requireWriter(actor, scope.jurisdictionId);
    jurisdictionId = scope.jurisdictionId;
  } else {
    const reader = await readerFor(sql, actor, scope);
    if (!reader.organizationId) throw new AuthError(403, "the jurisdiction's staff add volunteers to its roster, not to one incident");
    if (!reader.canWrite) throw new AuthError(403, "requires a contributor or coordinator grant on this incident");
    ({ jurisdictionId, organizationId, incidentId } = reader);
  }
  const input = VolunteerSchema.parse(raw);
  const [row] = await sql`
    insert into volunteers (jurisdiction_id, organization_id, incident_id, name, affiliation, affiliation_name, skills,
      credentials, notes, active, created_by, updated_by)
    values (${jurisdictionId}, ${organizationId}, ${incidentId}, ${input.name}, ${input.affiliation}, ${input.affiliationName},
      ${input.skills}::text[], ${sql.json(input.credentials as never)}, ${input.notes}, ${input.active}, ${actor.person.id}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await sql`insert into volunteer_contacts (volunteer_id, phone, email) values (${id}, ${input.phone}, ${input.email})`;
  await recordAudit(sql, actor, {
    jurisdictionId, ...(incidentId ? { incidentId } : {}), category: "volunteer.saved", subjectTable: "volunteers", subjectId: id,
    payload: { ...auditOf(input), ...(organizationId ? { organizationId } : {}) },
  });
  return { id };
}

async function writableVolunteer(sql: Sql, volunteerId: string): Promise<Row> {
  const [row] = await sql`
    select id, jurisdiction_id, incident_id, name, active, can_write_volunteer(id) as writable
    from volunteers where id = ${volunteerId}`;
  if (!row) throw new AuthError(404, "volunteer not found");
  if (!row.writable) throw new AuthError(403, "requires write access to this volunteer");
  return row;
}

/** Edit an entry, its contact and its credentials; who entered it and for which incident stay as they were. */
export async function updateVolunteer(sql: Sql, actor: Principal, volunteerId: string, raw: unknown): Promise<{ id: string }> {
  const current = await writableVolunteer(sql, volunteerId);
  const input = VolunteerSchema.parse(raw);
  await sql`
    update volunteers set name = ${input.name}, affiliation = ${input.affiliation}, affiliation_name = ${input.affiliationName},
      skills = ${input.skills}::text[], credentials = ${sql.json(input.credentials as never)}, notes = ${input.notes},
      active = ${input.active}, updated_by = ${actor.person.id}, updated_at = now()
    where id = ${volunteerId}`;
  await sql`update volunteer_contacts set phone = ${input.phone}, email = ${input.email} where volunteer_id = ${volunteerId}`;
  const incidentId = current.incident_id as string | null;
  await recordAudit(sql, actor, {
    jurisdictionId: current.jurisdiction_id as string, ...(incidentId ? { incidentId } : {}),
    category: "volunteer.saved", subjectTable: "volunteers", subjectId: volunteerId, payload: auditOf(input),
  });
  return { id: volunteerId };
}

/**
 * Deploy a volunteer on an incident of their jurisdiction; a partner's
 * volunteer only on the incident they were entered for. A deployment whose
 * role needs a credential the volunteer lacks is kept, and the roster warns
 * of it.
 */
export async function deployVolunteer(sql: Sql, actor: Principal, volunteerId: string, raw: unknown): Promise<{ id: string }> {
  const volunteer = await writableVolunteer(sql, volunteerId);
  const input = VolunteerDeploymentSchema.parse(raw);
  if (!volunteer.active) throw new AuthError(409, `${volunteer.name as string} is inactive; make them active before deploying them`);
  const [incident] = await sql`select jurisdiction_id from incidents where id = ${input.incidentId}`;
  if (!incident || incident.jurisdiction_id !== volunteer.jurisdiction_id) {
    throw new AuthError(400, "incidentId: no incident of the volunteer's jurisdiction");
  }
  if (volunteer.incident_id && volunteer.incident_id !== input.incidentId) {
    throw new AuthError(400, "incidentId: a partner organization's volunteer is deployed only on the incident they were entered for");
  }
  const [row] = await sql`
    insert into volunteer_deployments (volunteer_id, jurisdiction_id, incident_id, role, starts_at, ends_at, needs, note,
      created_by, updated_by)
    values (${volunteerId}, ${volunteer.jurisdiction_id as string}, ${input.incidentId}, ${input.role}, ${input.startsAt},
      ${input.endsAt}, ${input.needs}::text[], ${input.note}, ${actor.person.id}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId: volunteer.jurisdiction_id as string, incidentId: input.incidentId, category: "volunteer.deployment.saved",
    subjectTable: "volunteers", subjectId: volunteerId,
    payload: { deploymentId: id, role: input.role, startsAt: input.startsAt, endsAt: input.endsAt, needs: input.needs },
  });
  return { id };
}

async function writableDeployment(sql: Sql, deploymentId: string): Promise<Row> {
  const [row] = await sql`
    select id, volunteer_id, jurisdiction_id, incident_id, role, starts_at, ends_at,
      can_deploy_volunteer(volunteer_id, incident_id) as writable
    from volunteer_deployments where id = ${deploymentId}`;
  if (!row) throw new AuthError(404, "deployment not found");
  if (!row.writable) throw new AuthError(403, "requires write access to this volunteer");
  return row;
}

/** Change a deployment's role, times, needs or note, such as ending it. */
export async function updateDeployment(sql: Sql, actor: Principal, deploymentId: string, raw: unknown): Promise<{ id: string }> {
  const current = await writableDeployment(sql, deploymentId);
  const input = VolunteerDeploymentUpdateSchema.parse(raw);
  await sql`
    update volunteer_deployments set role = ${input.role}, starts_at = ${input.startsAt}, ends_at = ${input.endsAt},
      needs = ${input.needs}::text[], note = ${input.note}, updated_by = ${actor.person.id}, updated_at = now()
    where id = ${deploymentId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: current.jurisdiction_id as string, incidentId: current.incident_id as string,
    category: "volunteer.deployment.saved", subjectTable: "volunteers", subjectId: current.volunteer_id as string,
    payload: { deploymentId, role: input.role, startsAt: input.startsAt, endsAt: input.endsAt, needs: input.needs },
  });
  return { id: deploymentId };
}

/** Remove a deployment recorded in error; the audit keeps what it was. */
export async function removeDeployment(sql: Sql, actor: Principal, deploymentId: string): Promise<void> {
  const current = await writableDeployment(sql, deploymentId);
  await sql`delete from volunteer_deployments where id = ${deploymentId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: current.jurisdiction_id as string, incidentId: current.incident_id as string,
    category: "volunteer.deployment.removed", subjectTable: "volunteers", subjectId: current.volunteer_id as string,
    payload: {
      deploymentId, role: current.role as string, startsAt: iso(current.starts_at),
      endsAt: current.ends_at ? iso(current.ends_at) : null,
    },
  });
}
