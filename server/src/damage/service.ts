import {
  publicAssistanceTotals,
  summarizeAssessments,
  renderDeclarationSupport,
  type AssessmentRow,
  type DamageDegree,
  type DamageSummary,
  type DeclarationThresholds,
  type PaItemStatus,
  type PublicAssistanceTotals,
  type ShelterReport,
  DAMAGE_DEGREES,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import {
  AuthError,
  principalForPerson,
  requireAdmin,
  requireMember,
  requireWriter,
  type Principal,
} from "../auth/service.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { withPerson } from "../db/context.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type Page, type PageRequest } from "../db/cursor.js";
import { recordAudit } from "../audit/service.js";
import { writeImportReport, type ReportRow } from "../data-packs/import-reports.js";
import { rateLimit } from "../security/rate-limit.js";
import { lockIncidentMutation } from "../incidents/participation.js";

/** Public self-reports accepted per jurisdiction per minute; a flood cannot bury moderators or the store. */
const INTAKE_PER_MINUTE = 30;

/**
 * Damage assessment module (F8/F9). Pre-loaded baselines,
 * offline-capable field assessment against them, moderated public
 * self-report intake, and aggregation into FEMA declaration paperwork.
 * The invariant the acceptance turns on: only APPROVED assessments count
 * toward the declaration, so an unmoderated public report can never move
 * the numbers a federal request is built on.
 */

const DEGREES = new Set<string>(DAMAGE_DEGREES.values);

export interface BaselineInput {
  readonly parcelId: string;
  readonly address: string;
  readonly structureType: string;
  readonly replacementValue: number;
  readonly location?: { lon: number; lat: number } | undefined;
}

/** The baseline's fields and the file columns the Damage screen reads them from. */
const BASELINE_MAPPING = [
  { field: "Parcel ID", column: "parcelId" },
  { field: "Address", column: "address" },
  { field: "Structure type", column: "structureType" },
  { field: "Replacement value", column: "replacementValue" },
  { field: "Location", column: "lon, lat" },
];

/**
 * Baseline import. The documented pipeline: a jurisdiction exports its
 * assessor parcel roll to CSV (parcel_id, address, structure_type,
 * replacement_value, lon, lat), a one-line converter maps it to these
 * rows, and this upserts them. Real GIS parcel ingestion is a pilot task;
 * the shape and the upsert semantics are fixed here. A parcel the file
 * lists twice is taken once, from its first row, and the import keeps a
 * report of each parcel created, updated or refused (VC-13).
 */
export async function importBaseline(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  rows: readonly BaselineInput[],
  sourceName?: string,
): Promise<{ imported: number; reportId: string }> {
  requireAdmin(actor, jurisdictionId);
  let imported = 0;
  const report: ReportRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = `parcel ${row.parcelId}`;
    if (seen.has(row.parcelId)) {
      report.push({ item, outcome: "refused", reason: "the file lists this parcel earlier; the first one is kept" });
      continue;
    }
    seen.add(row.parcelId);
    const geom = row.location
      ? sql`ST_SetSRID(ST_MakePoint(${row.location.lon}, ${row.location.lat}), 4326)`
      : null;
    // xmax is zero on a row this statement inserted, and set on one it updated.
    const [result] = await sql`
      insert into damage_baselines
        (jurisdiction_id, parcel_id, address, structure_type, replacement_value, geom, imported_by)
      values
        (${jurisdictionId}, ${row.parcelId}, ${row.address}, ${row.structureType},
         ${row.replacementValue}, ${geom}, ${actor.person.id})
      on conflict (jurisdiction_id, parcel_id) do update set
        address = excluded.address,
        structure_type = excluded.structure_type,
        replacement_value = excluded.replacement_value,
        geom = excluded.geom
      returning (xmax = 0) as inserted`;
    report.push({ item, outcome: result!.inserted ? "created" : "updated" });
    imported += 1;
  }
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "damage.baseline.imported",
    payload: { rows: rows.length },
  });
  const reportId = await writeImportReport(sql, actor, {
    jurisdictionId, kind: "parcel_baseline", subject: "Parcel baseline", sourceName, mapping: BASELINE_MAPPING, rows: report,
  });
  return { imported, reportId };
}

