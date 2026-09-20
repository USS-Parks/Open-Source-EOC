import type { IncidentAreaGeometry, IncidentAreaRevision, IncidentAreaUpdate } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority } from "./participation.js";

async function incident(sql: Sql, actor: Principal, incidentId: string) {
  return getIncidentAuthority(sql, actor, incidentId);
}

const revisionSelect = `
  select a.incident_id, a.revision, ST_AsGeoJSON(a.geometry)::jsonb as geometry,
         a.period_label, a.period_starts_at, a.period_ends_at, a.reason,
         a.created_at, a.created_by, p.display_name as created_by_name,
         a.position_id, pos.title as position_title,
         coalesce(home.name, owner.name) as home_organization_name,
         coalesce(a.incident_position_title, pos.title) as incident_position_title
  from incident_area_revisions a
  join persons p on p.id = a.created_by
  left join positions pos on pos.id = a.position_id
  left join jurisdictions home on home.id = a.home_organization_id
  join incidents i on i.id = a.incident_id
  join jurisdictions owner on owner.id = i.jurisdiction_id`;

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
    homeOrganizationName: (row.home_organization_name as string | null) ?? null,
    incidentPositionTitle: (row.incident_position_title as string | null) ?? null,
  };
}

function initialRevision(incidentId: string): IncidentAreaRevision {
  return {
    incidentId, revision: 0, geometry: null, operationalPeriod: null, reason: "",
    createdAt: null, createdBy: null, createdByName: null, positionId: null, positionTitle: null,
    homeOrganizationName: null, incidentPositionTitle: null,
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
  const authority = await incident(sql, actor, incidentId);
  const jurisdictionId = authority.jurisdictionId;
  if (!authority.canEditArea)
    throw new AuthError(403, "requires incident area coordinator");
  if (authority.canManageParticipation && actor.position &&
      actor.position.jurisdictionId !== jurisdictionId)
    throw new AuthError(403, "sign into a position in the incident jurisdiction");
  const [locked] = await sql`
    select lock_incident_area(${incidentId}) as closed_at`;
  if (locked?.closed_at) throw new AuthError(409, "incident is closed");
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
       period_ends_at, reason, created_by, position_id,
       home_organization_id, incident_position_title, participation_id)
    values (${incidentId}, ${revision}, ST_GeomFromGeoJSON(${geojson}),
      ${input.operationalPeriod?.label ?? null},
      ${input.operationalPeriod ? new Date(input.operationalPeriod.startsAt) : null},
      ${input.operationalPeriod ? new Date(input.operationalPeriod.endsAt) : null},
      ${input.reason}, ${actor.person.id},
      ${authority.canManageParticipation ? actor.position?.id ?? null : null},
      ${authority.canManageParticipation ? jurisdictionId : authority.participation?.organizationId ?? null},
      ${authority.canManageParticipation ? actor.position?.title ?? null : authority.participation?.incidentPositionTitle ?? null},
      ${authority.canManageParticipation ? null : authority.participation?.id ?? null})`;
  await recordAudit(sql, actor, {
    jurisdictionId, incidentId, category: "incident.area.revised",
    subjectTable: "incident_area_revisions", subjectId: incidentId,
    payload: { revision, reason: input.reason,
      homeOrganizationId: authority.canManageParticipation ? jurisdictionId : authority.participation?.organizationId,
      incidentPositionTitle: authority.canManageParticipation ? actor.position?.title ?? null : authority.participation?.incidentPositionTitle,
      participationId: authority.canManageParticipation ? null : authority.participation?.id },
  });
  const [row] = await sql.unsafe(`${revisionSelect} where a.incident_id = $1 and a.revision = $2`, [incidentId, revision]);
  return toRevision(row!, incidentId);
}
