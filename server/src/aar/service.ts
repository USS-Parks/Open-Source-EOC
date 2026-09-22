import {
  composeAar,
  renderAarPdf,
  summarizeAar,
  type AarActionAssignment,
  type AarActionPriority,
  type AarActionStatus,
  type AarComposeInput,
  type AarCorrectiveAction,
  type AarDocument,
  type AarObservation,
  type AarOperationalPeriod,
  type WorkflowAssignmentRequest,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { exportChronology } from "../audit/service.js";
import { resolveWorkflowAssignment, type ResolvedWorkflowAssignment } from "../boards/workflow.js";
import { getIncidentAuthority } from "../incidents/participation.js";

/**
 * After-action review, server side (VEOC-36). Observations are captured while
 * the incident runs; the AAR composes from them plus the exported chronology
 * as evidence; and corrective actions are jurisdiction-scoped so they persist
 * past incident closure and keep reporting status.
 */

async function incidentJurisdiction(sql: Sql, incidentId: string): Promise<{ jurisdictionId: string; name: string }> {
  const [row] = await sql`select jurisdiction_id, name from incidents where id = ${incidentId}`;
  if (!row) throw new AuthError(404, "incident not found");
  return { jurisdictionId: row.jurisdiction_id as string, name: row.name as string };
}

async function operationalPeriod(
  sql: Sql, incidentId: string, revision: number | undefined,
): Promise<AarOperationalPeriod | null> {
  if (revision === undefined) return null;
  const [row] = await sql`
    select revision, period_label, period_starts_at, period_ends_at
    from incident_area_revisions
    where incident_id = ${incidentId} and revision = ${revision}
      and period_label is not null`;
  if (!row) throw new AuthError(400, "operational period revision is unavailable for this incident");
  return {
    revision: Number(row.revision),
    label: row.period_label as string,
    startsAt: new Date(row.period_starts_at as Date | string).toISOString(),
    endsAt: new Date(row.period_ends_at as Date | string).toISOString(),
  };
}

export async function recordObservation(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: {
    capability: string;
    capabilityElement?: string | undefined;
    kind: "strength" | "improvement";
    observation: string;
    recommendation?: string | undefined;
    periodRevision?: number | undefined;
  },
): Promise<{ id: string }> {
  const { jurisdictionId } = await incidentJurisdiction(sql, incidentId);
  requireWriter(actor, jurisdictionId);
  await operationalPeriod(sql, incidentId, input.periodRevision);
  const [row] = await sql`
    insert into aar_observations
      (jurisdiction_id, incident_id, capability, capability_element, kind, observation,
       recommendation, operational_period_revision, created_by)
    values
      (${jurisdictionId}, ${incidentId}, ${input.capability}, ${input.capabilityElement ?? "none"},
       ${input.kind}, ${input.observation}, ${input.recommendation ?? null},
       ${input.periodRevision ?? null}, ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "aar.observed",
    subjectTable: "aar_observations",
    subjectId: row!.id as string,
    payload: { capability: input.capability, kind: input.kind,
      operationalPeriodRevision: input.periodRevision ?? null },
  });
  return { id: row!.id as string };
}

export async function listObservations(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  options: { periodRevision?: number | undefined } = {},
): Promise<AarObservation[]> {
  const { jurisdictionId } = await incidentJurisdiction(sql, incidentId);
  requireMember(actor, jurisdictionId);
  await operationalPeriod(sql, incidentId, options.periodRevision);
  const rows = await sql`
    select id, capability, capability_element, kind, observation, recommendation,
      operational_period_revision, created_at
    from aar_observations
    where incident_id = ${incidentId}
      and (${options.periodRevision ?? null}::integer is null
        or operational_period_revision = ${options.periodRevision ?? null})
    order by created_at, id`;
  return rows.map((r) => ({
    id: r.id as string,
    capability: r.capability as string,
    capabilityElement: (r.capability_element as string | null) ?? "none",
    kind: r.kind as "strength" | "improvement",
    observation: r.observation as string,
    recommendation: (r.recommendation as string | null) ?? null,
    operationalPeriodRevision: (r.operational_period_revision as number | null) ?? null,
    createdAt: new Date(r.created_at as Date | string).toISOString(),
  }));
}

export async function createCorrectiveAction(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: {
    incidentId?: string | undefined;
    capability: string;
    capabilityElement?: string | undefined;
    recommendation: string;
    priority?: AarActionPriority | undefined;
    periodRevision?: number | undefined;
    assignment?: WorkflowAssignmentRequest | undefined;
    ownerPosition?: string | undefined;
    ownerPerson?: string | undefined;
    dueDate?: string | undefined;
  },
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  if (input.incidentId) {
    const authority = await getIncidentAuthority(sql, actor, input.incidentId);
    const sourceAllowed = authority.jurisdictionId === jurisdictionId
      || authority.participation?.organizationId === jurisdictionId;
    if (!sourceAllowed) throw new AuthError(403, "corrective action source is outside incident authority");
    await operationalPeriod(sql, input.incidentId, input.periodRevision);
  } else if (input.periodRevision !== undefined || input.assignment?.kind === "incident_participant") {
    throw new AuthError(400, "period and participant assignment require an incident");
  }
  const ownerCount = [input.assignment, input.ownerPosition, input.ownerPerson]
    .filter((value) => value !== undefined).length;
  if (ownerCount > 1) throw new AuthError(400, "choose one corrective action owner");
  let assignment: ResolvedWorkflowAssignment | null = null;
  if (input.assignment) {
    if (input.assignment.kind === "incident_participant" && input.assignment.incidentId !== input.incidentId)
      throw new AuthError(400, "assignment incident does not match the corrective action");
    assignment = await resolveWorkflowAssignment(sql, actor, jurisdictionId, input.assignment);
  } else if (input.ownerPosition) {
    assignment = await resolveWorkflowAssignment(sql, actor, jurisdictionId, {
      kind: "position", positionId: input.ownerPosition,
    });
  }
  if (input.ownerPerson) {
    const [owner] = await sql`
      select p.id from persons p join jurisdiction_memberships m on m.person_id = p.id
      where p.id = ${input.ownerPerson} and not p.disabled
        and m.jurisdiction_id = ${jurisdictionId}`;
    if (!owner) throw new AuthError(400, "owner person is not an active member of the source organization");
  }
  const [row] = await sql`
    insert into corrective_actions
      (jurisdiction_id, incident_id, capability, capability_element, recommendation,
       priority, operational_period_revision, owner_position, owner_person,
       owner_participant, assignment_snapshot, due_date, created_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.capability},
       ${input.capabilityElement ?? "none"}, ${input.recommendation},
       ${input.priority ?? "unspecified"}, ${input.periodRevision ?? null},
       ${assignment?.kind === "position" ? assignment.positionId : null},
       ${input.ownerPerson ?? null},
       ${assignment?.kind === "incident_participant" ? assignment.participantId : null},
       ${assignment ? sql.json(assignment as never) : null}, ${input.dueDate ?? null},
       ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "aar.corrective_action_created",
    subjectTable: "corrective_actions",
    subjectId: row!.id as string,
    payload: { capability: input.capability, priority: input.priority ?? "unspecified",
      operationalPeriodRevision: input.periodRevision ?? null, assignment },
  });
  return { id: row!.id as string };
}

