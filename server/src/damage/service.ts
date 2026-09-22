import {
  summarizeAssessments,
  renderDeclarationSupport,
  type AssessmentRow,
  type DamageDegree,
  type DamageSummary,
  type DeclarationThresholds,
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
import { recordAudit } from "../audit/service.js";
import { rateLimit } from "../security/rate-limit.js";

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

/**
 * Baseline import. The documented pipeline: a jurisdiction exports its
 * assessor parcel roll to CSV (parcel_id, address, structure_type,
 * replacement_value, lon, lat), a one-line converter maps it to these
 * rows, and this upserts them. Real GIS parcel ingestion is a pilot task;
 * the shape and the upsert semantics are fixed here.
 */
export async function importBaseline(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  rows: readonly BaselineInput[],
): Promise<{ imported: number }> {
  requireAdmin(actor, jurisdictionId);
  let imported = 0;
  for (const row of rows) {
    const geom = row.location
      ? sql`ST_SetSRID(ST_MakePoint(${row.location.lon}, ${row.location.lat}), 4326)`
      : null;
    const result = await sql`
      insert into damage_baselines
        (jurisdiction_id, parcel_id, address, structure_type, replacement_value, geom, imported_by)
      values
        (${jurisdictionId}, ${row.parcelId}, ${row.address}, ${row.structureType},
         ${row.replacementValue}, ${geom}, ${actor.person.id})
      on conflict (jurisdiction_id, parcel_id) do update set
        address = excluded.address,
        structure_type = excluded.structure_type,
        replacement_value = excluded.replacement_value,
        geom = excluded.geom`;
    imported += result.count;
  }
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "damage.baseline.imported",
    payload: { rows: rows.length },
  });
  return { imported };
}

export interface AssessmentInput {
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
  const geom = input.location
    ? sql`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
    : null;
  const [row] = await sql`
    insert into damage_assessments
      (jurisdiction_id, baseline_id, address, structure_type, degree, ownership, insured,
       estimated_loss, source, status, notes, geom, assessed_by, moderated_by, moderated_at)
    values
      (${jurisdictionId}, ${input.baselineId ?? null}, ${input.address}, ${input.structureType},
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

export async function enablePublicIntake(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<{ token: string }> {
  requireAdmin(actor, jurisdictionId);
  const token = newToken();
  await sql`
    insert into damage_intake (jurisdiction_id, token_hash, owner_person, enabled)
    values (${jurisdictionId}, ${token.hash}, ${actor.person.id}, true)
    on conflict (jurisdiction_id) do update set
      token_hash = excluded.token_hash, owner_person = excluded.owner_person, enabled = true`;
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
    select owner_person, token_hash from damage_intake
    where jurisdiction_id = ${jurisdictionId} and enabled`;
  if (!intake || (intake.token_hash as string) !== hashToken(token))
    throw new AuthError(401, "invalid intake token");
  if (!rateLimit(`intake:${jurisdictionId}`, INTAKE_PER_MINUTE, 60_000).allowed)
    throw new AuthError(429, "too many reports right now, please retry shortly");
  if (!DEGREES.has(input.degree)) throw new AuthError(400, "unknown damage degree");

  const owner = await principalForPerson(sql, intake.owner_person as string);
  return withPerson(sql, owner.person.id, async (tx) => {
    const geom = input.location
      ? tx`ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)`
      : null;
    const [row] = await tx`
      insert into damage_assessments
        (jurisdiction_id, address, structure_type, degree, estimated_loss, source, status,
         notes, geom, reporter_contact)
      values
        (${jurisdictionId}, ${input.address}, ${input.structureType}, ${input.degree},
         ${input.estimatedLoss ?? 0}, 'public', 'submitted', ${input.notes ?? null}, ${geom},
         ${input.reporterContact ?? null})
      returning id`;
    return { id: row!.id as string };
  });
}

export async function moderate(
  sql: Sql,
  actor: Principal,
  assessmentId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const [row] = await sql`
    select jurisdiction_id, status, source from damage_assessments where id = ${assessmentId}`;
  if (!row) throw new AuthError(404, "assessment not found");
  requireWriter(actor, row.jurisdiction_id as string);
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
  filter: { status?: string; source?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select id, address, degree, source, status, estimated_loss, reporter_contact, created_at
    from damage_assessments
    where jurisdiction_id = ${jurisdictionId}
      and (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
      and (${filter.source ?? null}::text is null or source = ${filter.source ?? null})
    order by created_at desc`;
  return rows.map((r) => ({ ...r, estimated_loss: Number(r.estimated_loss) }));
}

async function approvedRows(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
): Promise<AssessmentRow[]> {
  requireMember(actor, jurisdictionId);
  const rows = await sql`
    select degree, estimated_loss, insured from damage_assessments
    where jurisdiction_id = ${jurisdictionId} and status = 'approved'`;
  return rows.map((r) => ({
    degree: r.degree as DamageDegree,
    estimatedLoss: Number(r.estimated_loss),
    insured: (r.insured as boolean | null) ?? null,
  }));
}

export async function aggregate(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  thresholds: DeclarationThresholds,
): Promise<DamageSummary> {
  return summarizeAssessments(await approvedRows(sql, actor, jurisdictionId), thresholds);
}

export async function exportDeclaration(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  thresholds: DeclarationThresholds,
  meta: { jurisdiction: string; incident: string },
): Promise<{ summary: DamageSummary; document: string }> {
  const summary = summarizeAssessments(await approvedRows(sql, actor, jurisdictionId), thresholds);
  const document = renderDeclarationSupport(summary, {
    ...meta,
    preparedAt: new Date().toISOString(),
  });
  return { summary, document };
}