/**
 * What an incident reads: its own reports and line items, and those recorded
 * with no incident, which belong to no incident in particular. With no
 * incident chosen, the organization's whole inventory.
 */
function incidentScope(sql: Sql, incidentId: string | null | undefined) {
  return incidentId ? sql`and (incident_id = ${incidentId} or incident_id is null)` : sql``;
}

export interface AssessmentInput {
  readonly incidentId?: string | null | undefined;
  readonly baselineId?: string | undefined;
  readonly address: string;
  readonly structureType: string;
  readonly degree: string;
  readonly ownership?: string | undefined;
  readonly insured?: boolean | null | undefined;
  readonly estimatedLoss: number;
  readonly notes?: string | undefined;
  readonly location?: { lon: number; lat: number } | undefined;
}

/** An official field assessment: authoritative on create, so approved. */
export async function createAssessment(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: AssessmentInput,
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  if (!DEGREES.has(input.degree)) throw new AuthError(400, "unknown damage degree");
  await requireOwnIncident(sql, jurisdictionId, input.incidentId);
  const geom = input.location
    ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
    : null;
  const [row] = await sql`
    insert into damage_assessments
      (jurisdiction_id, incident_id, baseline_id, address, structure_type, degree, ownership, insured,
       estimated_loss, source, status, notes, geom, assessed_by, moderated_by, moderated_at)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.baselineId ?? null}, ${input.address}, ${input.structureType},
       ${input.degree}, ${input.ownership ?? null}, ${input.insured ?? null},
       ${input.estimatedLoss}, 'official', 'approved', ${input.notes ?? null}, ${geom},
       ${actor.person.id}, ${actor.person.id}, now())
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "damage.assessment.created",
    subjectTable: "damage_assessments",
    subjectId: id,
    payload: { degree: input.degree, source: "official" },
  });
  return { id };
}

/** Issue the organization's one intake token, for `incidentId` when given: the reports it takes carry that incident. */
export async function enablePublicIntake(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId?: string | null,
): Promise<{ token: string }> {
  requireAdmin(actor, jurisdictionId);
  await requireOwnIncident(sql, jurisdictionId, incidentId);
  const token = newToken();
  await sql`
    insert into damage_intake (jurisdiction_id, token_hash, owner_person, enabled, incident_id)
    values (${jurisdictionId}, ${token.hash}, ${actor.person.id}, true, ${incidentId ?? null})
    on conflict (jurisdiction_id) do update set
      token_hash = excluded.token_hash, owner_person = excluded.owner_person, enabled = true,
      incident_id = excluded.incident_id`;
  return { token: token.token };
}

export interface PublicReportInput {
  readonly address: string;
  readonly structureType: string;
  readonly degree: string;
  readonly estimatedLoss?: number | undefined;
  readonly reporterContact?: string | undefined;
  readonly notes?: string | undefined;
  readonly location?: { lon: number; lat: number } | undefined;
}

/**
 * Public self-report intake. Token-gated and rate-limited, it lands the
 * report as source=public status=submitted under the enabling owner's
 * authority. It is a moderation-queue entry, never an assessed record:
 * aggregation ignores it until a moderator approves it.
 */
export async function submitPublicReport(
  sql: Sql,
  jurisdictionId: string,
  token: string,
  input: PublicReportInput,
): Promise<{ id: string }> {
  const [intake] = await sql`
    select owner_person, token_hash, incident_id from damage_intake
    where jurisdiction_id = ${jurisdictionId} and enabled`;
  if (!intake || (intake.token_hash as string) !== hashToken(token))
    throw new AuthError(401, "invalid intake token");
  const owner = await principalForPerson(sql, intake.owner_person as string);
  const incidentId = (intake.incident_id as string | null) ?? null;
  // A token issued for an incident stops filing when the incident closes, and says
  // so no differently from a wrong token.
  const refused = () => new AuthError(401, "invalid intake token");
  if (incidentId && !(await incidentOpen(sql, owner.person.id, incidentId))) throw refused();
  if (!rateLimit(`intake:${jurisdictionId}`, INTAKE_PER_MINUTE, 60_000).allowed)
    throw new AuthError(429, "too many reports right now, please retry shortly");
  if (!DEGREES.has(input.degree)) throw new AuthError(400, "unknown damage degree");

  return withPerson(sql, owner.person.id, async (tx) => {
    // Checked again under the closeout lock, so a report cannot land as the incident closes.
    if (incidentId) {
      await lockIncidentMutation(tx, incidentId);
      const [open] = await tx`select 1 from incidents where id = ${incidentId} and closed_at is null`;
      if (!open) throw refused();
    }
    const geom = input.location
      ? tx`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
      : null;
    const [row] = await tx`
      insert into damage_assessments
        (jurisdiction_id, incident_id, address, structure_type, degree, estimated_loss, source, status,
         notes, geom, reporter_contact)
      values
        (${jurisdictionId}, ${incidentId}, ${input.address}, ${input.structureType}, ${input.degree},
         ${input.estimatedLoss ?? 0}, 'public', 'submitted', ${input.notes ?? null}, ${geom},
         ${input.reporterContact ?? null})
      returning id`;
    return { id: row!.id as string };
  });
}

