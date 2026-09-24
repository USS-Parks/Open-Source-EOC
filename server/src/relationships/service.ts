import { deriveRecordValues, type IapDocument, type OperationalRelationship, type OperationalRelationshipCreate, type OperationalRelationshipTarget } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { CURSOR_AT_FORMAT, DEFAULT_PAGE_LIMIT, cutPage, decodeCursor, type Page, type PageRequest } from "../db/cursor.js";
import { getIncidentBoardReadShape, visibleFields } from "../boards/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";
import { requireAssessmentWrite } from "../lifelines/assessment-common.js";
import { recordAudit } from "../audit/service.js";

type Row = Record<string, unknown>;

function iapObjectives(content: IapDocument): readonly string[] {
  const form = content.forms.find((item) => item.id === "ICS-202");
  const section = form?.sections.find((item) => item.heading === "Objectives");
  return section?.lines?.filter((item): item is string => typeof item === "string") ?? [];
}

const LABEL_KEYS = ["name", "title", "summary", "item", "headline", "road", "entry", "observation", "public_label"] as const;

async function target(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  row: Row,
): Promise<OperationalRelationshipTarget> {
  switch (row.target_kind) {
    case "task": return { kind: "task", taskId: row.target_id as string };
    case "resource_request": return { kind: "resource_request", resourceRequestId: row.target_id as string };
    case "board_record": {
      const boardId = row.target_board_id as string;
      const board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
      const fields = visibleFields(board);
      const values = deriveRecordValues(board.fields, row.target_board_data as Record<string, unknown>);
      const labelField = fields.find((field) => LABEL_KEYS.includes(field.key as typeof LABEL_KEYS[number])
        && (typeof values[field.key] === "string" || typeof values[field.key] === "number"))
        ?? fields.find((field) => typeof values[field.key] === "string" || typeof values[field.key] === "number");
      const value = labelField ? values[labelField.key] : undefined;
      return {
        kind: "board_record",
        boardRecordId: row.target_id as string,
        boardId,
        boardTitle: board.title,
        label: value === undefined ? board.title : String(value),
      };
    }
    case "map_feature": return { kind: "map_feature", datasetId: row.target_dataset_id as string, featureId: row.target_feature_id as string };
    case "iap_objective": return {
      kind: "iap_objective",
      iapId: row.target_iap_id as string,
      contentRevision: Number(row.target_iap_content_revision),
      objectiveIndex: Number(row.target_objective_index),
      objectiveLabel: row.target_iap_objective_label as string,
      operationalPeriod: row.target_iap_operational_period as string,
    };
    default: throw new Error("unknown operational relationship target");
  }
}

async function toRelationship(sql: Sql, actor: Principal, incidentId: string, row: Row): Promise<OperationalRelationship> {
  const relationTarget = await target(sql, actor, incidentId, row);
  return {
    id: row.id as string, incidentId: row.incident_id as string,
    source: { domain: row.source_domain as "lifeline" | "esf", framework: row.source_framework as string, definitionKey: row.source_definition_key as string },
    target: relationTarget,
    targetState: relationTarget.kind === "iap_objective" && Number(row.current_iap_content_revision) !== relationTarget.contentRevision ? "stale" : "available",
    attribution: { personId: row.created_by as string, personName: row.person_name as string, organizationId: row.organization_id as string, organizationName: row.organization_name as string, positionId: row.position_id as string | null, positionTitle: row.position_title as string | null, participationId: row.participation_id as string | null, recordedAt: new Date(row.created_at as Date | string).toISOString() },
  };
}

async function validateSource(sql: Sql, incidentId: string, source: OperationalRelationshipCreate["source"]): Promise<void> {
  const [row] = await sql`select id from operational_assessments where incident_id = ${incidentId}
    and domain = ${source.domain} and framework = ${source.framework} and definition_key = ${source.definitionKey} limit 1`;
  if (!row) throw new AuthError(400, "relationship source has no assessment in this incident");
}

async function validateTarget(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  value: OperationalRelationshipCreate["target"],
): Promise<OperationalRelationshipTarget> {
  if (value.kind === "task") {
    const [row] = await sql`select id from checklist_items where id = ${value.taskId} and incident_id = ${incidentId}`;
    if (!row) throw new AuthError(400, "linked task is not attached to this incident");
    return value;
  } else if (value.kind === "resource_request") {
    const [row] = await sql`select id from resource_requests where id = ${value.resourceRequestId} and incident_id = ${incidentId}`;
    if (!row) throw new AuthError(400, "linked resource request is not attached to this incident");
    return value;
  } else if (value.kind === "board_record") {
    const [row] = await sql`select id, board_id, data from board_records where id = ${value.boardRecordId} and incident_id = ${incidentId}`;
    if (!row) throw new AuthError(400, "linked board record is not attached to this incident");
    return target(sql, actor, incidentId, {
      target_kind: value.kind,
      target_id: row.id,
      target_board_id: row.board_id,
      target_board_data: row.data,
    });
  } else if (value.kind === "map_feature") {
    const [row] = await sql`select source_id from data_pack_items where incident_id = ${incidentId}
      and dataset_id = ${value.datasetId} and source_id = ${value.featureId}`;
    if (!row) throw new AuthError(400, "linked map feature is not attached to this incident");
    return value;
  } else {
    const [row] = await sql`select content_revision, content, operational_period
      from iaps where id = ${value.iapId} and incident_id = ${incidentId}`;
    const objective = row ? iapObjectives(row.content as IapDocument)[value.objectiveIndex] : undefined;
    if (!row || Number(row.content_revision) !== value.contentRevision || !objective?.trim()) {
      throw new AuthError(400, "linked planning objective is not current in this incident IAP revision");
    }
    return {
      ...value,
      objectiveLabel: objective.trim(),
      operationalPeriod: row.operational_period as string,
    };
  }
}

