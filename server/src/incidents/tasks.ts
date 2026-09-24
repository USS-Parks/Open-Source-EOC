import { createHash, randomUUID } from "node:crypto";
import type {
  IncidentTask,
  TaskCompletionReceipt,
  TaskDependencyView,
  TaskListQuery,
  TaskListResponse,
  TaskCreate,
  TaskMetadataPatch,
  TaskStatus,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type PageRequest } from "../db/cursor.js";
import { resolveWorkflowAssignment } from "../boards/workflow.js";
import {
  getIncidentAuthority,
  lockIncidentMutation,
  type IncidentAuthority,
} from "./participation.js";

interface TaskRow extends Record<string, unknown> {
  id: string;
  number: string | number;
  incident_id: string;
  item: string;
  category: string;
  status: TaskStatus;
  due_at: string | Date | null;
  revision: number;
  position_id: string | null;
  position_title: string | null;
  position_organization_id: string | null;
  position_organization_name: string | null;
  position_holders: string | null;
  assigned_participant_id: string | null;
  participant_organization_name: string | null;
  participant_person_name: string | null;
  participant_person_id: string | null;
  participant_organization_id: string | null;
  participant_title: string | null;
  completed_at: string | Date | null;
  completed_by: string | null;
  completed_by_position: string | null;
  completed_by_organization_id: string | null;
  completed_by_participation_id: string | null;
  completed_as_title: string | null;
}

const taskSelect = `
  select c.id, c.number, c.incident_id, c.item, c.category, c.status, c.due_at, c.sort_order, c.revision,
    c.position_id, pos.title as position_title,
    pos.jurisdiction_id as position_organization_id,
    position_org.name as position_organization_name,
    (select string_agg(holder.display_name, ', ' order by holder.display_name)
      from position_assignments pa join persons holder on holder.id = pa.person_id
      where pa.position_id = c.position_id and pa.revoked_at is null) as position_holders,
    c.assigned_participant_id, ip.person_id as participant_person_id,
    ip.organization_id as participant_organization_id,
    participant_org.name as participant_organization_name,
    participant_person.display_name as participant_person_name,
    ip.incident_position_title as participant_title,
    c.completed_at, c.completed_by, c.completed_by_position,
    c.completed_by_organization_id, c.completed_by_participation_id,
    c.completed_as_title
  from checklist_items c
  left join positions pos on pos.id = c.position_id
  left join jurisdictions position_org on position_org.id = pos.jurisdiction_id
  left join incident_participants ip on ip.id = c.assigned_participant_id
  left join jurisdictions participant_org on participant_org.id = ip.organization_id
  left join persons participant_person on participant_person.id = ip.person_id`;

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function toTask(row: TaskRow, dependencies: readonly TaskDependencyView[] = []): IncidentTask {
  const assignment = row.position_id
    ? {
        kind: "position" as const,
        id: row.position_id,
        organizationId: row.position_organization_id!,
        organizationName: row.position_organization_name ?? "",
        title: row.position_title!,
        personId: null,
        personName: row.position_holders,
      }
    : row.assigned_participant_id
      ? {
          kind: "incident_participant" as const,
          id: row.assigned_participant_id,
          organizationId: row.participant_organization_id!,
          organizationName: row.participant_organization_name ?? "",
          title: row.participant_title!,
          personId: row.participant_person_id,
          personName: row.participant_person_name,
        }
      : null;
  const completedBy = row.completed_at
    ? {
        personId: row.completed_by!,
        positionId: row.completed_by_position,
        organizationId: row.completed_by_organization_id!,
        participationId: row.completed_by_participation_id,
        title: row.completed_as_title!,
      }
    : null;
  return {
    id: row.id,
    number: Number(row.number),
    incidentId: row.incident_id,
    item: row.item,
    category: row.category,
    status: row.status,
    dueAt: iso(row.due_at),
    revision: Number(row.revision),
    assignment,
    dependencies,
    completedAt: iso(row.completed_at),
    completedBy,
  };
}

