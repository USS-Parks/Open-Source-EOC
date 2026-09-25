import {
  RESOURCE_REQUEST_ENDED,
  RESOURCE_REQUEST_REASON_REQUIRED,
  RESOURCE_STATUS_TRANSITIONS,
  canTransition,
  requestStage,
  isDeliveryStep,
  formatCostExport,
  typeSatisfies,
  type CostRow,
  type PoolResource,
  type ResourceAssignmentView,
  type ResourceRequestAssignment,
  type ResourceRequestDetail,
  type ResourceRequestSummary,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import {
  AuthError,
  principalForPerson,
  requireMember,
  requireWriter,
  type Principal,
} from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type Page, type PageRequest } from "../db/cursor.js";
import { recordAudit } from "../audit/service.js";
import { resolveWorkflowAssignment } from "../boards/workflow.js";
import { getIncidentAuthority, lockIncidentMutation } from "../incidents/participation.js";
import { requireKind } from "./typing.js";

/**
 * The 213RR resource lifecycle, server side (F5). A request moves
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
  /** A kind from the typing catalog and, optionally, the least capable type that fills the request. */
  readonly resourceKind?: string | undefined;
  readonly resourceType?: number | undefined;
}

/**
 * Submit a request and return its receipt: the number, the time it was
 * received, its stage and the organization it went to. Receipt is not
 * acceptance; the receiving organization accepts or declines it next.
 */
export async function submitRequest(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: SubmitInput,
): Promise<ResourceRequestSummary> {
  const { id } = await insertRequest(sql, actor, jurisdictionId, input);
  const [row] = await sql.unsafe(`${requestSelect} where r.id = $1`, [id]);
  return requestSummary(row as Record<string, unknown>);
}

