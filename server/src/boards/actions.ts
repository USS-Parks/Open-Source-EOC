import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ZodError } from "zod";
import {
  ACTION_CHAIN_DEPTH,
  BoardTemplateSchema,
  deriveRecordValues,
  resolveTime,
  unmetGuardConditions,
  type ActionWrite,
  type BoardAction,
  type BoardActionRun,
  type BoardTemplate,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { afterCommit, withSavepoint } from "../db/context.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { notifyBoardEvent, type BoardEvent } from "../notify/engine.js";
import { publishBoardEvent } from "../events/bus.js";
import { createRecord, getIncidentBoardReadShape, updateRecord, visibleFields } from "./service.js";
import { requestWorkflowTransition } from "./workflow-runtime.js";

/**
 * The board action runner (VC-17). After a person's write, the actions of the
 * written record's board that the write sets off run in the same transaction,
 * as that person: each step goes through the same service call a person's
 * own edit, record, transition or notice would, so it holds only the
 * authority the person holds, and the per-state read-only fields and guards
 * apply. A step that is refused rolls back alone and is recorded with its
 * reason; the person's own write stands. An action's write can set off
 * further actions, which form one chain; a chain stops an action that already
 * ran in it, and any action deeper than ACTION_CHAIN_DEPTH, and records why.
 */

/** A write that may set off a board's actions. */
export type ActionCause =
  | { readonly kind: "record_created"; readonly boardId: string; readonly recordId: string }
  | { readonly kind: "field_changed"; readonly boardId: string; readonly recordId: string; readonly fields: readonly string[] }
  | { readonly kind: "state_entered"; readonly boardId: string; readonly recordId: string; readonly state: string };

interface Chain {
  readonly id: string;
  /** `boardId:actionKey` of every action that ran in the chain. */
  readonly ran: Set<string>;
}

interface RunContext {
  readonly boardId: string;
  readonly recordId: string;
  readonly boardTitle: string;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly createdBy: string;
  readonly template: BoardTemplate;
  readonly record: Readonly<Record<string, unknown>>;
}

interface StepDone {
  readonly reason?: string;
  readonly result: BoardActionRun["result"];
  readonly causes: readonly ActionCause[];
}

/** Run the actions `cause` sets off, and the chain their writes set off in turn. */
export async function runBoardActions(
  tx: Sql,
  actor: Principal,
  cause: ActionCause,
  chain: Chain = { id: randomUUID(), ran: new Set() },
  depth = 1,
  by: BoardAction | null = null,
): Promise<void> {
  const [row] = await tx`
    select r.data, r.incident_id, r.created_by, b.jurisdiction_id, b.title, t.definition
    from board_records r
    join boards b on b.id = r.board_id
    join board_templates t on t.key = b.template_key and t.version = b.template_version
    where r.id = ${cause.recordId} and r.board_id = ${cause.boardId}`;
  // A record the person may not read sets nothing off: its actions would read it for them.
  if (!row) return;
  const template = BoardTemplateSchema.parse(row.definition);
  const actions = (template.actions ?? []).filter((action) => setsOff(action, cause));
  if (actions.length === 0) return;
  const data = row.data as Record<string, unknown>;
  let record: Record<string, unknown> = data;
  try { record = deriveRecordValues(template.fields, data); } catch { /* a calculation that cannot be made reads as absent */ }
  const context: RunContext = {
    boardId: cause.boardId, recordId: cause.recordId, boardTitle: row.title as string,
    jurisdictionId: row.jurisdiction_id as string, incidentId: (row.incident_id as string | null) ?? null,
    createdBy: row.created_by as string, template, record,
  };
  const now = new Date();
  for (const action of actions) {
    if (action.condition && unmetGuardConditions(action.condition, record, now).length > 0) continue;
    const log = (outcome: BoardActionRun["outcome"], reason: string | null, result: BoardActionRun["result"] = null) =>
      recordRun(tx, actor, context, action, by, chain, depth, outcome, reason, result);
    const identity = `${cause.boardId}:${action.key}`;
    if (chain.ran.has(identity)) {
      await log("stopped", `${action.label} already ran in this chain; running it again would loop.`);
      continue;
    }
    if (depth > ACTION_CHAIN_DEPTH) {
      await log("stopped", `The chain reached its limit of ${ACTION_CHAIN_DEPTH} actions, each set off by the one before.`);
      continue;
    }
    chain.ran.add(identity);
    let done: StepDone;
    try {
      done = await withSavepoint(tx, (sp) => runStep(sp, actor, context, action, chain));
    } catch (error) {
      const reason = refusal(error);
      if (reason === null) throw error;
      await log("refused", reason);
      continue;
    }
    await log("done", done.reason ?? null, done.result);
    for (const next of done.causes) await runBoardActions(tx, actor, next, chain, depth + 1, action);
  }
}

function setsOff(action: BoardAction, cause: ActionCause): boolean {
  const trigger = action.trigger;
  if (trigger.kind !== cause.kind) return false;
  if (trigger.kind === "field_changed") return cause.kind === "field_changed" && cause.fields.includes(trigger.field);
  if (trigger.kind === "state_entered") return cause.kind === "state_entered" && cause.state === trigger.state;
  return true;
}

async function runStep(sp: Sql, actor: Principal, context: RunContext, action: BoardAction, chain: Chain): Promise<StepDone> {
  const tag: ActionWrite = { key: action.key, label: action.label, chain: chain.id };
  const { boardId, recordId } = context;
  const incidentId = context.incidentId ?? undefined;
  const step = action.step;
  switch (step.kind) {
    case "set_field": {
      const field = context.template.fields.find((item) => item.key === step.field);
      const value = field?.type === "datetime" ? new Date(resolveTime(step.value, new Date())!).toISOString() : step.value;
      const written = await updateRecord(sp, actor, boardId, recordId, { [step.field]: value }, incidentId, tag);
      if (!written.changed) return { reason: "The field already held that value.", result: { field: step.field }, causes: [] };
      await announce(sp, actor, { jurisdictionId: written.jurisdictionId, boardId, boardKey: written.boardKey, recordId,
        event: "record.updated", record: written.data, previous: written.previous });
      return { result: { field: step.field },
        causes: [{ kind: "field_changed", boardId, recordId, fields: changedFields(written.previous ?? {}, written.data) }] };
    }
    case "create_record": {
      if (!incidentId) throw new AuthError(409, "A linked record needs an incident, and this record is not part of one.");
      const boards = await sp`
        select b.id, b.title from incident_boards ib join boards b on b.id = ib.board_id
        where ib.incident_id = ${incidentId} and b.template_key = ${step.board} and b.archived_at is null
        order by b.id`;
      if (boards.length !== 1)
        throw new AuthError(409, boards.length === 0 ? `The incident has no board made from template ${step.board}.`
          : `The incident has more than one board made from template ${step.board}.`);
      const target = boards[0]!;
      const targetShape = await getIncidentBoardReadShape(sp, actor, incidentId, target.id as string);
      const link = targetShape.fields.find((field) => field.key === step.link);
      if (link?.type !== "record_ref" || link.targetBoardKey !== context.template.key)
        throw new AuthError(409, `${target.title as string} has no field ${step.link} that refers to ${context.boardTitle}.`);
      // Only what the person reads is copied: an action never carries a value past their field access.
      const source = await getIncidentBoardReadShape(sp, actor, incidentId, boardId);
      const readable = new Set(visibleFields(source).map((field) => field.key));
      const data: Record<string, unknown> = { [step.link]: recordId };
      for (const { to, from } of step.mapping) {
        const value = context.record[from];
        if (readable.has(from) && value !== undefined && value !== null) data[to] = value;
      }
      const created = await createRecord(sp, actor, target.id as string, data, incidentId, tag);
      await announce(sp, actor, { jurisdictionId: created.jurisdictionId, boardId: target.id as string,
        boardKey: created.boardKey, recordId: created.id, event: "record.created", record: created.data });
      return { result: { recordId: created.id, boardId: target.id as string, board: target.title as string },
        causes: [{ kind: "record_created", boardId: target.id as string, recordId: created.id }] };
    }
    case "transition": {
      const moved = await requestWorkflowTransition(sp, actor, boardId, recordId,
        { transitionKey: step.transition, idempotencyKey: `action:${chain.id}:${action.key}` });
      const state = context.template.workflow?.states.find((item) => item.key === moved.state)?.label ?? moved.state;
      if (moved.pendingTransition) return { reason: "The transition waits for approval.", result: { state }, causes: [] };
      return { result: { state }, causes: [{ kind: "state_entered", boardId, recordId, state: moved.state }] };
    }
    case "notify": {
      if (!actor.memberships.some((membership) => membership.jurisdictionId === context.jurisdictionId))
        throw new AuthError(403, "Only members of the board's jurisdiction send its notices.");
      let personId: string | null = null;
      let positionId: string | null = null;
      let to = "the record's creator";
      if (step.to.kind === "creator") personId = context.createdBy;
      else {
        const [position] = await sp`
          select id, title from positions where jurisdiction_id = ${context.jurisdictionId} and key = ${step.to.positionKey}`;
        if (!position) throw new AuthError(409, `The jurisdiction has no position ${step.to.positionKey}.`);
        positionId = position.id as string;
        to = position.title as string;
      }
      // The id is chosen here: the sender may not be able to read the notice back.
      await sp`
        insert into notifications
          (id, jurisdiction_id, incident_id, person_id, position_id, channel, title, body, status, detail)
        values (${randomUUID()}, ${context.jurisdictionId}, ${context.incidentId}, ${personId}, ${positionId}, 'action',
          ${`${context.boardTitle}: ${action.label}`}, ${step.message}, 'delivered',
          ${sp.json({ boardId, recordId, action: action.key, chain: chain.id })})`;
      return { result: { to }, causes: [] };
    }
  }
}

/**
 * An action's write reaches the board's notification rules as any write does,
 * and live views once the transaction commits.
 */
async function announce(sp: Sql, actor: Principal, event: BoardEvent): Promise<void> {
  await notifyBoardEvent(sp, actor, event);
  afterCommit(sp, () => publishBoardEvent(event));
}

/** Why a step was refused, in the words its service gave; null for a failure that is not a refusal. */
function refusal(error: unknown): string | null {
  if (error instanceof AuthError) return error.message;
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`).join("; ");
  // Row-level security refused the write.
  if (error && typeof error === "object" && "code" in error && error.code === "42501")
    return "The person whose change set this off may not make this change.";
  return null;
}

export function changedFields(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !isDeepStrictEqual(before[key], after[key]));
}

/** A record's workflow state and its revision, or null before its workflow first moves. */
export async function workflowState(tx: Sql, recordId: string): Promise<{ state: string; revision: number } | null> {
  const [row] = await tx`select state_key, state_revision from board_workflow_instances where record_id = ${recordId}`;
  return row ? { state: row.state_key as string, revision: Number(row.state_revision) } : null;
}

/**
 * After a workflow request or approval, run what entering a new state sets
 * off. The record's workflow row says whether it moved: a request that waits
 * for approval, a replay and a withdrawal leave it in its state.
 */
export async function runAfterTransition(
  tx: Sql, actor: Principal, boardId: string, recordId: string,
  before: { readonly state: string; readonly revision: number } | null,
): Promise<void> {
  const after = await workflowState(tx, recordId);
  if (!after || after.revision === (before?.revision ?? 0) || after.state === before?.state) return;
  await runBoardActions(tx, actor, { kind: "state_entered", boardId, recordId, state: after.state });
}

/** One run in the record's audit trail, which the record's history reads. */
async function recordRun(
  tx: Sql, actor: Principal, context: RunContext, action: BoardAction, by: BoardAction | null, chain: Chain,
  depth: number, outcome: BoardActionRun["outcome"], reason: string | null, result: BoardActionRun["result"],
): Promise<void> {
  const trigger = action.trigger;
  const stateLabel = (key: string) => context.template.workflow?.states.find((state) => state.key === key)?.label ?? key;
  const run: BoardActionRun = {
    action: { key: action.key, label: action.label },
    trigger: {
      kind: trigger.kind,
      field: trigger.kind === "field_changed" ? trigger.field : null,
      state: trigger.kind === "state_entered" ? stateLabel(trigger.state) : null,
      byAction: by?.label ?? null,
    },
    step: action.step.kind, outcome, reason, chain: chain.id, depth, result,
  };
  await recordAudit(tx, actor, {
    jurisdictionId: context.jurisdictionId,
    ...(context.incidentId ? { incidentId: context.incidentId } : {}),
    category: "board.action.run",
    subjectTable: "board_records",
    subjectId: context.recordId,
    payload: { board: context.template.key, ...run },
  });
}
