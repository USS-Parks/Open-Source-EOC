import {
  CALIFORNIA_CATALOG,
  datasetAvailability,
  type CatalogCategory,
  type CatalogSource,
  type DatasetAvailability,
  type ImpactAvailability,
  type ImpactCategory,
  type ImpactCategoryAggregate,
  type ImpactCoverage,
  type ImpactSourceAggregate,
  type ImpactUnit,
  type IncidentImpactResponse,
  type ViewportBbox,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { analysisArea, spatialScope } from "./bbox.js";

const CATEGORY_MAP: Readonly<Record<ImpactCategory, readonly CatalogCategory[]>> = {
  structures_parcels: ["parcels_buildings"],
  infrastructure_facilities: ["critical_facilities", "lifelines"],
  shelters: ["shelters"],
  closures: ["roads_closures"],
  population: ["population"],
};

const METHOD = {
  spatialPredicate: "ST_Intersects",
  populationEstimate:
    "source population multiplied by intersected polygon geography area divided by source polygon geography area",
  populationDenominator: "source polygon geography area in square metres",
  overlapDeduplication:
    "distinct source_id within one selected dataset; cross-source identities are not assumed equivalent",
} as const;

interface DatasetRow {
  id: string;
  key: string;
  name: string;
  last_success_at: Date | string | null;
  last_error: string | null;
  stale_after_seconds: number;
  created_at: Date | string;
}

interface ObservedAggregate {
  coverage: ImpactCoverage;
  value: number | null;
  contributingRecords: number;
  loadedAt: string | null;
  sourceVintage: string | null;
  reason: string | null;
}

function canonicalDatasetKey(source: CatalogSource): string {
  return source.id.replace(/-/g, "_");
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function validVintage(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function units(category: ImpactCategory): ImpactUnit {
  return category === "population" ? "people" : "records";
}

function blankCategory(category: ImpactCategory, reason: string): ImpactCategoryAggregate {
  return {
    category,
    unit: units(category),
    availability: "awaiting",
    value: null,
    coverage: "unknown",
    reason,
    sources: [],
  };
}

function blankResponse(
  incidentId: string,
  areaRevision: number | null,
  reason: string,
  bbox?: ViewportBbox,
): IncidentImpactResponse {
  return {
    incidentId,
    scope: spatialScope(bbox),
    areaRevision,
    areaGeometryAvailable: false,
    categories: {
      structures_parcels: blankCategory("structures_parcels", reason),
      infrastructure_facilities: blankCategory("infrastructure_facilities", reason),
      shelters: blankCategory("shelters", reason),
      closures: blankCategory("closures", reason),
      population: blankCategory("population", reason),
    },
    method: METHOD,
  };
}

function newestSuccessful(rows: readonly DatasetRow[]): DatasetRow | null {
  const successful = rows.filter((row) => row.last_success_at !== null);
  successful.sort((a, b) => {
    const success = new Date(b.last_success_at!).getTime() - new Date(a.last_success_at!).getTime();
    if (success !== 0) return success;
    const created = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return created !== 0 ? created : b.id.localeCompare(a.id);
  });
  return successful[0] ?? null;
}

async function observeDataset(
  sql: Sql,
  datasetId: string,
  incidentId: string,
  revision: number,
  category: ImpactCategory,
  bbox: ViewportBbox | undefined,
): Promise<ObservedAggregate> {
  const [row] = await sql`
    with area as (
      select geometry as incident_geometry, ${analysisArea(sql, bbox)} as geometry
      from incident_area_revisions
      where incident_id = ${incidentId} and revision = ${revision}
    ), source as (
      select d.coverage, i.source_id, i.data, i.geom, i.last_loaded_at
      from data_pack_datasets d
      left join data_pack_items i on i.dataset_id = d.id
      where d.id = ${datasetId}
    )
    select
      case
        when bool_and(s.coverage is null) then 'unknown'
        when ST_IsEmpty(a.geometry)
          and bool_or(ST_Covers(s.coverage, a.incident_geometry)) then 'complete'
        when bool_or(ST_Covers(s.coverage, a.geometry)) then 'complete'
        when bool_or(ST_Intersects(s.coverage, a.geometry)) then 'partial'
        else 'none'
      end as coverage,
      count(distinct s.source_id)::integer as total_records,
      count(distinct s.source_id) filter (where s.geom is not null)::integer as spatial_records,
      count(distinct s.source_id) filter (
        where s.geom is not null and ST_Intersects(s.geom, a.geometry)
      )::integer as affected_records,
      count(distinct s.source_id) filter (
        where GeometryType(s.geom) in ('POLYGON', 'MULTIPOLYGON')
          and ST_Area(s.geom::geography) > 0
          and s.data->>'category' ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
      )::integer as population_records,
      count(distinct s.source_id) filter (
        where GeometryType(s.geom) in ('POLYGON', 'MULTIPOLYGON')
          and ST_Area(s.geom::geography) > 0
          and s.data->>'category' ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
          and ST_Intersects(s.geom, a.geometry)
          and ST_Area(ST_Intersection(s.geom, a.geometry)::geography) > 0
      )::integer as population_contributing,
      coalesce(sum(
        case when GeometryType(s.geom) in ('POLYGON', 'MULTIPOLYGON')
          and ST_Area(s.geom::geography) > 0
          and s.data->>'category' ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
          and ST_Within(s.geom, a.geometry)
        then (s.data->>'category')::numeric
        when GeometryType(s.geom) in ('POLYGON', 'MULTIPOLYGON')
          and ST_Area(s.geom::geography) > 0
          and s.data->>'category' ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$'
          and ST_Intersects(s.geom, a.geometry)
        then (s.data->>'category')::numeric
          * ST_Area(ST_Intersection(s.geom, a.geometry)::geography)
          / ST_Area(s.geom::geography)
        else 0 end
      ), 0)::double precision as population,
      max(s.last_loaded_at) as loaded_at,
      case when count(s.source_id) > 0
          and count(s.data->>'occurredAt') = count(s.source_id)
          and bool_and(length(trim(s.data->>'occurredAt')) > 0)
          and count(distinct s.data->>'occurredAt') = 1
        then min(s.data->>'occurredAt') else null end as source_vintage
    from area a cross join source s
    group by a.geometry, a.incident_geometry`;

  if (!row) {
    return { coverage: "unknown", value: null, contributingRecords: 0,
      loadedAt: null, sourceVintage: null, reason: "dataset has no aggregateable baseline" };
  }
  const coverage = row.coverage as ImpactCoverage;
  const totalRecords = Number(row.total_records);
  const spatialRecords = Number(row.spatial_records);
  const affectedRecords = Number(row.affected_records);
  const populationRecords = Number(row.population_records);
  const populationContributing = Number(row.population_contributing);
  let reason: string | null = null;
  if (coverage === "unknown") reason = "dataset coverage geometry is missing";
  else if (coverage === "partial") reason = "dataset coverage only partially contains the analysis area";
  else if (coverage === "none") reason = "dataset coverage does not contain the analysis area";
  else if (totalRecords === 0) reason = "successful load contains no source records";
  else if (totalRecords !== spatialRecords) reason = "one or more source records lack geometry";
  else if (category === "population" && totalRecords !== populationRecords)
    reason = "population requires numeric category values on polygon records";

  return {
    coverage,
    value: category === "population" ? Number(row.population) : affectedRecords,
    contributingRecords: category === "population" ? populationContributing : affectedRecords,
    loadedAt: iso((row.loaded_at as Date | string | null) ?? null),
    sourceVintage: validVintage(row.source_vintage),
    reason,
  };
}

function missingSource(source: CatalogSource, registrations: number): ImpactSourceAggregate {
  return {
    catalogSourceId: source.id,
    datasetId: null,
    datasetKey: canonicalDatasetKey(source),
    datasetName: source.name,
    owner: source.owner,
    license: source.license,
    catalogCoverage: source.coverage,
    availability: source.available ? "awaiting" : "unavailable",
    loadedAt: null,
    sourceVintage: null,
    coverage: "unknown",
    value: null,
    contributingRecords: null,
    registrationsConsidered: registrations,
    reason: source.available ? "no successful baseline is loaded" : (source.notes ?? "catalog source unavailable"),
  };
}

async function sourceAggregate(
  sql: Sql,
  source: CatalogSource,
  registrations: readonly DatasetRow[],
  incidentId: string,
  revision: number,
  category: ImpactCategory,
  now: Date,
  bbox: ViewportBbox | undefined,
): Promise<ImpactSourceAggregate> {
  const selected = newestSuccessful(registrations);
  if (!selected) return missingSource(source, registrations.length);
  const observed = await observeDataset(sql, selected.id, incidentId, revision, category, bbox);
  const availability: DatasetAvailability = datasetAvailability({
    lastSuccessAt: new Date(selected.last_success_at!),
    lastError: selected.last_error,
    staleAfterSeconds: selected.stale_after_seconds,
    now,
  });
  return {
    catalogSourceId: source.id,
    datasetId: selected.id,
    datasetKey: selected.key,
    datasetName: selected.name,
    owner: source.owner,
    license: source.license,
    catalogCoverage: source.coverage,
    availability,
    loadedAt: observed.loadedAt ?? iso(selected.last_success_at),
    sourceVintage: observed.sourceVintage,
    coverage: observed.coverage,
    value: observed.value,
    contributingRecords: observed.contributingRecords,
    registrationsConsidered: registrations.length,
    reason: observed.reason ?? selected.last_error,
  };
}

function combineCategory(
  category: ImpactCategory,
  sources: readonly ImpactSourceAggregate[],
): ImpactCategoryAggregate {
  const usable = sources.filter((source) => source.datasetId !== null && source.value !== null);
  const availability: ImpactAvailability = sources.length === 0
    ? "awaiting"
    : sources.every((source) => source.availability === sources[0]!.availability)
      ? sources[0]!.availability
      : "mixed";
  const coverage: ImpactCoverage = sources.length === 0
    ? "unknown"
    : sources.some((source) => source.coverage === "unknown")
    ? "unknown"
    : sources.every((source) => source.coverage === "complete")
      ? "complete"
      : sources.every((source) => source.coverage === "none")
        ? "none"
        : "partial";
  const reasons: string[] = [];
  if (usable.length === 0) reasons.push("no loaded baseline is available");
  if (sources.some((source) => source.datasetId === null))
    reasons.push("one or more catalog baselines are missing");
  if (sources.some((source) => source.coverage !== "complete"))
    reasons.push("one or more source coverages are missing, partial, or outside the analysis area");
  if (sources.some((source) => source.datasetId !== null && source.reason !== null))
    reasons.push("one or more source baselines are incomplete");
  if (sources.some((source) => source.availability !== "available"))
    reasons.push("one or more catalog baselines are stale, unavailable, or awaiting load");
  if (usable.length > 1) reasons.push("cross-source identities cannot be deduplicated safely");
  const reason = reasons.length === 0 ? null : reasons.join("; ");
  return {
    category,
    unit: units(category),
    availability,
    value: reason === null ? usable[0]!.value : null,
    coverage,
    reason,
    sources,
  };
}

/**
 * Compute source-backed impacts for one explicit area revision, or the current
 * revision when omitted. The current lookup selects the latest revision first
 * and only then checks geometry, so a later null revision never resurrects an
 * older boundary. Callers supply an RLS-scoped connection or authorize access
 * before invoking this low-level query seam.
 */
export async function computeSpatialImpact(
  sql: Sql,
  incidentId: string,
  revision?: number,
  now = new Date(),
  catalog: readonly CatalogSource[] = CALIFORNIA_CATALOG,
  bbox?: ViewportBbox,
): Promise<IncidentImpactResponse> {
  const rows = revision === undefined
    ? await sql`select revision, geometry is not null as has_geometry
        from incident_area_revisions where incident_id = ${incidentId}
        order by revision desc limit 1`
    : await sql`select revision, geometry is not null as has_geometry
        from incident_area_revisions where incident_id = ${incidentId} and revision = ${revision}`;
  const area = rows[0];
  if (!area) return blankResponse(incidentId, null, "incident has no requested area revision", bbox);
  const areaRevision = Number(area.revision);
  if (!area.has_geometry)
    return blankResponse(incidentId, areaRevision, "selected area revision has no geometry", bbox);

  const datasetRows = await sql`
    select d.id, d.key, d.name, d.last_success_at, d.last_error,
           d.stale_after_seconds, d.created_at
    from data_pack_datasets d join data_packs p on p.id = d.pack_id
    where p.incident_id = ${incidentId}` as unknown as DatasetRow[];
  const categories = {} as Record<ImpactCategory, ImpactCategoryAggregate>;
  for (const [category, catalogCategories] of Object.entries(CATEGORY_MAP) as Array<
    [ImpactCategory, readonly CatalogCategory[]]
  >) {
    const catalogSources = catalog.filter((source) =>
      catalogCategories.includes(source.category),
    );
    const sourceResults: ImpactSourceAggregate[] = [];
    for (const source of catalogSources) {
      const key = canonicalDatasetKey(source);
      const registrations = datasetRows.filter((dataset) => dataset.key === key);
      sourceResults.push(await sourceAggregate(
        sql, source, registrations, incidentId, areaRevision, category, now, bbox,
      ));
    }
    categories[category] = combineCategory(category, sourceResults);
  }
  return {
    incidentId,
    scope: spatialScope(bbox),
    areaRevision,
    areaGeometryAvailable: true,
    categories,
    method: METHOD,
  };
}
