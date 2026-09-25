import { z } from "zod";
import {
  COMMAND_STAFF,
  GENERAL_STAFF,
  RESOURCE_REQUEST_STATES,
  TaskTemplateItemSchema,
  nextStates,
  workflowDueAt,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import {
  CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type Page, type PageRequest,
} from "../db/cursor.js";
import { AuthError, requireAdmin, requireMember, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { STANDARD_TITLES } from "../auth/authz.js";
import { createBoard } from "../boards/service.js";
import { getIncidentAuthority, lockIncidentMutation } from "./participation.js";
import { completeLegacyChecklistItem } from "./tasks.js";

export const IncidentTemplateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(1),
  positions: z.array(z.string().min(1)).min(1),
  /** Titles for positions the jurisdiction does not have yet; the standard ICS positions need none. */
  positionTitles: z.record(z.string(), z.string().min(1).max(120)).optional(),
  boards: z.array(z.string().min(1)),
  checklists: z.array(
    z.object({ position: z.string().min(1), items: z.array(TaskTemplateItemSchema).min(1) }),
  ),
}).superRefine((template, ctx) => {
  const keyed = new Map<string, [number, number]>();
  for (const [listIndex, list] of template.checklists.entries()) {
    for (const [itemIndex, item] of list.items.entries()) {
      if (typeof item !== "string" && item.due?.kind === "record_field") {
        ctx.addIssue({
          code: "custom",
          path: ["checklists", listIndex, "items", itemIndex, "due"],
          message: "checklist template due rules cannot reference record fields",
        });
      }
      if (typeof item !== "string" && item.key) {
        if (keyed.has(item.key)) {
          ctx.addIssue({ code: "custom", path: ["checklists", listIndex, "items", itemIndex, "key"], message: "checklist task keys must be unique" });
        } else keyed.set(item.key, [listIndex, itemIndex]);
      }
    }
  }
  for (const [listIndex, list] of template.checklists.entries()) for (const [itemIndex, item] of list.items.entries()) {
    if (typeof item === "string") continue;
    for (const dependency of item.dependsOn ?? []) {
      if (!keyed.has(dependency)) ctx.addIssue({ code: "custom", path: ["checklists", listIndex, "items", itemIndex, "dependsOn"], message: `checklist dependency ${dependency} has no keyed task` });
      if (dependency === item.key) ctx.addIssue({ code: "custom", path: ["checklists", listIndex, "items", itemIndex, "dependsOn"], message: "checklist task cannot depend on itself" });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dependencyKeys = new Map<string, readonly string[]>();
  for (const list of template.checklists) for (const item of list.items) if (typeof item !== "string" && item.key) dependencyKeys.set(item.key, item.dependsOn ?? []);
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cyclic = (dependencyKeys.get(key) ?? []).some(visit);
    visiting.delete(key); visited.add(key);
    return cyclic;
  };
  for (const key of dependencyKeys.keys()) if (visit(key)) {
    ctx.addIssue({ code: "custom", path: ["checklists"], message: "checklist task dependencies must not contain a cycle" });
    break;
  }
});

export type IncidentTemplate = z.infer<typeof IncidentTemplateSchema>;

/** The standard scenario library: activation templates as data (F12, F13). */
export const STANDARD_INCIDENT_TEMPLATES: readonly IncidentTemplate[] = [
  {
    key: "wildfire",
    title: "Wildfire",
    positions: [...COMMAND_STAFF.values, ...GENERAL_STAFF.values],
    boards: [
      "significant_events",
      "activity_log",
      "resource_request",
      "shelters",
      "road_closures",
      "sign_in_out",
    ],
    checklists: [
      {
        position: "incident_commander",
        items: [
          "Assume command and announce on the significant events board",
          "Set initial incident objectives",
          "Establish the operational period",
        ],
      },
      {
        position: "operations_section_chief",
        items: ["Confirm resource status with dispatch", "Open the resource request board"],
      },
      {
        position: "public_information_officer",
        items: ["Draft the initial public statement", "Confirm media contact roster"],
      },
    ],
  },
  {
    key: "severe_storm",
    title: "Severe Storm",
    positions: [...COMMAND_STAFF.values, ...GENERAL_STAFF.values],
    boards: [
      "significant_events",
      "activity_log",
      "resource_request",
      "shelters",
      "road_closures",
      "field_reports",
      "incident_facilities",
      "sign_in_out",
    ],
    checklists: [
      {
        position: "incident_commander",
        items: [
          "Assume command and announce on the significant events board",
          "Set initial incident objectives",
          "Establish the operational period",
        ],
      },
      {
        position: "operations_section_chief",
        items: ["Confirm road and utility status with field crews", "Open the resource request board"],
      },
      {
        position: "planning_section_chief",
        items: ["Collect lifeline assessments for the situation report", "Prepare the next operational period briefing"],
      },
      {
        position: "public_information_officer",
        items: ["Draft the initial public statement", "Confirm media contact roster"],
      },
    ],
  },
  {
    key: "daily_ops",
    title: "Daily Operations",
    positions: ["operations_section_chief"],
    boards: ["activity_log", "significant_events"],
    checklists: [
      { position: "operations_section_chief", items: ["Review overnight significant events"] },
    ],
  },
];

export async function ensureStandardIncidentTemplates(sql: Sql): Promise<void> {
  for (const t of STANDARD_INCIDENT_TEMPLATES) {
    await sql`
      insert into incident_templates (key, title, definition)
      values (${t.key}, ${t.title}, ${sql.json(t)})
      on conflict (key) do nothing`;
  }
}

export interface ActivationResult {
  readonly incidentId: string;
  readonly positions: number;
  readonly boards: number;
  readonly checklistItems: number;
  readonly libraries: number;
}

/**
 * One-action activation (F12): the incident arrives with its ICS org
 * chart, its board set, per-position checklists, and its scenario
 * libraries. Daily-ops incidents run the same machinery under a flag
 * (F17), so the skills never go stale.
 */
export async function activateIncident(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: {
    templateKey: string;
    name: string;
    kind?: "incident" | "daily_ops" | "planned_event" | "exercise" | undefined;
  },
): Promise<ActivationResult> {
  requireAdmin(actor, jurisdictionId);
  const [templateRow] = await sql`
    select definition, version from incident_templates where key = ${input.templateKey}`;
  if (!templateRow) throw new AuthError(404, "incident template not found");
  const template = IncidentTemplateSchema.parse(templateRow.definition);

  // The incident keeps the template version it opened from; a later edit to the template changes no incident.
  const [incident] = await sql`
    insert into incidents (jurisdiction_id, template_key, template_version, name, kind, activated_by)
    values (${jurisdictionId}, ${template.key}, ${templateRow.version as number}, ${input.name},
            ${input.kind ?? "incident"}, ${actor.person.id})
    returning id`;
  const incidentId = incident!.id as string;

  const positionIds = new Map<string, string>();
  for (const key of template.positions) {
    const [existing] = await sql`
      select id from positions where jurisdiction_id = ${jurisdictionId} and key = ${key}`;
    let positionId = existing?.id as string | undefined;
    if (!positionId) {
      const [created] = await sql`
        insert into positions (jurisdiction_id, key, title)
        values (${jurisdictionId}, ${key}, ${STANDARD_TITLES[key] ?? template.positionTitles?.[key] ?? key})
        returning id`;
      positionId = created!.id as string;
    }
    positionIds.set(key, positionId);
    await sql`
      insert into incident_positions (incident_id, position_id)
      values (${incidentId}, ${positionId}) on conflict do nothing`;
  }

  let boardCount = 0;
  for (const boardKey of template.boards) {
    // Titled for people: the incident's name and the board template's title, not its key.
    const [boardTemplate] = await sql`
      select title from board_templates where key = ${boardKey} order by version desc limit 1`;
    const boardId = await createBoard(sql, actor, jurisdictionId, boardKey, undefined,
      `${input.name}: ${(boardTemplate?.title as string | undefined) ?? boardKey}`);
    await sql`
      insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
    boardCount += 1;
  }

  let itemCount = 0;
  const taskIds = new Map<string, string>();
  const templateDependencies: Array<{ readonly taskId: string; readonly dependsOn: readonly string[] }> = [];
  const [clock] = await sql`select now() as activated_at`;
  const activatedAt = new Date(clock!.activated_at as string).toISOString();
  for (const list of template.checklists) {
    const positionId = positionIds.get(list.position);
    if (!positionId) continue;
    for (const [i, raw] of list.items.entries()) {
      const item = typeof raw === "string"
        ? { item: raw, category: "general", due: undefined }
        : raw;
      const dueAt = item.due
        ? workflowDueAt(item.due, {
            createdAt: activatedAt,
            transitionedAt: activatedAt,
            record: {},
          })
        : null;
      const [created] = await sql`
        insert into checklist_items
          (incident_id, position_id, item, category, due_at, sort_order)
        values (${incidentId}, ${positionId}, ${item.item}, ${item.category}, ${dueAt}, ${i})
        returning id`;
      if (typeof raw !== "string" && raw.key) taskIds.set(raw.key, created!.id as string);
      if (typeof raw !== "string" && raw.dependsOn?.length) {
        templateDependencies.push({ taskId: created!.id as string, dependsOn: raw.dependsOn });
      }
      itemCount += 1;
    }
  }
  for (const dependency of templateDependencies) for (const key of dependency.dependsOn) {
    const prerequisiteTaskId = taskIds.get(key);
    if (!prerequisiteTaskId) throw new Error(`validated task dependency ${key} did not resolve`);
    await sql`insert into checklist_task_dependencies (task_id, prerequisite_task_id)
      values (${dependency.taskId}, ${prerequisiteTaskId})`;
  }

  const attached = await sql`
    insert into incident_libraries (incident_id, library_id)
    select ${incidentId}, id from libraries
    where jurisdiction_id = ${jurisdictionId} and for_template = ${template.key}
    returning library_id`;

  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "incident.activated",
    subjectTable: "incidents",
    subjectId: incidentId,
    payload: {
      template: template.key, templateVersion: templateRow.version as number, name: input.name, kind: input.kind ?? "incident",
    },
  });

  return {
    incidentId,
    positions: positionIds.size,
    boards: boardCount,
    checklistItems: itemCount,
    libraries: attached.length,
  };
}

export interface IncidentDetail {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly closedAt: string | null;
  /** The template and version the incident was activated from; null for one made another way or before versions were kept. */
  readonly templateKey: string | null;
  readonly templateVersion: number | null;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
  readonly positions: ReadonlyArray<{ id: string; key: string; title: string }>;
  readonly boards: ReadonlyArray<{ id: string; title: string }>;
  readonly checklists: ReadonlyArray<{
    id: string;
    positionKey: string | null;
    item: string;
    category: string;
    status: string;
    dueAt: string | null;
    revision: number;
    assignedParticipantId: string | null;
    completedAt: string | null;
    completedByPosition: string | null;
  }>;
  readonly libraries: ReadonlyArray<{ id: string; title: string; kind: string }>;
}

export interface IncidentSummary {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly kind: string;
  readonly closedAt: string | null;
  readonly archivedAt: string | null;
  readonly lockedAt: string | null;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
}

/** Archived incidents are left out of a list unless the caller asks for them. */
export type IncidentArchiveFilter = "exclude" | "include" | "only";

const archiveFilter = (sql: Sql, archived: IncidentArchiveFilter) =>
  archived === "include" ? sql``
    : archived === "only" ? sql`and i.archived_at is not null`
    : sql`and i.archived_at is null`;

const isoOrNull = (value: unknown) => value ? new Date(value as string).toISOString() : null;

/** Open incidents first, for the operator to pick one (forms, IAP, ops). */
export async function listIncidents(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  archived: IncidentArchiveFilter = "exclude",
): Promise<IncidentSummary[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select i.id, i.jurisdiction_id, i.name, i.kind, i.closed_at, i.archived_at, i.locked_at,
      is_admin_of(i.jurisdiction_id) as can_manage,
      can_revise_incident_area(i.id) as can_edit
    from incidents i
    where (i.jurisdiction_id = ${jurisdictionId}
      or exists (select 1 from incident_participants ip
        where ip.incident_id = i.id and ip.organization_id = ${jurisdictionId}
          and ip.person_id = ${actor.person.id} and ip.revoked_at is null
          and ip.expires_at > now()
          and eligible_incident_person(ip.person_id, ip.organization_id)))
      ${archiveFilter(sql, archived)}
    order by i.closed_at nulls first, i.name`;
  return rows.map((r) => ({
    id: r.id as string,
    jurisdictionId: r.jurisdiction_id as string,
    name: r.name as string,
    kind: r.kind as string,
    closedAt: (r.closed_at as string | null) ?? null,
    archivedAt: isoOrNull(r.archived_at),
    lockedAt: isoOrNull(r.locked_at),
    canManageParticipation: Boolean(r.can_manage),
    canEditArea: Boolean(r.can_edit),
  }));
}

export interface IncidentOverviewRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly activatedAt: string;
  readonly closedAt: string | null;
  readonly archivedAt: string | null;
  readonly lockedAt: string | null;
  readonly operationalPeriod: { label: string; startsAt: string; endsAt: string } | null;
  readonly openResourceRequests: number;
  readonly openTasks: number;
  readonly boardRecords: number;
  readonly participatingOrganizations: number;
}

/** Request states with no way out; every other state is still open work. */
const FINISHED_REQUEST_STATES = RESOURCE_REQUEST_STATES.values.filter((state) => nextStates(state).length === 0);

/**
 * The jurisdiction's master view: every incident it owns, newest first, with
 * its rollups computed in one statement. Each count runs under the reader's
 * row-level security, so it counts only what the reader may see.
 */
export async function listIncidentOverview(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  archived: IncidentArchiveFilter,
  page: PageRequest,
): Promise<Page<IncidentOverviewRow>> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    with page as (
      select i.id, i.name, i.kind, i.activated_at, i.closed_at, i.archived_at, i.locked_at
      from incidents i
      where i.jurisdiction_id = ${jurisdictionId} ${archiveFilter(sql, archived)}
        ${after ? sql`and (i.activated_at, i.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
      order by i.activated_at desc, i.id desc limit ${limit + 1}
    ), requests as (
      select incident_id, unfinished as n
      from public.incident_request_counts(array(select id from page), ${FINISHED_REQUEST_STATES as string[]}::text[])
    ), tasks as (
      select incident_id, count(*)::int as n from checklist_items
      where incident_id in (select id from page) and status <> 'completed'
      group by incident_id
    ), records as (
      select ib.incident_id, count(*)::int as n from incident_boards ib
      join board_records r on r.board_id = ib.board_id
      where ib.incident_id in (select id from page) and r.deleted_at is null
      group by ib.incident_id
    ), organizations as (
      select incident_id, count(distinct organization_id)::int as n from incident_participants
      where incident_id in (select id from page) and revoked_at is null and expires_at > now()
      group by incident_id
    )
    select p.*, to_char(p.activated_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at,
      period.period_label, period.period_starts_at, period.period_ends_at,
      coalesce(requests.n, 0) as open_requests, coalesce(tasks.n, 0) as open_tasks,
      coalesce(records.n, 0) as board_records, coalesce(organizations.n, 0) as organizations
    from page p
    left join lateral (
      select a.period_label, a.period_starts_at, a.period_ends_at from incident_area_revisions a
      where a.incident_id = p.id order by a.revision desc limit 1
    ) period on true
    left join requests on requests.incident_id = p.id
    left join tasks on tasks.incident_id = p.id
    left join records on records.incident_id = p.id
    left join organizations on organizations.incident_id = p.id
    order by p.activated_at desc, p.id desc`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    items: items.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as string,
      activatedAt: new Date(r.activated_at as string).toISOString(),
      closedAt: isoOrNull(r.closed_at),
      archivedAt: isoOrNull(r.archived_at),
      lockedAt: isoOrNull(r.locked_at),
      operationalPeriod: r.period_label === null ? null : {
        label: r.period_label as string,
        startsAt: new Date(r.period_starts_at as string).toISOString(),
        endsAt: new Date(r.period_ends_at as string).toISOString(),
      },
      openResourceRequests: Number(r.open_requests),
      openTasks: Number(r.open_tasks),
      boardRecords: Number(r.board_records),
      participatingOrganizations: Number(r.organizations),
    })),
    nextCursor,
  };
}

