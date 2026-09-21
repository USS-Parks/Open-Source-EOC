import { WorkflowAssignmentRequestSchema, type WorkflowAssignmentRequest } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";

export type ResolvedWorkflowAssignment =
  | {
      readonly kind: "position";
      readonly positionId: string;
      readonly positionKey: string;
      readonly positionTitle: string;
      readonly organizationId: string;
      readonly authority: "local_writer";
    }
  | {
      readonly kind: "incident_participant";
      readonly participantId: string;
      readonly incidentId: string;
      readonly organizationId: string;
      readonly personId: string;
      readonly incidentPositionTitle: string;
      readonly participantRole: "contributor" | "coordinator";
      readonly authority: "incident_owner_admin" | "incident_coordinator";
      readonly actorParticipationId: string | null;
    };

/**
 * Resolve one requested workflow assignee against current database authority.
 * This primitive does not persist routing state. Execution and immutable
 * history are owned by the workflow runtime that consumes the resolution.
 */
export async function resolveWorkflowAssignment(
  sql: Sql,
  actor: Principal,
  sourceJurisdictionId: string,
  raw: WorkflowAssignmentRequest | unknown,
): Promise<ResolvedWorkflowAssignment> {
  const request = WorkflowAssignmentRequestSchema.parse(raw);
  if (request.kind === "position") {
    requireLocalWriter(actor, sourceJurisdictionId);
    const [position] = await sql`
      select id, jurisdiction_id, key, title from positions where id = ${request.positionId}`;
    if (!position) throw new AuthError(404, "position not found");
    if (position.jurisdiction_id !== sourceJurisdictionId) {
      throw new AuthError(400, "position belongs to another organization");
    }
    return {
      kind: "position",
      positionId: position.id as string,
      positionKey: position.key as string,
      positionTitle: position.title as string,
      organizationId: position.jurisdiction_id as string,
      authority: "local_writer",
    };
  }

  const incident = await getIncidentAuthority(sql, actor, request.incidentId);
  let authority: "incident_owner_admin" | "incident_coordinator";
  let actorParticipationId: string | null;
  if (incident.jurisdictionId === sourceJurisdictionId && incident.canManageParticipation) {
    authority = "incident_owner_admin";
    actorParticipationId = null;
  } else if (
    incident.participation?.organizationId === sourceJurisdictionId &&
    incident.participation.role === "coordinator"
  ) {
    authority = "incident_coordinator";
    actorParticipationId = incident.participation.id;
  } else {
    throw new AuthError(403, "cross-organization assignment requires explicit incident authority");
  }

  const [target] = await sql`
    select ip.id, ip.organization_id, ip.person_id, ip.incident_position_title, ip.role
    from incident_participants ip
    where ip.id = ${request.participantId}
      and ip.incident_id = ${request.incidentId}
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)`;
  if (!target) throw new AuthError(404, "active incident participant not found");
  if (target.organization_id === sourceJurisdictionId) {
    throw new AuthError(400, "cross-organization assignment target must be another organization");
  }
  if (target.role !== "contributor" && target.role !== "coordinator") {
    throw new AuthError(403, "incident participant is not authorized to receive assignments");
  }
  return {
    kind: "incident_participant",
    participantId: target.id as string,
    incidentId: request.incidentId,
    organizationId: target.organization_id as string,
    personId: target.person_id as string,
    incidentPositionTitle: target.incident_position_title as string,
    participantRole: target.role as "contributor" | "coordinator",
    authority,
    actorParticipationId,
  };
}

function requireLocalWriter(actor: Principal, jurisdictionId: string): void {
  const membership = actor.memberships.find((item) => item.jurisdictionId === jurisdictionId);
  if (!membership || (membership.role !== "admin" && membership.role !== "member")) {
    throw new AuthError(403, "requires write access to the source organization");
  }
}