export interface CorrectiveActionRow extends AarCorrectiveAction {
  readonly incidentId: string | null;
  readonly createdAt: string;
}

function publicAssignment(value: unknown): AarActionAssignment | null {
  const assignment = value as ResolvedWorkflowAssignment | null;
  if (!assignment) return null;
  return assignment.kind === "position" ? {
    kind: "position",
    organizationId: assignment.organizationId,
    positionId: assignment.positionId,
    label: assignment.positionTitle,
  } : {
    kind: "incident_participant",
    organizationId: assignment.organizationId,
    participantId: assignment.participantId,
    personId: assignment.personId,
    label: assignment.incidentPositionTitle,
  };
}

function toCorrectiveAction(row: Record<string, unknown>): CorrectiveActionRow {
  return {
    id: row.id as string,
    capability: row.capability as string,
    capabilityElement: (row.capability_element as string | null) ?? "none",
    recommendation: row.recommendation as string,
    priority: row.priority as AarActionPriority,
    owner: (row.owner as string | null) ?? null,
    assignment: publicAssignment(row.assignment_snapshot),
    dueDate: row.due_date ? new Date(row.due_date as Date | string).toISOString().slice(0, 10) : null,
    status: row.status as AarActionStatus,
    revision: Number(row.revision),
    operationalPeriodRevision: (row.operational_period_revision as number | null) ?? null,
    completedAt: row.completed_at ? new Date(row.completed_at as Date | string).toISOString() : null,
    completedBy: (row.completed_by_name as string | null) ?? null,
    incidentId: (row.incident_id as string | null) ?? null,
    createdAt: new Date(row.created_at as Date | string).toISOString(),
  };
}

