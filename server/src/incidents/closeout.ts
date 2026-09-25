import { RESOURCE_REQUEST_ENDED, type IncidentCloseout } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";

/**
 * Before an administrator closes an incident: the requests and tasks still
 * open, which become read-only history; the participant grants still in
 * force, which keep their read until revoked or expired; and the datasets
 * registered for it, which keep updating.
 */
export async function getIncidentCloseout(sql: Sql, actor: Principal, incidentId: string): Promise<IncidentCloseout> {
  const [incident] = await sql`select jurisdiction_id, closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (!actor.memberships.some((m) => m.jurisdictionId === incident.jurisdiction_id && m.role === "admin"))
    throw new AuthError(403, "only the incident's administrators close it");
  const requests = await sql`
    select id, number, item, state from resource_requests
    where incident_id = ${incidentId} and state <> all(${RESOURCE_REQUEST_ENDED as string[]}::text[])
    order by number`;
  const tasks = await sql`
    select id, number, item from checklist_items where incident_id = ${incidentId} and status <> 'completed' order by number`;
  const grants = await sql`
    select ip.id, p.display_name as person, j.name as organization, ip.expires_at
    from incident_participants ip join persons p on p.id = ip.person_id join jurisdictions j on j.id = ip.organization_id
    where ip.incident_id = ${incidentId} and ip.revoked_at is null and ip.expires_at > now()
    order by j.name, p.display_name`;
  const [datasets] = await sql`
    select count(*)::int as n from data_pack_datasets d join data_packs p on p.id = d.pack_id where p.incident_id = ${incidentId}`;
  return {
    closedAt: incident.closed_at ? new Date(incident.closed_at as string).toISOString() : null,
    openRequests: requests.map((row) => ({ id: row.id as string, number: Number(row.number), item: row.item as string, state: row.state as string })),
    openTasks: tasks.map((row) => ({ id: row.id as string, number: Number(row.number), item: row.item as string })),
    activeGrants: grants.map((row) => ({
      id: row.id as string, person: row.person as string, organization: row.organization as string,
      expiresAt: new Date(row.expires_at as string).toISOString(),
    })),
    datasets: Number(datasets?.n ?? 0),
  };
}