export async function createOperationalRelationship(sql: Sql, actor: Principal, incidentId: string, input: OperationalRelationshipCreate): Promise<OperationalRelationship> {
  const context = await requireAssessmentWrite(sql, actor, incidentId);
  await validateSource(sql, incidentId, input.source);
  const resolvedTarget = await validateTarget(sql, actor, incidentId, input.target);
  const targetId = input.target.kind === "task" ? input.target.taskId : input.target.kind === "resource_request" ? input.target.resourceRequestId : input.target.kind === "board_record" ? input.target.boardRecordId : null;
  const [created] = await sql`insert into operational_relationships (incident_id, source_domain, source_framework, source_definition_key, target_kind, target_id, target_dataset_id, target_feature_id, target_iap_id, target_iap_content_revision, target_objective_index, target_iap_objective_label, target_iap_operational_period, created_by, organization_id, position_id, position_title, participation_id)
    values (${incidentId}, ${input.source.domain}, ${input.source.framework}, ${input.source.definitionKey}, ${input.target.kind}, ${targetId}, ${input.target.kind === "map_feature" ? input.target.datasetId : null}, ${input.target.kind === "map_feature" ? input.target.featureId : null}, ${resolvedTarget.kind === "iap_objective" ? resolvedTarget.iapId : null}, ${resolvedTarget.kind === "iap_objective" ? resolvedTarget.contentRevision : null}, ${resolvedTarget.kind === "iap_objective" ? resolvedTarget.objectiveIndex : null}, ${resolvedTarget.kind === "iap_objective" ? resolvedTarget.objectiveLabel : null}, ${resolvedTarget.kind === "iap_objective" ? resolvedTarget.operationalPeriod : null}, ${actor.person.id}, ${context.homeOrganizationId}, ${context.positionId}, ${context.positionTitle}, ${context.participationId})
    returning id`.catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new AuthError(409, "this relationship is already recorded");
    throw error;
  });
  const [row] = await sql`select r.*, p.display_name as person_name, j.name as organization_name,
    i.id as target_iap_visible_id, i.content_revision as current_iap_content_revision, br.board_id as target_board_id,
    br.data as target_board_data from operational_relationships r
    join persons p on p.id = r.created_by join jurisdictions j on j.id = r.organization_id
    left join iaps i on i.id = r.target_iap_id
    left join board_records br on r.target_kind = 'board_record' and br.id = r.target_id
    where r.id = ${created!.id as string}`;
  const relationship = await toRelationship(sql, actor, incidentId, row! as Row);
  await recordAudit(sql, actor, { jurisdictionId: context.jurisdictionId, incidentId, category: "operational.relationship.created", subjectTable: "operational_relationships", subjectId: relationship.id, payload: { source: relationship.source, target: relationship.target } });
  return relationship;
}

export async function listOperationalRelationships(sql: Sql, actor: Principal, incidentId: string, page: PageRequest): Promise<Page<OperationalRelationship>> {
  await getIncidentAuthority(sql, actor, incidentId);
  const after = decodeCursor(page.cursor, ["at", "id"]);
  const limit = page.limit ?? DEFAULT_PAGE_LIMIT;
  // An IAP objective link shows only while the caller can read its IAP.
  const rows = await sql`select r.*, p.display_name as person_name, j.name as organization_name,
    i.content_revision as current_iap_content_revision, br.board_id as target_board_id,
    br.data as target_board_data, to_char(r.created_at at time zone 'UTC', ${CURSOR_AT_FORMAT}) as page_at
    from operational_relationships r join persons p on p.id = r.created_by join jurisdictions j on j.id = r.organization_id
    left join iaps i on i.id = r.target_iap_id
    left join board_records br on r.target_kind = 'board_record' and br.id = r.target_id
    where r.incident_id = ${incidentId} and (r.target_kind <> 'iap_objective' or i.id is not null)
      ${after ? sql`and (r.created_at, r.id) < (${after[0]!}::text::timestamptz, ${after[1]!}::uuid)` : sql``}
    order by r.created_at desc, r.id desc limit ${limit + 1}`;
  const { items, nextCursor } = cutPage(rows as Row[], limit, (row) => [row.page_at as string, row.id as string]);
  return { items: await Promise.all(items.map((row) => toRelationship(sql, actor, incidentId, row))), nextCursor };
}