/**
 * Every corrective action in the jurisdiction, open ones by default. These
 * survive incident closure, so daily-ops keeps reporting on them.
 */
export async function listCorrectiveActions(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  options: {
    status?: AarActionStatus | undefined;
    priority?: AarActionPriority | undefined;
    capability?: string | undefined;
    incidentId?: string | undefined;
    periodRevision?: number | undefined;
    includeComplete?: boolean;
  } = {},
): Promise<CorrectiveActionRow[]> {
  requireMember(actor, jurisdictionId);
  if (options.periodRevision !== undefined && !options.incidentId)
    throw new AuthError(400, "operational period requires an incident filter");
  if (options.incidentId) await operationalPeriod(sql, options.incidentId, options.periodRevision);
  const rows = await sql`
    select ca.*, completed.display_name as completed_by_name,
      coalesce(ca.assignment_snapshot ->> 'positionTitle',
        ca.assignment_snapshot ->> 'incidentPositionTitle', pos.title, per.display_name) as owner
    from corrective_actions ca
    left join positions pos on pos.id = ca.owner_position
    left join persons per on per.id = ca.owner_person
    left join persons completed on completed.id = ca.completed_by
    where ca.jurisdiction_id = ${jurisdictionId}
      and (${options.status ?? null}::text is null or ca.status = ${options.status ?? null})
      and (${options.priority ?? null}::text is null or ca.priority = ${options.priority ?? null})
      and (${options.capability ?? null}::text is null or ca.capability = ${options.capability ?? null})
      and (${options.incidentId ?? null}::uuid is null or ca.incident_id = ${options.incidentId ?? null})
      and (${options.periodRevision ?? null}::integer is null
        or ca.operational_period_revision = ${options.periodRevision ?? null})
      and (${options.includeComplete ?? false} or ca.status <> 'complete')
    order by ca.created_at, ca.id`;
  return rows.map(toCorrectiveAction);
}

async function loadCorrectiveActionForUpdate(sql: Sql, id: string): Promise<Record<string, unknown>> {
  const [row] = await sql`
    select ca.* from corrective_actions ca where ca.id = ${id} for update`;
  if (!row) throw new AuthError(404, "corrective action not found");
  return row;
}

export async function getCorrectiveAction(
  sql: Sql, _actor: Principal, id: string,
): Promise<CorrectiveActionRow> {
  const [row] = await sql`
    select ca.*, completed.display_name as completed_by_name,
      coalesce(ca.assignment_snapshot ->> 'positionTitle',
        ca.assignment_snapshot ->> 'incidentPositionTitle', pos.title, per.display_name) as owner
    from corrective_actions ca
    left join positions pos on pos.id = ca.owner_position
    left join persons per on per.id = ca.owner_person
    left join persons completed on completed.id = ca.completed_by
    where ca.id = ${id}`;
  if (!row) throw new AuthError(404, "corrective action not found");
  return toCorrectiveAction(row);
}

export interface CorrectiveActionUpdate {
  readonly expectedRevision: number;
  readonly priority?: AarActionPriority | undefined;
  readonly assignment?: WorkflowAssignmentRequest | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly status?: AarActionStatus | undefined;
}

