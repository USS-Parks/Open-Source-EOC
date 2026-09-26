import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { TaskCreateSchema, type IncidentTask, type TaskCompletionReceipt } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, principalForPerson, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";
import { completeIncidentTask, createIncidentTask, updateIncidentTask } from "../incidents/tasks.js";
import { postMessage } from "../messaging/service.js";
import type { BoardSyncHub } from "./hub.js";

/**
 * Work a device queued for an incident, delivered after it reconnects (AG-07).
 *
 * A queued message, new task or task completion arrives here as a field
 * operation and runs exactly once: its receipt is kept under its sender and
 * operation id, and a retry returns it. A board edit arrives through the sync
 * hub instead. Either kind, reaching an incident that closed first, is neither
 * applied nor dropped: it is kept as a late submission for the incident's
 * owner administrators, attributed to its sender. Accepting one, once the
 * incident is open again, applies it as its sender would have; refusing one
 * keeps it with the reason.
 */

export type LateKind = "board" | "message" | "task" | "task_completion";

const Uuid = z.string().uuid();
const QueuedAt = z.string().datetime({ offset: true });

export const FieldOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"), operationId: Uuid, queuedAt: QueuedAt,
    threadId: Uuid, body: z.string().min(1).max(8000),
  }).strict(),
  z.object({
    kind: z.literal("task"), operationId: Uuid, queuedAt: QueuedAt,
    task: TaskCreateSchema, dependencyIds: z.array(Uuid).max(50).default([]),
  }).strict(),
  z.object({
    kind: z.literal("task_completion"), operationId: Uuid, queuedAt: QueuedAt, taskId: Uuid,
  }).strict(),
]);
export type FieldOperation = z.infer<typeof FieldOperationSchema>;

export type FieldOperationReceipt =
  | {
    readonly operationId: string;
    readonly kind: FieldOperation["kind"];
    readonly outcome: "applied";
    readonly messageId?: string;
    readonly task?: IncidentTask;
    readonly completion?: TaskCompletionReceipt;
  }
  | {
    readonly operationId: string;
    readonly kind: FieldOperation["kind"];
    readonly outcome: "late";
    readonly lateSubmissionId: string;
  };

export interface LateSubmissionInput {
  readonly incidentId: string;
  readonly jurisdictionId: string;
  readonly kind: LateKind;
  readonly operationId: string;
  readonly digest: string;
  readonly payload: unknown;
  readonly summary: string;
  readonly detail: unknown;
  readonly capturedAt: string | null;
}

const clip = (text: string, length: number): string =>
  text.length <= length ? text : `${text.slice(0, length - 3)}...`;

/** Keep work that reached a closed incident, as its sender, in the caller's transaction. */
export async function recordLateSubmission(tx: Sql, actor: Principal, input: LateSubmissionInput): Promise<string> {
  const [row] = await tx`
    insert into late_submissions
      (incident_id, jurisdiction_id, kind, operation_id, request_digest, payload, summary, detail,
       submitted_by, submitted_position, captured_at)
    values (${input.incidentId}, ${input.jurisdictionId}, ${input.kind}, ${input.operationId}, ${input.digest},
      ${tx.json(input.payload as never)}, ${clip(input.summary, 500)}, ${tx.json(input.detail as never)},
      ${actor.person.id}, ${actor.position?.id ?? null}, ${input.capturedAt})
    returning id`;
  const id = row!.id as string;
  await recordAudit(tx, actor, {
    jurisdictionId: input.jurisdictionId,
    incidentId: input.incidentId,
    category: "late_submission.received",
    subjectTable: "late_submissions",
    subjectId: id,
    payload: { kind: input.kind, operationId: input.operationId },
  });
  return id;
}

/** The late submission already holding this sender's operation, if any; a different payload is refused. */
export async function priorLateSubmission(
  tx: Sql,
  personId: string,
  operationId: string,
  digest: string,
): Promise<string | null> {
  const [row] = await tx`
    select id, request_digest from late_submissions
    where submitted_by = ${personId} and operation_id = ${operationId}`;
  if (!row) return null;
  if (row.request_digest !== digest) throw new AuthError(409, "operation id was used for another payload or scope");
  return row.id as string;
}

