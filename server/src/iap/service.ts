import { randomUUID } from "node:crypto";
import {
  assembleIap,
  buildIcsForm,
  renderIapPdf,
  sectionForPosition,
  DEFAULT_IAP_FORMS,
  ICS_FORM_IDS,
  type ActivityLogEntry,
  type CheckInEntry,
  type CommsChannel,
  type IapDocument,
  type IcsFormContent,
  type IcsFormId,
  type IncidentContext,
  type OrgEntry,
  type ResourceLine,
  type IapDisplayState,
  type IapPreparedAttribution,
  type IapProgress,
  type IapWorkspaceItem,
  type IapWorkspaceQuery,
  type IapWorkspaceResponse,
  type Ics204AssignedResource,
  type Ics204Assignment,
  type Ics204SupervisorAuthority,
  type WorkflowAssignmentRequest,
  withIcs204Assignments,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentBoardReadShape, visibleFields } from "../boards/service.js";
import { getIncidentAuthority, type IncidentAuthority } from "../incidents/participation.js";
import { resolveWorkflowAssignment } from "../boards/workflow.js";

/**
 * ICS forms and the IAP builder, server side (F5). The live
 * incident context (org chart from positions and current holders, the 214
 * from the activity-log board, check-ins, resources, comms) is gathered
 * here and handed to the pure builders in shared, so the operator supplies
 * only objectives and the operational period. An IAP is stored as its
 * assembled content and rendered to PDF on demand.
 */

function isFormId(value: string): value is IcsFormId {
  return (ICS_FORM_IDS as readonly string[]).includes(value);
}

export interface ContextExtras {
  readonly operationalPeriod: string;
  readonly objectives?: readonly string[];
  readonly preparedBy?: string;
  readonly safetyMessage?: string;
}

