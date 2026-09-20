import { canTransition, formatCostExport, type CostRow } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, principalForPerson, type Principal } from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { recordAudit } from "../audit/service.js";

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
  const [row] = await sql`
    insert into resource_requests
      (jurisdiction_id, incident_id, origin, item, quantity, priority, state, notes,
       needed_by, requested_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.origin}, ${input.item},
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
  positionId: string,
): Promise<{ state: string }> {
  const req = await loadRequest(sql, requestId);
  requireWriter(actor, req.jurisdiction_id);
  await sql`update resource_requests set assigned_position = ${positionId} where id = ${requestId}`;
  return transition(sql, actor, requestId, "assigned", `assigned to a position`);
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
    select jurisdiction_id, state, item, quantity, priority, notes from resource_requests
    where id = ${requestId}`;
  if (!full) throw new AuthError(404, "resource request not found");
  requireWriter(actor, full.jurisdiction_id as string);
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
        (jurisdiction_id, origin, item, quantity, priority, state, notes, requested_by,
         source_peer, source_request_id)
      values
        (${peer.jurisdiction_id as string}, 'escalated', ${payload.item}, ${payload.quantity},
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

export interface RequestSummary {
  readonly id: string;
  readonly item: string;
  readonly quantity: number;
  readonly priority: string;
  readonly state: string;
}

/** Resource requests visible in a jurisdiction, for the 213RR board. */
export async function listRequests(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<RequestSummary[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select id, item, quantity, priority, state from resource_requests
    where jurisdiction_id = ${jurisdictionId} order by item`;
  return rows.map((r) => ({
    id: r.id as string,
    item: r.item as string,
    quantity: r.quantity as number,
    priority: r.priority as string,
    state: r.state as string,
  }));
}

export async function getRequest(
  sql: Sql,
  actor: Principal,
  requestId: string,
): Promise<{ id: string; state: string; item: string; chronology: ChronologyEntry[] }> {
  const req = await loadRequest(sql, requestId);
  requireMember(actor, req.jurisdiction_id);
  const events = await sql`
    select from_state, to_state, note, actor_peer, at from rr_events
    where request_id = ${requestId} order by at, id`;
  return {
    id: requestId,
    state: req.state,
    item: req.item,
    chronology: events.map((e) => ({
      fromState: (e.from_state as string | null) ?? null,
      toState: e.to_state as string,
      note: (e.note as string | null) ?? null,
      by: (e.actor_peer as string | null) ?? null,
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

function requireWriter(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || (m.role !== "admin" && m.role !== "member"))
    throw new AuthError(403, "requires write access to this jurisdiction");
}
