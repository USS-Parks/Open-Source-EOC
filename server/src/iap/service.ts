import {
  assembleIap,
  buildIcsForm,
  iapToTextLines,
  renderPdf,
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
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

/**
 * ICS forms and the IAP builder, server side (VEOC-34, F5). The live
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
): Promise<{ jurisdictionId: string; ctx: IncidentContext }> {
  const [incident] = await sql`select jurisdiction_id, name from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  const jurisdictionId = incident.jurisdiction_id as string;
  requireMember(actor, jurisdictionId);

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
  const boardByKey = new Map<string, string>();
  for (const b of boards) if (!boardByKey.has(b.template_key as string)) boardByKey.set(b.template_key as string, b.id as string);

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
  return { jurisdictionId, ctx };
}

async function gatherActivityLog(sql: Sql, boardId?: string): Promise<ActivityLogEntry[]> {
  if (!boardId) return [];
  const rows = await sql`
    select data, created_at from board_records where board_id = ${boardId} order by created_at limit 200`;
  return rows.map((r) => {
    const data = r.data as Record<string, unknown>;
    return {
      time: (r.created_at as Date).toISOString().slice(11, 16),
      entry: String(data.entry ?? ""),
    };
  });
}

async function gatherCheckIns(sql: Sql, boardId?: string): Promise<CheckInEntry[]> {
  if (!boardId) return [];
  const rows = await sql`select data from board_records where board_id = ${boardId} limit 500`;
  return rows.map((r) => {
    const data = r.data as Record<string, unknown>;
    return {
      name: String(data.role_note ?? data.person ?? ""),
      time: String(data.signed_in ?? ""),
    };
  });
}

async function gatherResources(sql: Sql, boardId?: string): Promise<ResourceLine[]> {
  if (!boardId) return [];
  const rows = await sql`select data from board_records where board_id = ${boardId} limit 500`;
  return rows.map((r) => {
    const data = r.data as Record<string, unknown>;
    return {
      item: String(data.item ?? ""),
      quantity: String(data.quantity ?? ""),
      state: String(data.state ?? ""),
    };
  });
}

async function gatherComms(sql: Sql, boardId?: string): Promise<CommsChannel[]> {
  if (!boardId) return [];
  const rows = await sql`select data from board_records where board_id = ${boardId} limit 200`;
  return rows.map((r) => {
    const data = r.data as Record<string, unknown>;
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
}

export async function createIap(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: CreateIapInput,
): Promise<{ id: string; content: IapDocument }> {
  const { jurisdictionId, ctx } = await gatherContext(sql, actor, incidentId, input);
  requireWriter(actor, jurisdictionId);
  const formIds = (input.formIds ?? []).filter(isFormId);
  const iap = formIds.length > 0 ? assembleIap(ctx, formIds) : assembleIap(ctx);
  const [row] = await sql`
    insert into iaps (incident_id, operational_period, form_ids, content, prepared_by)
    values (${incidentId}, ${input.operationalPeriod},
            ${iap.forms.map((f) => f.id)}, ${sql.json(iap as never)}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "iap.assembled",
    subjectTable: "iaps",
    subjectId: id,
    payload: { operationalPeriod: input.operationalPeriod, forms: iap.forms.length },
  });
  return { id, content: iap };
}

export async function getIap(
  sql: Sql,
  actor: Principal,
  iapId: string,
): Promise<{ id: string; status: string; operationalPeriod: string; content: IapDocument }> {
  const [row] = await sql`
    select i.id, i.status, i.operational_period, i.content, inc.jurisdiction_id
    from iaps i join incidents inc on inc.id = i.incident_id where i.id = ${iapId}`;
  if (!row) throw new AuthError(404, "IAP not found");
  requireMember(actor, row.jurisdiction_id as string);
  return {
    id: row.id as string,
    status: row.status as string,
    operationalPeriod: row.operational_period as string,
    content: row.content as IapDocument,
  };
}

/** Submit a draft plan for command approval (writer). */
export async function submitIapForApproval(sql: Sql, actor: Principal, iapId: string): Promise<void> {
  const row = await iapWorkflowRow(sql, iapId);
  requireWriter(actor, row.jurisdictionId);
  if (row.status !== "draft")
    throw new AuthError(409, "only a draft plan can be submitted for approval");
  await sql`update iaps set status = 'in_approval' where id = ${iapId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdictionId,
    incidentId: row.incidentId,
    category: "iap.submitted",
    subjectTable: "iaps",
    subjectId: iapId,
  });
}

export async function approveIap(sql: Sql, actor: Principal, iapId: string): Promise<void> {
  const row = await iapWorkflowRow(sql, iapId);
  requireAdmin(actor, row.jurisdictionId);
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
  requireAdmin(actor, row.jurisdictionId);
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
): Promise<{ status: string; jurisdictionId: string; incidentId: string }> {
  const [row] = await sql`
    select i.status, inc.jurisdiction_id, i.incident_id
    from iaps i join incidents inc on inc.id = i.incident_id where i.id = ${iapId}`;
  if (!row) throw new AuthError(404, "IAP not found");
  return {
    status: row.status as string,
    jurisdictionId: row.jurisdiction_id as string,
    incidentId: row.incident_id as string,
  };
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
function displayStatus(stored: string, formCount: number): string {
  if (stored === "draft") return formCount === 0 ? "not_started" : "in_progress";
  return stored;
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
  const [incident] = await sql`select jurisdiction_id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  requireMember(actor, incident.jurisdiction_id as string);
  const rows = await sql`
    select i.id, i.operational_period, i.status, i.form_ids, i.created_at, i.approved_at,
           prep.display_name as prepared_by, appr.display_name as approved_by
    from iaps i
    left join persons prep on prep.id = i.prepared_by
    left join persons appr on appr.id = i.approved_by
    where i.incident_id = ${incidentId}
    order by i.created_at desc`;
  return rows.map((r) => {
    const formCount = (r.form_ids as string[] | null)?.length ?? 0;
    return {
      id: r.id as string,
      operationalPeriod: r.operational_period as string,
      status: displayStatus(r.status as string, formCount),
      formCount,
      targetForms: IAP_TARGET_FORMS,
      preparedBy: (r.prepared_by as string | null) ?? null,
      approvedBy: (r.approved_by as string | null) ?? null,
      approvedAt: r.approved_at ? new Date(r.approved_at as string).toISOString() : null,
      createdAt: new Date(r.created_at as string).toISOString(),
    };
  });
}

export async function exportIapPdf(
  sql: Sql,
  actor: Principal,
  iapId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const iap = await getIap(sql, actor, iapId);
  const content = iap.content;
  const title = `IAP - ${content.incidentName} - ${content.operationalPeriod}`;
  const bytes = renderPdf(title, iapToTextLines(content));
  const safe = content.incidentName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { filename: `iap-${safe}.pdf`, bytes };
}

function requireAdmin(actor: Principal, jurisdictionId: string): void {
  const m = actor.memberships.find((x) => x.jurisdictionId === jurisdictionId);
  if (!m || m.role !== "admin") throw new AuthError(403, "requires jurisdiction admin");
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
