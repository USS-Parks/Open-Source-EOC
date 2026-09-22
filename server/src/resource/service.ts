import {
  canTransition,
  formatCostExport,
  type CostRow,
  type ResourceAssignmentView,
  type ResourceRequestAssignment,
  type ResourceRequestDetail,
  type ResourceRequestSummary,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, principalForPerson, type Principal } from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { recordAudit } from "../audit/service.js";
import { resolveWorkflowAssignment } from "../boards/workflow.js";
import { getIncidentAuthority, lockIncidentMutation } from "../incidents/participation.js";

/**
 * The 213RR resource lifecycle, server side (VEOC-35, F5). A request moves
 * through the NIMS ordering states guarded by the dictionary transition
 * table; every move appends to an immutable chronology and notifies the
 * requester. A request can escalate to a higher tier over a federation peer
 * token and the upper tier reports fulfillment back; costs are captured and
 * export for reimbursement.
 */

export interface SubmitInput {
  readonly origin: "field" | "eoc";
  readonly item: string;
  readonly quantity?: number;
  readonly priority?: string;
  readonly neededBy?: Date | undefined;
  readonly notes?: string | undefined;
  readonly incidentId?: string | undefined;
}

export async function submitRequest(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: SubmitInput,
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  if (input.incidentId) await requireOpenIncidentScope(sql, actor, input.incidentId, jurisdictionId);
  const [row] = await sql`
    insert into resource_requests
      (jurisdiction_id, receiving_organization_id, incident_id, origin, item, quantity, priority, state, notes,
       needed_by, requested_by)
    values
      (${jurisdictionId}, ${jurisdictionId}, ${input.incidentId ?? null}, ${input.origin}, ${input.item},
       ${input.quantity ?? 1}, ${input.priority ?? "routine"}, 'submitted', ${input.notes ?? null},
       ${input.neededBy ?? null}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await appendEvent(sql, id, null, "submitted", "request submitted", actor.person.id, null);
  await notify(sql, jurisdictionId, actor.person.id, `Resource request submitted: ${input.item}`);
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "rr.submitted",
    subjectTable: "resource_requests",
    subjectId: id,
    payload: { item: input.item, origin: input.origin },
  });
  return { id };
}

interface RequestRow {
  jurisdiction_id: string;
  incident_id: string | null;
  state: string;
  item: string;
  requested_by: string;
  assigned_position: string | null;
}

async function loadRequest(sql: Sql, requestId: string): Promise<RequestRow> {
  const [row] = (await sql`
    select jurisdiction_id, incident_id, state, item, requested_by, assigned_position
    from resource_requests where id = ${requestId}`) as unknown as RequestRow[];
  if (!row) throw new AuthError(404, "resource request not found");
  return row;
}

/** Move a request to a new state, enforcing the transition table. */
export async function transition(
  sql: Sql,
  actor: Principal,
  requestId: string,
  toState: string,
  note?: string,
): Promise<{ state: string }> {
  const req = await loadRequest(sql, requestId);
  requireWriter(actor, req.jurisdiction_id);
  if (req.incident_id) await requireOpenIncidentScope(sql, actor, req.incident_id, req.jurisdiction_id);
  if (!canTransition(req.state, toState))
    throw new AuthError(409, `cannot move a request from ${req.state} to ${toState}`);
  await sql`update resource_requests set state = ${toState}, updated_at = now() where id = ${requestId}`;
  await appendEvent(sql, requestId, req.state, toState, note ?? null, actor.person.id, null);
  await notify(sql, req.jurisdiction_id, req.requested_by, `${req.item}: ${req.state} → ${toState}`);
  await recordAudit(sql, actor, {
    jurisdictionId: req.jurisdiction_id,
    ...(req.incident_id ? { incidentId: req.incident_id } : {}),
    category: "rr.transition",
    subjectTable: "resource_requests",
    subjectId: requestId,
    payload: { from: req.state, to: toState },
  });
  return { state: toState };
}

/** Assign a request to a position and move it to the assigned state. */
export async function assign(
  sql: Sql,
  actor: Principal,
  requestId: string,
  assignmentRequest: ResourceRequestAssignment,
): Promise<{ state: string }> {
  const req = await loadRequest(sql, requestId);
  requireWriter(actor, req.jurisdiction_id);
  if (req.incident_id) await requireOpenIncidentScope(sql, actor, req.incident_id, req.jurisdiction_id);
  if (assignmentRequest.kind === "incident_participant" && assignmentRequest.incidentId !== req.incident_id) {
    throw new AuthError(400, "assignment belongs to another incident");
  }
  const assignment = await resolveWorkflowAssignment(sql, actor, req.jurisdiction_id, assignmentRequest);
  await sql`
    update resource_requests set
      assigned_position = ${assignment.kind === "position" ? assignment.positionId : null},
      assigned_participant_id = ${assignment.kind === "incident_participant" ? assignment.participantId : null},
      supplying_organization_id = ${assignment.organizationId}, updated_at = now()
    where id = ${requestId}`;
  const label = assignment.kind === "position" ? assignment.positionTitle : assignment.incidentPositionTitle;
  return transition(sql, actor, requestId, "assigned", `assigned to ${label}`);
}

export interface EscalationPayload {
  readonly originRequestId: string;
  readonly item: string;
  readonly quantity: number;
  readonly priority: string;
  readonly notes: string | null;
}

export type EscalationDeliver = (payload: EscalationPayload) => Promise<void>;

/**
 * Escalate a request to a higher tier over a federation peer. The delivery
 * is injected (the transport that carries it to the peer's receive lane);
 * the escalation is recorded on this instance's chronology.
 */
export async function escalate(
  sql: Sql,
  actor: Principal,
  requestId: string,
  peerName: string,
  deliver: EscalationDeliver,
): Promise<void> {
  const [full] = await sql`
    select jurisdiction_id, incident_id, state, item, quantity, priority, notes from resource_requests
    where id = ${requestId}`;
  if (!full) throw new AuthError(404, "resource request not found");
  requireWriter(actor, full.jurisdiction_id as string);
  if (full.incident_id) {
    await requireOpenIncidentScope(sql, actor, full.incident_id as string, full.jurisdiction_id as string);
  }
  await deliver({
    originRequestId: requestId,
    item: full.item as string,
    quantity: full.quantity as number,
    priority: full.priority as string,
    notes: (full.notes as string | null) ?? null,
  });
  await appendEvent(
    sql,
    requestId,
    full.state as string,
    full.state as string,
    `escalated to ${peerName}`,
    actor.person.id,
    null,
  );
  await recordAudit(sql, actor, {
    jurisdictionId: full.jurisdiction_id as string,
    category: "rr.escalated",
    subjectTable: "resource_requests",
    subjectId: requestId,
    payload: { peer: peerName },
  });
}

/** Receive an escalated request from a peer tier (peer-token authenticated). */
export async function receiveEscalation(
  sql: Sql,
  peerToken: string,
  payload: EscalationPayload,
): Promise<{ id: string }> {
  const [peer] = await sql`
    select name, jurisdiction_id, created_by from peers where token_hash = ${hashToken(peerToken)}`;
  if (!peer) throw new AuthError(401, "unknown peer");
  const local = await principalForPerson(sql, peer.created_by as string);
  return withPerson(sql, local.person.id, async (tx) => {
    const [row] = await tx`
      insert into resource_requests
        (jurisdiction_id, receiving_organization_id, origin, item, quantity, priority, state, notes, requested_by,
         source_peer, source_request_id)
      values
        (${peer.jurisdiction_id as string}, ${peer.jurisdiction_id as string}, 'escalated', ${payload.item}, ${payload.quantity},
         ${payload.priority}, 'submitted', ${payload.notes}, ${local.person.id},
         ${peer.name as string}, ${payload.originRequestId})
      returning id`;
    const id = row!.id as string;
    await appendEvent(tx, id, null, "submitted", `escalated from ${peer.name as string}`, null, peer.name as string);
    await recordAudit(tx, local, {
      jurisdictionId: peer.jurisdiction_id as string,
      category: "rr.received_escalation",
      subjectTable: "resource_requests",
      subjectId: id,
      payload: { peer: peer.name as string, originRequestId: payload.originRequestId },
    });
    return { id };
  });
}

/** A higher tier reports a status change back to the originating request. */
export async function reportBack(
  sql: Sql,
  peerToken: string,
  sourceRequestId: string,
  toState: string,
  note?: string,
): Promise<{ state: string }> {
  const [peer] = await sql`
    select name, jurisdiction_id, created_by from peers where token_hash = ${hashToken(peerToken)}`;
  if (!peer) throw new AuthError(401, "unknown peer");
  const local = await principalForPerson(sql, peer.created_by as string);
  return withPerson(sql, local.person.id, async (tx) => {
    const req = await loadRequest(tx, sourceRequestId);
    if (req.jurisdiction_id !== (peer.jurisdiction_id as string))
      throw new AuthError(403, "request belongs to another jurisdiction");
    if (req.incident_id) await requireOpenIncidentScope(tx, local, req.incident_id, req.jurisdiction_id);
    const applied = canTransition(req.state, toState);
    if (applied)
      await tx`update resource_requests set state = ${toState}, updated_at = now() where id = ${sourceRequestId}`;
    await appendEvent(
      tx,
      sourceRequestId,
      req.state,
      applied ? toState : req.state,
      `${peer.name as string} reported ${toState}${note ? `: ${note}` : ""}`,
      null,
      peer.name as string,
    );
    await recordAudit(tx, local, {
      jurisdictionId: req.jurisdiction_id,
      category: "rr.peer_report",
      subjectTable: "resource_requests",
      subjectId: sourceRequestId,
      payload: { peer: peer.name as string, toState, applied },
    });
    return { state: applied ? toState : req.state };
  });
}

export async function addCost(
  sql: Sql,
  actor: Principal,
  requestId: string,
  input: { category: string; description?: string; amountCents: number; incurredAt?: string | undefined },
): Promise<{ id: string }> {
  const req = await loadRequest(sql, requestId);
  requireWriter(actor, req.jurisdiction_id);
  if (req.incident_id) await requireOpenIncidentScope(sql, actor, req.incident_id, req.jurisdiction_id);
  const [row] = await sql`
    insert into rr_costs (request_id, category, description, amount_cents, incurred_at, recorded_by)
    values (${requestId}, ${input.category}, ${input.description ?? ""}, ${input.amountCents},
            ${input.incurredAt ?? null}, ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId: req.jurisdiction_id,
    category: "rr.cost_recorded",
    subjectTable: "resource_requests",
    subjectId: requestId,
    payload: { amountCents: input.amountCents, category: input.category },
  });
  return { id: row!.id as string };
}

