import { createHash } from "node:crypto";
import {
  BoardTemplateSchema,
  WorkflowAssignmentRequestSchema,
  guardRefusal,
  unmetGuardConditions,
  workflowDueAt,
  workflowEscalationAt,
  type BoardTemplate,
  type WorkflowAssignmentRequest,
  type WorkflowTransition,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentAuthority, lockIncidentMutation, type IncidentAuthority } from "../incidents/participation.js";
import { getEffectiveBoard, getIncidentBoardReadShape, lockBoardMutation } from "./service.js";
import { resolveWorkflowAssignment, type ResolvedWorkflowAssignment } from "./workflow.js";

export interface WorkflowTransitionInput {
  readonly transitionKey: string;
  readonly assignment?: WorkflowAssignmentRequest | undefined;
  readonly idempotencyKey: string;
}

export interface WorkflowApprovalInput {
  readonly transitionKey: string;
  readonly ruleKey: string;
  readonly idempotencyKey: string;
}

export interface WorkflowWithdrawalInput {
  readonly transitionKey: string;
  /** Reject is an approver's refusal; cancel is the requester taking the request back. */
  readonly action: "reject" | "cancel";
  readonly note?: string | undefined;
  readonly idempotencyKey: string;
}

export interface WorkflowEscalationInput {
  readonly ruleKey: string;
  readonly occurrence: number;
  readonly assignment?: WorkflowAssignmentRequest | undefined;
  readonly idempotencyKey: string;
}

export interface WorkflowResult {
  readonly recordId: string;
  readonly state: string;
  readonly stateRevision: number;
  readonly pendingTransition: string | null;
  readonly dueAt: string | null;
  readonly dueStatus: "none" | "scheduled" | "missing";
  readonly assignment: ResolvedWorkflowAssignment | null;
}

interface RecordContext {
  readonly boardId: string;
  readonly recordId: string;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly record: Record<string, unknown>;
  readonly recordCreatedAt: string;
  readonly currentTemplate: BoardTemplate;
  readonly currentTemplateKey: string;
  readonly currentTemplateVersion: number;
  readonly boardRole: "admin" | "member" | "viewer" | "guest";
  readonly incidentAuthority: IncidentAuthority | null;
}

interface InstanceRow {
  record_id: string;
  board_id: string;
  jurisdiction_id: string;
  incident_id: string | null;
  template_key: string;
  template_version: number;
  state_key: string;
  state_revision: number;
  transition_key: string | null;
  transitioned_at: Date;
  due_at: Date | null;
  due_status: "none" | "scheduled" | "missing";
  assignment_kind: "position" | "incident_participant" | null;
  assignment_position_id: string | null;
  assignment_participant_id: string | null;
  assignment_snapshot: ResolvedWorkflowAssignment | null;
  pending_transition_key: string | null;
  pending_to_state: string | null;
  pending_requested_by: string | null;
  pending_assignment_request: WorkflowAssignmentRequest | null;
  pending_assignment_snapshot: ResolvedWorkflowAssignment | null;
  pending_started_at: Date | null;
}

interface LoadedWorkflow {
  readonly context: RecordContext;
  readonly instance: InstanceRow;
  readonly template: BoardTemplate;
}

export async function getRecordWorkflow(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
): Promise<WorkflowResult & { history: unknown[]; pinnedTemplateVersion: number }> {
  const context = await loadRecordContext(sql, actor, boardId, recordId, false);
  const [row] = await sql`
    select * from board_workflow_instances where record_id = ${recordId}`;
  if (!row) {
    const workflow = requireWorkflow(context.currentTemplate);
    return {
      recordId,
      state: workflow.initialState,
      stateRevision: 0,
      pendingTransition: null,
      dueAt: null,
      dueStatus: "none",
      assignment: null,
      pinnedTemplateVersion: context.currentTemplateVersion,
      history: [],
    };
  }
  const instance = asInstance(row);
  const history = await sql`
    select h.id, h.sequence, h.state_revision, h.event_kind, h.event_key, h.from_state, h.to_state,
      h.actor_person_id, p.display_name as actor_name, h.actor_position_id, h.actor_participation_id,
      h.detail, h.created_at
    from board_workflow_history h left join persons p on p.id = h.actor_person_id
    where h.record_id = ${recordId}
    order by h.sequence`;
  return {
    ...resultFrom(instance),
    pinnedTemplateVersion: instance.template_version,
    history: history.map((event) => ({
      id: event.id as string,
      sequence: Number(event.sequence),
      stateRevision: event.state_revision as number,
      eventKind: event.event_kind as string,
      eventKey: event.event_key as string,
      fromState: (event.from_state as string | null) ?? null,
      toState: (event.to_state as string | null) ?? null,
      actorPersonId: event.actor_person_id as string,
      actorName: (event.actor_name as string | null) ?? null,
      actorPositionId: (event.actor_position_id as string | null) ?? null,
      actorParticipationId: (event.actor_participation_id as string | null) ?? null,
      detail: event.detail as unknown,
      createdAt: new Date(event.created_at as string).toISOString(),
    })),
  };
}

