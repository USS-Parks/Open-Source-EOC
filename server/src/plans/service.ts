import {
  PlanActivateSchema,
  PlanDefinitionSchema,
  PlanSaveSchema,
  type IncidentPlan,
  type PlanActivation,
  type PlanDefinition,
  type PlanDetail,
  type PlanKind,
  type PlanSummary,
  type PlanVersion,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { activateIncident, IncidentTemplateSchema, type IncidentTemplate } from "../incidents/service.js";
import { sendMassNotificationIn } from "../notify/mass.js";

/**
 * Executable plans (VC-09): a jurisdiction's emergency plan as an object it
 * runs. Administrators author and version plans; members read them. Saving
 * checks every link against the plan's incident template, so what a section
 * names is what activation opens. Activation opens the incident from the
 * template, records the plan version on it, releases the tasks whose time
 * has come, keeps the rest waiting for the scheduler, and sends the notice,
 * all in one transaction. The scheduler also reminds administrators when a
 * plan's review falls due.
 */

type Row = Record<string, unknown>;
const iso = (value: unknown): string => new Date(value as string).toISOString();
const isoOrNull = (value: unknown): string | null => (value ? iso(value) : null);
const MINUTE = 60_000;

// The due date is the same expression the scheduler's reminder uses, so the
// screen and the reminder agree across a daylight saving change.
const planColumns = (sql: Sql) => sql`
  p.id, p.jurisdiction_id, p.title, p.definition, p.version, p.updated_at, p.reviewed_at, p.created_at,
  p.review_every_days, coalesce(p.reviewed_at, p.created_at) + make_interval(days => p.review_every_days) as review_due_at`;

function toSummary(row: Row): PlanSummary {
  const definition = PlanDefinitionSchema.parse(row.definition);
  return {
    id: row.id as string,
    title: row.title as string,
    kind: definition.kind,
    version: row.version as number,
    templateKey: definition.templateKey,
    sections: definition.sections.length,
    tasks: definition.tasks.length,
    updatedAt: iso(row.updated_at),
    reviewEveryDays: definition.reviewEveryDays ?? null,
    reviewedAt: isoOrNull(row.reviewed_at),
    reviewDueAt: isoOrNull(row.review_due_at),
  };
}

function toDetail(row: Row): PlanDetail {
  return {
    ...toSummary(row),
    jurisdictionId: row.jurisdiction_id as string,
    definition: PlanDefinitionSchema.parse(row.definition),
  };
}

async function loadPlan(sql: Sql, planId: string, lock = false): Promise<Row> {
  const [row] = lock
    ? await sql`select ${planColumns(sql)} from plans p where p.id = ${planId} for update`
    : await sql`select ${planColumns(sql)} from plans p where p.id = ${planId}`;
  if (!row) throw new AuthError(404, "plan not found");
  return row;
}

/** A jurisdiction's plans, by title. */
export async function listPlans(sql: Sql, actor: Principal, jurisdictionId: string): Promise<PlanSummary[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select ${planColumns(sql)} from plans p where p.jurisdiction_id = ${jurisdictionId} order by p.title, p.id`;
  return rows.map(toSummary);
}

export async function getPlan(sql: Sql, actor: Principal, planId: string): Promise<PlanDetail> {
  const row = await loadPlan(sql, planId);
  requireMember(actor, row.jurisdiction_id as string);
  return toDetail(row);
}

/** Every version of a plan, newest first, with who saved it. */
export async function listPlanVersions(sql: Sql, actor: Principal, planId: string): Promise<PlanVersion[]> {
  const row = await loadPlan(sql, planId);
  requireMember(actor, row.jurisdiction_id as string);
  const rows = await sql`
    select v.version, v.title, v.definition, v.created_at, p.display_name
    from plan_versions v left join persons p on p.id = v.created_by
    where v.plan_id = ${planId} order by v.version desc`;
  return rows.map((version) => ({
    version: version.version as number,
    title: version.title as string,
    definition: PlanDefinitionSchema.parse(version.definition),
    savedAt: iso(version.created_at),
    savedBy: (version.display_name as string | null) ?? null,
  }));
}

async function loadTemplate(sql: Sql, key: string): Promise<IncidentTemplate> {
  const [row] = await sql`select definition from incident_templates where key = ${key}`;
  if (!row) throw new AuthError(400, `templateKey: no incident template ${key}`);
  return IncidentTemplateSchema.parse(row.definition);
}

/**
 * Every part a plan names must be one its template opens: positions, boards
 * and rules by key, contact groups by name (or a group the jurisdiction
 * already has, which activation leaves as it is).
 */
async function checkAgainstTemplate(sql: Sql, jurisdictionId: string, plan: PlanDefinition): Promise<void> {
  const template = await loadTemplate(sql, plan.templateKey);
  const positions = new Set(template.positions);
  const boards = new Set(template.boards);
  const rules = new Set(template.rules ?? []);
  const groups = new Set((template.contactGroups ?? []).map((group) => group.name));
  const named = [...new Set([
    ...plan.sections.flatMap((section) => section.contactGroups),
    ...(plan.notice?.contactGroups ?? []),
  ])].filter((name) => !groups.has(name));
  if (named.length > 0) {
    const existing = await sql`
      select name from contact_groups where jurisdiction_id = ${jurisdictionId} and name = any(${named})`;
    for (const row of existing) groups.add(row.name as string);
  }
  const refuse = (path: string, what: string, value: string): never => {
    throw new AuthError(400, `${path}: ${what} ${value} is not one the ${template.title} template opens`);
  };
  for (const [index, section] of plan.sections.entries()) {
    const at = `sections.${index}`;
    for (const key of section.positions) if (!positions.has(key)) refuse(`${at}.positions`, "position", key);
    for (const key of section.boards) if (!boards.has(key)) refuse(`${at}.boards`, "board", key);
    for (const key of section.rules) if (!rules.has(key)) refuse(`${at}.rules`, "rule", key);
    for (const name of section.contactGroups) if (!groups.has(name)) refuse(`${at}.contactGroups`, "contact group", name);
  }
  for (const [index, task] of plan.tasks.entries()) {
    if (!positions.has(task.position)) refuse(`tasks.${index}.position`, "position", task.position);
  }
  if (plan.notice) {
    for (const key of plan.notice.positions) if (!positions.has(key)) refuse("notice.positions", "position", key);
    for (const key of plan.notice.onCallPositions) if (!positions.has(key)) refuse("notice.onCallPositions", "position", key);
    for (const name of plan.notice.contactGroups) if (!groups.has(name)) refuse("notice.contactGroups", "contact group", name);
  }
}

function parseSave(raw: unknown) {
  const parsed = PlanSaveSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AuthError(400, `${issue?.path.join(".") || "plan"}: ${issue?.message ?? "invalid plan"}`);
  }
  return parsed.data;
}

/** A new plan, at version 1. */
export async function createPlan(sql: Sql, actor: Principal, jurisdictionId: string, raw: unknown): Promise<PlanDetail> {
  requireAdmin(actor, jurisdictionId);
  const input = parseSave(raw);
  if (input.expectedVersion !== 0) throw new AuthError(409, "a new plan starts from version 0");
  await checkAgainstTemplate(sql, jurisdictionId, input.definition);
  const [created] = await sql`
    insert into plans (jurisdiction_id, title, definition, created_by, updated_by)
    values (${jurisdictionId}, ${input.title}, ${sql.json(input.definition as never)}, ${actor.person.id}, ${actor.person.id})
    returning id`;
  const planId = created!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId, category: "plan.saved", subjectTable: "plans", subjectId: planId,
    payload: { title: input.title, version: 1, kind: input.definition.kind, template: input.definition.templateKey },
  });
  return toDetail(await loadPlan(sql, planId));
}

/** Save over the version the editor opened; someone else's save in between is refused, not lost. */
export async function updatePlan(sql: Sql, actor: Principal, planId: string, raw: unknown): Promise<PlanDetail> {
  const current = await loadPlan(sql, planId, true);
  const jurisdictionId = current.jurisdiction_id as string;
  requireAdmin(actor, jurisdictionId);
  const input = parseSave(raw);
  const version = current.version as number;
  if (input.expectedVersion !== version) {
    throw new AuthError(409, `the plan changed after it was opened: version ${version} is current`);
  }
  await checkAgainstTemplate(sql, jurisdictionId, input.definition);
  await sql`
    update plans set title = ${input.title}, definition = ${sql.json(input.definition as never)},
      version = ${version + 1}, updated_by = ${actor.person.id}, updated_at = now()
    where id = ${planId}`;
  await recordAudit(sql, actor, {
    jurisdictionId, category: "plan.saved", subjectTable: "plans", subjectId: planId,
    payload: { title: input.title, version: version + 1, kind: input.definition.kind, template: input.definition.templateKey },
  });
  return toDetail(await loadPlan(sql, planId));
}

/** Record a review: the next one falls due a cadence from now. */
export async function reviewPlan(sql: Sql, actor: Principal, planId: string): Promise<PlanDetail> {
  const current = await loadPlan(sql, planId, true);
  const jurisdictionId = current.jurisdiction_id as string;
  requireAdmin(actor, jurisdictionId);
  await sql`update plans set reviewed_at = now(), reviewed_by = ${actor.person.id} where id = ${planId}`;
  await recordAudit(sql, actor, {
    jurisdictionId, category: "plan.reviewed", subjectTable: "plans", subjectId: planId,
    payload: { title: current.title as string, version: current.version as number },
  });
  return toDetail(await loadPlan(sql, planId));
}

async function insertTask(
  sql: Sql, incidentId: string, positionId: string, item: string, category: string, dueAt: Date | null,
): Promise<string> {
  const [created] = await sql`
    insert into checklist_items (incident_id, position_id, item, category, due_at, sort_order)
    values (${incidentId}, ${positionId}, ${item}, ${category}, ${dueAt},
      (select coalesce(max(sort_order), 0) + 1 from checklist_items where incident_id = ${incidentId}))
    returning id`;
  return created!.id as string;
}

/**
 * Activate a plan: open an incident from its template, then release or
 * schedule its tasks and send its notice. A recurring event plan needs the
 * occurrence's start and times its tasks from it; a task whose time has
 * already passed is released at once.
 */
export async function activatePlan(
  sql: Sql, actor: Principal, planId: string, raw: unknown, linkBase = "",
): Promise<PlanActivation> {
  const row = await loadPlan(sql, planId);
  const jurisdictionId = row.jurisdiction_id as string;
  requireAdmin(actor, jurisdictionId);
  const input = PlanActivateSchema.parse(raw);
  const plan = PlanDefinitionSchema.parse(row.definition);
  const version = row.version as number;
  if (plan.kind === "recurring_event" && !input.eventAt) {
    throw new AuthError(400, "eventAt: a recurring event plan is activated for an occurrence; give its start");
  }
  if (plan.kind === "incident_response" && input.eventAt) {
    throw new AuthError(400, "eventAt: an incident response plan times its tasks from activation and takes no event start");
  }

  const opened = await activateIncident(sql, actor, jurisdictionId, {
    templateKey: plan.templateKey,
    name: input.name,
    kind: plan.incidentKind ?? (plan.kind === "recurring_event" ? "planned_event" : "incident"),
  }, linkBase);
  const incidentId = opened.incidentId;
  const eventAt = input.eventAt ? new Date(input.eventAt) : null;
  await sql`
    update incidents set plan_id = ${planId}, plan_version = ${version}, plan_event_at = ${eventAt}
    where id = ${incidentId}`;

  const [clock] = await sql`select now() as now`;
  const now = new Date(clock!.now as string);
  const anchor = eventAt ?? now;
  const keys = [...new Set([
    ...plan.tasks.map((task) => task.position),
    ...(plan.notice?.positions ?? []),
    ...(plan.notice?.onCallPositions ?? []),
  ])];
  const positions = new Map<string, string>();
  if (keys.length > 0) {
    const rows = await sql`select id, key from positions where jurisdiction_id = ${jurisdictionId} and key = any(${keys})`;
    for (const position of rows) positions.set(position.key as string, position.id as string);
  }
  const positionId = (key: string): string => {
    const id = positions.get(key);
    if (!id) throw new AuthError(400, `the plan names position ${key}, which activation did not open`);
    return id;
  };

  let tasksReleased = 0;
  let tasksScheduled = 0;
  for (const task of plan.tasks) {
    const releaseAt = new Date(anchor.getTime() + task.releaseMinutes * MINUTE);
    if (releaseAt.getTime() <= now.getTime()) {
      const dueAt = task.dueMinutes ? new Date(now.getTime() + task.dueMinutes * MINUTE) : null;
      await insertTask(sql, incidentId, positionId(task.position), task.item, task.category, dueAt);
      tasksReleased += 1;
    } else {
      await sql`
        insert into plan_task_releases
          (incident_id, jurisdiction_id, plan_id, position_id, item, category, release_at, due_minutes)
        values (${incidentId}, ${jurisdictionId}, ${planId}, ${positionId(task.position)}, ${task.item},
          ${task.category}, ${releaseAt}, ${task.dueMinutes ?? null})`;
      tasksScheduled += 1;
    }
  }

  let notice: PlanActivation["notice"];
  if (plan.notice) {
    const names = plan.notice.contactGroups;
    const groups = names.length === 0 ? [] : await sql`
      select id, name from contact_groups where jurisdiction_id = ${jurisdictionId} and name = any(${names})`;
    const missing = names.filter((name) => !groups.some((group) => group.name === name));
    if (missing.length > 0) throw new AuthError(400, `the plan's notice names contact group ${missing.join(", ")}, which this jurisdiction does not have`);
    const ids = (list: readonly string[]) => list.map(positionId);
    const sent = await sendMassNotificationIn(sql, actor, jurisdictionId, {
      ...(groups.length ? { groupIds: groups.map((group) => group.id as string) } : {}),
      ...(plan.notice.positions.length ? { positionIds: ids(plan.notice.positions) } : {}),
      ...(plan.notice.onCallPositions.length ? { onCallPositionIds: ids(plan.notice.onCallPositions) } : {}),
      channels: plan.notice.channels,
      subject: `Activated: ${input.name}`.slice(0, 200),
      message: plan.notice.message ?? `${input.name} is activated under ${row.title as string}. Check in with the EOC and stand by for your assignment.`,
      mode: "broadcast",
    }, linkBase, { incidentId });
    notice = { massNotificationId: sent.id, recipients: sent.recipients };
  }

  await recordAudit(sql, actor, {
    jurisdictionId, incidentId, category: "plan.activated", subjectTable: "plans", subjectId: planId,
    payload: {
      title: row.title as string, version, incident: input.name, eventAt: eventAt?.toISOString() ?? null,
      tasksReleased, tasksScheduled, notified: notice?.recipients ?? 0,
    },
  });
  return { incidentId, planVersion: version, tasksReleased, tasksScheduled, ...(notice ? { notice } : {}) };
}