function operationDigest(incidentId: string, operation: FieldOperation): string {
  return createHash("sha256").update(JSON.stringify({ incidentId, ...operation })).digest("hex");
}

/** What a late operation holds, in words an administrator reads, and what it names. */
async function lateDescription(tx: Sql, incidentId: string, operation: FieldOperation): Promise<{ summary: string; detail: unknown }> {
  if (operation.kind === "message") {
    const [thread] = await tx`select title from threads where id = ${operation.threadId}`;
    const title = (thread?.title as string | undefined) || "an incident thread";
    return { summary: `Message in ${clip(title, 200)}`, detail: { threadId: operation.threadId, threadTitle: title, body: operation.body } };
  }
  if (operation.kind === "task") {
    return {
      summary: `New task: ${clip(operation.task.item, 400)}`,
      detail: { item: operation.task.item, category: operation.task.category, dueAt: operation.task.dueAt ?? null },
    };
  }
  const [task] = await tx`
    select number, item from checklist_items where id = ${operation.taskId} and incident_id = ${incidentId}`;
  if (!task) throw new AuthError(404, "task not found");
  return {
    summary: `Completion of TASK-${Number(task.number)} ${clip(task.item as string, 380)}`,
    detail: { taskId: operation.taskId, number: Number(task.number), item: task.item },
  };
}

/**
 * Run one queued field operation for its sender, exactly once. `accepting`
 * is set when an administrator accepts its late submission, so the kept
 * submission does not answer for it again.
 */