export async function requestWorkflowTransition(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  input: WorkflowTransitionInput,
): Promise<WorkflowResult> {
  const loaded = await loadWorkflowForWrite(sql, actor, boardId, recordId);
  const digest = commandDigest("transition", input);
  const prior = await replay(sql, loaded.context, actor, input.idempotencyKey, digest);
  if (prior) return prior;
  const workflow = requireWorkflow(loaded.template);
  if (loaded.instance.pending_transition_key)
    throw new AuthError(409, "another workflow transition is awaiting approval");
  const transition = workflow.transitions.find((item) => item.key === input.transitionKey);
  if (!transition) throw new AuthError(404, "workflow transition not found");
  if (transition.from !== loaded.instance.state_key)
    throw new AuthError(409, `transition requires state ${transition.from}`);
  await requireTransitionActor(sql, actor, loaded, transition);
  requireGuard(loaded, transition, false);
  const assignment = await resolveTransitionAssignment(sql, actor, loaded.context, transition, input.assignment);
  const revision = loaded.instance.state_revision + 1;
  const [clock] = await sql`select now() as at`;
  const startedAt = new Date(clock!.at as string).toISOString();
  await appendHistory(sql, actor, loaded.context, revision, "transition_requested", transition.key,
    loaded.instance.state_key, transition.to, { assignment });
  let result: WorkflowResult;
  if (transition.approvals.length) {
    await sql`
      update board_workflow_instances set
        pending_transition_key = ${transition.key}, pending_to_state = ${transition.to},
        pending_requested_by = ${actor.person.id},
        pending_assignment_request = ${input.assignment ? sql.json(input.assignment as never) : null},
        pending_assignment_snapshot = ${assignment ? sql.json(assignment as never) : null},
        pending_started_at = ${startedAt}, updated_at = now()
      where record_id = ${recordId}`;
    const pending: InstanceRow = {
      ...loaded.instance,
      pending_transition_key: transition.key,
      pending_to_state: transition.to,
      pending_requested_by: actor.person.id,
      pending_assignment_request: input.assignment ?? null,
      pending_assignment_snapshot: assignment,
      pending_started_at: new Date(startedAt),
    };
    result = resultFrom(pending);
  } else {
    result = await completeTransition(sql, actor, loaded, transition, assignment, startedAt);
  }
  await storeReplay(sql, loaded.context, actor, input.idempotencyKey, digest, result);
  return result;
}

export async function approveWorkflowTransition(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  input: WorkflowApprovalInput,
): Promise<WorkflowResult> {
  const loaded = await loadWorkflowForWrite(sql, actor, boardId, recordId);
  const digest = commandDigest("approval", input);
  const prior = await replay(sql, loaded.context, actor, input.idempotencyKey, digest);
  if (prior) return prior;
  const pendingKey = loaded.instance.pending_transition_key;
  if (!pendingKey || pendingKey !== input.transitionKey)
    throw new AuthError(409, "workflow transition is not awaiting this approval");
  const transition = requireWorkflow(loaded.template).transitions.find((item) => item.key === pendingKey);
  if (!transition) throw new AuthError(409, "pinned workflow transition is unavailable");
  const rule = transition.approvals.find((item) => item.key === input.ruleKey);
  if (!rule) throw new AuthError(404, "workflow approval rule not found");
  if (!rule.allowSelfApproval && loaded.instance.pending_requested_by === actor.person.id)
    throw new AuthError(403, "requester cannot approve this transition");
  await requireApprover(sql, actor, loaded, rule.approver);
  await validatePendingRequester(sql, loaded, transition);
  const revision = loaded.instance.state_revision + 1;
  try {
    await sql`
      insert into board_workflow_approvals
        (record_id, board_id, jurisdiction_id, incident_id, state_revision,
         transition_key, rule_key, actor_person_id, actor_position_id, actor_participation_id)
      values (${recordId}, ${boardId}, ${loaded.context.jurisdictionId},
        ${loaded.context.incidentId}, ${revision}, ${transition.key}, ${rule.key},
        ${actor.person.id}, ${actor.position?.id ?? null},
        ${loaded.context.incidentAuthority?.participation?.id ?? null})`;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AuthError(409, "actor already approved this rule");
    throw error;
  }
  await appendHistory(sql, actor, loaded.context, revision, "approval_recorded", rule.key,
    loaded.instance.state_key, transition.to, { transitionKey: transition.key });
  const approvals = await sql`
    select rule_key, actor_person_id from board_workflow_approvals
    where record_id = ${recordId} and state_revision = ${revision}`;
  const complete = transition.approvals.every((required) =>
    new Set(approvals.filter((row) => row.rule_key === required.key)
      .map((row) => row.actor_person_id as string)).size >= required.count);
  let result = resultFrom(loaded.instance);
  if (complete) {
    requireGuard(loaded, transition, true);
    const assignment = await validatePendingAssignment(sql, loaded);
    const [clock] = await sql`select now() as at`;
    result = await completeTransition(sql, actor, loaded, transition, assignment,
      new Date(clock!.at as string).toISOString());
  }
  await storeReplay(sql, loaded.context, actor, input.idempotencyKey, digest, result);
  return result;
}