async function taskDependencies(
  sql: Sql,
  taskIds: readonly string[],
): Promise<Map<string, TaskDependencyView[]>> {
  const result = new Map<string, TaskDependencyView[]>();
  if (taskIds.length === 0) return result;
  const rows = await sql.unsafe(`select d.task_id, prerequisite.id, prerequisite.item, prerequisite.status
    from checklist_task_dependencies d
    join checklist_items prerequisite on prerequisite.id = d.prerequisite_task_id
    where d.task_id = any($1::uuid[])
    order by prerequisite.sort_order, prerequisite.id`, [taskIds]);
  for (const row of rows as Array<Record<string, unknown>>) {
    const taskId = row.task_id as string;
    const dependencies = result.get(taskId) ?? [];
    dependencies.push({ id: row.id as string, item: row.item as string, status: row.status as TaskStatus });
    result.set(taskId, dependencies);
  }
  return result;
}

function dueBucket(
  task: IncidentTask,
  now: number,
): "overdue" | "next_24_hours" | "upcoming" | "none" | "completed" {
  if (task.status === "completed") return "completed";
  if (!task.dueAt) return "none";
  const due = new Date(task.dueAt).getTime();
  if (due < now) return "overdue";
  if (due < now + 24 * 60 * 60_000) return "next_24_hours";
  return "upcoming";
}

function assignedMatch(task: IncidentTask, actor: Principal, value: string): boolean {
  if (value === "unassigned") return task.assignment === null;
  if (value === "mine") {
    return task.assignment?.kind === "position"
      ? task.assignment.id === actor.position?.id
      : task.assignment?.personId === actor.person.id;
  }
  return task.assignment?.id === value;
}

/**
 * Aggregate the complete filtered task set and return one page of it. The
 * analytics count every match, so every task row is read; `on_page` marks
 * the rows after the cursor, compared in SQL in the list's own order.
 */
export async function listIncidentTasks(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  filters: TaskListQuery,
  page: PageRequest,
): Promise<TaskListResponse> {
  await getIncidentAuthority(sql, actor, incidentId);
  const after = decodeCursor(page.cursor, ["key", "atOrInfinity", "int", "id"]);
  const rows = await sql.unsafe(`select task.*,
      coalesce(to_char(task.due_at at time zone 'UTC', '${CURSOR_AT_FORMAT}'), 'infinity') as page_due,
      ($2::text is null or (task.status, coalesce(task.due_at, 'infinity'), task.sort_order, task.id)
        > ($2::text, $3::text::timestamptz, $4::text::integer, $5::uuid)) as on_page
    from (${taskSelect} where c.incident_id = $1) task
    order by task.status, coalesce(task.due_at, 'infinity'), task.sort_order, task.id`,
  [incidentId, ...(after ?? [null, null, null, null])]);
  const now = Date.now();
  const matching = (rows as unknown as TaskRow[]).map((row) => ({ row, task: toTask(row) })).filter(({ task }) =>
    (filters.status === undefined || task.status === filters.status) &&
    (filters.category === undefined || task.category === filters.category) &&
    (filters.assignment === undefined || assignedMatch(task, actor, filters.assignment)) &&
    (filters.due === undefined || dueBucket(task, now) === filters.due));
  const tasks = matching.map(({ task }) => task);
  const byStatus: Record<TaskStatus, number> = { open: 0, in_progress: 0, completed: 0 };
  const byCategory: Record<string, number> = {};
  let overdue = 0;
  let dueNext24Hours = 0;
  let upcoming = 0;
  let withoutDue = 0;
  for (const task of tasks) {
    byStatus[task.status] += 1;
    byCategory[task.category] = (byCategory[task.category] ?? 0) + 1;
    const bucket = dueBucket(task, now);
    if (bucket === "overdue") overdue += 1;
    else if (bucket === "next_24_hours") dueNext24Hours += 1;
    else if (bucket === "upcoming") upcoming += 1;
    else if (bucket === "none") withoutDue += 1;
  }
  const paged = cutPage(matching.filter(({ row }) => row.on_page), page.limit ?? DEFAULT_PAGE_LIMIT,
    ({ row }) => [row.status, row.page_due as string, String(row.sort_order), row.id]);
  const dependencies = await taskDependencies(sql, paged.items.map(({ row }) => row.id));
  return {
    tasks: paged.items.map(({ row }) => toTask(row, dependencies.get(row.id))),
    nextCursor: paged.nextCursor,
    analytics: {
      total: tasks.length,
      byStatus,
      byCategory,
      overdue,
      dueNext24Hours,
      upcoming,
      withoutDue,
    },
    filters,
  };
}

