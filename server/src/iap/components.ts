import { z } from "zod";
import {
  ICS_COMPONENT_EDITION,
  ICS_COMPONENT_FORMS,
  ICS_COMPONENT_FORM_IDS,
  componentToFormContent,
  isComponentFormId,
  prefillComponent,
  renderIcsFormPdf,
  validateComponentValues,
  type ComponentValues,
  type IcsComponentFormId,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority, type IncidentAuthority } from "../incidents/participation.js";
import { gatherContext, resolvePreparedAttribution } from "./service.js";
import { followComponentChange, type PlanChange } from "./plan.js";
import { ics213rr } from "../resource/rr213.js";

/**
 * ICS forms as components of an operational period (Veoci and air gap VA37,
 * part one). A component starts as a draft prefilled from the incident's own
 * records, is edited field by field, saved as its next version over the one
 * the editor opened, and marked ready when its preparer says so. The person
 * who saved a version, and the grant or position they acted under, are its
 * "prepared by". Every version is kept, and any one prints to PDF.
 */

export interface ComponentSummary {
  readonly id: string;
  readonly incidentId: string;
  readonly formId: IcsComponentFormId;
  readonly title: string;
  readonly label: string;
  readonly periodRevision: number;
  readonly operationalPeriod: string;
  readonly status: "draft" | "ready";
  readonly version: number;
  readonly preparedBy: string;
  readonly preparedRole: string;
  readonly updatedAt: string;
  /** The resource request a 213RR was started from; null for every other form. */
  readonly resourceRequestId: string | null;
}

export interface ComponentDetail extends ComponentSummary {
  readonly edition: string;
  readonly incidentName: string;
  readonly values: ComponentValues;
}

export interface ComponentVersion {
  readonly version: number;
  readonly status: "draft" | "ready";
  readonly label: string;
  readonly values: ComponentValues;
  readonly savedBy: string;
  readonly savedRole: string;
  readonly savedAt: string;
}

const iso = (value: unknown): string => new Date(value as string).toISOString();
const FORM_ORDER = new Map<string, number>(ICS_COMPONENT_FORM_IDS.map((id, index) => [id, index]));

function summary(row: Record<string, unknown>): ComponentSummary {
  const formId = row.form_id as IcsComponentFormId;
  return {
    id: row.id as string,
    incidentId: row.incident_id as string,
    formId,
    title: ICS_COMPONENT_FORMS[formId].title,
    label: row.label as string,
    periodRevision: Number(row.period_revision),
    operationalPeriod: row.operational_period as string,
    status: row.status as "draft" | "ready",
    version: Number(row.version),
    preparedBy: row.prepared_name as string,
    preparedRole: row.prepared_role_label as string,
    updatedAt: iso(row.updated_at),
    resourceRequestId: (row.resource_request_id as string | null) ?? null,
  };
}

async function recordComponentAudit(
  sql: Sql,
  actor: Principal,
  authority: IncidentAuthority,
  input: { incidentId: string; componentId: string; category: "ics_form.created" | "ics_form.saved"; payload: Record<string, unknown> },
): Promise<void> {
  if (authority.participation) {
    await sql`select append_ics_form_participant_audit(${input.componentId}, ${input.category}, ${sql.json(input.payload as never)})`;
    return;
  }
  await recordAudit(sql, actor, {
    jurisdictionId: authority.jurisdictionId,
    incidentId: input.incidentId,
    category: input.category,
    subjectTable: "ics_form_components",
    subjectId: input.componentId,
    payload: input.payload,
  });
}

/** The period an area revision recorded, which a component belongs to. */
async function periodOf(sql: Sql, incidentId: string, revision: number): Promise<string> {
  const [row] = await sql`
    select period_label from incident_area_revisions
    where incident_id = ${incidentId} and revision = ${revision} and period_label is not null`;
  if (!row) throw new AuthError(400, "operational period revision is not available for this incident");
  return (row.period_label as string).trim();
}

/** A label for a form a period holds several of; none for the others. */
function labelFor(formId: IcsComponentFormId, raw: string | undefined): string {
  const label = (raw ?? "").trim();
  if (!ICS_COMPONENT_FORMS[formId].many) return "";
  if (!label) throw new AuthError(400, `label: name this ${formId.replace("-", " ")} (${ICS_COMPONENT_FORMS[formId].labelHint})`);
  if (label.length > 200) throw new AuthError(400, "label: keep the label to 200 characters");
  return label;
}