/**
 * End a pending transition without taking it: the requester cancels their own
 * request, and a person who could approve one of its rules rejects it. The
 * record stays in its state. The request's revision is spent, so approvals
 * recorded against it never count toward a later request of the transition.
 */
export async function withdrawWorkflowTransition(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  input: WorkflowWithdrawalInput,
): Promise<WorkflowResult> {
  const loaded = await loadWorkflowForWrite(sql, actor, boardId, recordId);
  const digest = commandDigest("withdrawal", input);
  const prior = await replay(sql, loaded.context, actor, input.idempotencyKey, digest);
  if (prior) return prior;
  const pendingKey = loaded.instance.pending_transition_key;
  if (!pendingKey || pendingKey !== input.transitionKey)
    throw new AuthError(409, "workflow transition is not awaiting approval");
  const transition = requireWorkflow(loaded.template).transitions.find((item) => item.key === pendingKey);
  if (!transition) throw new AuthError(409, "pinned workflow transition is unavailable");
  const requester = loaded.instance.pending_requested_by;
  if (input.action === "cancel") {
    if (requester !== actor.person.id) throw new AuthError(403, "only the requester can cancel this transition");
  } else {
    let approver = false;
    for (const rule of transition.approvals) {
      if (!rule.allowSelfApproval && requester === actor.person.id) continue;
      approver = await requireApprover(sql, actor, loaded, rule.approver).then(() => true, (error: unknown) => {
        if (error instanceof AuthError) return false;
        throw error;
      });
      if (approver) break;
    }
    if (!approver) throw new AuthError(403, "rejecting requires authority to approve this transition");
  }
  const revision = loaded.instance.state_revision + 1;
  await sql`
    update board_workflow_instances set state_revision = ${revision},
      pending_transition_key = null, pending_to_state = null,
      pending_requested_by = null, pending_assignment_request = null,
      pending_assignment_snapshot = null, pending_started_at = null, updated_at = now()
    where record_id = ${recordId}`;
  await appendHistory(sql, actor, loaded.context, revision,
    input.action === "reject" ? "transition_rejected" : "transition_cancelled", transition.key,
    loaded.instance.state_key, transition.to, input.note ? { note: input.note } : {});
  const [updated] = await sql`select * from board_workflow_instances where record_id = ${recordId}`;
  const result = resultFrom(asInstance(updated!));
  await storeReplay(sql, loaded.context, actor, input.idempotencyKey, digest, result);
  return result;
}