/** Whether the incident is open, read as `personId` (the intake's owner, a member of its organization). */
async function incidentOpen(sql: Sql, personId: string, incidentId: string): Promise<boolean> {
  return withPerson(sql, personId, async (tx) => {
    const [row] = await tx`select 1 from incidents where id = ${incidentId} and closed_at is null`;
    return Boolean(row);
  });
}

export async function moderate(
  sql: Sql,
  actor: Principal,
  assessmentId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const [row] = await sql`
    select jurisdiction_id, incident_id, status, source from damage_assessments where id = ${assessmentId}`;
  if (!row) throw new AuthError(404, "assessment not found");
  requireWriter(actor, row.jurisdiction_id as string);
  // A closed incident's reports stay as they were at closeout: none is accepted or rejected after it.
  await requireOwnIncident(sql, row.jurisdiction_id as string, row.incident_id as string | null);
  if ((row.status as string) !== "submitted") throw new AuthError(409, "already moderated");
  await sql`
    update damage_assessments
    set status = ${decision}, moderated_by = ${actor.person.id}, moderated_at = now()
    where id = ${assessmentId}`;
  await recordAudit(sql, actor, {
    jurisdictionId: row.jurisdiction_id as string,
    category: `damage.report.${decision}`,
    subjectTable: "damage_assessments",
    subjectId: assessmentId,
  });
}

