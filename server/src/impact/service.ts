import {
  COMMUNITY_LIFELINES,
  IMPACT_CATEGORIES,
  type ImpactCategory,
  type ImpactCategoryAggregate,
  type ImpactCategoryDelta,
  type ImpactContributionPage,
  type ImpactLifelineReport,
  type ImpactSourceAggregate,
  type ImpactSourceDelta,
  type IncidentImpactAnalysis,
  type IncidentImpactComparison,
  type IncidentImpactResponse,
  type ViewportBbox,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";
import { getIncidentBoardReadShape, visibleFields } from "../boards/service.js";
import { computeSpatialImpact } from "./spatial.js";
import { analysisArea } from "./bbox.js";

const LIFELINE_INTERPRETATION =
  "reported incident status only; geographic exposure does not imply lifeline failure" as const;
const BASELINE_STATEMENT =
  "both revisions use the current selected dataset registrations and loaded records; this is not a historical baseline snapshot" as const;

async function authorizedImpact(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  revision: number | undefined,
  bbox?: ViewportBbox,
): Promise<IncidentImpactResponse> {
  await getIncidentAuthority(sql, actor, incidentId);
  const impact = await computeSpatialImpact(sql, incidentId, revision, undefined, undefined, bbox);
  if (revision !== undefined && impact.areaRevision === null)
    throw new AuthError(404, "impact revision not found");
  return impact;
}

async function incidentLifelines(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<ImpactLifelineReport[]> {
  const rows = await sql`
    select lifeline, status, note, record_id, board_id, reported_at,
           person_id, person_name, position_id, position_title
    from (
      select r.data->>'lifeline' as lifeline, r.data->>'status' as status,
             r.data->>'note' as note, r.id as record_id, r.board_id,
             coalesce(r.updated_at, r.created_at) as reported_at,
             coalesce(r.updated_by, r.created_by) as person_id,
             p.display_name as person_name,
             case when r.updated_by is null then r.created_by_position else null end as position_id,
             pos.title as position_title,
             row_number() over (
               partition by r.data->>'lifeline'
               order by coalesce(r.updated_at, r.created_at) desc, r.id desc
             ) as rn
      from board_records r
      join incident_boards ib on ib.board_id = r.board_id and ib.incident_id = r.incident_id
      join boards b on b.id = r.board_id and b.template_key = 'lifelines'
      join persons p on p.id = coalesce(r.updated_by, r.created_by)
      left join positions pos on pos.id =
        case when r.updated_by is null then r.created_by_position else null end
      where r.incident_id = ${incidentId} and r.data ? 'lifeline'
    ) latest where rn = 1`;
  const readableByBoard = new Map<string, Set<string>>();
  for (const boardId of new Set(rows.map((row) => row.board_id as string))) {
    const board = await getIncidentBoardReadShape(sql, actor, incidentId, boardId);
    readableByBoard.set(boardId, new Set(visibleFields(board).map((field) => field.key)));
  }
  const byLifeline = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const readable = readableByBoard.get(row.board_id as string)!;
    if (readable.has("lifeline")) byLifeline.set(row.lifeline as string, row);
  }
  return COMMUNITY_LIFELINES.values.map((lifeline) => {
    const row = byLifeline.get(lifeline);
    if (!row) {
      return { lifeline, status: "unknown", note: null, reportedAt: null,
        recordId: null, boardId: null, reportedBy: null };
    }
    return {
      lifeline,
      status: readableByBoard.get(row.board_id as string)!.has("status")
        ? row.status as string
        : "unknown",
      note: readableByBoard.get(row.board_id as string)!.has("note")
        ? ((row.note as string | null) ?? null)
        : null,
      reportedAt: new Date(row.reported_at as Date | string).toISOString(),
      recordId: row.record_id as string,
      boardId: row.board_id as string,
      reportedBy: {
        personId: row.person_id as string,
        personName: row.person_name as string,
        positionId: (row.position_id as string | null) ?? null,
        positionTitle: (row.position_title as string | null) ?? null,
      },
    };
  });
}

export async function getIncidentImpact(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  revision?: number,
  bbox?: ViewportBbox,
): Promise<IncidentImpactAnalysis> {
  const impact = await authorizedImpact(sql, actor, incidentId, revision, bbox);
  return {
    impact,
    lifelines: await incidentLifelines(sql, actor, incidentId),
    lifelineInterpretation: LIFELINE_INTERPRETATION,
  };
}

function comparableSource(source: ImpactSourceAggregate | undefined): source is ImpactSourceAggregate {
  return source !== undefined && source.datasetId !== null && source.value !== null &&
    source.availability === "available" && source.coverage === "complete" && source.reason === null;
}

function explainDelta(label: string, from: number | null, to: number | null, delta: number | null): string {
  if (delta === null) return `${label} cannot be compared because one or both revisions are unknown`;
  if (delta === 0) return `${label} exposure is unchanged`;
  return delta > 0 ? `${label} exposure increased by ${delta}` : `${label} exposure decreased by ${Math.abs(delta)}`;
}

function sourceDeltas(
  category: ImpactCategoryAggregate,
  next: ImpactCategoryAggregate,
): ImpactSourceDelta[] {
  const keys = new Set([
    ...category.sources.map((source) => source.catalogSourceId),
    ...next.sources.map((source) => source.catalogSourceId),
  ]);
  return [...keys].sort().map((catalogSourceId) => {
    const from = category.sources.find((source) => source.catalogSourceId === catalogSourceId);
    const to = next.sources.find((source) => source.catalogSourceId === catalogSourceId);
    const comparable = comparableSource(from) && comparableSource(to) && from.datasetId === to.datasetId;
    const fromValue = from?.value ?? null;
    const toValue = to?.value ?? null;
    const delta = comparable ? to.value! - from.value! : null;
    const name = to?.datasetName ?? from?.datasetName ?? catalogSourceId;
    return {
      catalogSourceId,
      datasetId: to?.datasetId ?? from?.datasetId ?? null,
      datasetName: name,
      unit: category.unit,
      fromValue,
      toValue,
      delta,
      explanation: explainDelta(name, fromValue, toValue, delta),
    };
  });
}

function categoryDelta(
  category: ImpactCategory,
  from: ImpactCategoryAggregate,
  to: ImpactCategoryAggregate,
): ImpactCategoryDelta {
  const delta = from.value !== null && to.value !== null ? to.value - from.value : null;
  return {
    category,
    unit: from.unit,
    fromValue: from.value,
    toValue: to.value,
    delta,
    explanation: explainDelta(category, from.value, to.value, delta),
    sources: sourceDeltas(from, to),
  };
}

export async function compareIncidentImpact(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  fromRevision: number,
  toRevision?: number,
  bbox?: ViewportBbox,
): Promise<IncidentImpactComparison> {
  await getIncidentAuthority(sql, actor, incidentId);
  const from = await computeSpatialImpact(sql, incidentId, fromRevision, undefined, undefined, bbox);
  const to = await computeSpatialImpact(sql, incidentId, toRevision, undefined, undefined, bbox);
  if (from.areaRevision === null || to.areaRevision === null)
    throw new AuthError(404, "impact revision not found");
  const categories = {} as Record<ImpactCategory, ImpactCategoryDelta>;
  for (const category of IMPACT_CATEGORIES)
    categories[category] = categoryDelta(category, from.categories[category], to.categories[category]);
  return {
    incidentId,
    scope: from.scope!,
    fromRevision: from.areaRevision,
    toRevision: to.areaRevision,
    baselineStatement: BASELINE_STATEMENT,
    categories,
  };
}

function selectedSource(
  impact: IncidentImpactResponse,
  datasetId: string,
): { category: ImpactCategory; source: ImpactSourceAggregate } | null {
  for (const category of IMPACT_CATEGORIES) {
    const source = impact.categories[category].sources.find((candidate) => candidate.datasetId === datasetId);
    if (source) return { category, source };
  }
  return null;
}

export async function listImpactContributions(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  datasetId: string,
  revision: number | undefined,
  cursor: string | undefined,
  limit: number,
  bbox?: ViewportBbox,
): Promise<ImpactContributionPage> {
  const impact = await authorizedImpact(sql, actor, incidentId, revision, bbox);
  if (impact.areaRevision === null || !impact.areaGeometryAvailable)
    throw new AuthError(409, "incident impact area is unavailable");
  const selected = selectedSource(impact, datasetId);
  if (!selected) throw new AuthError(404, "impact source not found");
  const population = selected.category === "population";
  const rows = await sql`
    with area as (
      select ${analysisArea(sql, bbox)} as geometry from incident_area_revisions
      where incident_id = ${incidentId} and revision = ${impact.areaRevision}
    )
    select i.source_id, i.data, ST_AsGeoJSON(i.geom)::jsonb as geometry,
      case when ${population} then
        case when ST_Within(i.geom, a.geometry) then (i.data->>'category')::numeric
          else (i.data->>'category')::numeric
            * ST_Area(ST_Intersection(i.geom, a.geometry)::geography)
            / ST_Area(i.geom::geography) end
        else 1 end::double precision as contribution
    from data_pack_items i cross join area a
    where i.dataset_id = ${datasetId} and i.incident_id = ${incidentId}
      and (${cursor ?? null}::text is null or i.source_id > ${cursor ?? null})
      and (
        (${population} = false and i.geom is not null and ST_Intersects(i.geom, a.geometry))
        or (${population} = true
          and GeometryType(i.geom) in ('POLYGON', 'MULTIPOLYGON')
          and ST_Area(i.geom::geography) > 0
          and i.data->>'category' ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
          and ST_Intersects(i.geom, a.geometry)
          and ST_Area(ST_Intersection(i.geom, a.geometry)::geography) > 0)
      )
    order by i.source_id
    limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  return {
    incidentId,
    scope: impact.scope!,
    areaRevision: impact.areaRevision,
    category: selected.category,
    source: selected.source,
    records: page.map((row) => ({
      sourceId: row.source_id as string,
      data: row.data as Record<string, unknown>,
      geometry: row.geometry,
      value: Number(row.contribution),
    })),
    nextCursor: rows.length > limit ? (page.at(-1)!.source_id as string) : null,
  };
}