export async function processWorkflowEscalation(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  input: WorkflowEscalationInput,
): Promise<WorkflowResult> {
  const loaded = await loadWorkflowForWrite(sql, actor, boardId, recordId);
  const digest = commandDigest("escalation", input);
  const prior = await replay(sql, loaded.context, actor, input.idempotencyKey, digest);
  if (prior) return prior;
  requireEscalationActor(actor, loaded.context);
  if (!loaded.instance.transition_key)
    throw new AuthError(409, "workflow has no transitioned escalation schedule");
  const transition = requireWorkflow(loaded.template).transitions
    .find((item) => item.key === loaded.instance.transition_key);
  const rule = transition?.escalations.find((item) => item.key === input.ruleKey);
  if (!transition || !rule) throw new AuthError(404, "workflow escalation rule not found");
  let scheduledAt: string;
  try {
    scheduledAt = workflowEscalationAt(rule, loaded.instance.transitioned_at.toISOString(), input.occurrence);
  } catch (error) {
    throw new AuthError(400, error instanceof Error ? error.message : "invalid escalation occurrence");
  }
  const [clock] = await sql`select now() as at`;
  if (new Date(scheduledAt) > new Date(clock!.at as string))
    throw new AuthError(409, "workflow escalation is not due");
  const eventKey = `${rule.key}:${input.occurrence}`;
  // Escalations belong to the completion that set the schedule; a withdrawn
  // request since then has advanced the revision without changing the state.
  const [completion] = await sql`
    select max(state_revision) as revision from board_workflow_history
    where record_id = ${recordId} and event_kind = 'transition_completed'`;
  const completedRevision = (completion?.revision as number | null) ?? loaded.instance.state_revision;
  const [existing] = await sql`
    select id from board_workflow_history
    where record_id = ${recordId} and state_revision = ${completedRevision}
      and event_kind = 'escalation' and event_key = ${eventKey}`;
  let result = resultFrom(loaded.instance);
  if (!existing) {
    const assignment = await resolveEscalationAssignment(sql, actor, loaded.context, rule.assignment, input.assignment);
    if (assignment) {
      await updateAssignment(sql, recordId, assignment);
      loaded.instance.assignment_kind = assignment.kind;
      loaded.instance.assignment_position_id = assignment.kind === "position" ? assignment.positionId : null;
      loaded.instance.assignment_participant_id = assignment.kind === "incident_participant" ? assignment.participantId : null;
      loaded.instance.assignment_snapshot = assignment;
      result = resultFrom(loaded.instance);
    }
    const historyId = await appendHistory(sql, actor, loaded.context,
      completedRevision, "escalation",
      eventKey, loaded.instance.state_key, loaded.instance.state_key,
      { ruleKey: rule.key, occurrence: input.occurrence, scheduledAt, assignment });
    await notifyAssignment(sql, loaded.context, assignment,
      `Escalation: ${transition.label}`, historyId);
  }
  await storeReplay(sql, loaded.context, actor, input.idempotencyKey, digest, result);
  return result;
}

async function loadWorkflowForWrite(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
): Promise<LoadedWorkflow> {
  // The incident's lock before the board's, the order record writes and the
  // sync hub take them: an action's write takes the incident's, and the
  // reverse order would deadlock against a record write on the same incident.
  const [record] = await sql`select incident_id from board_records where id = ${recordId} and board_id = ${boardId}`;
  if (record?.incident_id) await lockIncidentMutation(sql, record.incident_id as string);
  await lockBoardMutation(sql, boardId);
  const context = await loadRecordContext(sql, actor, boardId, recordId, true);
  const [found] = await sql`
    select * from board_workflow_instances where record_id = ${recordId} for update`;
  let instance: InstanceRow;
  let template: BoardTemplate;
  if (found) {
    instance = asInstance(found);
    const [pinned] = await sql`
      select definition from board_templates
      where key = ${instance.template_key} and version = ${instance.template_version}`;
    if (!pinned) throw new AuthError(409, "pinned workflow template is unavailable");
    template = BoardTemplateSchema.parse(pinned.definition);
  } else {
    template = context.currentTemplate;
    const workflow = requireWorkflow(template);
    const [created] = await sql`
      insert into board_workflow_instances
        (record_id, board_id, jurisdiction_id, incident_id, template_key,
         template_version, state_key)
      values (${recordId}, ${boardId}, ${context.jurisdictionId}, ${context.incidentId},
        ${context.currentTemplateKey}, ${context.currentTemplateVersion}, ${workflow.initialState})
      returning *`;
    instance = asInstance(created!);
  }
  requireWorkflow(template);
  return { context, instance, template };
}

async function loadRecordContext(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  forWrite: boolean,
): Promise<RecordContext> {
  const [row] = await sql`
    select r.data, r.created_at, r.incident_id, b.jurisdiction_id,
      b.template_key, b.template_version, t.definition, i.closed_at
    from board_records r
    join boards b on b.id = r.board_id
    join board_templates t on t.key = b.template_key and t.version = b.template_version
    left join incidents i on i.id = r.incident_id
    where r.id = ${recordId} and r.board_id = ${boardId}`;
  if (!row) throw new AuthError(404, "board record not found");
  const incidentId = (row.incident_id as string | null) ?? null;
  let boardRole: RecordContext["boardRole"];
  let incidentAuthority: IncidentAuthority | null = null;
  if (incidentId) {
    incidentAuthority = await getIncidentAuthority(sql, actor, incidentId);
    const board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
    boardRole = board.role;
    if (forWrite && !incidentAuthority.canContribute)
      throw new AuthError(403, "requires current incident contributor authority");
    if (forWrite && row.closed_at) throw new AuthError(409, "incident is closed");
  } else {
    const board = await getEffectiveBoard(sql, actor, boardId);
    boardRole = board.role;
    if (forWrite && board.role !== "admin" && board.role !== "member")
      throw new AuthError(403, "requires board write access");
  }
  return {
    boardId,
    recordId,
    jurisdictionId: row.jurisdiction_id as string,
    incidentId,
    record: row.data as Record<string, unknown>,
    recordCreatedAt: new Date(row.created_at as string).toISOString(),
    currentTemplate: BoardTemplateSchema.parse(row.definition),
    currentTemplateKey: row.template_key as string,
    currentTemplateVersion: row.template_version as number,
    boardRole,
    incidentAuthority,
  };
}