async function gatherContext(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  extras: ContextExtras,
): Promise<{ jurisdictionId: string; authority: IncidentAuthority; ctx: IncidentContext }> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const [incident] = await sql`select name from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const jurisdictionId = authority.jurisdictionId;

  const orgRows = await sql`
    select p.key, p.title,
      (select per.display_name from position_assignments pa
       join persons per on per.id = pa.person_id
       where pa.position_id = p.id and pa.revoked_at is null limit 1) as holder
    from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId} order by p.key`;
  const org: OrgEntry[] = orgRows.map((r) => ({
    section: sectionForPosition(r.key as string),
    positionKey: r.key as string,
    positionTitle: r.title as string,
    holder: (r.holder as string | null) ?? null,
  }));

  const boards = await sql`
    select b.id, b.template_key from boards b
    join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId}`;
  const boardByKey = new Map<string, { id: string; readable: ReadonlySet<string> }>();
  for (const board of boards) {
    const key = board.template_key as string;
    if (boardByKey.has(key)) continue;
    const shape = await getIncidentBoardReadShape(sql, actor, incidentId, board.id as string);
    boardByKey.set(key, {
      id: board.id as string,
      readable: new Set(visibleFields(shape).map((field) => field.key)),
    });
  }

  const activityLog = await gatherActivityLog(sql, boardByKey.get("activity_log"));
  const checkIns = await gatherCheckIns(sql, boardByKey.get("sign_in_out"));
  const resources = await gatherResources(sql, boardByKey.get("resource_request"));
  const comms = await gatherComms(sql, boardByKey.get("radio_communications"));

  const ctx: IncidentContext = {
    incidentName: incident.name as string,
    operationalPeriod: extras.operationalPeriod,
    preparedBy: extras.preparedBy ?? actor.person.displayName,
    objectives: extras.objectives ?? [],
    org,
    activityLog,
    checkIns,
    comms,
    resources,
    ...(extras.safetyMessage !== undefined ? { safetyMessage: extras.safetyMessage } : {}),
  };
  return { jurisdictionId, authority, ctx };
}

interface ReadableIapBoard {
  readonly id: string;
  readonly readable: ReadonlySet<string>;
}

function readableData(data: Record<string, unknown>, readable: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => readable.has(key)));
}

async function gatherActivityLog(sql: Sql, board?: ReadableIapBoard): Promise<ActivityLogEntry[]> {
  if (!board) return [];
  const rows = await sql`
    select data, created_at from board_records where board_id = ${board.id} order by created_at limit 200`;
  return rows.map((r) => {
    const data = readableData(r.data as Record<string, unknown>, board.readable);
    return {
      time: (r.created_at as Date).toISOString().slice(11, 16),
      entry: String(data.entry ?? ""),
    };
  });
}

async function gatherCheckIns(sql: Sql, board?: ReadableIapBoard): Promise<CheckInEntry[]> {
  if (!board) return [];
  const rows = await sql`select data from board_records where board_id = ${board.id} limit 500`;
  return rows.map((r) => {
    const data = readableData(r.data as Record<string, unknown>, board.readable);
    return {
      name: String(data.role_note ?? data.person ?? ""),
      time: String(data.signed_in ?? ""),
    };
  });
}

async function gatherResources(sql: Sql, board?: ReadableIapBoard): Promise<ResourceLine[]> {
  if (!board) return [];
  const rows = await sql`select data from board_records where board_id = ${board.id} limit 500`;
  return rows.map((r) => {
    const data = readableData(r.data as Record<string, unknown>, board.readable);
    return {
      item: String(data.item ?? ""),
      quantity: String(data.quantity ?? ""),
      state: String(data.state ?? ""),
    };
  });
}

async function gatherComms(sql: Sql, board?: ReadableIapBoard): Promise<CommsChannel[]> {
  if (!board) return [];
  const rows = await sql`select data from board_records where board_id = ${board.id} limit 200`;
  return rows.map((r) => {
    const data = readableData(r.data as Record<string, unknown>, board.readable);
    return {
      channel: String(data.channel ?? ""),
      frequency: String(data.frequency ?? ""),
      assignment: String(data.assignment ?? ""),
    };
  });
}

/** Build one prefilled ICS form from live incident data. */
export async function buildForm(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  formId: string,
  extras: ContextExtras,
): Promise<IcsFormContent> {
  if (!isFormId(formId)) throw new AuthError(404, "unknown ICS form");
  const { ctx } = await gatherContext(sql, actor, incidentId, extras);
  return buildIcsForm(formId, ctx);
}

export interface CreateIapInput extends ContextExtras {
  readonly formIds?: readonly string[];
  readonly periodRevision?: number;
}

interface ResolvedPeriod {
  readonly revision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface PreparedAttribution {
  readonly organizationId: string;
  readonly positionId: string | null;
  readonly participationId: string | null;
  readonly roleKey: string;
  readonly roleLabel: string;
}

function roleKey(prefix: "incident" | "position", value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 140);
  return `${prefix}:${normalized || "unspecified"}`;
}

async function resolvePeriod(
  sql: Sql,
  incidentId: string,
  operationalPeriod: string,
  requestedRevision?: number,
): Promise<ResolvedPeriod | null> {
  const label = operationalPeriod.trim();
  const rows = requestedRevision === undefined
    ? await sql`
        select revision, period_label, period_starts_at, period_ends_at
        from incident_area_revisions
        where incident_id = ${incidentId} and trim(period_label) = ${label}
          and period_starts_at is not null and period_ends_at is not null
        order by revision desc`
    : await sql`
        select revision, period_label, period_starts_at, period_ends_at
        from incident_area_revisions
        where incident_id = ${incidentId} and revision = ${requestedRevision}
          and period_label is not null and period_starts_at is not null and period_ends_at is not null`;
  if (requestedRevision !== undefined && rows.length === 0)
    throw new AuthError(400, "operational period revision is not available for this incident");
  if (rows.length === 0) return null;
  const periods = rows.map((row) => ({
    revision: Number(row.revision),
    label: (row.period_label as string).trim(),
    startsAt: new Date(row.period_starts_at as string).toISOString(),
    endsAt: new Date(row.period_ends_at as string).toISOString(),
  }));
  if (requestedRevision !== undefined && periods[0]!.label !== label)
    throw new AuthError(400, "operational period label does not match the selected revision");
  const triples = new Set(periods.map((period) =>
    JSON.stringify([period.label, period.startsAt, period.endsAt])));
  if (triples.size > 1)
    throw new AuthError(400, "operational period label is ambiguous for this incident");
  return periods[0]!;
}

async function resolvePreparedAttribution(
  sql: Sql,
  actor: Principal,
  authority: IncidentAuthority,
): Promise<PreparedAttribution> {
  if (!authority.canContribute)
    throw new AuthError(403, "requires current incident write authority");
  if (authority.participation) {
    return {
      organizationId: authority.participation.organizationId,
      positionId: null,
      participationId: authority.participation.id,
      roleKey: roleKey("incident", authority.participation.incidentPositionTitle),
      roleLabel: authority.participation.incidentPositionTitle,
    };
  }
  if (actor.position) {
    const [position] = await sql`
      select p.id, p.key, p.title from positions p
      join position_assignments pa on pa.position_id = p.id
      join auth_sessions s on s.id = ${actor.sessionId}
      where p.id = ${actor.position.id} and p.jurisdiction_id = ${authority.jurisdictionId}
        and pa.person_id = ${actor.person.id} and pa.revoked_at is null
        and s.person_id = ${actor.person.id} and s.ended_at is null
        and s.active_position_id = p.id`;
    if (!position) throw new AuthError(403, "active IAP position assignment is no longer current");
    return {
      organizationId: authority.jurisdictionId,
      positionId: position.id as string,
      participationId: null,
      roleKey: roleKey("position", position.key as string),
      roleLabel: position.title as string,
    };
  }
  const membershipRole = authority.canManageParticipation ? "admin" : "member";
  return {
    organizationId: authority.jurisdictionId,
    positionId: null,
    participationId: null,
    roleKey: `membership:${membershipRole}`,
    roleLabel: membershipRole === "admin" ? "Jurisdiction Admin" : "Jurisdiction Member",
  };
}

async function recordIapAudit(
  sql: Sql,
  actor: Principal,
  authority: IncidentAuthority,
  input: {
    incidentId: string;
    category:
      | "iap.assembled"
      | "iap.submitted"
      | "iap.ics204.revised"
      | "iap.revision.created";
    subjectId: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  if (authority.participation) {
    await sql`select append_iap_participant_audit(
      ${input.incidentId}, ${input.subjectId}, ${input.category},
      ${sql.json((input.payload ?? {}) as never)})`;
    return;
  }
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId,
    incidentId: input.incidentId,
    category: input.category,
    subjectTable: "iaps",
    subjectId: input.subjectId,
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
}

export async function createIap(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: CreateIapInput,
): Promise<{ id: string; content: IapDocument; periodRevision: number | null }> {
  const { authority, ctx } = await gatherContext(sql, actor, incidentId, input);
  const attribution = await resolvePreparedAttribution(sql, actor, authority);
  const period = await resolvePeriod(sql, incidentId, input.operationalPeriod, input.periodRevision);
  const formIds = input.formIds?.filter(isFormId);
  const iap = formIds === undefined ? assembleIap(ctx) : assembleIap(ctx, formIds);
  const id = randomUUID();
  const [row] = await sql`
    insert into iaps
      (id, incident_id, operational_period, period_revision, form_ids, content, prepared_by,
       prepared_organization_id, prepared_position_id, prepared_participation_id,
       prepared_role_key, prepared_role_label, revision_root_id, revision_number,
       supersedes_iap_id, content_revision)
    values (${id}, ${incidentId}, ${input.operationalPeriod},
            ${period?.revision ?? null}, ${iap.forms.map((f) => f.id)},
            ${sql.json(iap as never)}, ${actor.person.id}, ${attribution.organizationId},
            ${attribution.positionId}, ${attribution.participationId},
            ${attribution.roleKey}, ${attribution.roleLabel}, ${id}, 1, null, 1)
    returning id`;
  const createdId = row!.id as string;
  await recordIapAudit(sql, actor, authority, {
    incidentId,
    category: "iap.assembled",
    subjectId: createdId,
    payload: {
      operationalPeriod: input.operationalPeriod, periodRevision: period?.revision ?? null,
      forms: iap.forms.length, organizationId: attribution.organizationId,
      role: attribution.roleKey,
    },
  });
  return { id: createdId, content: iap, periodRevision: period?.revision ?? null };
}

export interface Ics204AssignmentInput {
  readonly id?: string | undefined;
  readonly name: string;
  readonly supervisor: WorkflowAssignmentRequest;
  readonly tactics: readonly string[];
  readonly resources: readonly Ics204AssignedResource[];
}

export interface ReplaceIcs204Input {
  readonly expectedContentRevision: number;
  readonly assignments: readonly Ics204AssignmentInput[];
}

async function resolveIcs204Assignment(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  sourceOrganizationId: string,
  input: Ics204AssignmentInput,
): Promise<Ics204Assignment> {
  if (input.supervisor.kind === "incident_participant"
    && input.supervisor.incidentId !== incidentId)
    throw new AuthError(400, "ICS-204 supervisor belongs to another incident");
  const resolved = await resolveWorkflowAssignment(sql, actor, sourceOrganizationId, input.supervisor);
  let supervisor: Ics204SupervisorAuthority;
  if (resolved.kind === "position") {
    const holders = await sql`
      select per.id, per.display_name, j.name as organization_name
      from position_assignments pa
      join persons per on per.id = pa.person_id
      join jurisdictions j on j.id = ${resolved.organizationId}
      where pa.position_id = ${resolved.positionId} and pa.revoked_at is null
      order by pa.assigned_at desc limit 2`;
    if (holders.length !== 1)
      throw new AuthError(409, "ICS-204 supervisor position must have exactly one current holder");
    supervisor = {
      kind: "position",
      organizationId: resolved.organizationId,
      organizationName: holders[0]!.organization_name as string,
      positionId: resolved.positionId,
      positionKey: resolved.positionKey,
      positionTitle: resolved.positionTitle,
      personId: holders[0]!.id as string,
      personName: holders[0]!.display_name as string,
      authority: resolved.authority,
    };
  } else {
    const [identity] = await sql`
      select j.name as organization_name, p.display_name as person_name
      from jurisdictions j join persons p on p.id = ${resolved.personId}
      where j.id = ${resolved.organizationId}`;
    if (!identity) throw new AuthError(404, "ICS-204 supervisor identity not found");
    supervisor = {
      kind: "incident_participant",
      organizationId: resolved.organizationId,
      organizationName: identity.organization_name as string,
      participantId: resolved.participantId,
      personId: resolved.personId,
      personName: identity.person_name as string,
      incidentPositionTitle: resolved.incidentPositionTitle,
      participantRole: resolved.participantRole,
      authority: resolved.authority,
      actorParticipationId: resolved.actorParticipationId,
    };
  }
  return {
    id: input.id ?? randomUUID(),
    name: input.name,
    supervisor,
    tactics: [...input.tactics],
    resources: input.resources.map((resource) => ({ ...resource })),
  };
}

async function resolveIcs204Assignments(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  sourceOrganizationId: string,
  inputs: readonly Ics204AssignmentInput[],
): Promise<Ics204Assignment[]> {
  const resolved: Ics204Assignment[] = [];
  const ids = new Set<string>();
  for (const input of inputs) {
    const assignment = await resolveIcs204Assignment(
      sql, actor, incidentId, sourceOrganizationId, input,
    );
    if (ids.has(assignment.id)) throw new AuthError(400, "duplicate ICS-204 assignment id");
    ids.add(assignment.id);
    resolved.push(assignment);
  }
  return resolved;
}

function hasOwnerWriteAuthority(actor: Principal, authority: IncidentAuthority): boolean {
  return authority.canContribute && actor.memberships.some((membership) =>
    membership.jurisdictionId === authority.jurisdictionId
      && (membership.role === "admin" || membership.role === "member"));
}

function requireIapEditAuthority(
  actor: Principal,
  authority: IncidentAuthority,
  row: { preparedBy: string; preparedParticipationId: string | null },
): void {
  const participantOwn = authority.canContribute && authority.participation !== null
    && row.preparedBy === actor.person.id
    && row.preparedParticipationId === authority.participation.id;
  if (!hasOwnerWriteAuthority(actor, authority) && !participantOwn)
    throw new AuthError(403, "requires owner write authority or the current preparer's incident grant");
}

/** Replace authored ICS-204 assignments in one draft using an exact content CAS. */
export async function replaceIcs204Assignments(
  sql: Sql,
  actor: Principal,
  iapId: string,
  input: ReplaceIcs204Input,
): Promise<{ contentRevision: number; assignments: readonly Ics204Assignment[] }> {
  const row = await iapWorkflowRow(sql, iapId);
  const authority = await getIncidentAuthority(sql, actor, row.incidentId);
  await requireCurrentClaimedPosition(sql, actor, row.jurisdictionId);
  requireIapEditAuthority(actor, authority, row);
  if (row.status !== "draft") throw new AuthError(409, "only a draft IAP can be edited");
  if (row.contentRevision !== input.expectedContentRevision)
    throw new AuthError(409, "IAP content revision conflict");
  const assignments = await resolveIcs204Assignments(
    sql, actor, row.incidentId,
    hasOwnerWriteAuthority(actor, authority) ? authority.jurisdictionId : row.preparedOrganizationId,
    input.assignments,
  );
  const content = withIcs204Assignments(row.content, assignments);
  const formIds = row.formIds.includes("ICS-204") ? row.formIds : [...row.formIds, "ICS-204"];
  const [comparison] = await sql`
    select content = ${sql.json(content as never)} and form_ids = ${formIds} as unchanged
    from iaps where id = ${iapId}`;
  if (comparison?.unchanged) return { contentRevision: row.contentRevision, assignments };
  const nextRevision = row.contentRevision + 1;
  const [updated] = await sql`
    update iaps set content = ${sql.json(content as never)}, form_ids = ${formIds},
      content_revision = ${nextRevision}
    where id = ${iapId} and status = 'draft' and content_revision = ${input.expectedContentRevision}
    returning id`;
  if (!updated) throw new AuthError(409, "IAP content revision conflict");
  await recordIapAudit(sql, actor, authority, {
    incidentId: row.incidentId,
    category: "iap.ics204.revised",
    subjectId: iapId,
    payload: { contentRevision: nextRevision, assignments: assignments.length },
  });
  return { contentRevision: nextRevision, assignments };
}

/** Clone one approved row into the next draft revision and replace its ICS-204. */
export async function createIapRevision(
  sql: Sql,
  actor: Principal,
  sourceIapId: string,
  assignmentsInput: readonly Ics204AssignmentInput[],
): Promise<{ id: string; revisionNumber: number; contentRevision: number }> {
  const source = await iapWorkflowRow(sql, sourceIapId);
  const authority = await getIncidentAuthority(sql, actor, source.incidentId);
  await requireCurrentClaimedPosition(sql, actor, source.jurisdictionId);
  requireIapEditAuthority(actor, authority, source);
  if (source.status !== "approved")
    throw new AuthError(409, "only an approved IAP can start a revision");
  const [successor] = await sql`select id from iaps where supersedes_iap_id = ${sourceIapId}`;
  if (successor) throw new AuthError(409, "this IAP revision already has a successor");
  const attribution = await resolvePreparedAttribution(sql, actor, authority);
  const assignments = await resolveIcs204Assignments(
    sql, actor, source.incidentId, attribution.organizationId, assignmentsInput,
  );
  const preparedContent: IapDocument = {
    ...source.content,
    preparedBy: actor.person.displayName,
    forms: source.content.forms.map((form) => ({ ...form, preparedBy: actor.person.displayName })),
  };
  const content = withIcs204Assignments(preparedContent, assignments);
  const formIds = source.formIds.includes("ICS-204")
    ? source.formIds : [...source.formIds, "ICS-204"];
  const id = randomUUID();
  const revisionNumber = source.revisionNumber + 1;
  try {
    await sql`
      insert into iaps
        (id, incident_id, operational_period, period_revision, status, form_ids, content,
         prepared_by, prepared_organization_id, prepared_position_id,
         prepared_participation_id, prepared_role_key, prepared_role_label,
         revision_root_id, revision_number, supersedes_iap_id, content_revision)
      values (${id}, ${source.incidentId}, ${source.operationalPeriod}, ${source.periodRevision},
        'draft', ${formIds}, ${sql.json(content as never)}, ${actor.person.id},
        ${attribution.organizationId}, ${attribution.positionId}, ${attribution.participationId},
        ${attribution.roleKey}, ${attribution.roleLabel}, ${source.revisionRootId},
        ${revisionNumber}, ${sourceIapId}, 1)`;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new AuthError(409, "this IAP revision already has a successor");
    throw error;
  }
  await recordIapAudit(sql, actor, authority, {
    incidentId: source.incidentId,
    category: "iap.revision.created",
    subjectId: id,
    payload: { revisionNumber, supersedesIapId: sourceIapId, assignments: assignments.length },
  });
  return { id, revisionNumber, contentRevision: 1 };
}

export async function getIap(
  sql: Sql,
  actor: Principal,
  iapId: string,
): Promise<{ id: string; status: string; operationalPeriod: string; contentRevision: number; content: IapDocument }> {
  const [row] = await sql`
    select i.id, i.status, i.operational_period, i.content_revision, i.content, i.incident_id
    from iaps i join incidents inc on inc.id = i.incident_id where i.id = ${iapId}`;
  if (!row) throw new AuthError(404, "IAP not found");
  await getIncidentAuthority(sql, actor, row.incident_id as string);
  return {
    id: row.id as string,
    status: row.status as string,
    operationalPeriod: row.operational_period as string,
    contentRevision: Number(row.content_revision),
    content: row.content as IapDocument,
  };
}

/** Submit a draft plan for command approval (writer). */
export async function submitIapForApproval(sql: Sql, actor: Principal, iapId: string): Promise<void> {
  const row = await iapWorkflowRow(sql, iapId);
  const authority = await getIncidentAuthority(sql, actor, row.incidentId);
  await requireCurrentClaimedPosition(sql, actor, row.jurisdictionId);
  const ownerWriter = hasOwnerWriteAuthority(actor, authority);
  const participantOwnDraft = authority.canContribute && authority.participation !== null
    && row.preparedBy === actor.person.id
    && row.preparedParticipationId === authority.participation.id;
  if (!ownerWriter && !participantOwnDraft)
    throw new AuthError(403, "requires owner write authority or the current preparer's incident grant");
  if (row.status !== "draft")
    throw new AuthError(409, "only a draft plan can be submitted for approval");
  await sql`
    update iaps set status = 'in_approval', submitted_by = ${actor.person.id}, submitted_at = now()
    where id = ${iapId}`;
  await recordIapAudit(sql, actor, authority, {
    incidentId: row.incidentId,
    category: "iap.submitted",
    subjectId: iapId,
  });
}

export async function approveIap(sql: Sql, actor: Principal, iapId: string): Promise<void> {
  const row = await iapWorkflowRow(sql, iapId);
  const authority = await getIncidentAuthority(sql, actor, row.incidentId);
  await requireCurrentClaimedPosition(sql, actor, row.jurisdictionId);
  if (!authority.canManageParticipation)
    throw new AuthError(403, "requires incident owner admin");
  if (row.status !== "draft" && row.status !== "in_approval")
    throw new AuthError(409, "only a draft or in-approval plan can be approved");
  await sql`
    update iaps set status = 'approved', approved_by = ${actor.person.id}, approved_at = now()
    where id = ${iapId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdictionId,
    incidentId: row.incidentId,
    category: "iap.approved",
    subjectTable: "iaps",
    subjectId: iapId,
  });
}

