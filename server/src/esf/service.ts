import type {
  AssessmentDecisionInput,
  CreateEsfAssessment,
  EsfAssessmentReport,
  EsfCurrentState,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import type { Principal } from "../auth/service.js";
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
} from "../lifelines/assessment-common.js";

const identity = (framework: "federal" | "california", esf: string) => ({
  domain: "esf" as const,
  framework,
  definitionKey: esf,
});

function toReport(row: Record<string, unknown>): EsfAssessmentReport {
  return {
    id: row.id as string,
    incidentId: row.incident_id as string,
    framework: row.framework as "federal" | "california",
    esf: row.definition_key as string,
    definitionVersion: row.definition_version as number,
    activation: row.activation as string,
    capacity: row.capacity as string,
    legacyStatus: (row.legacy_status as string | null) ?? null,
    assessedAt: new Date(row.assessed_at as Date | string).toISOString(),
    sourceKind: row.source_kind as "native" | "legacy_board",
    payload: row.payload as Record<string, unknown>,
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
    if (!readable.has("esf")) return [];
    const payload = row.payload as Record<string, unknown>;
    const legacy = payload.legacyData as Record<string, unknown> | undefined;
    const legacyData = legacy
      ? Object.fromEntries(Object.entries(legacy).filter(([key]) => readable.has(key)))
      : {};
    const safePayload = Object.fromEntries(
      Object.entries(payload).filter(([key]) => key !== "impactStatement"),
    );
    return [{
      ...row,
      activation: "unknown",
      capacity: "unknown",
      legacy_status: readable.has("status") ? row.legacy_status : null,
      payload: {
        ...safePayload,
        legacyData,
        situation: readable.has("note") ? payload.situation : null,
      },
    }];
  });
}

export async function createEsfAssessment(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: CreateEsfAssessment,
): Promise<EsfAssessmentReport> {
  const { framework, esf, definitionVersion } = input.identity;
  const context = await requireAssessmentWrite(sql, actor, incidentId);
  await validateSupersedes(
    sql, incidentId, identity(framework, esf), input.supersedesAssessmentId,
  );
  const organizationIds = [
    ...(input.coordinatorOrganizationId ? [input.coordinatorOrganizationId] : []),
    ...input.supportingOrganizationIds,
    ...input.evidence.flatMap((item) =>
      item.sourceOrganizationId ? [item.sourceOrganizationId] : []),
  ];
  await validateOrganizations(sql, incidentId, organizationIds);
  const actions = await resolveAssessmentActions(
    sql, actor, incidentId, context.jurisdictionId, input.actions,
  );
  const payload = {
    confidence: input.confidence,
    situation: input.situation,
    operationalPeriod: input.operationalPeriod ?? null,
    coordinatorOrganizationId: input.coordinatorOrganizationId ?? null,
    supportingOrganizationIds: input.supportingOrganizationIds,
    missions: input.missions,
    priorities: input.priorities,
    evidence: input.evidence,
    relatedLifelines: input.relatedLifelines,
    actions,
  };
  const [created] = await sql`
    insert into operational_assessments
      (domain, jurisdiction_id, incident_id, framework, definition_key,
       definition_version, activation, capacity, payload, assessed_at, source_kind,
       supersedes_id, created_by, position_id, position_title, participation_id,
       home_organization_id)
    values ('esf', ${context.jurisdictionId}, ${incidentId}, ${framework}, ${esf},
      ${definitionVersion}, ${input.activation}, ${input.capacity},
      ${sql.json(payload as never)}, ${new Date(input.assessedAt)}, 'native',
      ${input.supersedesAssessmentId ?? null}, ${actor.person.id},
      ${context.positionId}, ${context.positionTitle}, ${context.participationId},
      ${context.homeOrganizationId}) returning id`;
  const [row] = await sql.unsafe(
    `${assessmentSelect} where a.id = $1`, [created!.id as string],
  );
  return toReport(row!);
}

export async function listEsfAssessmentHistory(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  framework: "federal" | "california",
  esf: string,
): Promise<readonly EsfAssessmentReport[]> {
  await requireAssessmentRead(sql, actor, incidentId);
  const rows = await sql.unsafe(
    `${assessmentSelect} where a.incident_id = $1 and a.domain = 'esf'
      and a.framework = $2 and a.definition_key = $3
      order by a.assessed_at desc, a.created_at desc, a.id desc`,
    [incidentId, framework, esf],
  );
  return (await readableRows(sql, actor, incidentId, rows)).map(toReport);
}

export async function listCurrentEsfAssessments(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<readonly EsfCurrentState[]> {
  await requireAssessmentRead(sql, actor, incidentId);
  const reports = await sql.unsafe(
    `${assessmentSelect} where a.incident_id = $1 and a.domain = 'esf'
      and not exists (select 1 from operational_assessments child where child.supersedes_id = a.id)
      order by a.framework, a.definition_key, a.assessed_at desc, a.created_at desc, a.id desc`,
    [incidentId],
  );
  const visibleReports = await readableRows(sql, actor, incidentId, reports);
  const decisions = await sql.unsafe(
    `${decisionSelect} where d.incident_id = $1 and d.domain = 'esf'
      and not exists (select 1 from operational_assessment_decisions newer
        where newer.incident_id = d.incident_id and newer.domain = d.domain
          and newer.framework = d.framework and newer.definition_key = d.definition_key
          and (newer.created_at, newer.id) > (d.created_at, d.id))`,
    [incidentId],
  );
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of visibleReports) {
    const key = `${row.framework as string}:${row.definition_key as string}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, rows]) => {
    const current = rows.map(toReport);
    const [framework, esf] = key.split(":") as ["federal" | "california", string];
    const activations = new Set(current.map((report) => report.activation));
    const capacities = new Set(current.map((report) => report.capacity));
    const decisionRow = decisions.find((row) =>
      row.framework === framework && row.definition_key === esf);
    const selected = decisionRow
      ? current.find((report) => report.id === decisionRow.selected_assessment_id)
      : undefined;
    return {
      framework,
      esf,
      activation: selected?.activation ?? (activations.size === 1 ? current[0]!.activation : null),
      capacity: selected?.capacity ?? (capacities.size === 1 ? current[0]!.capacity : null),
      conflict: activations.size > 1 || capacities.size > 1,
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

export async function decideEsfAssessment(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  framework: "federal" | "california",
  esf: string,
  input: AssessmentDecisionInput,
): Promise<{ id: string }> {
  return { id: await recordDecision(sql, actor, incidentId, identity(framework, esf), input) };
}