/**
 * Refuse a transition whose guard the record does not meet: when it is
 * requested, and again when its last approval would complete it, since the
 * record may have changed while it waited.
 */
function requireGuard(loaded: LoadedWorkflow, transition: WorkflowTransition, completing: boolean): void {
  if (!transition.guard) return;
  const unmet = unmetGuardConditions(transition.guard, loaded.context.record, new Date());
  if (unmet.length === 0) return;
  const reason = guardRefusal(transition.guard, unmet, loaded.template.fields).replace(/[.\s]+$/, "");
  throw new AuthError(409, `${transition.label} ${completing ? "can no longer" : "cannot"} be taken: ${reason}.`);
}

function requireWorkflow(template: BoardTemplate) {
  if (!template.workflow) throw new AuthError(409, "board template has no workflow");
  return template.workflow;
}

async function requireTransitionActor(
  sql: Sql,
  actor: Principal,
  loaded: LoadedWorkflow,
  transition: WorkflowTransition,
): Promise<void> {
  for (const role of transition.allowedActors) {
    if (role === "writer" && isWriter(loaded.context)) return;
    if (role === "jurisdiction_admin" && isJurisdictionAdmin(actor, loaded.context.jurisdictionId)) return;
    if (role === "incident_coordinator" && isIncidentCoordinator(loaded.context)) return;
    if (role === "assigned_position" && await isCurrentAssignee(sql, actor, loaded)) return;
  }
  throw new AuthError(403, "actor is not allowed to run this workflow transition");
}

async function requireApprover(
  sql: Sql,
  actor: Principal,
  loaded: LoadedWorkflow,
  approver: WorkflowTransition["approvals"][number]["approver"],
): Promise<void> {
  if (approver.kind === "jurisdiction_admin") {
    if (!isJurisdictionAdmin(actor, loaded.context.jurisdictionId))
      throw new AuthError(403, "approval requires jurisdiction admin");
    return;
  }
  if (approver.kind === "incident_coordinator") {
    if (!isIncidentCoordinator(loaded.context))
      throw new AuthError(403, "approval requires current incident coordinator");
    return;
  }
  const current = await hasCurrentPosition(sql, actor, loaded.context.jurisdictionId,
    approver.positionKey);
  if (!current) throw new AuthError(403, `approval requires position ${approver.positionKey}`);
}

async function isCurrentAssignee(sql: Sql, actor: Principal, loaded: LoadedWorkflow): Promise<boolean> {
  if (loaded.instance.assignment_kind === "position") {
    return loaded.instance.assignment_position_id === actor.position?.id
      && await hasCurrentPosition(sql, actor, loaded.context.jurisdictionId);
  }
  if (loaded.instance.assignment_kind === "incident_participant") {
    const [row] = await sql`
      select 1 as ok from incident_participants
      where id = ${loaded.instance.assignment_participant_id}
        and incident_id = ${loaded.context.incidentId}
        and person_id = ${actor.person.id} and revoked_at is null and expires_at > now()
        and eligible_incident_person(person_id, organization_id)`;
    return Boolean(row);
  }
  return false;
}

async function hasCurrentPosition(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  key?: string,
): Promise<boolean> {
  if (!actor.position || actor.position.jurisdictionId !== jurisdictionId) return false;
  const [row] = await sql`
    select 1 as ok from positions p
    join position_assignments a on a.position_id = p.id
    join auth_sessions s on s.id = ${actor.sessionId}
    where p.id = ${actor.position.id} and p.jurisdiction_id = ${jurisdictionId}
      and (${key ?? null}::text is null or p.key = ${key ?? null})
      and a.person_id = ${actor.person.id} and a.revoked_at is null
      and s.person_id = ${actor.person.id} and s.ended_at is null
      and s.active_position_id = p.id`;
  return Boolean(row);
}

function isWriter(context: RecordContext): boolean {
  return context.incidentId ? Boolean(context.incidentAuthority?.canContribute)
    : context.boardRole === "admin" || context.boardRole === "member";
}

function isJurisdictionAdmin(actor: Principal, jurisdictionId: string): boolean {
  return actor.memberships.some((membership) =>
    membership.jurisdictionId === jurisdictionId && membership.role === "admin");
}