/** The plan an incident was activated from, at that version, and what it has still to release; null when none. */
export async function getIncidentPlan(sql: Sql, incidentId: string): Promise<IncidentPlan | null> {
  const [incident] = await sql`select plan_id, plan_version, plan_event_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  if (!incident.plan_id) return null;
  const [version] = await sql`
    select title, definition from plan_versions
    where plan_id = ${incident.plan_id as string} and version = ${incident.plan_version as number}`;
  if (!version) return null;
  const plan = PlanDefinitionSchema.parse(version.definition);
  const scheduled = await sql`
    select r.item, r.release_at, p.title from plan_task_releases r join positions p on p.id = r.position_id
    where r.incident_id = ${incidentId} and r.released_at is null order by r.release_at, r.id`;
  return {
    planId: incident.plan_id as string,
    title: version.title as string,
    kind: plan.kind as PlanKind,
    version: incident.plan_version as number,
    eventAt: isoOrNull(incident.plan_event_at),
    sections: plan.sections,
    scheduled: scheduled.map((task) => ({
      item: task.item as string, positionTitle: task.title as string, releaseAt: iso(task.release_at),
    })),
  };
}

/**
 * The scheduler's plans work for one jurisdiction, run as one of its
 * administrators: release each waiting task whose time has come on an open
 * incident, telling its position, and remind the administrators of each plan
 * whose review is due. Rows are claimed with skip locked, so a handover
 * between leaders releases nothing twice.
 */
export async function runDuePlans(sql: Sql, actor: Principal, jurisdictionId: string, now: Date): Promise<{ released: number; reminded: number }> {
  requireAdmin(actor, jurisdictionId);
  const due = await sql`
    select r.id, r.incident_id, r.plan_id, r.position_id, r.item, r.category, r.due_minutes, i.name as incident
    from plan_task_releases r join incidents i on i.id = r.incident_id
    where r.jurisdiction_id = ${jurisdictionId} and r.released_at is null and r.release_at <= ${now}
      and i.closed_at is null
    order by r.release_at, r.id
    for update of r skip locked`;
  for (const task of due) {
    const incidentId = task.incident_id as string;
    const dueMinutes = task.due_minutes as number | null;
    const taskId = await insertTask(sql, incidentId, task.position_id as string, task.item as string,
      task.category as string, dueMinutes ? new Date(now.getTime() + dueMinutes * MINUTE) : null);
    await sql`update plan_task_releases set released_at = ${now}, checklist_item_id = ${taskId} where id = ${task.id as string}`;
    await sql`
      insert into notifications (jurisdiction_id, position_id, incident_id, channel, title, body, status, detail)
      values (${jurisdictionId}, ${task.position_id as string}, ${incidentId}, 'plan_task',
        ${`New task: ${task.item as string}`.slice(0, 300)},
        ${`The plan for ${task.incident as string} released this task to your position.`},
        'delivered', ${sql.json({ taskId, route: `#/tasks?incident=${incidentId}` } as never)})`;
    await recordAudit(sql, actor, {
      jurisdictionId, incidentId, category: "plan.task_released", subjectTable: "checklist_items", subjectId: taskId,
      payload: { planId: task.plan_id as string, item: task.item as string },
    });
  }

  const reviews = await sql`
    select id, title, coalesce(reviewed_at, created_at) + make_interval(days => review_every_days) as due_at
    from plans
    where jurisdiction_id = ${jurisdictionId} and review_every_days is not null
      and coalesce(reviewed_at, created_at) + make_interval(days => review_every_days) <= ${now}
      and (review_reminded_for is null
           or review_reminded_for < coalesce(reviewed_at, created_at) + make_interval(days => review_every_days))
    for update skip locked`;
  for (const plan of reviews) {
    // Set in SQL: a JavaScript date would drop the due date's microseconds and fall just short of it.
    await sql`
      update plans set review_reminded_for = coalesce(reviewed_at, created_at) + make_interval(days => review_every_days)
      where id = ${plan.id as string}`;
    await sql`
      insert into notifications (jurisdiction_id, channel, title, body, status, detail)
      values (${jurisdictionId}, 'plan_review', ${`Plan review due: ${plan.title as string}`.slice(0, 300)},
        ${`${plan.title as string} was due for review at ${iso(plan.due_at).slice(0, 16).replace("T", " ")} UTC. Review it under Incidents, Plans, and mark it reviewed.`},
        'delivered', ${sql.json({ planId: plan.id as string, route: "#/incidents" } as never)})`;
  }
  return { released: due.length, reminded: reviews.length };
}