export async function getIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<IncidentDetail> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const [incident] = await sql`
    select id, jurisdiction_id, name, kind, closed_at, template_key, template_version from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const positions = await sql`
    select p.id, p.key, p.title from incident_positions ip
    join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId} order by p.key`;
  const boards = await sql`
    select b.id, b.title from incident_boards ib
    join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId} order by b.title`;
  const checklists = await sql`
    select c.id, p.key as position_key, c.item, c.category, c.status, c.due_at,
      c.revision, c.assigned_participant_id, c.completed_at,
      cp.title as completed_position
    from checklist_items c
    left join positions p on p.id = c.position_id
    left join positions cp on cp.id = c.completed_by_position
    where c.incident_id = ${incidentId}
    order by p.key, c.sort_order`;
  const libraries = await sql`
    select l.id, l.title, l.kind from incident_libraries il
    join libraries l on l.id = il.library_id
    where il.incident_id = ${incidentId} order by l.title`;
  return {
    id: incident.id as string,
    name: incident.name as string,
    kind: incident.kind as string,
    closedAt: (incident.closed_at as string | null) ?? null,
    templateKey: (incident.template_key as string | null) ?? null,
    templateVersion: (incident.template_version as number | null) ?? null,
    canManageParticipation: authority.canManageParticipation,
    canEditArea: authority.canEditArea,
    positions: positions.map((p) => ({
      id: p.id as string,
      key: p.key as string,
      title: p.title as string,
    })),
    boards: boards.map((b) => ({ id: b.id as string, title: b.title as string })),
    checklists: checklists.map((c) => ({
      id: c.id as string,
      positionKey: (c.position_key as string | null) ?? null,
      item: c.item as string,
      category: c.category as string,
      status: c.status as string,
      dueAt: c.due_at ? new Date(c.due_at as string).toISOString() : null,
      revision: Number(c.revision),
      assignedParticipantId: (c.assigned_participant_id as string | null) ?? null,
      completedAt: (c.completed_at as string | null) ?? null,
      completedByPosition: (c.completed_position as string | null) ?? null,
    })),
    libraries: libraries.map((l) => ({
      id: l.id as string,
      title: l.title as string,
      kind: l.kind as string,
    })),
  };
}

/**
 * Checklist completion is position-attributed (F12): the actor must hold
 * the owning position, and the completion records who and as-what.
 */
export async function completeChecklistItem(
  sql: Sql,
  actor: Principal,
  itemId: string,
): Promise<void> {
  await completeLegacyChecklistItem(sql, actor, itemId);
}

export async function closeIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<void> {
  await lockIncidentMutation(sql, incidentId);
  const [incident] = await sql`
    select jurisdiction_id, closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireAdmin(actor, incident.jurisdiction_id as string);
  if (incident.closed_at) throw new AuthError(409, "already closed");
  await sql`
    update incidents set closed_at = now(), closed_by = ${actor.person.id}
    where id = ${incidentId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: incident.jurisdiction_id as string,
    incidentId,
    category: "incident.closed",
    subjectTable: "incidents",
    subjectId: incidentId,
  });
}

/**
 * Reopen a closed incident, as an administrator of the owning jurisdiction,
 * with the reason recorded. An archived incident is unarchived first, so a
 * reopened incident is never hidden from the lists. Its records, requests,
 * tasks and grants are as they were at close, and take steps again.
 */
export async function reopenIncident(sql: Sql, actor: Principal, incidentId: string, reason: string): Promise<void> {
  await lockIncidentMutation(sql, incidentId);
  const [incident] = await sql`
    select jurisdiction_id, closed_at, archived_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireAdmin(actor, incident.jurisdiction_id as string);
  if (!incident.closed_at) throw new AuthError(409, "incident is open");
  if (incident.archived_at) throw new AuthError(409, "unarchive the incident before reopening it");
  await sql`update incidents set closed_at = null, closed_by = null where id = ${incidentId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: incident.jurisdiction_id as string,
    incidentId,
    category: "incident.reopened",
    subjectTable: "incidents",
    subjectId: incidentId,
    payload: { reason, closedAt: new Date(incident.closed_at as string).toISOString() },
  });
}

/** Each lifecycle change: the state it sets, on or off, its conflict, and its audit category. */
const LIFECYCLE_CHANGES = {
  archive: ["archived", true, "incident is already archived", "incident.archived"],
  unarchive: ["archived", false, "incident is not archived", "incident.unarchived"],
  lock: ["locked", true, "incident is already locked", "incident.locked"],
  unlock: ["locked", false, "incident is not locked", "incident.unlocked"],
} as const;
export type IncidentLifecycleChange = keyof typeof LIFECYCLE_CHANGES;

/**
 * Archive, unarchive, lock or unlock one incident, as an administrator of the
 * owning jurisdiction. Only a closed incident is archived. A lock withholds
 * the incident's boards from guest grants at the row-level security wall (see
 * has_guest_scope); members and participating organizations keep their read.
 */
export async function changeIncidentLifecycle(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  change: IncidentLifecycleChange,
): Promise<void> {
  const [state, on, conflict, category] = LIFECYCLE_CHANGES[change];
  await lockIncidentMutation(sql, incidentId);
  const [incident] = await sql`
    select jurisdiction_id, closed_at, archived_at, locked_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireAdmin(actor, incident.jurisdiction_id as string);
  if (Boolean(incident[`${state}_at`]) === on) throw new AuthError(409, conflict);
  if (change === "archive" && !incident.closed_at)
    throw new AuthError(409, "close the incident before archiving it");
  await sql`
    update incidents set ${sql(`${state}_at`)} = ${on ? sql`now()` : null},
      ${sql(`${state}_by`)} = ${on ? actor.person.id : null}
    where id = ${incidentId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: incident.jurisdiction_id as string,
    incidentId,
    category,
    subjectTable: "incidents",
    subjectId: incidentId,
  });
}


export async function createLibrary(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: {
    title: string;
    kind: "scenario" | "plan" | "reference";
    body: string;
    forTemplate?: string | undefined;
  },
): Promise<string> {
  requireAdmin(actor, jurisdictionId);
  const [row] = await sql`
    insert into libraries (jurisdiction_id, title, kind, body, for_template, created_by)
    values (${jurisdictionId}, ${input.title}, ${input.kind}, ${input.body},
            ${input.forTemplate ?? null}, ${actor.person.id})
    returning id`;
  return row!.id as string;
}