function isIncidentCoordinator(context: RecordContext): boolean {
  return context.incidentAuthority?.participation?.role === "coordinator";
}

function requireEscalationActor(actor: Principal, context: RecordContext): void {
  if (!isJurisdictionAdmin(actor, context.jurisdictionId) && !isIncidentCoordinator(context))
    throw new AuthError(403, "escalation processing requires jurisdiction admin or incident coordinator");
}

async function resolveTransitionAssignment(
  sql: Sql,
  actor: Principal,
  context: RecordContext,
  transition: WorkflowTransition,
  raw: WorkflowAssignmentRequest | undefined,
): Promise<ResolvedWorkflowAssignment | null> {
  if (!transition.assignment) {
    if (raw) throw new AuthError(400, "transition does not accept an assignment");
    return null;
  }
  if (transition.assignment.required && !raw)
    throw new AuthError(400, "transition requires an assignment");
  if (!raw) return null;
  return resolveAllowedAssignment(sql, actor, context, transition.assignment.allowedTargets, raw);
}

async function resolveEscalationAssignment(
  sql: Sql,
  actor: Principal,
  context: RecordContext,
  rule: WorkflowTransition["escalations"][number]["assignment"],
  raw: WorkflowAssignmentRequest | undefined,
): Promise<ResolvedWorkflowAssignment | null> {
  if (!rule) {
    if (raw) throw new AuthError(400, "escalation does not accept an assignment");
    return null;
  }
  if (rule.required && !raw) throw new AuthError(400, "escalation requires an assignment");
  if (!raw) return null;
  return resolveAllowedAssignment(sql, actor, context, rule.allowedTargets, raw);
}

async function resolveAllowedAssignment(
  sql: Sql,
  actor: Principal,
  context: RecordContext,
  allowed: readonly ("position" | "incident_participant")[],
  raw: WorkflowAssignmentRequest,
): Promise<ResolvedWorkflowAssignment> {
  const request = WorkflowAssignmentRequestSchema.parse(raw);
  if (!allowed.includes(request.kind)) throw new AuthError(400, "assignment target is not allowed");
  if (request.kind === "incident_participant" && request.incidentId !== context.incidentId)
    throw new AuthError(400, "assignment incident does not match the board record");
  if (request.kind === "incident_participant" && !context.incidentId)
    throw new AuthError(400, "incident participant assignment requires an incident record");
  return resolveWorkflowAssignment(sql, actor, context.jurisdictionId, request);
}

async function validatePendingAssignment(
  sql: Sql,
  loaded: LoadedWorkflow,
): Promise<ResolvedWorkflowAssignment | null> {
  const raw = loaded.instance.pending_assignment_request;
  if (!raw) return null;
  const requester = loaded.instance.pending_requested_by!;
  if (raw.kind === "position") {
    if (!await pendingRequesterAuthorized(sql, loaded.context.recordId, "writer"))
      throw new AuthError(409, "transition requester no longer has assignment authority");
    const snapshot = loaded.instance.pending_assignment_snapshot;
    if (snapshot?.kind !== "position" || snapshot.positionId !== raw.positionId
      || snapshot.organizationId !== loaded.context.jurisdictionId)
      throw new AuthError(409, "pending position assignment is invalid");
    return snapshot;
  }
  if (raw.incidentId !== loaded.context.incidentId)
    throw new AuthError(409, "pending assignment incident no longer matches the record");
  const ownerAdmin = await pendingRequesterAuthorized(sql, loaded.context.recordId, "admin");
  const [coordinator] = await sql`
    select 1 as ok where exists (
      select 1 from incident_participants
      where incident_id = ${raw.incidentId} and person_id = ${requester}
        and organization_id = ${loaded.context.jurisdictionId} and role = 'coordinator'
        and revoked_at is null and expires_at > now()
        and eligible_incident_person(person_id, organization_id)
    )`;
  if (!ownerAdmin && !coordinator)
    throw new AuthError(409, "transition requester no longer has incident assignment authority");
  const [target] = await sql`
    select id, organization_id, person_id, incident_position_title, role
    from incident_participants
    where id = ${raw.participantId} and incident_id = ${raw.incidentId}
      and organization_id <> ${loaded.context.jurisdictionId}
      and role in ('contributor', 'coordinator')
      and revoked_at is null and expires_at > now()
      and eligible_incident_person(person_id, organization_id)`;
  if (!target) throw new AuthError(409, "assigned incident participant is no longer active");
  return {
    kind: "incident_participant",
    participantId: target.id as string,
    incidentId: raw.incidentId,
    organizationId: target.organization_id as string,
    personId: target.person_id as string,
    incidentPositionTitle: target.incident_position_title as string,
    participantRole: target.role as "contributor" | "coordinator",
    authority: ownerAdmin ? "incident_owner_admin" : "incident_coordinator",
    actorParticipationId: ownerAdmin
      ? null
      : loaded.instance.pending_assignment_snapshot?.kind === "incident_participant"
        ? loaded.instance.pending_assignment_snapshot.actorParticipationId
        : null,
  };
}