export async function exportCosts(sql: Sql, actor: Principal, requestId: string): Promise<string> {
  const req = await loadRequest(sql, requestId);
  requireMember(actor, req.jurisdiction_id);
  const rows = await sql`
    select category, description, amount_cents, incurred_at from rr_costs
    where request_id = ${requestId} order by created_at`;
  const costRows: CostRow[] = rows.map((r) => ({
    requestId,
    item: req.item,
    category: r.category as string,
    description: r.description as string,
    amountCents: r.amount_cents as number,
    incurredAt: (r.incurred_at as Date).toISOString().slice(0, 10),
  }));
  return formatCostExport(costRows);
}

export interface ChronologyEntry {
  readonly fromState: string | null;
  readonly toState: string;
  readonly note: string | null;
  readonly by: string | null;
  readonly at: string;
}

const requestSelect = `
  select r.id, r.incident_id, r.item, r.quantity, r.priority, r.state,
    receiving.id as receiving_organization_id, receiving.name as receiving_organization_name,
    supplying.id as supplying_organization_id, supplying.name as supplying_organization_name,
    position.id as assigned_position_id, position.key as assigned_position_key,
    position.title as assigned_position_title,
    participant.id as assigned_participant_grant_id,
    participant.incident_id as assigned_participant_incident_id,
    participant.person_id as assigned_participant_person_id,
    participant.incident_position_title as assigned_participant_title,
    participant.role as assigned_participant_role,
    person.display_name as assigned_participant_person_name,
    participant_org.id as assigned_participant_organization_id,
    participant_org.name as assigned_participant_organization_name
  from resource_requests r
  join jurisdictions receiving on receiving.id = coalesce(r.receiving_organization_id, r.jurisdiction_id)
  left join jurisdictions supplying on supplying.id = r.supplying_organization_id
  left join positions position on position.id = r.assigned_position
  left join incident_participants participant on participant.id = r.assigned_participant_id
  left join persons person on person.id = participant.person_id
  left join jurisdictions participant_org on participant_org.id = participant.organization_id
`;