/** Mark an approved plan complete once its operational period has ended (admin). */
export async function markIapComplete(sql: Sql, actor: Principal, iapId: string): Promise<void> {
  const row = await iapWorkflowRow(sql, iapId);
  const authority = await getIncidentAuthority(sql, actor, row.incidentId);
  await requireCurrentClaimedPosition(sql, actor, row.jurisdictionId);
  if (!authority.canManageParticipation)
    throw new AuthError(403, "requires incident owner admin");
  if (row.status !== "approved")
    throw new AuthError(409, "only an approved plan can be marked complete");
  await sql`update iaps set status = 'complete' where id = ${iapId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdictionId,
    incidentId: row.incidentId,
    category: "iap.completed",
    subjectTable: "iaps",
    subjectId: iapId,
  });
}

async function iapWorkflowRow(
  sql: Sql,
  iapId: string,
): Promise<{
  status: string;
  jurisdictionId: string;
  incidentId: string;
  preparedBy: string;
  preparedOrganizationId: string;
  preparedParticipationId: string | null;
  operationalPeriod: string;
  periodRevision: number | null;
  formIds: IcsFormId[];
  content: IapDocument;
  revisionRootId: string;
  revisionNumber: number;
  contentRevision: number;
}> {
  const [row] = await sql`
    select i.status, inc.jurisdiction_id, i.incident_id, i.prepared_by,
      i.prepared_organization_id, i.prepared_participation_id,
      i.operational_period, i.period_revision, i.form_ids, i.content,
      i.revision_root_id, i.revision_number, i.content_revision
    from iaps i join incidents inc on inc.id = i.incident_id
    where i.id = ${iapId} for update of i`;
  if (!row) throw new AuthError(404, "IAP not found");
  return {
    status: row.status as string,
    jurisdictionId: row.jurisdiction_id as string,
    incidentId: row.incident_id as string,
    preparedBy: row.prepared_by as string,
    preparedOrganizationId: row.prepared_organization_id as string,
    preparedParticipationId: (row.prepared_participation_id as string | null) ?? null,
    operationalPeriod: row.operational_period as string,
    periodRevision: row.period_revision === null ? null : Number(row.period_revision),
    formIds: (row.form_ids as IcsFormId[]) ?? [],
    content: row.content as IapDocument,
    revisionRootId: row.revision_root_id as string,
    revisionNumber: Number(row.revision_number),
    contentRevision: Number(row.content_revision),
  };
}

async function requireCurrentClaimedPosition(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<void> {
  if (!actor.position) return;
  const [position] = await sql`
    select 1 from positions p
    join position_assignments pa on pa.position_id = p.id
    join auth_sessions s on s.id = ${actor.sessionId}
    where p.id = ${actor.position.id} and p.jurisdiction_id = ${jurisdictionId}
      and pa.person_id = ${actor.person.id} and pa.revoked_at is null
      and s.person_id = ${actor.person.id} and s.ended_at is null
      and s.active_position_id = p.id`;
  if (!position) throw new AuthError(403, "active IAP position assignment is no longer current");
}

/** The standard IAP is complete when it carries all of the default forms. */
export const IAP_TARGET_FORMS = DEFAULT_IAP_FORMS.length;

export interface IapListItem {
  readonly id: string;
  readonly operationalPeriod: string;
  /** Display state: not_started, in_progress, in_approval, approved, complete. */
  readonly status: string;
  readonly formCount: number;
  readonly targetForms: number;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
}

/** Derive the working-list display state from the stored status and form count. */
function displayStatus(stored: string, formCount: number): IapDisplayState {
  if (stored === "draft") return formCount === 0 ? "not_started" : "in_progress";
  if (stored === "in_approval" || stored === "approved" || stored === "complete") return stored;
  throw new Error(`unsupported IAP status: ${stored}`);
}

function progressFor(formIds: readonly string[] | null): IapProgress {
  const requiredFormIds = [...DEFAULT_IAP_FORMS];
  const completedSet = new Set((formIds ?? []).filter(isFormId));
  const completedFormIds = requiredFormIds.filter((id) => completedSet.has(id));
  const missingFormIds = requiredFormIds.filter((id) => !completedSet.has(id));
  const completed = completedFormIds.length;
  const required = requiredFormIds.length;
  return {
    requiredFormIds,
    completedFormIds,
    missingFormIds,
    completed,
    required,
    percent: required === 0 ? 100 : Math.round((completed / required) * 100),
  };
}

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function facet(values: readonly { key: string; label: string }[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, { key: string; label: string; count: number }>();
  for (const value of values) {
    const current = counts.get(value.key);
    if (current) current.count += 1;
    else counts.set(value.key, { ...value, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Query the incident-isolated working/published IAP workspace. */
export async function queryIapWorkspace(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  query: IapWorkspaceQuery,
): Promise<IapWorkspaceResponse> {
  await getIncidentAuthority(sql, actor, incidentId);
  if (query.periodRevision !== undefined) {
    const [period] = await sql`
      select 1 from incident_area_revisions
      where incident_id = ${incidentId} and revision = ${query.periodRevision}
        and period_label is not null and period_starts_at is not null and period_ends_at is not null`;
    if (!period) throw new AuthError(400, "operational period revision is not available for this incident");
  }
  const rows = await sql`
    select i.id, i.operational_period, i.period_revision, i.status, i.form_ids,
      i.created_at, i.submitted_at, i.approved_at,
      prep.display_name as prepared_by, submitter.display_name as submitted_by,
      approver.display_name as approved_by,
      i.prepared_organization_id, organization.name as prepared_organization_name,
      i.prepared_position_id, i.prepared_participation_id,
      i.prepared_role_key, i.prepared_role_label,
      i.revision_root_id, i.revision_number, i.supersedes_iap_id, i.content_revision,
      period.period_label, period.period_starts_at, period.period_ends_at
    from iaps i
    join jurisdictions organization on organization.id = i.prepared_organization_id
    left join persons prep on prep.id = i.prepared_by
    left join persons submitter on submitter.id = i.submitted_by
    left join persons approver on approver.id = i.approved_by
    left join incident_area_revisions period
      on period.incident_id = i.incident_id and period.revision = i.period_revision
    where i.incident_id = ${incidentId}
      and (${query.organizationId ?? null}::uuid is null
        or i.prepared_organization_id = ${query.organizationId ?? null})
      and (${query.periodRevision ?? null}::integer is null
        or i.period_revision = ${query.periodRevision ?? null})
      and (${query.role ?? null}::text is null or i.prepared_role_key = ${query.role ?? null})
      and (${query.view} = 'all'
        or (${query.view} = 'working' and i.status in ('draft', 'in_approval'))
        or (${query.view} = 'published' and i.status in ('approved', 'complete')))
    order by i.created_at desc, i.id desc`;
  const iaps: IapWorkspaceItem[] = rows.map((row) => {
    const progress = progressFor((row.form_ids as string[] | null) ?? []);
    const preparedAttribution: IapPreparedAttribution = {
      organizationId: row.prepared_organization_id as string,
      organizationName: row.prepared_organization_name as string,
      roleKey: row.prepared_role_key as string,
      roleLabel: row.prepared_role_label as string,
      positionId: (row.prepared_position_id as string | null) ?? null,
      participationId: (row.prepared_participation_id as string | null) ?? null,
    };
    return {
      id: row.id as string,
      operationalPeriod: row.operational_period as string,
      period: row.period_revision === null ? null : {
        revision: Number(row.period_revision),
        label: row.period_label as string,
        startsAt: iso(row.period_starts_at),
        endsAt: iso(row.period_ends_at),
      },
      status: displayStatus(row.status as string, progress.completed),
      formCount: progress.completed,
      targetForms: progress.required,
      progress,
      preparedBy: (row.prepared_by as string | null) ?? null,
      preparedAttribution,
      submittedBy: (row.submitted_by as string | null) ?? null,
      submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
      approvedBy: (row.approved_by as string | null) ?? null,
      approvedAt: row.approved_at ? iso(row.approved_at) : null,
      createdAt: iso(row.created_at),
      revisionRootId: row.revision_root_id as string,
      revisionNumber: Number(row.revision_number),
      contentRevision: Number(row.content_revision),
      supersedesIapId: (row.supersedes_iap_id as string | null) ?? null,
    };
  });
  const states: IapDisplayState[] = ["not_started", "in_progress", "in_approval", "approved", "complete"];
  const byState = Object.fromEntries(states.map((state) => [
    state, iaps.filter((iap) => iap.status === state).length,
  ])) as Record<IapDisplayState, number>;
  return {
    iaps,
    query,
    summary: {
      total: iaps.length,
      byState,
      completedForms: iaps.reduce((sum, iap) => sum + iap.progress.completed, 0),
      requiredForms: iaps.reduce((sum, iap) => sum + iap.progress.required, 0),
    },
    facets: {
      organizations: facet(iaps.map((iap) => ({
        key: iap.preparedAttribution.organizationId,
        label: iap.preparedAttribution.organizationName,
      }))),
      roles: facet(iaps.map((iap) => ({
        key: iap.preparedAttribution.roleKey,
        label: iap.preparedAttribution.roleLabel,
      }))),
    },
  };
}

/**
 * Every IAP for an incident, newest first: the WebEOC-style working list. The
 * stored draft/in_approval/approved/complete becomes a five-state display
 * status, and the form count against the standard set drives a progress bar.
 */
export async function listIaps(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<IapListItem[]> {
  const workspace = await queryIapWorkspace(sql, actor, incidentId, { view: "all" });
  return workspace.iaps.map((iap) => ({
    id: iap.id,
    operationalPeriod: iap.operationalPeriod,
    status: iap.status,
    formCount: iap.formCount,
    targetForms: iap.targetForms,
    preparedBy: iap.preparedBy,
    approvedBy: iap.approvedBy,
    approvedAt: iap.approvedAt,
    createdAt: iap.createdAt,
  }));
}

export interface IapRevisionSummary {
  readonly id: string;
  readonly revisionNumber: number;
  readonly contentRevision: number;
  readonly status: string;
  readonly supersedesIapId: string | null;
  readonly createdAt: string;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
}

/** List the accessible immutable lineage for the selected IAP row. */
export async function listIapRevisions(
  sql: Sql,
  actor: Principal,
  iapId: string,
): Promise<IapRevisionSummary[]> {
  const [selected] = await sql`
    select incident_id, revision_root_id from iaps where id = ${iapId}`;
  if (!selected) throw new AuthError(404, "IAP not found");
  await getIncidentAuthority(sql, actor, selected.incident_id as string);
  const rows = await sql`
    select i.id, i.revision_number, i.content_revision, i.status, i.supersedes_iap_id,
      i.created_at, i.approved_at, prep.display_name as prepared_by,
      approver.display_name as approved_by
    from iaps i
    left join persons prep on prep.id = i.prepared_by
    left join persons approver on approver.id = i.approved_by
    where i.revision_root_id = ${selected.revision_root_id as string}
    order by i.revision_number`;
  return rows.map((row) => ({
    id: row.id as string,
    revisionNumber: Number(row.revision_number),
    contentRevision: Number(row.content_revision),
    status: row.status as string,
    supersedesIapId: (row.supersedes_iap_id as string | null) ?? null,
    createdAt: iso(row.created_at),
    preparedBy: (row.prepared_by as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
  }));
}

/** Resolve one exact accessible lineage revision and render its stored snapshot. */
export async function exportIapRevisionPdf(
  sql: Sql,
  actor: Principal,
  iapId: string,
  revisionNumber: number,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const [selected] = await sql`select revision_root_id from iaps where id = ${iapId}`;
  if (!selected) throw new AuthError(404, "IAP not found");
  const [revision] = await sql`
    select id from iaps
    where revision_root_id = ${selected.revision_root_id as string}
      and revision_number = ${revisionNumber}`;
  if (!revision) throw new AuthError(404, "IAP revision not found");
  return exportIapPdf(sql, actor, revision.id as string);
}

export async function exportIapPdf(
  sql: Sql,
  actor: Principal,
  iapId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  await getIap(sql, actor, iapId);
  const [snapshot] = await sql`
    select content, created_at, approved_at, revision_number, content_revision, status
    from iaps where id = ${iapId}`;
  if (!snapshot) throw new AuthError(404, "IAP not found");
  const content = snapshot.content as IapDocument;
  const bytes = renderIapPdf(content, {
    source: "Stored IAP snapshot",
    sourceTime: iso(snapshot.approved_at ?? snapshot.created_at),
    revision: `IAP revision ${snapshot.revision_number}; content revision ${snapshot.content_revision}; status ${snapshot.status}`,
  });
  const safe = content.incidentName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { filename: `iap-${safe}.pdf`, bytes };
}
