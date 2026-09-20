import type { IncidentAreaGeometry, IncidentAreaRevision, IncidentAreaUpdate } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((m) => m.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((m) => m.jurisdictionId === jurisdictionId && m.role === "admin"))
    throw new AuthError(403, "requires jurisdiction admin");
}

async function incident(sql: Sql, actor: Principal, incidentId: string) {
  const [row] = await sql`
    select jurisdiction_id, closed_at from incidents where id = ${incidentId}`;
  if (!row) throw new AuthError(404, "incident not found");
  requireMember(actor, row.jurisdiction_id as string);
  return row;
}

const revisionSelect = `
  select a.incident_id, a.revision, ST_AsGeoJSON(a.geometry)::jsonb as geometry,
         a.period_label, a.period_starts_at, a.period_ends_at, a.reason,
         a.created_at, a.created_by, p.display_name as created_by_name,
         a.position_id, pos.title as position_title
  from incident_area_revisions a
  join persons p on p.id = a.created_by
  left join positions pos on pos.id = a.position_id`;

function toRevision(row: Record<string, unknown>, incidentId: string): IncidentAreaRevision {
  return {
    incidentId,
    revision: Number(row.revision),
    geometry: (row.geometry as IncidentAreaGeometry | null) ?? null,
    operationalPeriod: row.period_label === null ? null : {
      label: row.period_label as string,
      startsAt: new Date(row.period_starts_at as string).toISOString(),
      endsAt: new Date(row.period_ends_at as string).toISOString(),
    },
    reason: row.reason as string,
    createdAt: new Date(row.created_at as string).toISOString(),
    createdBy: row.created_by as string,
    createdByName: row.created_by_name as string,
    positionId: (row.position_id as string | null) ?? null,
    positionTitle: (row.position_title as string | null) ?? null,
  };
}

function initialRevision(incidentId: string): IncidentAreaRevision {
  return {
    incidentId, revision: 0, geometry: null, operationalPeriod: null, reason: "",
    createdAt: null, createdBy: null, createdByName: null, positionId: null, positionTitle: null,
  };
}

export async function getIncidentArea(
  sql: Sql, actor: Principal, incidentId: string,
): Promise<IncidentAreaRevision> {
  await incident(sql, actor, incidentId);
  const [row] = await sql.unsafe(`${revisionSelect} where a.incident_id = $1 order by a.revision desc limit 1`, [incidentId]);
  return row ? toRevision(row, incidentId) : initialRevision(incidentId);
}

export async function listIncidentAreaHistory(
  sql: Sql, actor: Principal, incidentId: string, beforeRevision?: number,
): Promise<IncidentAreaRevision[]> {
  await incident(sql, actor, incidentId);
  const rows = await sql.unsafe(
    `${revisionSelect} where a.incident_id = $1 and ($2::integer is null or a.revision < $2)
     order by a.revision desc limit 50`, [incidentId, beforeRevision ?? null],
  );
  return rows.map((row) => toRevision(row, incidentId));
}

export async function reviseIncidentArea(
  sql: Sql, actor: Principal, incidentId: string, input: IncidentAreaUpdate,
): Promise<IncidentAreaRevision> {
  const owner = await incident(sql, actor, incidentId);
  const jurisdictionId = owner.jurisdiction_id as string;
  requireAdmin(actor, jurisdictionId);
  if (actor.position && actor.position.jurisdictionId !== jurisdictionId)
    throw new AuthError(403, "sign into a position in the incident jurisdiction");
  const [locked] = await sql`
    select closed_at from incidents where id = ${incidentId} for update`;
  if (!locked) throw new AuthError(403, "requires jurisdiction admin");
  if (locked.closed_at) throw new AuthError(409, "incident is closed");
  const [latest] = await sql`
    select revision from incident_area_revisions where incident_id = ${incidentId}
    order by revision desc limit 1`;
  const revision = Number(latest?.revision ?? 0) + 1;
  if (input.expectedRevision !== revision - 1)
    throw new AuthError(409, "incident area revision is stale");

  const geojson = input.geometry ? JSON.stringify(input.geometry) : null;
  if (geojson !== null) {
    const [check] = await sql`
      select ST_IsValid(g) as valid, ST_IsEmpty(g) as empty,
             ST_Area(g) as area, GeometryType(g) as kind
      from (select ST_GeomFromGeoJSON(${geojson}) as g) candidate`;
    if (!check?.valid || check.empty || Number(check.area) <= 0 ||
        !["POLYGON", "MULTIPOLYGON"].includes(check.kind as string))
      throw new AuthError(400, "invalid incident area geometry");
  }

  await sql`
    insert into incident_area_revisions
      (incident_id, revision, geometry, period_label, period_starts_at,
       period_ends_at, reason, created_by, position_id)
    values (${incidentId}, ${revision}, ST_GeomFromGeoJSON(${geojson}),
      ${input.operationalPeriod?.label ?? null},
      ${input.operationalPeriod ? new Date(input.operationalPeriod.startsAt) : null},
      ${input.operationalPeriod ? new Date(input.operationalPeriod.endsAt) : null},
      ${input.reason}, ${actor.person.id}, ${actor.position?.id ?? null})`;
  await recordAudit(sql, actor, {
    jurisdictionId, incidentId, category: "incident.area.revised",
    subjectTable: "incident_area_revisions", subjectId: incidentId,
    payload: { revision, reason: input.reason },
  });
  const [row] = await sql.unsafe(`${revisionSelect} where a.incident_id = $1 and a.revision = $2`, [incidentId, revision]);
  return toRevision(row!, incidentId);
}
