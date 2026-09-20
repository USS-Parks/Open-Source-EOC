import {
  aarToTextLines,
  composeAar,
  renderPdf,
  type AarComposeInput,
  type AarCorrectiveAction,
  type AarDocument,
  type AarObservation,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { exportChronology } from "../audit/service.js";

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
  },
): Promise<{ id: string }> {
  const { jurisdictionId } = await incidentJurisdiction(sql, incidentId);
  requireWriter(actor, jurisdictionId);
  const [row] = await sql`
    insert into aar_observations
      (jurisdiction_id, incident_id, capability, capability_element, kind, observation,
       recommendation, created_by)
    values
      (${jurisdictionId}, ${incidentId}, ${input.capability}, ${input.capabilityElement ?? "none"},
       ${input.kind}, ${input.observation}, ${input.recommendation ?? null}, ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    incidentId,
    category: "aar.observed",
    subjectTable: "aar_observations",
    subjectId: row!.id as string,
    payload: { capability: input.capability, kind: input.kind },
  });
  return { id: row!.id as string };
}

export async function listObservations(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<AarObservation[]> {
  const { jurisdictionId } = await incidentJurisdiction(sql, incidentId);
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select capability, capability_element, kind, observation, recommendation from aar_observations
    where incident_id = ${incidentId} order by created_at`;
  return rows.map((r) => ({
    capability: r.capability as string,
    capabilityElement: (r.capability_element as string | null) ?? "none",
    kind: r.kind as "strength" | "improvement",
    observation: r.observation as string,
    recommendation: (r.recommendation as string | null) ?? null,
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
    ownerPosition?: string | undefined;
    ownerPerson?: string | undefined;
    dueDate?: string | undefined;
  },
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  const [row] = await sql`
    insert into corrective_actions
      (jurisdiction_id, incident_id, capability, capability_element, recommendation,
       owner_position, owner_person, due_date, created_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.capability},
       ${input.capabilityElement ?? "none"}, ${input.recommendation},
       ${input.ownerPosition ?? null}, ${input.ownerPerson ?? null}, ${input.dueDate ?? null},
       ${actor.person.id})
    returning id`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "aar.corrective_action_created",
    subjectTable: "corrective_actions",
    subjectId: row!.id as string,
    payload: { capability: input.capability },
  });
  return { id: row!.id as string };
}

export async function setCorrectiveActionStatus(
  sql: Sql,
  actor: Principal,
  id: string,
  status: "open" | "in_progress" | "complete",
): Promise<void> {
  const [row] = await sql`select jurisdiction_id from corrective_actions where id = ${id}`;
  if (!row) throw new AuthError(404, "corrective action not found");
  requireWriter(actor, row.jurisdiction_id as string);
  await sql`
    update corrective_actions
    set status = ${status}, updated_at = now(),
        completed_at = case when ${status === "complete"} then now() else null end
    where id = ${id}`;
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdiction_id as string,
    category: "aar.corrective_action_status",
    subjectTable: "corrective_actions",
    subjectId: id,
    payload: { status },
  });
}

export interface CorrectiveActionRow {
  readonly id: string;
  readonly capability: string;
  readonly capabilityElement: string;
  readonly recommendation: string;
  readonly owner: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly incidentId: string | null;
}

/**
 * Every corrective action in the jurisdiction, open ones by default. These
 * survive incident closure, so daily-ops keeps reporting on them.
 */
export async function listCorrectiveActions(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  options: { status?: string | undefined; includeComplete?: boolean } = {},
): Promise<CorrectiveActionRow[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select ca.id, ca.capability, ca.capability_element, ca.recommendation, ca.due_date,
           ca.status, ca.incident_id,
           coalesce(pos.title, per.display_name) as owner
    from corrective_actions ca
    left join positions pos on pos.id = ca.owner_position
    left join persons per on per.id = ca.owner_person
    where ca.jurisdiction_id = ${jurisdictionId}
      and (${options.status ?? null}::text is null or ca.status = ${options.status ?? null})
      and (${options.includeComplete ?? false} or ca.status <> 'complete')
    order by ca.created_at`;
  return rows.map((r) => ({
    id: r.id as string,
    capability: r.capability as string,
    capabilityElement: (r.capability_element as string | null) ?? "none",
    recommendation: r.recommendation as string,
    owner: (r.owner as string | null) ?? null,
    dueDate: r.due_date ? (r.due_date as Date).toISOString().slice(0, 10) : null,
    status: r.status as string,
    incidentId: (r.incident_id as string | null) ?? null,
  }));
}

export async function composeAndStoreAar(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: { overview: string; objectives?: readonly string[]; period?: string },
): Promise<{ id: string; content: AarDocument }> {
  const { jurisdictionId, name } = await incidentJurisdiction(sql, incidentId);
  requireWriter(actor, jurisdictionId);
  const observations = await listObservations(sql, actor, incidentId);
  const caRows = await listCorrectiveActions(sql, actor, jurisdictionId, { includeComplete: true });
  const correctiveActions: AarCorrectiveAction[] = caRows
    .filter((c) => c.incidentId === incidentId)
    .map((c) => ({
      capability: c.capability,
      capabilityElement: c.capabilityElement,
      recommendation: c.recommendation,
      owner: c.owner,
      dueDate: c.dueDate,
      status: c.status,
    }));
  const chronology = await exportChronology(sql, actor, { jurisdictionId });
  const composeInput: AarComposeInput = {
    incidentName: name,
    period: input.period ?? "",
    overview: input.overview,
    objectives: input.objectives ?? [],
    observations,
    correctiveActions,
    chronologyLines: chronology.map((c) => c.line),
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
    payload: { observations: observations.length, chronology: content.chronologyCount },
  });
  return { id: row!.id as string, content };
}

export async function exportAarPdf(
  sql: Sql,
  actor: Principal,
  aarId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const [row] = await sql`
    select a.content, a.title, inc.jurisdiction_id
    from aars a join incidents inc on inc.id = a.incident_id where a.id = ${aarId}`;
  if (!row) throw new AuthError(404, "AAR not found");
  requireMember(actor, row.jurisdiction_id as string);
  const content = row.content as AarDocument;
  const bytes = renderPdf(row.title as string, aarToTextLines(content));
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
