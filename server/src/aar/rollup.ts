import type { AarActionPriority, AarActionStatus, AarRollup } from "@openeoc/shared";
import type { Sql } from "../db/client.js";

/**
 * Corrective actions across every incident the reader may read, for the
 * after-action dashboard's all-incidents scope. Row-level security decides
 * both lists: an incident is listed when the reader is a member of its
 * organization or an active participant, and an action when the reader may
 * read it (a member of the organization that recorded it, or its assigned
 * participant) and its incident is listed. An incident counts when it was
 * active at some time in the range; either end may be open.
 */
export async function aarRollup(
  sql: Sql,
  range: { readonly from?: string | undefined; readonly to?: string | undefined },
): Promise<AarRollup> {
  const incidents = await sql`
    select id, name, jurisdiction_id, activated_at, closed_at from incidents
    where (${range.to ?? null}::timestamptz is null or activated_at < ${range.to ?? null}::timestamptz)
      and (${range.from ?? null}::timestamptz is null or closed_at is null
        or closed_at >= ${range.from ?? null}::timestamptz)
    order by activated_at desc, id`;
  const ids = incidents.map((row) => row.id as string);
  const actions = ids.length === 0 ? [] : await sql`
    select ca.id, ca.incident_id, ca.jurisdiction_id, source.name as organization_name,
      ca.capability, ca.capability_element, ca.recommendation, ca.priority, ca.status,
      to_char(ca.due_date, 'YYYY-MM-DD') as due_date, ca.created_at,
      coalesce(ca.assignment_snapshot ->> 'positionTitle',
        ca.assignment_snapshot ->> 'incidentPositionTitle', pos.title, per.display_name) as owner,
      responsible.id as owner_organization_id, responsible.name as owner_organization_name
    from corrective_actions ca
    left join jurisdictions source on source.id = ca.jurisdiction_id
    left join positions pos on pos.id = ca.owner_position
    left join persons per on per.id = ca.owner_person
    -- A person owner is a member of the recording organization; an assignment names its own.
    left join jurisdictions responsible on responsible.id = coalesce(
      (ca.assignment_snapshot ->> 'organizationId')::uuid, pos.jurisdiction_id,
      case when ca.owner_person is not null then ca.jurisdiction_id end)
    where ca.incident_id = any(${ids}::uuid[])
    order by ca.created_at, ca.id`;
  return {
    incidents: incidents.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      jurisdictionId: row.jurisdiction_id as string,
      activatedAt: new Date(row.activated_at as Date | string).toISOString(),
      closedAt: row.closed_at ? new Date(row.closed_at as Date | string).toISOString() : null,
    })),
    correctiveActions: actions.map((row) => ({
      id: row.id as string,
      incidentId: row.incident_id as string,
      organizationId: row.jurisdiction_id as string,
      organizationName: (row.organization_name as string | null) ?? null,
      capability: row.capability as string,
      capabilityElement: row.capability_element as string,
      recommendation: row.recommendation as string,
      priority: row.priority as AarActionPriority,
      status: row.status as AarActionStatus,
      dueDate: (row.due_date as string | null) ?? null,
      owner: (row.owner as string | null) ?? null,
      ownerOrganization: row.owner_organization_id
        ? { id: row.owner_organization_id as string, name: row.owner_organization_name as string }
        : null,
      createdAt: new Date(row.created_at as Date | string).toISOString(),
    })),
  };
}