function organization(row: Record<string, unknown>, prefix: "receiving" | "supplying" | "assigned_participant"): { id: string; name: string } | null {
  const id = row[`${prefix}_organization_id`];
  const name = row[`${prefix}_organization_name`];
  return typeof id === "string" && typeof name === "string" ? { id, name } : null;
}

function assignmentView(row: Record<string, unknown>): ResourceAssignmentView | null {
  const participantOrganization = organization(row, "assigned_participant");
  if (typeof row.assigned_participant_grant_id === "string" && participantOrganization) {
    return {
      kind: "incident_participant",
      participantId: row.assigned_participant_grant_id,
      incidentId: row.assigned_participant_incident_id as string,
      personId: row.assigned_participant_person_id as string,
      personName: row.assigned_participant_person_name as string,
      incidentPositionTitle: row.assigned_participant_title as string,
      participantRole: row.assigned_participant_role as "contributor" | "coordinator",
      organization: participantOrganization,
    };
  }
  const supplyingOrganization = organization(row, "supplying");
  if (typeof row.assigned_position_id === "string" && supplyingOrganization) {
    return {
      kind: "position",
      positionId: row.assigned_position_id,
      positionKey: row.assigned_position_key as string,
      positionTitle: row.assigned_position_title as string,
      organization: supplyingOrganization,
    };
  }
  return null;
}