export async function runFieldOperation(
  tx: Sql,
  actor: Principal,
  incidentId: string,
  operation: FieldOperation,
  accepting = false,
): Promise<FieldOperationReceipt> {
  const digest = operationDigest(incidentId, operation);
  const [prior] = await tx`
    select incident_id, request_digest, receipt from field_operations
    where person_id = ${actor.person.id} and operation_id = ${operation.operationId}`;
  if (prior) {
    if (prior.incident_id !== incidentId || prior.request_digest !== digest)
      throw new AuthError(409, "operation id was used for another payload or scope");
    return prior.receipt as FieldOperationReceipt;
  }
  const base = { operationId: operation.operationId, kind: operation.kind };
  if (!accepting) {
    const kept = await priorLateSubmission(tx, actor.person.id, operation.operationId, digest);
    if (kept) return { ...base, outcome: "late", lateSubmissionId: kept };
  }
  const [incident] = await tx`select jurisdiction_id, closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (operation.kind === "message") {
    const [thread] = await tx`select incident_id from threads where id = ${operation.threadId}`;
    if (!thread) throw new AuthError(404, "thread not found");
    if (thread.incident_id !== incidentId) throw new AuthError(400, "thread is not part of this incident");
  }
  if (incident.closed_at) {
    const authority = await getIncidentAuthority(tx, actor, incidentId);
    if (!authority.canContribute) throw new AuthError(403, "incident contribution required");
    if (operation.kind === "task" && !authority.canManageParticipation)
      throw new AuthError(403, "adding a task requires incident owner admin");
    const { summary, detail } = await lateDescription(tx, incidentId, operation);
    const lateSubmissionId = await recordLateSubmission(tx, actor, {
      incidentId, jurisdictionId: incident.jurisdiction_id as string, kind: operation.kind,
      operationId: operation.operationId, digest, payload: operation, summary, detail,
      capturedAt: operation.queuedAt,
    });
    return { ...base, outcome: "late", lateSubmissionId };
  }
  let receipt: FieldOperationReceipt;
  if (operation.kind === "message") {
    const posted = await postMessage(tx, actor, operation.threadId, operation.body, operation.operationId);
    receipt = { ...base, outcome: "applied", messageId: posted.id };
  } else if (operation.kind === "task") {
    let task = await createIncidentTask(tx, actor, incidentId, operation.task);
    if (operation.dependencyIds.length) {
      task = await updateIncidentTask(tx, actor, incidentId, task.id,
        { expectedRevision: task.revision, dependencyIds: operation.dependencyIds });
    }
    receipt = { ...base, outcome: "applied", task };
  } else {
    const completion = await completeIncidentTask(tx, actor, incidentId, operation.taskId, operation.operationId);
    receipt = { ...base, outcome: "applied", completion };
  }
  await tx`
    insert into field_operations (person_id, operation_id, incident_id, kind, request_digest, receipt)
    values (${actor.person.id}, ${operation.operationId}, ${incidentId}, ${operation.kind}, ${digest},
      ${tx.json(receipt as never)})`;
  return receipt;
}

export interface LateSubmissionView {
  readonly id: string;
  readonly incidentId: string;
  readonly kind: LateKind;
  readonly summary: string;
  readonly detail: unknown;
  readonly status: "pending" | "accepted" | "refused";
  readonly submittedBy: { readonly personId: string; readonly displayName: string; readonly positionTitle: string | null };
  readonly capturedAt: string | null;
  readonly receivedAt: string;
  readonly decidedBy: { readonly personId: string; readonly displayName: string } | null;
  readonly decidedAt: string | null;
  readonly reason: string | null;
}

const iso = (value: unknown): string | null => value ? new Date(value as string).toISOString() : null;

function toView(row: Record<string, unknown>): LateSubmissionView {
  return {
    id: row.id as string,
    incidentId: row.incident_id as string,
    kind: row.kind as LateKind,
    summary: row.summary as string,
    detail: row.detail,
    status: row.status as LateSubmissionView["status"],
    submittedBy: {
      personId: row.submitted_by as string,
      displayName: row.submitter_name as string,
      positionTitle: (row.position_title as string | null) ?? null,
    },
    capturedAt: iso(row.captured_at),
    receivedAt: iso(row.received_at)!,
    decidedBy: row.decided_by ? { personId: row.decided_by as string, displayName: row.decider_name as string } : null,
    decidedAt: iso(row.decided_at),
    reason: (row.reason as string | null) ?? null,
  };
}

const lateSelect = (sql: Sql) => sql`
  select l.*, sender.display_name as submitter_name, pos.title as position_title,
    decider.display_name as decider_name
  from late_submissions l
  join persons sender on sender.id = l.submitted_by
  left join positions pos on pos.id = l.submitted_position
  left join persons decider on decider.id = l.decided_by`;

/** An incident's late submissions: all of them for its owner's administrators, a sender's own otherwise. */
export async function listLateSubmissions(tx: Sql, incidentId: string): Promise<LateSubmissionView[]> {
  const rows = await tx`${lateSelect(tx)} where l.incident_id = ${incidentId} order by l.received_at desc, l.id`;
  return rows.map(toView);
}

/** A pending late submission its incident's owner administrator may decide, locked until the decision commits. */
async function decidable(tx: Sql, actor: Principal, id: string): Promise<Record<string, unknown>> {
  const [seen] = await tx`select incident_id from late_submissions where id = ${id}`;
  if (!seen) throw new AuthError(404, "late submission not found");
  const authority = await getIncidentAuthority(tx, actor, seen.incident_id as string);
  if (!authority.canManageParticipation) throw new AuthError(403, "requires incident owner admin");
  const [row] = await tx`${lateSelect(tx)} where l.id = ${id} for update of l`;
  if (!row) throw new AuthError(404, "late submission not found");
  if (row.status !== "pending") throw new AuthError(409, `late submission was already ${row.status as string}`);
  return row;
}

async function decide(
  tx: Sql,
  actor: Principal,
  row: Record<string, unknown>,
  status: "accepted" | "refused",
  reason: string | null,
  outcome: Record<string, unknown> = {},
): Promise<LateSubmissionView> {
  const id = row.id as string;
  const [updated] = await tx`
    update late_submissions
    set status = ${status}, decided_by = ${actor.person.id}, decided_at = now(), reason = ${reason}
    where id = ${id} and status = 'pending'
    returning id`;
  if (!updated) throw new AuthError(409, "late submission was already decided");
  await recordAudit(tx, actor, {
    jurisdictionId: row.jurisdiction_id as string,
    incidentId: row.incident_id as string,
    category: `late_submission.${status}`,
    subjectTable: "late_submissions",
    subjectId: id,
    payload: { kind: row.kind, submittedBy: row.submitted_by, operationId: row.operation_id,
      ...(reason ? { reason } : {}), ...outcome },
  });
  const [fresh] = await tx`${lateSelect(tx)} where l.id = ${id}`;
  return toView(fresh!);
}

/** The sender, acting as they did when they queued the work. */
async function sender(sql: Sql, row: Record<string, unknown>): Promise<Principal> {
  const principal = await principalForPerson(sql, row.submitted_by as string);
  if (!row.submitted_position) return principal;
  const [position] = await withPerson(sql, principal.person.id, (tx) => tx`
    select id, key, title, jurisdiction_id from positions where id = ${row.submitted_position as string}`);
  return position ? {
    ...principal,
    position: {
      id: position.id as string, key: position.key as string, title: position.title as string,
      jurisdictionId: position.jurisdiction_id as string,
    },
  } : principal;
}

/**
 * Accept a late submission: apply it to its incident as its sender, then
 * record the decision. The incident must be open, as every write to it must.
 * The submission stays locked while its work applies, so no other decision
 * crosses it; the sender's operation id keeps a second attempt, after a
 * failure between the two, from applying it twice.
 */
export async function acceptLateSubmission(
  sql: Sql,
  hub: BoardSyncHub,
  actor: Principal,
  id: string,
): Promise<{ lateSubmission: LateSubmissionView; conflicts: number }> {
  return withPerson(sql, actor.person.id, async (tx) => {
    const row = await decidable(tx, actor, id);
    const incidentId = row.incident_id as string;
    const [incident] = await tx`select closed_at from incidents where id = ${incidentId}`;
    if (incident?.closed_at) throw new AuthError(409, "the incident is closed; reopen it to accept late work");
    const payload = row.payload as Record<string, unknown>;
    const author = await sender(sql, row);
    let conflicts = 0;
    if (row.kind === "board") {
      const result = await hub.apply(author, payload.boardId as string,
        new Uint8Array(Buffer.from(payload.update as string, "base64")), `late:${id}`,
        { operationId: row.operation_id as string, incidentId, acceptingLate: true });
      conflicts = result.conflicts;
    } else {
      const operation = FieldOperationSchema.parse(payload);
      await withPerson(sql, author.person.id, (inner) => runFieldOperation(inner, author, incidentId, operation, true));
    }
    const lateSubmission = await decide(tx, actor, row, "accepted", null, conflicts ? { conflicts } : {});
    return { lateSubmission, conflicts };
  });
}

const RefuseBody = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

export function lateSubmissionRoutes(
  app: FastifyInstance,
  sql: Sql,
  hub: BoardSyncHub,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post("/api/v1/incidents/:incidentId/field-operations", { preHandler: authenticate }, async (req, reply) => {
    const incidentId = Uuid.parse((req.params as { incidentId: string }).incidentId);
    const operation = FieldOperationSchema.parse(req.body);
    return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
      runFieldOperation(tx, req.principal, incidentId, operation)));
  });

  app.get("/api/v1/incidents/:incidentId/late-submissions", { preHandler: authenticate }, async (req, reply) => {
    const incidentId = Uuid.parse((req.params as { incidentId: string }).incidentId);
    return reply.send({ lateSubmissions: await withPerson(sql, req.principal.person.id, (tx) =>
      listLateSubmissions(tx, incidentId)) });
  });

  app.post("/api/v1/late-submissions/:lateSubmissionId/accept", { preHandler: authenticate }, async (req, reply) => {
    const id = Uuid.parse((req.params as { lateSubmissionId: string }).lateSubmissionId);
    return reply.send(await acceptLateSubmission(sql, hub, req.principal, id));
  });

  app.post("/api/v1/late-submissions/:lateSubmissionId/refuse", { preHandler: authenticate }, async (req, reply) => {
    const id = Uuid.parse((req.params as { lateSubmissionId: string }).lateSubmissionId);
    const { reason } = RefuseBody.parse(req.body);
    return reply.send({ lateSubmission: await withPerson(sql, req.principal.person.id, async (tx) =>
      decide(tx, req.principal, await decidable(tx, req.principal, id), "refused", reason)) });
  });
}