export async function updateCorrectiveAction(
  sql: Sql, actor: Principal, id: string, input: CorrectiveActionUpdate,
): Promise<CorrectiveActionRow> {
  const row = await loadCorrectiveActionForUpdate(sql, id);
  const revision = Number(row.revision);
  if (revision !== input.expectedRevision)
    throw new AuthError(409, "corrective action revision is stale");
  const jurisdictionId = row.jurisdiction_id as string;
  const localWriter = actor.memberships.some((membership) =>
    membership.jurisdictionId === jurisdictionId
      && (membership.role === "admin" || membership.role === "member"));
  const [assigned] = await sql`
    select 1 as ok from incident_participants ip
    where ip.id = ${row.owner_participant as string | null}
      and ip.incident_id = ${row.incident_id as string | null}
      and ip.person_id = ${actor.person.id}
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)`;
  if (!localWriter && !assigned)
    throw new AuthError(403, "requires source write access or the active assigned participant");
  const changesMetadata = input.priority !== undefined
    || input.assignment !== undefined || input.dueDate !== undefined;
  if (changesMetadata && !localWriter)
    throw new AuthError(403, "assigned participant may update status only");

  let assignment = row.assignment_snapshot as ResolvedWorkflowAssignment | null;
  let ownerPosition = (row.owner_position as string | null) ?? null;
  let ownerPerson = (row.owner_person as string | null) ?? null;
  let ownerParticipant = (row.owner_participant as string | null) ?? null;
  if (input.assignment !== undefined) {
    assignment = input.assignment === null ? null
      : await resolveWorkflowAssignment(sql, actor, jurisdictionId, input.assignment);
    if (assignment?.kind === "incident_participant"
      && assignment.incidentId !== row.incident_id)
      throw new AuthError(400, "assignment incident does not match the corrective action");
    ownerPosition = assignment?.kind === "position" ? assignment.positionId : null;
    ownerParticipant = assignment?.kind === "incident_participant" ? assignment.participantId : null;
    ownerPerson = null;
  }
  const nextStatus = input.status ?? row.status as AarActionStatus;
  const nextPriority = input.priority ?? row.priority as AarActionPriority;
  const nextDueDate = input.dueDate === undefined ? row.due_date as Date | null : input.dueDate;
  if (localWriter) {
    await sql`
      update corrective_actions set
      priority = ${nextPriority}, status = ${nextStatus}, due_date = ${nextDueDate},
      owner_position = ${ownerPosition}, owner_person = ${ownerPerson},
      owner_participant = ${ownerParticipant},
      assignment_snapshot = ${assignment ? sql.json(assignment as never) : null},
      revision = revision + 1, updated_at = now(),
      completed_at = case when completed_at is null and ${nextStatus} = 'complete'
        then now() else completed_at end,
      completed_by = case when completed_at is null and ${nextStatus} = 'complete'
        then ${actor.person.id} else completed_by end
      where id = ${id}`;
  } else {
    await sql`
      update corrective_actions set
        status = ${nextStatus}, revision = revision + 1, updated_at = now(),
        completed_at = case when completed_at is null and ${nextStatus} = 'complete'
          then now() else completed_at end,
        completed_by = case when completed_at is null and ${nextStatus} = 'complete'
          then ${actor.person.id} else completed_by end
      where id = ${id}`;
  }
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(row.incident_id ? { incidentId: row.incident_id as string } : {}),
    category: "aar.corrective_action_updated",
    subjectTable: "corrective_actions",
    subjectId: id,
    payload: { fromRevision: revision, toRevision: revision + 1,
      priority: nextPriority, status: nextStatus, dueDate: nextDueDate, assignment },
  });
  return getCorrectiveAction(sql, actor, id);
}

/** Legacy status route delegates through the same lock, authority and revision path. */
export async function setCorrectiveActionStatus(
  sql: Sql, actor: Principal, id: string, status: AarActionStatus,
): Promise<void> {
  const row = await loadCorrectiveActionForUpdate(sql, id);
  await updateCorrectiveAction(sql, actor, id, {
    expectedRevision: Number(row.revision), status,
  });
}

