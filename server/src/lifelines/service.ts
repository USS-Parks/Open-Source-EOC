import {
  COMMUNITY_LIFELINES,
  type AssessmentDecisionInput,
  type CreateLifelineAssessment,
  type LifelineAssessmentReport,
  type LifelineCurrentState,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentImpact } from "../impact/service.js";
import { getIncidentBoardReadShape, visibleFields } from "../boards/service.js";
import {
  assessmentSelect,
  attribution,
  decisionSelect,
  recordDecision,
  requireAssessmentRead,
  requireAssessmentWrite,
  resolveAssessmentActions,
  validateOrganizations,
  validateSupersedes,
} from "./assessment-common.js";

const identity = (lifeline: string) => ({
  domain: "lifeline" as const,
  framework: "fema_community_lifelines",
  definitionKey: lifeline,
});

export function selectedImpactEvidenceFields(
  aggregate: { value: number | null; coverage: string; reason: string | null },
  source?: {
    datasetId: string | null;
    value: number | null;
    coverage: string;
    reason: string | null;
    loadedAt: string | null;
    sourceVintage: string | null;
  },
): Record<string, unknown> {
  return {
    datasetId: source ? source.datasetId : null,
    value: source ? source.value : aggregate.value,
    coverage: source ? source.coverage : aggregate.coverage,
    reason: source ? source.reason : aggregate.reason,
    loadedAt: source ? source.loadedAt : null,
    sourceVintage: source ? source.sourceVintage : null,
  };
}

function toReport(row: Record<string, unknown>): LifelineAssessmentReport {
  return {
    id: row.id as string,
    incidentId: row.incident_id as string,
    lifeline: row.definition_key as string,
    definitionVersion: row.definition_version as number,
    condition: row.condition as string,
    assessedAt: new Date(row.assessed_at as Date | string).toISOString(),
    sourceKind: row.source_kind as "native" | "legacy_board",
    legacyStatus: (row.legacy_status as string | null) ?? null,
    payload: row.payload as Record<string, unknown>,
    stabilizationObjective: (row.stabilization_objective as string | null) ?? null,
    nextUpdateAt: row.next_update_at ? new Date(row.next_update_at as Date | string).toISOString() : null,
    supersedesAssessmentId: (row.supersedes_id as string | null) ?? null,
    legacyBoardId: (row.legacy_board_id as string | null) ?? null,
    legacyRecordId: (row.legacy_record_id as string | null) ?? null,
    attribution: attribution(row),
  };
}

async function readableRows(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const readableByBoard = new Map<string, Set<string>>();
  for (const boardId of new Set(rows.flatMap((row) =>
    row.legacy_board_id ? [row.legacy_board_id as string] : []))) {
    const board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
    readableByBoard.set(boardId, new Set(visibleFields(board).map((field) => field.key)));
  }
  return rows.flatMap((row) => {
    if (row.source_kind !== "legacy_board") return [row];
    const readable = readableByBoard.get(row.legacy_board_id as string)!;
    if (!readable.has("lifeline")) return [];
    const payload = row.payload as Record<string, unknown>;
    const legacy = payload.legacyData as Record<string, unknown> | undefined;
    const legacyData = legacy
      ? Object.fromEntries(Object.entries(legacy).filter(([key]) => readable.has(key)))
      : {};
    return [{
      ...row,
      condition: readable.has("status") ? row.condition : "unknown",
      payload: {
        ...payload,
        legacyData,
        impactStatement: readable.has("note") ? payload.impactStatement : null,
      },
    }];
  });
}

async function snapshotImpactEvidence(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  evidence: CreateLifelineAssessment["evidence"],
): Promise<readonly Record<string, unknown>[]> {
  const cache = new Map<number | undefined, Awaited<ReturnType<typeof getIncidentImpact>>>();
  const snapshots: Record<string, unknown>[] = [];
  for (const item of evidence) {
    if (item.kind === "reported") {
      snapshots.push(item);
      continue;
    }
    let analysis = cache.get(item.areaRevision);
    if (!analysis) {
      analysis = await getIncidentImpact(sql, actor, incidentId, item.areaRevision);
      cache.set(item.areaRevision, analysis);
    }
    if (analysis.impact.areaRevision === null) {
      throw new AuthError(409, "impact evidence requires an incident area revision");
    }
    const aggregate = analysis.impact.categories[item.category];
    const source = item.datasetId
      ? aggregate.sources.find((candidate) => candidate.datasetId === item.datasetId)
      : undefined;
    if (item.datasetId && !source) {
      throw new AuthError(400, "impact dataset is not a selected source for this category");
    }
    snapshots.push({
      kind: "impact",
      category: item.category,
      areaRevision: analysis.impact.areaRevision,
      ...selectedImpactEvidenceFields(aggregate, source),
      sources: source ? [source] : aggregate.sources,
      capturedAt: new Date().toISOString(),
      interpretation: "exposure evidence only; it does not determine lifeline condition",
    });
  }
  return snapshots;
}

