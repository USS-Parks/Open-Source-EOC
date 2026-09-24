import type {
  AssessmentAttribution,
  AssessmentDecisionInput,
  StabilizationActionInput,
  WorkflowAssignmentRequest,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import {
  getIncidentAuthority,
  type IncidentAuthority,
} from "../incidents/participation.js";
import { resolveWorkflowAssignment } from "../boards/workflow.js";

export interface WriteContext {
  readonly authority: IncidentAuthority;
  readonly jurisdictionId: string;
  readonly homeOrganizationId: string;
  readonly positionId: string | null;
  readonly positionTitle: string | null;
  readonly participationId: string | null;
}

export interface AssessmentIdentity {
  readonly domain: "lifeline" | "esf";
  readonly framework: string;
  readonly definitionKey: string;
}

export async function requireAssessmentRead(
  sql: Sql, actor: Principal, incidentId: string,
): Promise<IncidentAuthority> {
  return getIncidentAuthority(sql, actor, incidentId);
}

export async function requireAssessmentWrite(
  sql: Sql, actor: Principal, incidentId: string,
): Promise<WriteContext> {
  const initialAuthority = await getIncidentAuthority(sql, actor, incidentId);
  if (!initialAuthority.canContribute) {
    throw new AuthError(403, "requires incident contribution authority");
  }
  const [incident] = await sql`
    select lock_operational_assessment_incident(${incidentId}) as closed_at`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (incident.closed_at) throw new AuthError(409, "incident is closed");
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  if (!authority.canContribute) {
    throw new AuthError(403, "requires current incident contribution authority");
  }
  const participation = authority.participation;
  const isOwnerWriter = actor.memberships.some((membership) =>
    membership.jurisdictionId === authority.jurisdictionId &&
    (membership.role === "admin" || membership.role === "member"));
  if (!isOwnerWriter && !participation) {
    throw new AuthError(403, "requires current incident authority");
  }
  const useActivePosition = isOwnerWriter && actor.position?.jurisdictionId === authority.jurisdictionId;
  return {
    authority,
    jurisdictionId: authority.jurisdictionId,
    homeOrganizationId: isOwnerWriter
      ? authority.jurisdictionId
      : participation!.organizationId,
    positionId: useActivePosition ? actor.position!.id : null,
    positionTitle: useActivePosition
      ? actor.position!.title
      : participation?.incidentPositionTitle ?? null,
    participationId: isOwnerWriter ? null : participation!.id,
  };
}

export async function validateOrganizations(
  sql: Sql, incidentId: string, organizationIds: readonly string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  const rows = await sql`
    select distinct organization_id from (
      select jurisdiction_id as organization_id from incidents where id = ${incidentId}
      union all
      select organization_id from incident_participants
      where incident_id = ${incidentId} and revoked_at is null and expires_at > now()
        and eligible_incident_person(person_id, organization_id)
    ) allowed where organization_id in ${sql(organizationIds as string[])}`;
  const found = new Set(rows.map((row) => row.organization_id as string));
  const missing = organizationIds.find((id) => !found.has(id));
  if (missing) throw new AuthError(400, "responsible organization is not active on this incident");
}

export async function resolveAssessmentActions(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  sourceJurisdictionId: string,
  actions: readonly StabilizationActionInput[],
): Promise<readonly Record<string, unknown>[]> {
  const organizations = actions.flatMap((action) =>
    action.responsibleOrganizationId ? [action.responsibleOrganizationId] : []);
  await validateOrganizations(sql, incidentId, organizations);
  const resolved: Record<string, unknown>[] = [];
  for (const action of actions) {
    if (action.assignment?.kind === "incident_participant" &&
        action.assignment.incidentId !== incidentId) {
      throw new AuthError(400, "action assignment belongs to another incident");
    }
    if (action.linkedResourceRequestId) {
      const [request] = await sql`
        select id from resource_requests
        where id = ${action.linkedResourceRequestId} and incident_id = ${incidentId}`;
      if (!request) throw new AuthError(400, "linked resource request is not attached to this incident");
    }
    if (action.linkedBoardRecordId) {
      const [record] = await sql`
        select r.id from board_records r join incident_boards ib
          on ib.board_id = r.board_id and ib.incident_id = r.incident_id
        where r.id = ${action.linkedBoardRecordId} and r.incident_id = ${incidentId}`;
      if (!record) throw new AuthError(400, "linked board record is not attached to this incident");
    }
    const assignment = action.assignment
      ? await resolveActionOwner(sql, actor, incidentId, sourceJurisdictionId, action.assignment)
      : null;
    resolved.push({ ...action, assignment, assignmentRequest: action.assignment ?? null });
  }
  return resolved;
}

/**
 * The owner a stabilization action names. Where the writer holds assignment
 * authority the workflow rule resolves it, as for any assignment. Otherwise
 * the owner is named: naming records who is expected to act and creates no
 * task or obligation, so any writer of the assessment may name one of the
 * incident's positions or any active participant on the incident with
 * contributor or coordinator standing.
 */
async function resolveActionOwner(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  sourceJurisdictionId: string,
  request: WorkflowAssignmentRequest,
): Promise<Record<string, unknown>> {
  try {
    return await resolveWorkflowAssignment(sql, actor, sourceJurisdictionId, request);
  } catch (refused) {
    if (!(refused instanceof AuthError)) throw refused;
    return nameActionOwner(sql, incidentId, request, refused);
  }
}

async function nameActionOwner(
  sql: Sql,
  incidentId: string,
  request: WorkflowAssignmentRequest,
  refused: AuthError,
): Promise<Record<string, unknown>> {
  if (request.kind === "position") {
    const [position] = await sql`
      select p.id, p.key, p.title, p.jurisdiction_id from incident_positions ip
      join positions p on p.id = ip.position_id
      where ip.incident_id = ${incidentId} and p.id = ${request.positionId}`;
    if (!position) throw refused;
    return {
      kind: "position", positionId: position.id as string, positionKey: position.key as string,
      positionTitle: position.title as string, organizationId: position.jurisdiction_id as string,
      authority: "incident_named",
    };
  }
  if (request.incidentId !== incidentId) throw new AuthError(400, "action assignment belongs to another incident");
  const [participant] = await sql`
    select ip.id, ip.organization_id, ip.person_id, ip.incident_position_title, ip.role
    from incident_participants ip
    where ip.id = ${request.participantId} and ip.incident_id = ${incidentId}
      and ip.revoked_at is null and ip.expires_at > now()
      and ip.role in ('contributor', 'coordinator')
      and eligible_incident_person(ip.person_id, ip.organization_id)`;
  if (!participant) throw new AuthError(404, "active incident participant not found");
  return {
    kind: "incident_participant", participantId: participant.id as string, incidentId,
    organizationId: participant.organization_id as string, personId: participant.person_id as string,
    incidentPositionTitle: participant.incident_position_title as string,
    participantRole: participant.role as string, authority: "incident_named", actorParticipationId: null,
  };
}

export async function validateSupersedes(
  sql: Sql, incidentId: string, identity: AssessmentIdentity, supersedesId?: string,
): Promise<void> {
  if (!supersedesId) return;
  const [row] = await sql`
    select id from operational_assessments
    where id = ${supersedesId} and incident_id = ${incidentId}
      and domain = ${identity.domain} and framework = ${identity.framework}
      and definition_key = ${identity.definitionKey}`;
  if (!row) throw new AuthError(400, "superseded assessment is outside this assessment lineage");
  const [child] = await sql`select id from operational_assessments where supersedes_id = ${supersedesId}`;
  if (child) throw new AuthError(409, "assessment has already been superseded");
}

export function attribution(row: Record<string, unknown>): AssessmentAttribution {
  return {
    personId: row.created_by as string,
    personName: row.person_name as string,
    positionId: (row.position_id as string | null) ?? null,
    positionTitle: (row.position_title as string | null) ?? null,
    participationId: (row.participation_id as string | null) ?? null,
    homeOrganizationId: row.home_organization_id as string,
    homeOrganizationName: row.home_organization_name as string,
    recordedAt: new Date(row.created_at as Date | string).toISOString(),
  };
}

export async function recordDecision(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  identity: AssessmentIdentity,
  input: AssessmentDecisionInput,
): Promise<string> {
  const context = await requireAssessmentWrite(sql, actor, incidentId);
  if (!context.authority.canManageParticipation && context.authority.participation?.role !== "coordinator") {
    throw new AuthError(403, "requires incident owner admin or coordinator");
  }
  const [selected] = await sql`
    select id from operational_assessments
    where id = ${input.selectedAssessmentId} and incident_id = ${incidentId}
      and domain = ${identity.domain} and framework = ${identity.framework}
      and definition_key = ${identity.definitionKey}
      and not exists (select 1 from operational_assessments child
        where child.supersedes_id = operational_assessments.id)`;
  if (!selected) throw new AuthError(400, "selected assessment is not a current report for this item");
  const [created] = await sql`
    insert into operational_assessment_decisions
      (incident_id, jurisdiction_id, domain, framework, definition_key,
       selected_assessment_id, rationale, created_by, position_id, position_title,
       participation_id, home_organization_id)
    values (${incidentId}, ${context.jurisdictionId}, ${identity.domain}, ${identity.framework},
      ${identity.definitionKey}, ${input.selectedAssessmentId}, ${input.rationale},
      ${actor.person.id}, ${context.positionId}, ${context.positionTitle},
      ${context.participationId}, ${context.homeOrganizationId}) returning id`;
  return created!.id as string;
}

export const assessmentSelect = `
  select a.*, p.display_name as person_name, j.name as home_organization_name
  from operational_assessments a
  join persons p on p.id = a.created_by
  join jurisdictions j on j.id = a.home_organization_id`;

export const decisionSelect = `
  select d.*, p.display_name as person_name, j.name as home_organization_name
  from operational_assessment_decisions d
  join persons p on p.id = d.created_by
  join jurisdictions j on j.id = d.home_organization_id`;