export async function getAarAnalytics(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  options: { periodRevision?: number | undefined } = {},
) {
  const { jurisdictionId } = await incidentJurisdiction(sql, incidentId);
  requireMember(actor, jurisdictionId);
  const observations = await listObservations(sql, actor, incidentId, options);
  const correctiveActions = await listCorrectiveActions(sql, actor, jurisdictionId, {
    includeComplete: true,
    incidentId,
    ...(options.periodRevision !== undefined ? { periodRevision: options.periodRevision } : {}),
  });
  return { observations, correctiveActions, analytics: summarizeAar(observations, correctiveActions) };
}

export async function composeAndStoreAar(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: {
    overview: string;
    objectives?: readonly string[];
    period?: string;
    periodRevision?: number | undefined;
  },
): Promise<{ id: string; content: AarDocument }> {
  const { jurisdictionId, name } = await incidentJurisdiction(sql, incidentId);
  requireWriter(actor, jurisdictionId);
  const selectedPeriod = await operationalPeriod(sql, incidentId, input.periodRevision);
  const periodOptions = input.periodRevision === undefined ? {}
    : { periodRevision: input.periodRevision };
  const observations = await listObservations(sql, actor, incidentId, periodOptions);
  const correctiveActions: AarCorrectiveAction[] = await listCorrectiveActions(
    sql, actor, jurisdictionId,
    { includeComplete: true, incidentId, ...periodOptions },
  );
  const chronology = await exportChronology(sql, actor, {
    jurisdictionId,
    ...(selectedPeriod ? {
      from: new Date(selectedPeriod.startsAt), to: new Date(selectedPeriod.endsAt),
    } : {}),
  });
  const incidentEvents = await sql`
    select seq from audit_events where incident_id = ${incidentId}
      and (${selectedPeriod?.startsAt ?? null}::timestamptz is null
        or created_at >= ${selectedPeriod?.startsAt ?? null})
      and (${selectedPeriod?.endsAt ?? null}::timestamptz is null
        or created_at < ${selectedPeriod?.endsAt ?? null})`;
  const incidentSequences = new Set(incidentEvents.map((event) => Number(event.seq)));
  const chronologyLines = chronology
    .filter((entry) => incidentSequences.has(entry.seq)
      && (!selectedPeriod || entry.at < selectedPeriod.endsAt))
    .map((entry) => entry.line);
  const composeInput: AarComposeInput = {
    incidentName: name,
    period: selectedPeriod?.label ?? input.period ?? "",
    operationalPeriod: selectedPeriod,
    overview: input.overview,
    objectives: input.objectives ?? [],
    observations,
    correctiveActions,
    chronologyLines,
  };
  const content = composeAar(composeInput);
  const [row] = await sql`
    insert into aars (jurisdiction_id, incident_id, title, content, created_by)
    values (${jurisdictionId}, ${incidentId}, ${`AAR: ${name}`}, ${sql.json(content as never)},
            ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "aar.composed",
    subjectTable: "aars",
    subjectId: row!.id as string,
    payload: { observations: observations.length, correctiveActions: correctiveActions.length,
      chronology: content.chronologyCount,
      operationalPeriodRevision: selectedPeriod?.revision ?? null },
  });
  return { id: row!.id as string, content };
}

export async function exportAarPdf(
  sql: Sql,
  actor: Principal,
  aarId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const [row] = await sql`
    select a.content, a.title, a.created_at, inc.jurisdiction_id
    from aars a join incidents inc on inc.id = a.incident_id where a.id = ${aarId}`;
  if (!row) throw new AuthError(404, "AAR not found");
  requireMember(actor, row.jurisdiction_id as string);
  const content = row.content as AarDocument;
  const bytes = renderAarPdf(content, {
    source: "Stored AAR snapshot",
    sourceTime: new Date(row.created_at as string | Date).toISOString(),
  });
  const safe = content.incidentName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { filename: `aar-${safe}.pdf`, bytes };
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