export async function createLifelineAssessment(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: CreateLifelineAssessment,
): Promise<LifelineAssessmentReport> {
  const context = await requireAssessmentWrite(sql, actor, incidentId);
  await validateSupersedes(sql, incidentId, identity(input.lifeline), input.supersedesAssessmentId);
  const evidenceOrganizations = input.evidence.flatMap((item) =>
    item.kind === "reported" && item.sourceOrganizationId ? [item.sourceOrganizationId] : []);
  await validateOrganizations(sql, incidentId, [
    ...input.responsibleOrganizationIds, ...evidenceOrganizations,
  ]);
  const actions = await resolveAssessmentActions(
    sql, actor, incidentId, context.homeOrganizationId, input.actions,
  );
  const evidence = await snapshotImpactEvidence(sql, actor, incidentId, input.evidence);
  const payload = {
    confidence: input.confidence,
    impactStatement: input.impactStatement,
    operationalPeriod: input.operationalPeriod ?? null,
    stabilizationOutlook: input.stabilizationOutlook ?? null,
    components: input.components,
    evidence,
    responsibleOrganizationIds: input.responsibleOrganizationIds,
    actions,
  };
  const [created] = await sql`
    insert into operational_assessments
      (domain, jurisdiction_id, incident_id, framework, definition_key,
       definition_version, condition, payload, assessed_at, source_kind,
       supersedes_id, created_by, position_id, position_title, participation_id,
       home_organization_id, stabilization_objective, next_update_at)
    values ('lifeline', ${context.jurisdictionId}, ${incidentId},
      'fema_community_lifelines', ${input.lifeline}, ${input.definitionVersion},
      ${input.condition}, ${sql.json(payload as never)}, ${new Date(input.assessedAt)},
      'native', ${input.supersedesAssessmentId ?? null}, ${actor.person.id},
      ${context.positionId}, ${context.positionTitle}, ${context.participationId},
      ${context.homeOrganizationId}, ${input.stabilizationObjective ?? null},
      ${input.nextUpdateAt ? new Date(input.nextUpdateAt) : null}) returning id`;
  const [row] = await sql.unsafe(
    `${assessmentSelect} where a.id = $1`, [created!.id as string],
  );
  return toReport(row!);
}

export async function listLifelineAssessmentHistory(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  lifeline: string,
): Promise<readonly LifelineAssessmentReport[]> {
  await requireAssessmentRead(sql, actor, incidentId);
  const rows = await sql.unsafe(
    `${assessmentSelect} where a.incident_id = $1 and a.domain = 'lifeline'
      and a.framework = 'fema_community_lifelines' and a.definition_key = $2
      order by a.assessed_at desc, a.created_at desc, a.id desc`,
    [incidentId, lifeline],
  );
  return (await readableRows(sql, actor, incidentId, rows)).map(toReport);
}

export async function listCurrentLifelineAssessments(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<readonly LifelineCurrentState[]> {
  await requireAssessmentRead(sql, actor, incidentId);
  const reports = await sql.unsafe(
    `${assessmentSelect} where a.incident_id = $1 and a.domain = 'lifeline'
      and not exists (select 1 from operational_assessments child where child.supersedes_id = a.id)
      order by a.definition_key, a.assessed_at desc, a.created_at desc, a.id desc`,
    [incidentId],
  );
  const visibleReports = await readableRows(sql, actor, incidentId, reports);
  const decisions = await sql.unsafe(
    `${decisionSelect} where d.incident_id = $1 and d.domain = 'lifeline'
      and not exists (select 1 from operational_assessment_decisions newer
        where newer.incident_id = d.incident_id and newer.domain = d.domain
          and newer.framework = d.framework and newer.definition_key = d.definition_key
          and (newer.created_at, newer.id) > (d.created_at, d.id))`,
    [incidentId],
  );
  return COMMUNITY_LIFELINES.values.map((lifeline) => {
    const current = visibleReports
      .filter((row) => row.definition_key === lifeline)
      .map(toReport);
    const conditions = new Set(current.map((report) => report.condition));
    const decisionRow = decisions.find((row) => row.definition_key === lifeline);
    const selected = decisionRow
      ? current.find((report) => report.id === decisionRow.selected_assessment_id)
      : undefined;
    return {
      lifeline,
      condition: selected?.condition ?? (conditions.size === 1 ? current[0]!.condition : null),
      conflict: conditions.size > 1,
      reports: current,
      decision: selected && decisionRow ? {
        id: decisionRow.id as string,
        selectedAssessmentId: decisionRow.selected_assessment_id as string,
        rationale: decisionRow.rationale as string,
        attribution: attribution(decisionRow),
      } : null,
    };
  });
}

export async function decideLifelineAssessment(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  lifeline: string,
  input: AssessmentDecisionInput,
): Promise<{ id: string }> {
  return { id: await recordDecision(sql, actor, incidentId, identity(lifeline), input) };
}