/** A period's components, in form order, then by label. */
export async function listComponents(sql: Sql, actor: Principal, incidentId: string, periodRevision?: number): Promise<ComponentSummary[]> {
  await getIncidentAuthority(sql, actor, incidentId);
  const rows = await sql`
    select c.*, p.display_name as prepared_name from ics_form_components c join persons p on p.id = c.prepared_by
    where c.incident_id = ${incidentId} and (${periodRevision ?? null}::integer is null or c.period_revision = ${periodRevision ?? null})`;
  return rows.map(summary).sort((a, b) =>
    b.periodRevision - a.periodRevision
    || FORM_ORDER.get(a.formId)! - FORM_ORDER.get(b.formId)!
    || a.label.localeCompare(b.label));
}

/** A 213RR's label and values, from the incident's resource request it is started from (VA38). */
async function fromRequest(sql: Sql, actor: Principal, incidentId: string, requestId: string | undefined) {
  if (!requestId) throw new AuthError(400, "requestId: start an ICS 213RR from one of the incident's resource requests");
  const { request, values } = await ics213rr(sql, actor, requestId);
  if (request.incidentId !== incidentId) throw new AuthError(400, "requestId: that resource request belongs to another incident");
  return { label: `REQ-${request.number}`, values };
}

/** Start a form for a period: a draft at version 1, prefilled from the incident's records. */
export async function createComponent(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: { formId: string; periodRevision: number; label?: string | undefined; requestId?: string | undefined },
): Promise<ComponentDetail> {
  if (!isComponentFormId(input.formId)) throw new AuthError(400, `formId: ${input.formId} is not an ICS form this workspace keeps`);
  const formId = input.formId;
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const attribution = await resolvePreparedAttribution(sql, actor, authority);
  const request = formId === "ICS-213RR" ? await fromRequest(sql, actor, incidentId, input.requestId) : null;
  const label = request?.label ?? labelFor(formId, input.label);
  const operationalPeriod = await periodOf(sql, incidentId, input.periodRevision);
  const [incident] = await sql`select activated_at from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  // Objectives the period's 202 already holds feed a new 201 or 209.
  const [objectives] = await sql`
    select field_values ->> 'objectives' as text from ics_form_components
    where incident_id = ${incidentId} and period_revision = ${input.periodRevision} and form_id = 'ICS-202'`;
  const { ctx } = await gatherContext(sql, actor, incidentId, {
    operationalPeriod,
    objectives: String(objectives?.text ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
  });
  const values = request?.values ?? prefillComponent(formId, ctx, {
    preparedRole: attribution.roleLabel,
    incidentStart: `${iso(incident.activated_at).slice(0, 16).replace("T", " ")} UTC`,
  });
  let id: string;
  try {
    const [row] = await sql`
      insert into ics_form_components
        (incident_id, period_revision, operational_period, form_id, label, edition, field_values,
         prepared_by, prepared_role_label, prepared_organization_id, prepared_participation_id, resource_request_id)
      values (${incidentId}, ${input.periodRevision}, ${operationalPeriod}, ${formId}, ${label}, ${ICS_COMPONENT_EDITION},
        ${sql.json(values as never)}, ${actor.person.id}, ${attribution.roleLabel}, ${attribution.organizationId},
        ${attribution.participationId}, ${request ? input.requestId! : null})
      returning id`;
    id = row!.id as string;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new AuthError(409, label
        ? `this period already has an ${formId.replace("-", " ")} named ${label}`
        : `this period already has an ${formId.replace("-", " ")}; open it instead`);
    }
    throw error;
  }
  await recordComponentAudit(sql, actor, authority, {
    incidentId, componentId: id, category: "ics_form.created",
    payload: { formId, label, periodRevision: input.periodRevision },
  });
  return getComponent(sql, actor, id);
}

export async function getComponent(sql: Sql, actor: Principal, componentId: string): Promise<ComponentDetail> {
  const [row] = await sql`
    select c.*, p.display_name as prepared_name, i.name as incident_name
    from ics_form_components c join persons p on p.id = c.prepared_by join incidents i on i.id = c.incident_id
    where c.id = ${componentId}`;
  if (!row) throw new AuthError(404, "ICS form not found");
  await getIncidentAuthority(sql, actor, row.incident_id as string);
  return {
    ...summary(row),
    edition: row.edition as string,
    incidentName: row.incident_name as string,
    values: row.field_values as ComponentValues,
  };
}

export const SaveComponentSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  status: z.enum(["draft", "ready"]),
  expectedVersion: z.number().int().min(1),
  label: z.string().max(200).optional(),
}).strict();
export type SaveComponentInput = z.infer<typeof SaveComponentSchema>;

/**
 * Save a component as its next version over the version the editor opened;
 * a save over someone else's is refused. The saver becomes its "prepared by".
 * A version marked ready goes into the plans that hold the form and that the
 * saver may revise (part two); the answer names each plan it changed.
 */
export async function saveComponent(
  sql: Sql,
  actor: Principal,
  componentId: string,
  input: SaveComponentInput,
): Promise<ComponentDetail & { readonly plans: readonly PlanChange[] }> {
  const [row] = await sql`select incident_id, form_id, version, label from ics_form_components where id = ${componentId}`;
  if (!row) throw new AuthError(404, "ICS form not found");
  const incidentId = row.incident_id as string;
  const formId = row.form_id as IcsComponentFormId;
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const attribution = await resolvePreparedAttribution(sql, actor, authority);
  let values: Record<string, unknown>;
  try {
    values = validateComponentValues(formId, input.values);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      throw new AuthError(400, `${issue?.path.join(".") || "values"}: ${issue?.message ?? "invalid value"}`);
    }
    throw error;
  }
  // A 213RR keeps its request's number as its name.
  const label = input.label === undefined || formId === "ICS-213RR" ? (row.label as string) : labelFor(formId, input.label);
  const [locked] = await sql`select version from ics_form_components where id = ${componentId} for update`;
  const current = Number(locked!.version);
  if (input.expectedVersion !== current) {
    throw new AuthError(409, `the form changed after it was opened: version ${current} is current`);
  }
  try {
    await sql`
      update ics_form_components
      set field_values = ${sql.json(values as never)}, status = ${input.status}, label = ${label},
          version = ${current + 1}, prepared_by = ${actor.person.id}, prepared_role_label = ${attribution.roleLabel},
          prepared_organization_id = ${attribution.organizationId}, prepared_participation_id = ${attribution.participationId},
          updated_at = now()
      where id = ${componentId}`;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new AuthError(409, `this period already has an ${formId.replace("-", " ")} named ${label}`);
    throw error;
  }
  await recordComponentAudit(sql, actor, authority, {
    incidentId, componentId, category: "ics_form.saved",
    payload: { formId, label, version: current + 1, status: input.status },
  });
  const plans = input.status === "ready" ? await followComponentChange(sql, actor, componentId) : [];
  return { ...await getComponent(sql, actor, componentId), plans };
}

/** Every version of a component, newest first. */
export async function listComponentVersions(sql: Sql, actor: Principal, componentId: string): Promise<ComponentVersion[]> {
  await getComponent(sql, actor, componentId);
  const rows = await sql`
    select v.*, p.display_name from ics_form_component_versions v join persons p on p.id = v.saved_by
    where v.component_id = ${componentId} order by v.version desc`;
  return rows.map((row) => ({
    version: Number(row.version),
    status: row.status as "draft" | "ready",
    label: row.label as string,
    values: row.field_values as ComponentValues,
    savedBy: row.display_name as string,
    savedRole: row.saved_role_label as string,
    savedAt: iso(row.saved_at),
  }));
}

/** One version of a component (the current one unless named) as a PDF. */
export async function componentPdf(
  sql: Sql,
  actor: Principal,
  componentId: string,
  version?: number,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const component = await getComponent(sql, actor, componentId);
  const chosen = version === undefined || version === component.version
    ? { values: component.values, label: component.label, status: component.status, by: component.preparedBy,
        role: component.preparedRole, at: component.updatedAt, version: component.version }
    : await (async () => {
        const found = (await listComponentVersions(sql, actor, componentId)).find((v) => v.version === version);
        if (!found) throw new AuthError(404, "ICS form version not found");
        return { values: found.values, label: found.label, status: found.status, by: found.savedBy, role: found.savedRole,
          at: found.savedAt, version: found.version };
      })();
  const content = componentToFormContent(component.formId, chosen.values, {
    incidentName: component.incidentName,
    operationalPeriod: component.operationalPeriod,
    preparedBy: `${chosen.by}, ${chosen.role}`,
    ...(chosen.label ? { label: chosen.label } : {}),
  });
  const bytes = renderIcsFormPdf(content, {
    source: "Stored ICS form",
    sourceTime: chosen.at,
    revision: `Version ${chosen.version}; ${chosen.status}; ${component.edition}`,
  });
  const safe = `${component.formId}-${component.incidentName}${chosen.label ? `-${chosen.label}` : ""}`
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return { filename: `${safe}-v${chosen.version}.pdf`, bytes };
}