async function insertRequest(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: SubmitInput,
): Promise<{ id: string }> {
  const writer = actor.memberships.some((m) => m.jurisdictionId === jurisdictionId && (m.role === "admin" || m.role === "member"));
  if (!writer && input.incidentId) {
    // The partner requests and the owner assigns: a contributor asks the incident's owner.
    return requestFromIncidentOwner(sql, actor, input.incidentId, jurisdictionId, input);
  }
  requireWriter(actor, jurisdictionId);
  if (input.incidentId) await requireOpenIncidentScope(sql, actor, input.incidentId, jurisdictionId);
  if (input.resourceType !== undefined && !input.resourceKind) throw new AuthError(400, "a type needs a resource kind");
  if (input.resourceKind) await requireKind(sql, jurisdictionId, input.resourceKind, input.resourceType ?? null, false);
  const [row] = await sql`
    insert into resource_requests
      (jurisdiction_id, receiving_organization_id, incident_id, origin, item, quantity, priority, state, notes,
       needed_by, requested_by, resource_kind, resource_type)
    values
      (${jurisdictionId}, ${jurisdictionId}, ${input.incidentId ?? null}, ${input.origin}, ${input.item},
       ${input.quantity ?? 1}, ${input.priority ?? "routine"}, 'submitted', ${input.notes ?? null},
       ${input.neededBy ?? null}, ${actor.person.id}, ${input.resourceKind ?? null}, ${input.resourceType ?? null})
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
  resource_kind: string | null;
  resource_type: number | null;
}

async function loadRequest(sql: Sql, requestId: string): Promise<RequestRow> {
  const [row] = (await sql`
    select jurisdiction_id, incident_id, state, item, requested_by, assigned_position, resource_kind, resource_type
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
  if (await isAssigneeOutsideOwner(sql, actor, requestId, req)) {
    // The participant the request is assigned to records its delivery, and nothing else.
    await lockIncidentMutation(sql, req.incident_id!);
    await requireOpenIncident(sql, req.incident_id!);
    if (!isDeliveryStep(req.state, toState))
      throw new AuthError(403, "an assigned participant records only the delivery steps");
    const [recorded] = await sql`select public.record_request_delivery(${requestId}, ${toState}, ${note ?? null}) as state`;
    if (!recorded?.state) throw new AuthError(409, "the request changed; reload and try again");
    return { state: toState };
  }
  requireWriter(actor, req.jurisdiction_id);
  if (req.incident_id) await requireOpenIncidentScope(sql, actor, req.incident_id, req.jurisdiction_id);
  if (!canTransition(req.state, toState))
    throw new AuthError(409, `cannot move a request from ${requestStage(req.state)} to ${requestStage(toState)}`);
  const reason = note?.trim() ?? "";
  if (RESOURCE_REQUEST_REASON_REQUIRED.includes(toState) && !reason)
    throw new AuthError(400, `give the reason the request is ${requestStage(toState).toLowerCase()}`);
  // Accepting names the owner: this person, as the position they act in.
  const accepting = toState === "accepted";
  const [moved] = await sql`
    update resource_requests set state = ${toState}, updated_at = now(),
      accepted_by = case when ${accepting} then ${actor.person.id}::uuid else accepted_by end,
      accepted_position = case when ${accepting} then ${actor.position?.id ?? null}::uuid else accepted_position end,
      accepted_at = case when ${accepting} then now() else accepted_at end
    where id = ${requestId} and state = ${req.state} returning id`;
  if (!moved) throw new AuthError(409, "the request changed; reload and try again");
  await appendEvent(sql, requestId, req.state, toState, reason || null, actor.person.id, null);
  await notify(sql, req.jurisdiction_id, req.requested_by,
    `${req.item}: ${requestStage(req.state)} → ${requestStage(toState)}${reason ? `. ${reason}` : ""}`);
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
 * is injected (the transport that carries it to the peer's receive lane) and
 * runs outside any transaction; `sql` is the pool. One transaction checks the
 * request and claims it, so a second escalation of it is refused while this
 * one is in flight; a second records the escalation on this instance's
 * chronology and releases the claim, only once the peer has taken it. A
 * failed delivery releases the claim and records nothing.
 */
export async function escalate(
  sql: Sql,
  actor: Principal,
  requestId: string,
  peerName: string,
  deliver: EscalationDeliver,
): Promise<void> {
  const payload = await withPerson(sql, actor.person.id, async (tx): Promise<EscalationPayload> => {
    const [full] = await tx`
      select jurisdiction_id, incident_id, item, quantity, priority, notes from resource_requests
      where id = ${requestId}`;
    if (!full) throw new AuthError(404, "resource request not found");
    requireWriter(actor, full.jurisdiction_id as string);
    if (full.incident_id) {
      await requireOpenIncidentScope(tx, actor, full.incident_id as string, full.jurisdiction_id as string);
    }
    const [claimed] = await tx`
      update resource_requests set escalation_claimed_at = now()
      where id = ${requestId}
        and (escalation_claimed_at is null or escalation_claimed_at < now() - interval '1 minute')
      returning id`;
    if (!claimed) throw new AuthError(409, "this request is already being escalated");
    return {
      originRequestId: requestId,
      item: full.item as string,
      quantity: full.quantity as number,
      priority: full.priority as string,
      notes: (full.notes as string | null) ?? null,
    };
  });
  const release = (tx: Sql) => tx`
    update resource_requests set escalation_claimed_at = null where id = ${requestId}
    returning jurisdiction_id, state`;
  try {
    await deliver(payload);
  } catch (err) {
    await withPerson(sql, actor.person.id, release);
    throw err;
  }
  await withPerson(sql, actor.person.id, async (tx) => {
    const [row] = await release(tx);
    await appendEvent(tx, requestId, row!.state as string, row!.state as string, `escalated to ${peerName}`, actor.person.id, null);
    await recordAudit(tx, actor, {
      jurisdictionId: row!.jurisdiction_id as string,
      category: "rr.escalated",
      subjectTable: "resource_requests",
      subjectId: requestId,
      payload: { peer: peerName },
    });
  });
}

/** Receive an escalated request from a peer tier (peer-token authenticated). */
export async function receiveEscalation(
  sql: Sql,
  peerToken: string,
  payload: EscalationPayload,
): Promise<{ id: string; duplicate: boolean }> {
  const [peer] = await sql`
    select name, jurisdiction_id, created_by from peers where token_hash = ${hashToken(peerToken)}`;
  if (!peer) throw new AuthError(401, "unknown peer");
  const local = await principalForPerson(sql, peer.created_by as string);
  return withPerson(sql, local.person.id, async (tx) => {
    // A repeated delivery of one escalation, as after a lost acknowledgement,
    // answers with the request it made the first time and records nothing new.
    const [row] = await tx`
      insert into resource_requests
        (jurisdiction_id, receiving_organization_id, origin, item, quantity, priority, state, notes, requested_by,
         source_peer, source_request_id)
      values
        (${peer.jurisdiction_id as string}, ${peer.jurisdiction_id as string}, 'escalated', ${payload.item}, ${payload.quantity},
         ${payload.priority}, 'submitted', ${payload.notes}, ${local.person.id},
         ${peer.name as string}, ${payload.originRequestId})
      on conflict (jurisdiction_id, source_peer, source_request_id) where source_request_id is not null do nothing
      returning id`;
    if (!row) {
      const [existing] = await tx`
        select id from resource_requests
        where jurisdiction_id = ${peer.jurisdiction_id as string} and source_peer = ${peer.name as string}
          and source_request_id = ${payload.originRequestId}`;
      return { id: existing!.id as string, duplicate: true };
    }
    const id = row.id as string;
    await appendEvent(tx, id, null, "submitted", `escalated from ${peer.name as string}`, null, peer.name as string);
    await recordAudit(tx, local, {
      jurisdictionId: peer.jurisdiction_id as string,
      category: "rr.received_escalation",
      subjectTable: "resource_requests",
      subjectId: id,
      payload: { peer: peer.name as string, originRequestId: payload.originRequestId },
    });
    return { id, duplicate: false };
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
    // A peer on an earlier version still reports acceptance by its old name.
    if (toState === "triaged") toState = "accepted";
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
            coalesce(${input.incurredAt ?? null}::date, current_date), ${actor.person.id})
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

/** The actor holds the incident grant the request is assigned to and is not in the owning organization. */
async function isAssigneeOutsideOwner(sql: Sql, actor: Principal, requestId: string, req: RequestRow): Promise<boolean> {
  if (!req.incident_id || actor.memberships.some((m) => m.jurisdictionId === req.jurisdiction_id)) return false;
  const [row] = await sql`select public.is_request_assignee(${requestId}) as assignee`;
  return row?.assignee === true;
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
  select r.id, r.number, r.incident_id, r.item, r.quantity, r.priority, r.state,
    r.needed_by, r.notes, r.created_at, r.updated_at,
    requester.display_name as requested_by_name,
    r.accepted_by, acceptor.display_name as accepted_by_name, accepted_position.title as accepted_position_title, r.accepted_at,
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
    participant_org.name as assigned_participant_organization_name,
    r.resource_kind, r.resource_type,
    -- Costs stay with the owning organization; another reader sees none.
    case when public.is_member_of(r.jurisdiction_id)
      then (select coalesce(sum(c.amount_cents), 0) from rr_costs c where c.request_id = r.id)::bigint
    end as cost_cents
  from resource_requests r
  join jurisdictions receiving on receiving.id = coalesce(r.receiving_organization_id, r.jurisdiction_id)
  left join jurisdictions supplying on supplying.id = r.supplying_organization_id
  left join positions position on position.id = r.assigned_position
  left join incident_participants participant on participant.id = r.assigned_participant_id
  left join persons person on person.id = participant.person_id
  left join jurisdictions participant_org on participant_org.id = participant.organization_id
  left join persons requester on requester.id = r.requested_by
  left join persons acceptor on acceptor.id = r.accepted_by
  left join positions accepted_position on accepted_position.id = r.accepted_position
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
    number: Number(row.number),
    incidentId: (row.incident_id as string | null) ?? null,
    item: row.item as string,
    quantity: Number(row.quantity),
    priority: row.priority as string,
    state: row.state as string,
    receivingOrganization,
    supplyingOrganization: organization(row, "supplying"),
    assignment: assignmentView(row),
    resourceKind: (row.resource_kind as string | null) ?? null,
    resourceType: (row.resource_type as number | null) ?? null,
    costCents: row.cost_cents === null || row.cost_cents === undefined ? null : Number(row.cost_cents),
    neededBy: row.needed_by ? new Date(row.needed_by as string).toISOString() : null,
    notes: (row.notes as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date((row.updated_at ?? row.created_at) as string).toISOString(),
    requestedByName: (row.requested_by_name as string | null) ?? null,
    acceptance: row.accepted_at
      ? {
          personId: (row.accepted_by as string | null) ?? null,
          personName: (row.accepted_by_name as string | null) ?? "Unknown",
          positionTitle: (row.accepted_position_title as string | null) ?? null,
          at: new Date(row.accepted_at as string).toISOString(),
        }
      : null,
  };
}

/** What a request list is narrowed to. Every filter the caller sets is one the screen names. */
export interface RequestFilters {
  /** A request number (REQ-1043 or 1043), or words in the item or notes. */
  readonly q?: string | undefined;
  /** Open requests, ended ones (closed, declined, cancelled), or all of them, the default. */
  readonly status?: "open" | "ended" | "all" | undefined;
  /** Only the requests this person asked for. */
  readonly mine?: boolean | undefined;
}

/** A page of requests in one scope, newest first, narrowed by the filters. Row-level security stays the wall. */
async function requestPage(
  sql: Sql,
  actor: Principal,
  scope: { readonly where: string; readonly params: readonly unknown[] },
  filters: RequestFilters,
  page: PageRequest,
): Promise<Page<ResourceRequestSummary>> {
  const after = decodeCursor(page.cursor, ["seq", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const params: unknown[] = [...scope.params];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [scope.where];
  const text = filters.q?.trim();
  if (text) {
    // LIKE's wildcards and its escape character, taken literally.
    const words = param(`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const number = /^(?:req-?\s*)?(\d{1,15})$/i.exec(text)?.[1];
    where.push(`(r.item ilike ${words} or coalesce(r.notes, '') ilike ${words}${number ? ` or r.number = ${param(number)}::bigint` : ""})`);
  }
  if (filters.status === "open") where.push(`r.state <> all(${param(RESOURCE_REQUEST_ENDED)}::text[])`);
  if (filters.status === "ended") where.push(`r.state = any(${param(RESOURCE_REQUEST_ENDED)}::text[])`);
  if (filters.mine) where.push(`r.requested_by = ${param(actor.person.id)}::uuid`);
  if (after) where.push(`(r.number, r.id) < (${param(after[0])}::bigint, ${param(after[1])}::uuid)`);
  const rows = await sql.unsafe(`${requestSelect}
    where ${where.join(" and ")}
    order by r.number desc, r.id desc limit ${param(limit + 1)}`, params as never[]);
  const { items, nextCursor } = cutPage(rows as unknown as Record<string, unknown>[], limit,
    (row) => [String(row.number), row.id as string]);
  return { items: items.map(requestSummary), nextCursor };
}

/**
 * Resource requests visible in a jurisdiction, for the 213RR board. An
 * optional incident narrows the list to that incident's requests;
 * unscoped returns every request in the jurisdiction, so a standing cache with
 * no incident is never silently hidden.
 */
export async function listRequests(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId: string | undefined,
  page: PageRequest,
  filters: RequestFilters = {},
): Promise<Page<ResourceRequestSummary>> {
  requireMember(actor, jurisdictionId);
  return requestPage(sql, actor, {
    where: "r.jurisdiction_id = $1 and ($2::uuid is null or r.incident_id = $2)",
    params: [jurisdictionId, incidentId ?? null],
  }, filters, page);
}

/**
 * Every resource request attached to an incident, from every organization,
 * for anyone who can read the incident: its owner's members and each active
 * participant.
 */
export async function listIncidentRequests(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  page: PageRequest,
  filters: RequestFilters = {},
): Promise<Page<ResourceRequestSummary>> {
  const [access] = await sql`select public.can_read_incident(${incidentId}) as readable`;
  if (access?.readable !== true) throw new AuthError(404, "incident not found");
  return requestPage(sql, actor, { where: "r.incident_id = $1", params: [incidentId] }, filters, page);
}

export async function getRequest(
  sql: Sql,
  actor: Principal,
  requestId: string,
): Promise<ResourceRequestDetail> {
  const req = await loadRequest(sql, requestId);
  if (req.incident_id) {
    const [access] = await sql`
      select public.is_member_of(${req.jurisdiction_id}) or public.can_read_incident(${req.incident_id}) as readable`;
    if (access?.readable !== true) throw new AuthError(404, "resource request not found");
  } else {
    requireMember(actor, req.jurisdiction_id);
  }
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

/**
 * The jurisdiction's resource pool. A resource is one definite kind and type
 * from the typing catalog; its status moves by the dictionary table, one
 * request at a time, and ends at demobilization. Each move is audited. The
 * resource's status and its request's lifecycle move independently.
 */
function poolResource(row: Record<string, unknown>): PoolResource {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.resource_kind as string,
    type: (row.resource_type as number | null) ?? null,
    status: row.status as string,
    request: row.request_id ? { id: row.request_id as string, item: row.request_item as string } : null,
    returnCondition: (row.return_condition as string | null) ?? null,
    demobilizationChecks: row.demobilization_checks as string[],
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function listResources(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
): Promise<Page<PoolResource>> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["key", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select s.id, s.name, s.resource_kind, s.resource_type, s.status, s.request_id, r.item as request_item,
      s.return_condition, s.demobilization_checks, s.updated_at
    from resources s left join resource_requests r on r.id = s.request_id
    where s.jurisdiction_id = ${jurisdictionId}
      and (${after?.[0] ?? null}::text is null or (s.name, s.id) > (${after?.[0] ?? null}::text, ${after?.[1] ?? null}::uuid))
    order by s.name, s.id limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows as unknown as Record<string, unknown>[], limit,
    (row) => [row.name as string, row.id as string]);
  return { items: items.map(poolResource), nextCursor };
}

export async function addResource(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: { name: string; kind: string; type: number | null },
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  await requireKind(sql, jurisdictionId, input.kind, input.type, true);
  const [row] = await sql`
    insert into resources (jurisdiction_id, name, resource_kind, resource_type, created_by, updated_by)
    values (${jurisdictionId}, ${input.name}, ${input.kind}, ${input.type}, ${actor.person.id}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "resource.added",
    subjectTable: "resources",
    subjectId: id,
    payload: { name: input.name, kind: input.kind, type: input.type },
  });
  return { id };
}

/**
 * Correct a pool resource's name, kind or type. Kind and type change only
 * while the resource is not assigned, so no request holds a resource it no
 * longer matches.
 */
export async function updateResource(
  sql: Sql,
  actor: Principal,
  resourceId: string,
  input: { name: string; kind: string; type: number | null },
): Promise<void> {
  const [resource] = await sql`
    select jurisdiction_id, name, resource_kind, resource_type, status from resources where id = ${resourceId}`;
  if (!resource) throw new AuthError(404, "resource not found");
  const jurisdictionId = resource.jurisdiction_id as string;
  requireWriter(actor, jurisdictionId);
  const retyped = input.kind !== resource.resource_kind || input.type !== resource.resource_type;
  if (retyped && !["available", "out_of_service"].includes(resource.status as string))
    throw new AuthError(409, `a ${String(resource.status).replace("_", " ")} resource keeps its kind and type`);
  if (retyped) await requireKind(sql, jurisdictionId, input.kind, input.type, true);
  await sql`
    update resources set name = ${input.name}, resource_kind = ${input.kind}, resource_type = ${input.type},
      updated_by = ${actor.person.id}, updated_at = now()
    where id = ${resourceId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "resource.updated",
    subjectTable: "resources",
    subjectId: resourceId,
    payload: {
      from: { name: resource.name, kind: resource.resource_kind, type: resource.resource_type },
      to: { name: input.name, kind: input.kind, type: input.type },
    },
  });
}

export interface ResourceHistoryEntry {
  readonly at: string;
  readonly actorName: string;
  readonly category: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** A pool resource's history from the audit trail: added, edited and every status move, oldest first. */
export async function resourceHistory(sql: Sql, actor: Principal, resourceId: string): Promise<ResourceHistoryEntry[]> {
  const [resource] = await sql`select jurisdiction_id from resources where id = ${resourceId}`;
  if (!resource) throw new AuthError(404, "resource not found");
  requireMember(actor, resource.jurisdiction_id as string);
  const rows = await sql`
    select e.created_at, e.category, e.payload, p.display_name
    from audit_events e join persons p on p.id = e.person_id
    where e.subject_table = 'resources' and e.subject_id = ${resourceId}
    order by e.seq limit 500`;
  return rows.map((row) => ({
    at: new Date(row.created_at as string).toISOString(),
    actorName: row.display_name as string,
    category: row.category as string,
    detail: (row.payload as Record<string, unknown> | null) ?? {},
  }));
}

export interface ResourceMove {
  readonly to: string;
  /** Required to assign: the request the resource goes to. */
  readonly requestId?: string | undefined;
  /** Required to demobilize, with the checks made. */
  readonly returnCondition?: string | undefined;
  readonly checks?: readonly string[] | undefined;
}

export async function transitionResource(
  sql: Sql,
  actor: Principal,
  resourceId: string,
  move: ResourceMove,
): Promise<{ status: string }> {
  const [resource] = await sql`
    select jurisdiction_id, resource_kind, resource_type, status, request_id from resources where id = ${resourceId}`;
  if (!resource) throw new AuthError(404, "resource not found");
  const jurisdictionId = resource.jurisdiction_id as string;
  const from = resource.status as string;
  requireWriter(actor, jurisdictionId);
  if (!(RESOURCE_STATUS_TRANSITIONS[from] ?? []).includes(move.to))
    throw new AuthError(409, `cannot move a resource from ${from} to ${move.to}`);
  let incidentId: string | null = null;
  if (move.to === "assigned") {
    if (!move.requestId) throw new AuthError(400, "name the request to assign the resource to");
    const req = await loadRequest(sql, move.requestId);
    if (req.jurisdiction_id !== jurisdictionId) throw new AuthError(409, "the request belongs to another jurisdiction");
    if (!["sourcing", "assigned", "deployed"].includes(req.state))
      throw new AuthError(409, `a ${req.state} request does not take resources`);
    if (req.incident_id) await requireOpenIncidentScope(sql, actor, req.incident_id, jurisdictionId);
    if (req.resource_kind !== resource.resource_kind ||
        !typeSatisfies(resource.resource_type as number | null, req.resource_type))
      throw new AuthError(409, "the resource is not the kind and type the request asks for");
    // A request takes no more resources than its quantity. The lock orders
    // concurrent assignments to one request, so two cannot both take the last place.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`resource-cap:${move.requestId}`}, 0))`;
    const [held] = await sql`
      select r.quantity, (select count(*)::int from resources s where s.request_id = r.id and s.status = 'assigned') as assigned
      from resource_requests r where r.id = ${move.requestId}`;
    if (held && (held.assigned as number) >= (held.quantity as number)) {
      const quantity = held.quantity as number;
      throw new AuthError(409, `the request already has the ${quantity} resource${quantity === 1 ? "" : "s"} it asked for`);
    }
    incidentId = req.incident_id;
  }
  const demobilized = move.to === "demobilized";
  if (demobilized && !move.returnCondition) throw new AuthError(400, "record the return condition to demobilize");
  const checks = demobilized ? [...new Set(move.checks ?? [])] : [];
  const [updated] = await sql`
    update resources set
      status = ${move.to},
      request_id = ${move.to === "assigned" ? move.requestId! : null},
      return_condition = ${demobilized ? move.returnCondition! : null},
      demobilization_checks = ${checks}::text[],
      demobilized_at = case when ${demobilized} then now() end,
      updated_by = ${actor.person.id}, updated_at = now()
    where id = ${resourceId} and status = ${from}
    returning id`;
  if (!updated) throw new AuthError(409, "the resource changed; reload and try again");
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(incidentId ? { incidentId } : {}),
    category: "resource.status",
    subjectTable: "resources",
    subjectId: resourceId,
    payload: {
      from,
      to: move.to,
      requestId: move.to === "assigned" ? move.requestId : (resource.request_id as string | null),
      ...(demobilized ? { returnCondition: move.returnCondition, checks } : {}),
    },
  });
  return { status: move.to };
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

/**
 * A partner contributor requests from the incident's owner, on an open
 * incident. The database function sets every server-owned value; the owner
 * receives the request and types it.
 */
async function requestFromIncidentOwner(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  jurisdictionId: string,
  input: SubmitInput,
): Promise<{ id: string }> {
  await lockIncidentMutation(sql, incidentId);
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  if (!authority.canContribute || !authority.participation)
    throw new AuthError(403, "requires current incident contributor authority");
  if (authority.jurisdictionId !== jurisdictionId)
    throw new AuthError(403, "a partner requests only from the incident's owner");
  if (input.resourceKind || input.resourceType !== undefined)
    throw new AuthError(400, "the incident's owner types a partner's request");
  if (input.priority !== undefined && !["routine", "priority", "immediate"].includes(input.priority))
    throw new AuthError(400, "priority is routine, priority or immediate");
  if (input.item.length > 200 || (input.notes?.length ?? 0) > 4000)
    throw new AuthError(400, "a request names its item in at most 200 characters, with notes of at most 4000");
  await requireOpenIncident(sql, incidentId);
  const [row] = await sql`
    select public.submit_participant_request(${incidentId}, ${input.item}, ${input.quantity ?? 1},
      ${input.priority ?? "routine"}, ${input.notes ?? null}, ${input.neededBy ?? null}, ${input.origin}) as id`;
  if (!row?.id) throw new AuthError(403, "requires current incident contributor authority");
  return { id: row.id as string };
}

async function requireOpenIncident(sql: Sql, incidentId: string): Promise<void> {
  const [incident] = await sql`select closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (incident.closed_at) throw new AuthError(409, "incident is closed");
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