async function validatePendingRequester(
  sql: Sql,
  loaded: LoadedWorkflow,
  transition: WorkflowTransition,
): Promise<void> {
  const requester = loaded.instance.pending_requested_by!;
  for (const role of transition.allowedActors) {
    if (role === "jurisdiction_admin") {
      if (await pendingRequesterAuthorized(sql, loaded.context.recordId, "admin")) return;
    } else if (role === "writer") {
      if (await pendingRequesterAuthorized(sql, loaded.context.recordId, "writer")) return;
      if (loaded.context.incidentId) {
        const [row] = await sql`
            select 1 as ok where exists (
              select 1 from incident_participants
              where incident_id = ${loaded.context.incidentId} and person_id = ${requester}
                and role in ('contributor', 'coordinator')
                and revoked_at is null and expires_at > now()
                and eligible_incident_person(person_id, organization_id)
            )`;
        if (row) return;
      }
    } else if (role === "incident_coordinator") {
      const [row] = await sql`
        select 1 as ok from incident_participants
        where incident_id = ${loaded.context.incidentId} and person_id = ${requester}
          and role = 'coordinator' and revoked_at is null and expires_at > now()
          and eligible_incident_person(person_id, organization_id)`;
      if (row) return;
    } else if (loaded.instance.assignment_kind === "position") {
      if (await pendingRequesterAuthorized(sql, loaded.context.recordId, "assigned_position")) return;
    } else if (loaded.instance.assignment_kind === "incident_participant") {
      const [row] = await sql`
        select 1 as ok from incident_participants
        where id = ${loaded.instance.assignment_participant_id}
          and incident_id = ${loaded.context.incidentId} and person_id = ${requester}
          and revoked_at is null and expires_at > now()
          and eligible_incident_person(person_id, organization_id)`;
      if (row) return;
    }
  }
  throw new AuthError(409, "transition requester no longer has current workflow authority");
}

async function completeTransition(
  sql: Sql,
  actor: Principal,
  loaded: LoadedWorkflow,
  transition: WorkflowTransition,
  assignment: ResolvedWorkflowAssignment | null,
  transitionedAt: string,
): Promise<WorkflowResult> {
  let dueAt: string | null = null;
  let dueStatus: WorkflowResult["dueStatus"] = "none";
  if (transition.due) {
    try {
      dueAt = workflowDueAt(transition.due, {
        createdAt: loaded.context.recordCreatedAt,
        transitionedAt,
        record: loaded.context.record,
      });
    } catch (error) {
      throw new AuthError(409, error instanceof Error ? error.message : "invalid workflow due date");
    }
    dueStatus = dueAt ? "scheduled" : "missing";
  }
  const revision = loaded.instance.state_revision + 1;
  if (assignment) {
    await sql`
      update board_workflow_instances set state_key = ${transition.to},
        state_revision = ${revision}, transition_key = ${transition.key},
        transitioned_at = ${transitionedAt}, due_at = ${dueAt}, due_status = ${dueStatus},
        assignment_kind = ${assignment.kind},
        assignment_position_id = ${assignment.kind === "position" ? assignment.positionId : null},
        assignment_participant_id = ${assignment.kind === "incident_participant" ? assignment.participantId : null},
        assignment_snapshot = ${sql.json(assignment as never)},
        pending_transition_key = null, pending_to_state = null,
        pending_requested_by = null, pending_assignment_request = null,
        pending_assignment_snapshot = null,
        pending_started_at = null, updated_at = now()
      where record_id = ${loaded.context.recordId}`;
  } else {
    await sql`
      update board_workflow_instances set state_key = ${transition.to},
        state_revision = ${revision}, transition_key = ${transition.key},
        transitioned_at = ${transitionedAt}, due_at = ${dueAt}, due_status = ${dueStatus},
        pending_transition_key = null, pending_to_state = null,
        pending_requested_by = null, pending_assignment_request = null,
        pending_assignment_snapshot = null,
        pending_started_at = null, updated_at = now()
      where record_id = ${loaded.context.recordId}`;
  }
  const historyId = await appendHistory(sql, actor, loaded.context, revision,
    "transition_completed", transition.key,
    loaded.instance.state_key, transition.to, { assignment, dueAt, dueStatus });
  await notifyAssignment(sql, loaded.context, assignment, transition.label, historyId);
  const [updated] = await sql`
    select * from board_workflow_instances where record_id = ${loaded.context.recordId}`;
  return resultFrom(asInstance(updated!));
}

