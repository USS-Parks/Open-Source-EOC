import { randomUUID } from "node:crypto";
import {
  assembleComponentPlan,
  componentFormLabel,
  type ComponentValues,
  type IapDocument,
  type IcsComponentFormId,
  type PlanComponent,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";
import {
  iapWorkflowRow,
  recordIapAudit,
  requireCurrentClaimedPosition,
  requireIapEditAuthority,
  resolvePeriod,
  resolvePreparedAttribution,
} from "./service.js";

/**
 * The IAP assembled from the period's ICS form components (Veoci and air gap
 * VA37, part two). The planning section chooses the ready forms a plan holds;
 * the plan keeps each at the version it took, rendered into its stored
 * content, and is submitted and approved as a whole. A draft plan takes a
 * form's newer ready version in place. After approval, a form marked ready
 * again makes the plan's next revision, a draft for approval, while the
 * approved revision stays as it was.
 */

/** A form a plan holds, beside the form's own latest version. */
export interface PlanComponentState {
  readonly componentId: string;
  readonly formId: IcsComponentFormId;
  readonly label: string;
  /** The version the plan holds. */
  readonly version: number;
  /** The form's latest version, and whether it is draft or ready. */
  readonly currentVersion: number;
  readonly currentStatus: "draft" | "ready";
}

export interface PlanChange {
  readonly id: string;
  readonly revisionNumber: number;
  readonly contentRevision: number;
  readonly changed: readonly { readonly formId: IcsComponentFormId; readonly label: string; readonly version: number }[];
}

const MAX_PLAN_FORMS = 60;

/** The forms a plan holds, in its order, with each form's latest version. */
export async function planComponents(sql: Sql, iapId: string): Promise<PlanComponentState[]> {
  const rows = await sql`
    select m.component_id, m.version, c.form_id, c.label, c.version as current_version, c.status
    from iap_components m join ics_form_components c on c.id = m.component_id
    where m.iap_id = ${iapId} order by m.ordinal`;
  return rows.map((row) => ({
    componentId: row.component_id as string,
    formId: row.form_id as IcsComponentFormId,
    label: row.label as string,
    version: Number(row.version),
    currentVersion: Number(row.current_version),
    currentStatus: row.status as "draft" | "ready",
  }));
}

/** Each chosen form at the version named, with who saved that version. */
async function readParts(sql: Sql, members: readonly { componentId: string; version: number }[]): Promise<PlanComponent[]> {
  const rows = await sql`
    select v.component_id, v.version, v.label, v.field_values, c.form_id, p.display_name, v.saved_role_label
    from unnest(${members.map((m) => m.componentId)}::uuid[], ${members.map((m) => m.version)}::integer[])
      as wanted (component_id, version)
    join ics_form_component_versions v on v.component_id = wanted.component_id and v.version = wanted.version
    join ics_form_components c on c.id = v.component_id
    join persons p on p.id = v.saved_by`;
  if (rows.length !== members.length) throw new AuthError(404, "an ICS form version the plan holds was not found");
  return rows.map((row) => ({
    componentId: row.component_id as string,
    formId: row.form_id as IcsComponentFormId,
    label: row.label as string,
    version: Number(row.version),
    values: row.field_values as ComponentValues,
    preparedBy: `${row.display_name as string}, ${row.saved_role_label as string}`,
  }));
}

const named = (formId: IcsComponentFormId, label: string): string =>
  label ? `${componentFormLabel(formId)}, ${label}` : componentFormLabel(formId);

async function insertMembers(sql: Sql, iapId: string, content: IapDocument): Promise<void> {
  for (const [ordinal, ref] of (content.components ?? []).entries()) {
    await sql`
      insert into iap_components (iap_id, component_id, version, ordinal)
      values (${iapId}, ${ref.componentId}, ${ref.version}, ${ordinal})`;
  }
}

const formIdsOf = (content: IapDocument): string[] => [...new Set(content.forms.map((form) => form.id))];

/**
 * A draft IAP for a period, assembled from the ready forms the planning
 * section chose, each at its current version.
 */
export async function createComponentPlan(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: { operationalPeriod: string; periodRevision: number; componentIds: readonly string[] },
): Promise<{ id: string; content: IapDocument; periodRevision: number }> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const attribution = await resolvePreparedAttribution(sql, actor, authority);
  const period = await resolvePeriod(sql, incidentId, input.operationalPeriod, input.periodRevision);
  if (!period) throw new AuthError(400, "operational period revision is not available for this incident");
  const ids = [...new Set(input.componentIds)];
  if (ids.length === 0) throw new AuthError(400, "componentIds: choose at least one ICS form for the plan");
  if (ids.length > MAX_PLAN_FORMS) throw new AuthError(400, `componentIds: a plan holds at most ${MAX_PLAN_FORMS} forms`);
  const rows = await sql`
    select id, incident_id, period_revision, form_id, label, version, status
    from ics_form_components where id = any(${ids}::uuid[])`;
  if (rows.length !== ids.length) throw new AuthError(404, "an ICS form chosen for the plan was not found");
  for (const row of rows) {
    const name = named(row.form_id as IcsComponentFormId, row.label as string);
    if (row.incident_id !== incidentId || Number(row.period_revision) !== period.revision)
      throw new AuthError(400, `componentIds: ${name} belongs to another operational period`);
    if (row.status !== "ready")
      throw new AuthError(400, `componentIds: ${name} is a draft; mark it ready before the plan takes it`);
  }
  const [incident] = await sql`select name from incidents where id = ${incidentId}`;
  const parts = await readParts(sql, rows.map((row) => ({ componentId: row.id as string, version: Number(row.version) })));
  const content = assembleComponentPlan({
    incidentName: incident!.name as string,
    operationalPeriod: period.label,
    preparedBy: actor.person.displayName,
  }, parts);
  const id = randomUUID();
  await sql`
    insert into iaps
      (id, incident_id, operational_period, period_revision, form_ids, content, prepared_by,
       prepared_organization_id, prepared_position_id, prepared_participation_id,
       prepared_role_key, prepared_role_label, revision_root_id, revision_number,
       supersedes_iap_id, content_revision)
    values (${id}, ${incidentId}, ${period.label}, ${period.revision}, ${formIdsOf(content)},
            ${sql.json(content as never)}, ${actor.person.id}, ${attribution.organizationId},
            ${attribution.positionId}, ${attribution.participationId},
            ${attribution.roleKey}, ${attribution.roleLabel}, ${id}, 1, null, 1)`;
  await insertMembers(sql, id, content);
  await recordIapAudit(sql, actor, authority, {
    incidentId,
    category: "iap.assembled",
    subjectId: id,
    payload: {
      operationalPeriod: period.label, periodRevision: period.revision, forms: content.forms.length,
      components: content.components?.length ?? 0, organizationId: attribution.organizationId, role: attribution.roleKey,
    },
  });
  return { id, content, periodRevision: period.revision };
}

