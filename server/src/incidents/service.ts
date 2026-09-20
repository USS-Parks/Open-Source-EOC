import { z } from "zod";
import { COMMAND_STAFF, GENERAL_STAFF } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { STANDARD_TITLES } from "../auth/authz.js";
import { createBoard } from "../boards/service.js";
import { getIncidentAuthority } from "./participation.js";

export const IncidentTemplateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(1),
  positions: z.array(z.string().min(1)).min(1),
  boards: z.array(z.string().min(1)),
  checklists: z.array(
    z.object({ position: z.string().min(1), items: z.array(z.string().min(1)).min(1) }),
  ),
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
    kind?: "incident" | "daily_ops" | "planned_event" | undefined;
  },
): Promise<ActivationResult> {
  requireAdmin(actor, jurisdictionId);
  const [templateRow] = await sql`
    select definition from incident_templates where key = ${input.templateKey}`;
  if (!templateRow) throw new AuthError(404, "incident template not found");
  const template = IncidentTemplateSchema.parse(templateRow.definition);

  const [incident] = await sql`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${jurisdictionId}, ${template.key}, ${input.name}, ${input.kind ?? "incident"},
            ${actor.person.id})
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
        values (${jurisdictionId}, ${key}, ${STANDARD_TITLES[key] ?? key})
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
    const boardId = await createBoard(sql, actor, jurisdictionId, boardKey, undefined,
      `${input.name}: ${boardKey}`);
    await sql`
      insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
    boardCount += 1;
  }

  let itemCount = 0;
  for (const list of template.checklists) {
    const positionId = positionIds.get(list.position);
    if (!positionId) continue;
    for (const [i, item] of list.items.entries()) {
      await sql`
        insert into checklist_items (incident_id, position_id, item, sort_order)
        values (${incidentId}, ${positionId}, ${item}, ${i})`;
      itemCount += 1;
    }
  }

  const attached = await sql`
    insert into incident_libraries (incident_id, library_id)
    select ${incidentId}, id from libraries
    where jurisdiction_id = ${jurisdictionId} and for_template = ${template.key}
    returning library_id`;

  // Opening an incident locks the jurisdiction down: guest/public read is
  // suspended until the incident closes (an admin can override in between).
  await sql`update jurisdictions set locked = true where id = ${jurisdictionId}`;

  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "incident.activated",
    subjectTable: "incidents",
    subjectId: incidentId,
    payload: { template: template.key, name: input.name, kind: input.kind ?? "incident" },
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
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
  readonly positions: ReadonlyArray<{ id: string; key: string; title: string }>;
  readonly boards: ReadonlyArray<{ id: string; title: string }>;
  readonly checklists: ReadonlyArray<{
    id: string;
    positionKey: string;
    item: string;
    completedAt: string | null;
    completedByPosition: string | null;
  }>;
  readonly libraries: ReadonlyArray<{ id: string; title: string; kind: string }>;
}

export interface IncidentSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly closedAt: string | null;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
}

/** Open incidents first, for the operator to pick one (forms, IAP, ops). */
export async function listIncidents(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<IncidentSummary[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select id, name, kind, closed_at,
      is_admin_of(jurisdiction_id) as can_manage,
      can_revise_incident_area(id) as can_edit
    from incidents
    where jurisdiction_id = ${jurisdictionId}
      or exists (select 1 from incident_participants ip
        where ip.incident_id = incidents.id and ip.organization_id = ${jurisdictionId}
          and ip.person_id = ${actor.person.id} and ip.revoked_at is null
          and ip.expires_at > now()
          and eligible_incident_person(ip.person_id, ip.organization_id))
    order by closed_at nulls first, name`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as string,
    closedAt: (r.closed_at as string | null) ?? null,
    canManageParticipation: Boolean(r.can_manage),
    canEditArea: Boolean(r.can_edit),
  }));
}

export async function getIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<IncidentDetail> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const [incident] = await sql`
    select id, jurisdiction_id, name, kind, closed_at from incidents where id = ${incidentId}`;
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
    select c.id, p.key as position_key, c.item, c.completed_at, cp.title as completed_position
    from checklist_items c
    join positions p on p.id = c.position_id
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
      positionKey: c.position_key as string,
      item: c.item as string,
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
  const [item] = await sql`
    select c.id, c.position_id, c.completed_at, i.jurisdiction_id, i.id as incident_id
    from checklist_items c join incidents i on i.id = c.incident_id
    where c.id = ${itemId}`;
  if (!item) throw new AuthError(404, "checklist item not found");
  requireMember(actor, item.jurisdiction_id as string);
  if (actor.position?.id !== (item.position_id as string))
    throw new AuthError(403, "sign into the owning position to complete its checklist");
  if (item.completed_at) throw new AuthError(409, "already completed");
  await sql`
    update checklist_items
    set completed_at = now(), completed_by = ${actor.person.id},
        completed_by_position = ${actor.position.id}
    where id = ${itemId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: item.jurisdiction_id as string,
    incidentId: item.incident_id as string,
    category: "checklist.completed",
    subjectTable: "checklist_items",
    subjectId: itemId,
  });
}

export async function closeIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<void> {
  const [incident] = await sql`
    select jurisdiction_id, closed_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireAdmin(actor, incident.jurisdiction_id as string);
  if (incident.closed_at) throw new AuthError(409, "already closed");
  await sql`
    update incidents set closed_at = now(), closed_by = ${actor.person.id}
    where id = ${incidentId}`;
  // Lift lockdown when no open incident remains in the jurisdiction.
  await sql`
    update jurisdictions set locked = false
    where id = ${incident.jurisdiction_id as string}
      and not exists (
        select 1 from incidents
        where jurisdiction_id = ${incident.jurisdiction_id as string} and closed_at is null)`;
  await recordAudit(sql, actor, {
    jurisdictionId: incident.jurisdiction_id as string,
    incidentId,
    category: "incident.closed",
    subjectTable: "incidents",
    subjectId: incidentId,
  });
}

export async function getLockdown(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ locked: boolean }> {
  requireMember(actor, jurisdictionId);
  const [row] = await sql`select locked from jurisdictions where id = ${jurisdictionId}`;
  return { locked: Boolean(row?.locked) };
}

/** Admin override: lift or re-apply lockdown while incidents run. */
export async function setLockdown(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  locked: boolean,
): Promise<{ locked: boolean }> {
  requireAdmin(actor, jurisdictionId);
  await sql`update jurisdictions set locked = ${locked} where id = ${jurisdictionId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: locked ? "jurisdiction.locked" : "jurisdiction.unlocked",
    subjectTable: "jurisdictions",
    subjectId: jurisdictionId,
  });
  return { locked };
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

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
}

function requireMember(actor: Principal, jurisdictionId: string): void {
  if (!actor.memberships.some((x) => x.jurisdictionId === jurisdictionId))
    throw new AuthError(403, "no access to this jurisdiction");
}