function requestSummary(row: Record<string, unknown>): ResourceRequestSummary {
  const receivingOrganization = organization(row, "receiving");
  if (!receivingOrganization) throw new Error("resource request is missing a receiving organization");
  return {
    id: row.id as string,
    incidentId: (row.incident_id as string | null) ?? null,
    item: row.item as string,
    quantity: Number(row.quantity),
    priority: row.priority as string,
    state: row.state as string,
    receivingOrganization,
    supplyingOrganization: organization(row, "supplying"),
    assignment: assignmentView(row),
  };
}

/**
 * Resource requests visible in a jurisdiction, for the 213RR board. An
 * optional incident narrows the list to that incident's requests (VEOC-79B2);
 * unscoped returns every request in the jurisdiction, so a standing cache with
 * no incident is never silently hidden. Row-level security stays the wall.
 */
export async function listRequests(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId?: string,
): Promise<ResourceRequestSummary[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql.unsafe(`${requestSelect}
    where r.jurisdiction_id = $1 and ($2::uuid is null or r.incident_id = $2)
    order by r.item`, [jurisdictionId, incidentId ?? null]);
  return rows.map((row) => requestSummary(row as Record<string, unknown>));
}

export async function getRequest(
  sql: Sql,
  actor: Principal,
  requestId: string,
): Promise<ResourceRequestDetail> {
  const req = await loadRequest(sql, requestId);
  requireMember(actor, req.jurisdiction_id);
  const [request] = await sql.unsafe(`${requestSelect} where r.id = $1`, [requestId]);
  if (!request) throw new AuthError(404, "resource request not found");
  const events = await sql`
    select e.from_state, e.to_state, e.note, coalesce(person.display_name, e.actor_peer) as by, e.at
    from rr_events e left join persons person on person.id = e.actor_person
    where e.request_id = ${requestId} order by e.at, e.id`;
  return {
    ...requestSummary(request as Record<string, unknown>),
    chronology: events.map((e) => ({
      fromState: (e.from_state as string | null) ?? null,
      toState: e.to_state as string,
      note: (e.note as string | null) ?? null,
      by: (e.by as string | null) ?? null,
      at: (e.at as Date).toISOString(),
    })),
  };
}

async function appendEvent(
  sql: Sql,
  requestId: string,
  fromState: string | null,
  toState: string,
  note: string | null,
  actorPerson: string | null,
  actorPeer: string | null,
): Promise<void> {
  await sql`
    insert into rr_events (request_id, from_state, to_state, note, actor_person, actor_peer)
    values (${requestId}, ${fromState}, ${toState}, ${note}, ${actorPerson}, ${actorPeer})`;
}

async function notify(
  sql: Sql,
  jurisdictionId: string,
  personId: string,
  message: string,
): Promise<void> {
  await sql`
    insert into notifications (jurisdiction_id, person_id, channel, title, body, status)
    values (${jurisdictionId}, ${personId}, 'resource', ${"Resource request"}, ${message}, 'delivered')`;
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}

/**
 * Resource writes use the same incident lock as closeout and participation.
 * The resource remains owned by its receiving jurisdiction; an active
 * incident contributor may scope that organization's request to the incident.
 */
async function requireOpenIncidentScope(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  requestJurisdictionId: string,
): Promise<void> {
  await lockIncidentMutation(sql, incidentId);
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  if (!authority.canContribute)
    throw new AuthError(403, "requires current incident contributor authority");
  if (authority.jurisdictionId !== requestJurisdictionId &&
      authority.participation?.organizationId !== requestJurisdictionId)
    throw new AuthError(403, "incident authority does not cover this receiving organization");
  const [incident] = await sql`select closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (incident.closed_at) throw new AuthError(409, "incident is closed");
}

function requireWriter(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || (m.role !== "admin" && m.role !== "member"))
    throw new AuthError(403, "requires write access to this jurisdiction");
}