/**
 * Bring a plan up to its forms' latest ready versions. A draft takes them in
 * place as its next content revision; an approved revision with no successor
 * makes the next revision, a draft for approval. A plan in approval or
 * complete keeps the forms it holds.
 */
export async function refreshPlanForms(sql: Sql, actor: Principal, iapId: string): Promise<PlanChange> {
  const row = await iapWorkflowRow(sql, iapId);
  const authority = await getIncidentAuthority(sql, actor, row.incidentId);
  await requireCurrentClaimedPosition(sql, actor, row.jurisdictionId);
  requireIapEditAuthority(actor, authority, row);
  const members = await planComponents(sql, iapId);
  if (members.length === 0) throw new AuthError(409, "this plan was not assembled from ICS form components");
  const changed = members.filter((m) => m.currentVersion > m.version && m.currentStatus === "ready");
  const unchanged: PlanChange = { id: iapId, revisionNumber: row.revisionNumber, contentRevision: row.contentRevision, changed: [] };
  if (changed.length === 0) return unchanged;
  const next = members.map((m) => ({
    componentId: m.componentId,
    version: m.currentVersion > m.version && m.currentStatus === "ready" ? m.currentVersion : m.version,
  }));
  const summary = changed.map((m) => ({ formId: m.formId, label: m.label, version: m.currentVersion }));

  if (row.status === "draft") {
    const content = assembleComponentPlan({
      incidentName: row.content.incidentName, operationalPeriod: row.content.operationalPeriod, preparedBy: row.content.preparedBy,
    }, await readParts(sql, next));
    const contentRevision = row.contentRevision + 1;
    for (const m of changed) {
      await sql`update iap_components set version = ${m.currentVersion} where iap_id = ${iapId} and component_id = ${m.componentId}`;
    }
    const [updated] = await sql`
      update iaps set content = ${sql.json(content as never)}, form_ids = ${formIdsOf(content)},
        content_revision = ${contentRevision}
      where id = ${iapId} and status = 'draft' and content_revision = ${row.contentRevision}
      returning id`;
    if (!updated) throw new AuthError(409, "IAP content revision conflict");
    await recordIapAudit(sql, actor, authority, {
      incidentId: row.incidentId, category: "iap.forms.refreshed", subjectId: iapId,
      payload: { contentRevision, forms: summary },
    });
    return { id: iapId, revisionNumber: row.revisionNumber, contentRevision, changed: summary };
  }

  if (row.status !== "approved")
    throw new AuthError(409, "a plan in approval or complete keeps the forms it holds; approve it, then revise");
  const [successor] = await sql`select id from iaps where supersedes_iap_id = ${iapId}`;
  if (successor) throw new AuthError(409, "this IAP revision already has a successor");
  const attribution = await resolvePreparedAttribution(sql, actor, authority);
  const content = assembleComponentPlan({
    incidentName: row.content.incidentName, operationalPeriod: row.content.operationalPeriod, preparedBy: actor.person.displayName,
  }, await readParts(sql, next));
  const id = randomUUID();
  const revisionNumber = row.revisionNumber + 1;
  await sql`
    insert into iaps
      (id, incident_id, operational_period, period_revision, status, form_ids, content,
       prepared_by, prepared_organization_id, prepared_position_id,
       prepared_participation_id, prepared_role_key, prepared_role_label,
       revision_root_id, revision_number, supersedes_iap_id, content_revision)
    values (${id}, ${row.incidentId}, ${row.operationalPeriod}, ${row.periodRevision},
      'draft', ${formIdsOf(content)}, ${sql.json(content as never)}, ${actor.person.id},
      ${attribution.organizationId}, ${attribution.positionId}, ${attribution.participationId},
      ${attribution.roleKey}, ${attribution.roleLabel}, ${row.revisionRootId},
      ${revisionNumber}, ${iapId}, 1)`;
  await insertMembers(sql, id, content);
  await recordIapAudit(sql, actor, authority, {
    incidentId: row.incidentId, category: "iap.revision.created", subjectId: id,
    payload: { revisionNumber, supersedesIapId: iapId, reason: "forms changed", forms: summary },
  });
  return { id, revisionNumber, contentRevision: 1, changed: summary };
}

/**
 * After a form is marked ready, each latest plan revision holding it takes
 * the change: a draft in place, an approved revision as its next revision.
 * Plans the saver may not revise, or that are in approval or complete, are
 * left for someone who can, and show the change as waiting.
 */
export async function followComponentChange(sql: Sql, actor: Principal, componentId: string): Promise<PlanChange[]> {
  const plans = await sql`
    select distinct i.id from iap_components m join iaps i on i.id = m.iap_id
    where m.component_id = ${componentId} and i.status in ('draft', 'approved')
      and not exists (select 1 from iaps s where s.supersedes_iap_id = i.id)`;
  const changes: PlanChange[] = [];
  for (const plan of plans) {
    try {
      const change = await refreshPlanForms(sql, actor, plan.id as string);
      if (change.changed.length > 0) changes.push(change);
    } catch (error) {
      if (error instanceof AuthError && (error.status === 403 || error.status === 404)) continue;
      throw error;
    }
  }
  return changes;
}