export async function listAssessments(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  filter: { status?: string; source?: string; incidentId?: string },
  page: PageRequest,
): Promise<Page<Record<string, unknown>>> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select id, incident_id, address, structure_type, degree, source, status, estimated_loss, insured, notes,
      reporter_contact, created_at, ST_X(geom) as lon, ST_Y(geom) as lat,
      to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from damage_assessments
    where jurisdiction_id = ${jurisdictionId}
      and (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
      and (${filter.source ?? null}::text is null or source = ${filter.source ?? null})
      ${incidentScope(sql, filter.incidentId)}
      ${after ? sql`and (created_at, id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by created_at desc, id desc limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    items: items.map(({ page_at: _pageAt, ...r }) => ({ ...r, estimated_loss: Number(r.estimated_loss) })),
    nextCursor,
  };
}

async function approvedRows(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  incidentId: string | null | undefined,
): Promise<AssessmentRow[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select degree, estimated_loss, insured from damage_assessments
    where jurisdiction_id = ${jurisdictionId} and status = 'approved' ${incidentScope(sql, incidentId)}`;
  return rows.map((r) => ({
    degree: r.degree as DamageDegree,
    estimatedLoss: Number(r.estimated_loss),
    insured: (r.insured as boolean | null) ?? null,
  }));
}

/** Counted Public Assistance cost by work category: submitted and reviewed items, never drafts. */
async function paTotals(sql: Sql, jurisdictionId: string, incidentId: string | null | undefined): Promise<PublicAssistanceTotals> {
  const groups = await sql`
    select category, sum(estimated_cost_cents)::text as cents, count(*)::int as items
    from damage_pa_items
    where jurisdiction_id = ${jurisdictionId} and status <> 'draft' ${incidentScope(sql, incidentId)}
    group by category`;
  return publicAssistanceTotals(groups.map((g) => ({
    category: g.category as string,
    costCents: Number(g.cents),
    items: g.items as number,
  })));
}

/**
 * The latest report of each registered shelter, read from the facilities
 * integration. A shelter reports its capacity and open spaces as beds, so
 * the counts sum over every bed row, as the facilities screen does. A
 * registered facility belongs to its organization, not to an incident, so the
 * census is the organization's under every incident.
 */
async function shelterReports(sql: Sql, jurisdictionId: string): Promise<ShelterReport[]> {
  const rows = await sql`
    select f.name, r.beds, r.reported_at
    from facilities f
    left join lateral (
      select beds, reported_at from facility_status_reports
      where facility_id = f.id order by reported_at desc limit 1) r on true
    where f.jurisdiction_id = ${jurisdictionId} and f.kind = 'shelter' and f.retired_at is null
    order by f.name, f.id`;
  return rows.map((r) => {
    const beds = (r.beds as Array<{ available: number; baseline: number }> | null) ?? [];
    return {
      name: r.name as string,
      capacity: beds.reduce((sum, bed) => sum + bed.baseline, 0),
      open: beds.reduce((sum, bed) => sum + bed.available, 0),
      reportedAt: r.reported_at ? new Date(r.reported_at as string).toISOString() : null,
    };
  });
}

/**
 * The loss summary and declaration indicators. `shelterCensus` is whether
 * the facilities integration runs; when it is off the summary carries no
 * census rather than numbers from tables nobody reports into.
 */
export async function aggregate(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  thresholds: DeclarationThresholds,
  shelterCensus: boolean,
  incidentId?: string | null,
): Promise<DamageSummary> {
  const rows = await approvedRows(sql, actor, jurisdictionId, incidentId);
  return summarizeAssessments(
    rows,
    thresholds,
    await paTotals(sql, jurisdictionId, incidentId),
    shelterCensus ? await shelterReports(sql, jurisdictionId) : null,
  );
}

export async function exportDeclaration(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  thresholds: DeclarationThresholds,
  meta: { jurisdiction: string; incident: string },
  shelterCensus: boolean,
  incidentId?: string | null,
): Promise<{ summary: DamageSummary; document: string }> {
  const summary = await aggregate(sql, actor, jurisdictionId, thresholds, shelterCensus, incidentId);
  const document = renderDeclarationSupport(summary, {
    ...meta,
    preparedAt: new Date().toISOString(),
  });
  return { summary, document };
}

export interface PaItemInput {
  readonly incidentId?: string | null | undefined;
  readonly applicant: string;
  readonly category: string;
  readonly site?: string | null | undefined;
  readonly description: string;
  readonly estimatedCostCents: number;
  readonly insured?: boolean | null | undefined;
  readonly percentComplete: number;
  readonly status: PaItemStatus;
  readonly location?: { lon: number; lat: number } | null | undefined;
}

/**
 * A damage write names an open incident of its own organization. Closure
 * refuses incident-scoped writes (an archived incident is always closed); the
 * closeout lock is taken first, so a write cannot land as the incident closes.
 */
async function requireOwnIncident(sql: Sql, jurisdictionId: string, incidentId: string | null | undefined): Promise<void> {
  if (!incidentId) return;
  await lockIncidentMutation(sql, incidentId);
  const [row] = await sql`select closed_at from incidents where id = ${incidentId} and jurisdiction_id = ${jurisdictionId}`;
  if (!row) throw new AuthError(400, "incident is not in this jurisdiction");
  if (row.closed_at) throw new AuthError(409, "incident is closed");
}

/**
 * A Public Assistance line item: one applicant's work in one category at one
 * site. The route checks the category against the PA dictionary.
 */
export async function createPaItem(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  input: PaItemInput,
): Promise<{ id: string }> {
  requireWriter(actor, jurisdictionId);
  await requireOwnIncident(sql, jurisdictionId, input.incidentId);
  const geom = input.location
    ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
    : null;
  const [row] = await sql`
    insert into damage_pa_items
      (jurisdiction_id, incident_id, applicant, category, site, description, estimated_cost_cents,
       insured, percent_complete, status, geom, created_by, updated_by)
    values
      (${jurisdictionId}, ${input.incidentId ?? null}, ${input.applicant}, ${input.category},
       ${input.site ?? null}, ${input.description}, ${input.estimatedCostCents}, ${input.insured ?? null},
       ${input.percentComplete}, ${input.status}, ${geom}, ${actor.person.id}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "damage.pa_item.created",
    subjectTable: "damage_pa_items",
    subjectId: id,
    payload: { category: input.category, estimatedCostCents: input.estimatedCostCents, status: input.status },
  });
  return { id };
}

/** Replace a line item's editable fields. */
export async function updatePaItem(
  sql: Sql,
  actor: Principal,
  itemId: string,
  input: PaItemInput,
): Promise<void> {
  const [item] = await sql`select jurisdiction_id, incident_id, estimated_cost_cents from damage_pa_items where id = ${itemId}`;
  if (!item) throw new AuthError(404, "Public Assistance line item not found");
  // A cost or incident changed by hand no longer comes from the force account it was rolled up from.
  const keepsForceAccount = Number(item.estimated_cost_cents) === input.estimatedCostCents
    && (item.incident_id ?? null) === (input.incidentId ?? null);
  const jurisdictionId = item.jurisdiction_id as string;
  requireWriter(actor, jurisdictionId);
  // Neither the incident it is in nor the one it moves to may be closed.
  await requireOwnIncident(sql, jurisdictionId, item.incident_id as string | null);
  if ((input.incidentId ?? null) !== (item.incident_id ?? null)) await requireOwnIncident(sql, jurisdictionId, input.incidentId);
  const geom = input.location
    ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
    : null;
  await sql`
    update damage_pa_items set
      incident_id = ${input.incidentId ?? null}, applicant = ${input.applicant}, category = ${input.category},
      site = ${input.site ?? null}, description = ${input.description},
      estimated_cost_cents = ${input.estimatedCostCents}, insured = ${input.insured ?? null},
      percent_complete = ${input.percentComplete}, status = ${input.status}, geom = ${geom},
      ${keepsForceAccount ? sql`` : sql`force_account = null, force_account_at = null,`}
      updated_by = ${actor.person.id}, updated_at = now()
    where id = ${itemId}`;
  await recordAudit(sql, actor, {
    jurisdictionId,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    category: "damage.pa_item.updated",
    subjectTable: "damage_pa_items",
    subjectId: itemId,
    payload: { category: input.category, estimatedCostCents: input.estimatedCostCents, status: input.status },
  });
}

/** Line items newest first, with the counted totals by category, across the jurisdiction or as `incidentId` reads them. */
export async function listPaItems(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  page: PageRequest,
  incidentId?: string,
): Promise<Page<Record<string, unknown>> & { totals: PublicAssistanceTotals }> {
  requireMember(actor, jurisdictionId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  const rows = await sql`
    select id, incident_id, applicant, category, site, description, estimated_cost_cents, insured,
      percent_complete, status, ST_X(geom) as lon, ST_Y(geom) as lat, created_at, updated_at, force_account_at,
      to_char(created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from damage_pa_items
    where jurisdiction_id = ${jurisdictionId} ${incidentScope(sql, incidentId)}
      ${after ? sql`and (created_at, id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by created_at desc, id desc limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows, limit, (r) => [r.page_at as string, r.id as string]);
  return {
    items: items.map(({ page_at: _pageAt, ...r }) => ({ ...r, estimated_cost_cents: Number(r.estimated_cost_cents) })),
    nextCursor,
    totals: await paTotals(sql, jurisdictionId, incidentId),
  };
}