type LockedIncidentAuthority = IncidentAuthority & { readonly closedAt: string | null };

async function lockIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<LockedIncidentAuthority> {
  await getIncidentAuthority(sql, actor, incidentId);
  await lockIncidentMutation(sql, incidentId);
  const [incident] = await sql`
    select id, closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  return { ...authority, closedAt: (incident.closed_at as string | null) ?? null };
}

async function loadTaskForUpdate(sql: Sql, incidentId: string, taskId: string): Promise<TaskRow> {
  const rows = await sql.unsafe(
    `${taskSelect} where c.incident_id = $1 and c.id = $2 for update of c`,
    [incidentId, taskId],
  );
  const row = rows[0] as TaskRow | undefined;
  if (!row) throw new AuthError(404, "task not found");
  return row;
}

/** Owner-admin metadata or current-assignee status update with revision CAS. */
/** Add a task to an open incident; the owner's administrators manage task metadata, as they do for updates. */
export async function createIncidentTask(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: TaskCreate,
): Promise<IncidentTask> {
  const authority = await lockIncident(sql, actor, incidentId);
  if (authority.closedAt) throw new AuthError(409, "incident is closed");
  if (!authority.canManageParticipation) throw new AuthError(403, "adding a task requires incident owner admin");
  let positionId: string | null = null;
  let participantId: string | null = null;
  if (input.assignment) {
    if (input.assignment.kind === "incident_participant" && input.assignment.incidentId !== incidentId) {
      throw new AuthError(400, "assignment belongs to another incident");
    }
    const assignment = await resolveWorkflowAssignment(sql, actor, authority.jurisdictionId, input.assignment);
    positionId = assignment.kind === "position" ? assignment.positionId : null;
    participantId = assignment.kind === "incident_participant" ? assignment.participantId : null;
  }
  const [created] = await sql`
    insert into checklist_items (incident_id, item, category, due_at, position_id, assigned_participant_id, sort_order)
    values (${incidentId}, ${input.item}, ${input.category}, ${input.dueAt ?? null}::timestamptz,
      ${positionId}, ${participantId},
      (select coalesce(max(sort_order), 0) + 1 from checklist_items where incident_id = ${incidentId}))
    returning id`;
  const taskId = created!.id as string;
  const [row] = await sql.unsafe(`${taskSelect} where c.id = $1`, [taskId]);
  const task = toTask(row as unknown as TaskRow);
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId,
    incidentId,
    category: "checklist.task.created",
    subjectTable: "checklist_items",
    subjectId: taskId,
    payload: { number: task.number, item: task.item, category: task.category, dueAt: task.dueAt },
  });
  return task;
}

export async function updateIncidentTask(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  taskId: string,
  input: TaskMetadataPatch,
): Promise<IncidentTask> {
  const authority = await lockIncident(sql, actor, incidentId);
  if (authority.closedAt) throw new AuthError(409, "incident is closed");
  const current = await loadTaskForUpdate(sql, incidentId, taskId);
  if (current.status === "completed") throw new AuthError(409, "completed task is immutable");
  if (Number(current.revision) !== input.expectedRevision) throw new AuthError(409, "task revision changed");
  const statusOnly = input.status !== undefined && input.item === undefined &&
    input.category === undefined && input.dueAt === undefined && input.assignment === undefined &&
    input.dependencyIds === undefined;
  if (!authority.canManageParticipation) {
    if (!statusOnly) throw new AuthError(403, "task metadata requires incident owner admin");
    await requireCurrentAssignee(sql, actor, authority, current);
  }

  let positionId: string | null | undefined;
  let participantId: string | null | undefined;
  if (input.assignment !== undefined) {
    if (input.assignment === null) {
      positionId = null;
      participantId = null;
    } else {
      if (input.assignment.kind === "incident_participant" && input.assignment.incidentId !== incidentId) {
        throw new AuthError(400, "assignment belongs to another incident");
      }
      const assignment = await resolveWorkflowAssignment(
        sql,
        actor,
        authority.jurisdictionId,
        input.assignment,
      );
      positionId = assignment.kind === "position" ? assignment.positionId : null;
      participantId = assignment.kind === "incident_participant" ? assignment.participantId : null;
    }
  }
  if (input.dependencyIds !== undefined) {
    if (input.dependencyIds.includes(taskId)) throw new AuthError(400, "task cannot depend on itself");
    const dependencyRows = await sql.unsafe(`select id, incident_id from checklist_items
      where id = any($1::uuid[])`, [input.dependencyIds]);
    if (dependencyRows.length !== input.dependencyIds.length) throw new AuthError(400, "task dependency was not found");
    if ((dependencyRows as Array<Record<string, unknown>>).some((row) => row.incident_id !== incidentId)) {
      throw new AuthError(400, "task dependency belongs to another incident");
    }
    const cycle = await sql.unsafe(`with recursive prerequisites(id) as (
        select prerequisite_task_id from checklist_task_dependencies where task_id = any($1::uuid[])
        union
        select d.prerequisite_task_id from checklist_task_dependencies d
          join prerequisites p on p.id = d.task_id
      ) select 1 from prerequisites where id = $2::uuid limit 1`, [input.dependencyIds, taskId]);
    if (cycle.length) throw new AuthError(400, "task dependency would create a cycle");
    await sql`delete from checklist_task_dependencies where task_id = ${taskId}`;
    for (const dependencyId of input.dependencyIds) await sql`
      insert into checklist_task_dependencies (task_id, prerequisite_task_id)
      values (${taskId}, ${dependencyId})`;
  }

  const [updated] = await sql`
    update checklist_items set
      item = case when ${input.item !== undefined} then ${input.item ?? current.item} else item end,
      category = case when ${input.category !== undefined} then ${input.category ?? current.category} else category end,
      due_at = case when ${input.dueAt !== undefined} then ${input.dueAt ?? null}::timestamptz else due_at end,
      status = case when ${input.status !== undefined} then ${input.status ?? current.status} else status end,
      position_id = case when ${positionId !== undefined} then ${positionId ?? null}::uuid else position_id end,
      assigned_participant_id = case when ${participantId !== undefined}
        then ${participantId ?? null}::uuid else assigned_participant_id end
    where id = ${taskId} and incident_id = ${incidentId}
      and revision = ${input.expectedRevision}
    returning id`;
  if (!updated) throw new AuthError(409, "task revision changed");
  const [row] = await sql.unsafe(`${taskSelect} where c.id = $1`, [taskId]);
  const task = toTask(row as unknown as TaskRow, (await taskDependencies(sql, [taskId])).get(taskId));
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId,
    incidentId,
    category: "checklist.task.updated",
    subjectTable: "checklist_items",
    subjectId: taskId,
    payload: {
      revision: task.revision,
      changed: Object.keys(input).filter((key) => key !== "expectedRevision"),
      ...(statusOnly ? { status: task.status } : {}),
    },
  });
  return task;
}

function completionDigest(incidentId: string, taskId: string): string {
  return createHash("sha256").update(JSON.stringify({ incidentId, taskId, action: "complete" })).digest("hex");
}

async function requireCurrentAssignee(
  sql: Sql,
  actor: Principal,
  authority: IncidentAuthority,
  task: TaskRow,
): Promise<void> {
  if (task.position_id) {
    const [assignment] = await sql`
      select id from position_assignments
      where position_id = ${task.position_id} and person_id = ${actor.person.id}
        and revoked_at is null`;
    if (!assignment || actor.position?.id !== task.position_id || !authority.canContribute) {
      throw new AuthError(403, "sign into the assigned position to complete this task");
    }
    return;
  }
  if (
    task.assigned_participant_id &&
    authority.participation?.id === task.assigned_participant_id &&
    task.participant_person_id === actor.person.id
  ) return;
  throw new AuthError(403, "task is not assigned to the current actor");
}

/** Complete once; exact retries return the first immutable receipt. */
export async function completeIncidentTask(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  taskId: string,
  operationId: string,
): Promise<TaskCompletionReceipt> {
  const authority = await lockIncident(sql, actor, incidentId);
  const digest = completionDigest(incidentId, taskId);
  const [prior] = await sql`
    select task_id, incident_id, actor_person_id, request_digest, receipt
    from checklist_completion_operations where operation_id = ${operationId}`;
  if (prior) {
    if (
      prior.task_id !== taskId || prior.incident_id !== incidentId ||
      prior.actor_person_id !== actor.person.id || prior.request_digest !== digest
    ) throw new AuthError(409, "operation id was used for another completion");
    return prior.receipt as unknown as TaskCompletionReceipt;
  }
  if (authority.closedAt) throw new AuthError(409, "incident is closed");
  const task = await loadTaskForUpdate(sql, incidentId, taskId);
  await requireCurrentAssignee(sql, actor, authority, task);
  if (task.status === "completed") throw new AuthError(409, "task is already completed");
  const blocked = await sql`
    select prerequisite.item from checklist_task_dependencies d
    join checklist_items prerequisite on prerequisite.id = d.prerequisite_task_id
    where d.task_id = ${taskId} and prerequisite.status <> 'completed'
    order by prerequisite.sort_order, prerequisite.id limit 1`;
  if (blocked.length) throw new AuthError(409, `task prerequisite is incomplete: ${blocked[0]!.item as string}`);

  const [completed] = await sql`
    update checklist_items set status = 'completed'
    where id = ${taskId} and incident_id = ${incidentId} and revision = ${task.revision}
    returning revision, completed_at, completed_by, completed_by_position,
      completed_by_organization_id, completed_by_participation_id, completed_as_title`;
  if (!completed) throw new AuthError(409, "task revision changed");
  const receipt: TaskCompletionReceipt = {
    operationId,
    taskId,
    incidentId,
    status: "completed",
    revision: Number(completed.revision),
    completedAt: new Date(completed.completed_at as string).toISOString(),
    completedBy: {
      personId: completed.completed_by as string,
      positionId: (completed.completed_by_position as string | null) ?? null,
      organizationId: completed.completed_by_organization_id as string,
      participationId: (completed.completed_by_participation_id as string | null) ?? null,
      title: completed.completed_as_title as string,
    },
  };
  try {
    await sql`
      insert into checklist_completion_operations
        (operation_id, task_id, incident_id, actor_person_id, request_digest, receipt)
      values (${operationId}, ${taskId}, ${incidentId}, ${actor.person.id}, ${digest},
        ${sql.json(receipt as never)})`;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new AuthError(409, "operation id was used for another completion");
    }
    throw error;
  }
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId,
    incidentId,
    category: "checklist.completed",
    subjectTable: "checklist_items",
    subjectId: taskId,
    payload: { operationId, revision: receipt.revision },
  });
  return receipt;
}

/** Backward-compatible entry point; it uses the same completion engine. */
export async function completeLegacyChecklistItem(
  sql: Sql,
  actor: Principal,
  taskId: string,
): Promise<TaskCompletionReceipt> {
  const [task] = await sql`select incident_id from checklist_items where id = ${taskId}`;
  if (!task) throw new AuthError(404, "task not found");
  return completeIncidentTask(sql, actor, task.incident_id as string, taskId, randomUUID());
}