async function updateAssignment(
  sql: Sql,
  recordId: string,
  assignment: ResolvedWorkflowAssignment,
): Promise<void> {
  await sql`
    update board_workflow_instances set assignment_kind = ${assignment.kind},
      assignment_position_id = ${assignment.kind === "position" ? assignment.positionId : null},
      assignment_participant_id = ${assignment.kind === "incident_participant" ? assignment.participantId : null},
      assignment_snapshot = ${sql.json(assignment as never)}, updated_at = now()
    where record_id = ${recordId}`;
}

async function appendHistory(
  sql: Sql,
  actor: Principal,
  context: RecordContext,
  revision: number,
  kind: "transition_requested" | "approval_recorded" | "transition_completed" | "escalation"
    | "transition_rejected" | "transition_cancelled",
  key: string,
  from: string | null,
  to: string | null,
  detail: Record<string, unknown>,
): Promise<string> {
  const [row] = await sql`
    insert into board_workflow_history
      (record_id, board_id, jurisdiction_id, incident_id, state_revision,
       event_kind, event_key, from_state, to_state, actor_person_id,
       actor_position_id, actor_participation_id, detail)
    values (${context.recordId}, ${context.boardId}, ${context.jurisdictionId},
      ${context.incidentId}, ${revision}, ${kind}, ${key}, ${from}, ${to},
      ${actor.person.id}, ${actor.position?.id ?? null},
      ${context.incidentAuthority?.participation?.id ?? null}, ${sql.json(detail as never)})
    returning id`;
  return row!.id as string;
}

async function notifyAssignment(
  sql: Sql,
  context: RecordContext,
  assignment: ResolvedWorkflowAssignment | null,
  label: string,
  historyId: string,
): Promise<void> {
  if (!assignment) return;
  await sql`
    insert into notifications
      (jurisdiction_id, person_id, position_id, channel, title, body, status, detail)
    values (${context.jurisdictionId},
      ${assignment.kind === "incident_participant" ? assignment.personId : null},
      ${assignment.kind === "position" ? assignment.positionId : null},
      'workflow', 'Workflow assignment', ${label}, 'delivered',
      ${sql.json({
        boardId: context.boardId,
        recordId: context.recordId,
        sourceJurisdictionId: context.jurisdictionId,
        incidentId: context.incidentId,
        historyId,
      } as never)})`;
}

async function replay(
  sql: Sql,
  context: RecordContext,
  actor: Principal,
  key: string,
  digest: string,
): Promise<WorkflowResult | null> {
  const [row] = await sql`
    select request_digest, result from board_workflow_idempotency
    where record_id = ${context.recordId} and actor_person_id = ${actor.person.id}
      and idempotency_key = ${key}`;
  if (!row) return null;
  if (row.request_digest !== digest) throw new AuthError(409, "idempotency key was used for another request");
  return row.result as unknown as WorkflowResult;
}

async function storeReplay(
  sql: Sql,
  context: RecordContext,
  actor: Principal,
  key: string,
  digest: string,
  result: WorkflowResult,
): Promise<void> {
  await sql`
    insert into board_workflow_idempotency
      (record_id, board_id, jurisdiction_id, incident_id, actor_person_id,
       idempotency_key, request_digest, result)
    values (${context.recordId}, ${context.boardId}, ${context.jurisdictionId},
      ${context.incidentId}, ${actor.person.id}, ${key}, ${digest}, ${sql.json(result as never)})`;
}

function commandDigest(kind: string, value: object): string {
  return createHash("sha256").update(JSON.stringify({ kind, value })).digest("hex");
}

async function pendingRequesterAuthorized(
  sql: Sql,
  recordId: string,
  role: "admin" | "writer" | "assigned_position",
): Promise<boolean> {
  const [row] = await sql`
    select workflow_pending_requester_authorized(${recordId}, ${role}) as allowed`;
  return Boolean(row?.allowed);
}

function resultFrom(instance: InstanceRow): WorkflowResult {
  return {
    recordId: instance.record_id,
    state: instance.state_key,
    stateRevision: instance.state_revision,
    pendingTransition: instance.pending_transition_key,
    dueAt: instance.due_at?.toISOString() ?? null,
    dueStatus: instance.due_status,
    assignment: instance.assignment_snapshot,
  };
}

function asInstance(row: Record<string, unknown>): InstanceRow {
  return row as unknown as InstanceRow;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
