import { createHash } from "node:crypto";
import {
  CALIFORNIA_CATALOG,
  catalogCovers,
  catalogToDataset,
  datasetAvailability,
  mapItem,
  type Bbox,
  type CatalogEntryStatus,
  type DataPack,
  type DatasetStatus,
  type FieldMapping,
  type NormalizedField,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { getIncidentAuthority } from "../incidents/participation.js";

/**
 * Data-pack onboarding (VEOC-79C). A participating organization registers its
 * datasets into an incident at runtime. The organization is the source owner;
 * each dataset carries its field mapping, coverage and freshness. A dataset
 * that has not loaded or has failed is reported as awaiting or unavailable,
 * never as zero, and its absence never blocks the incident.
 */

export interface RegisteredPack {
  readonly id: string;
  readonly organizationSlug: string;
  readonly datasetKeys: readonly string[];
}

/** Register a pack and its datasets. Owner admins, or a coordinator of the
 * named organization, may onboard; the coordinator is bound to their own org. */
export async function registerDataPack(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  input: DataPack,
): Promise<RegisteredPack> {
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  const [org] = await sql`
    select id, name from jurisdictions where slug = ${input.organizationSlug}`;
  if (!org) throw new AuthError(404, "organization not found");
  const orgId = org.id as string;
  const ownerAdmin = authority.canManageParticipation;
  const orgCoordinator =
    authority.participation?.role === "coordinator" &&
    authority.participation.organizationId === orgId;
  if (!ownerAdmin && !orgCoordinator)
    throw new AuthError(403, "requires incident owner admin or a coordinator of that organization");

  // Validate every declared coverage geometry before writing anything.
  for (const dataset of input.datasets) {
    if (dataset.coverage === undefined) continue;
    const [check] = await sql`
      select ST_IsValid(ST_GeomFromGeoJSON(${JSON.stringify(dataset.coverage)})) as valid`;
    if (!check?.valid) throw new AuthError(400, `invalid coverage geometry for dataset ${dataset.key}`);
  }

  const [pack] = await sql`
    insert into data_packs (incident_id, organization_id, name, description, created_by)
    values (${incidentId}, ${orgId}, ${input.name}, ${input.description ?? null}, ${actor.person.id})
    returning id`;
  const packId = pack!.id as string;
  for (const dataset of input.datasets) {
    // ST_GeomFromGeoJSON(NULL) is NULL, so an absent coverage stays null.
    const coverageJson = dataset.coverage === undefined ? null : JSON.stringify(dataset.coverage);
    await sql`
      insert into data_pack_datasets
        (pack_id, key, name, kind, url, field_mapping, coverage, stale_after_seconds)
      values (${packId}, ${dataset.key}, ${dataset.name}, ${dataset.kind},
        ${dataset.url ?? null}, ${sql.json(dataset.fieldMapping as never)},
        ST_GeomFromGeoJSON(${coverageJson}), ${dataset.staleAfterSeconds})`;
  }
  await recordAudit(sql, actor, {
    // Attribute the event to the jurisdiction the actor belongs to: the
    // incident owner for an owner admin, or the partner organization for its
    // coordinator. Both satisfy the audit membership wall; incidentId ties the
    // event to the incident either way.
    jurisdictionId: ownerAdmin ? authority.jurisdictionId : orgId,
    incidentId,
    category: "incident.datapack.registered",
    subjectTable: "data_packs",
    subjectId: packId,
    payload: { organizationId: orgId, name: input.name, datasets: input.datasets.map((d) => d.key) },
  });
  return { id: packId, organizationSlug: input.organizationSlug, datasetKeys: input.datasets.map((d) => d.key) };
}

// --- California data catalog (VEOC-79F) ---

/** The incident operational area's bounding box, or null when no area geometry
 *  has been set (coverage is then unknown, never assumed). */
async function incidentAreaBbox(sql: Sql, incidentId: string): Promise<Bbox | null> {
  const [row] = await sql`
    select ST_XMin(e) as w, ST_YMin(e) as s, ST_XMax(e) as x, ST_YMax(e) as n
    from (
      select ST_Envelope(geometry) as e from incident_area_revisions
      where incident_id = ${incidentId} and geometry is not null
      order by revision desc limit 1
    ) t`;
  if (!row || row.w === null) return null;
  return [Number(row.w), Number(row.s), Number(row.x), Number(row.n)];
}

/** The catalog annotated for an incident (VEOC-79F): whether each source covers
 *  the incident's operational area, and whether it is already onboarded. When the
 *  incident has no area geometry yet, coverage is left unknown (true), never
 *  assumed absent. */
export async function listCatalogForIncident(
  sql: Sql,
  actor: Principal,
  incidentId: string,
): Promise<CatalogEntryStatus[]> {
  await getIncidentAuthority(sql, actor, incidentId);
  const bbox = await incidentAreaBbox(sql, incidentId);
  const onboarded = new Set(
    (
      await sql`
        select d.key from data_pack_datasets d
        join data_packs p on p.id = d.pack_id
        where p.incident_id = ${incidentId}`
    ).map((r) => r.key as string),
  );
  return CALIFORNIA_CATALOG.map((s) => ({
    ...s,
    coversIncident: bbox === null ? true : catalogCovers(s, bbox),
    onboarded: onboarded.has(s.id.replace(/-/g, "_")),
  }));
}

/**
 * Onboard a catalog source into an incident (VEOC-79F), reusing the data-pack
 * path. The onboarded pack is owned by the incident's owner jurisdiction and
 * records the true upstream source and license as attribution. Only the incident
 * owner admin may pull in a catalog source, and a named gap cannot be onboarded.
 */
export async function onboardCatalogSource(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  sourceId: string,
): Promise<RegisteredPack> {
  const source = CALIFORNIA_CATALOG.find((s) => s.id === sourceId);
  if (!source) throw new AuthError(404, "catalog source not found");
  if (!source.available)
    throw new AuthError(409, `catalog source is a named gap: ${source.notes ?? "not yet integrated"}`);
  const authority = await getIncidentAuthority(sql, actor, incidentId);
  if (!authority.canManageParticipation)
    throw new AuthError(403, "requires incident owner admin to onboard a catalog source");
  const [owner] = await sql`select slug from jurisdictions where id = ${authority.jurisdictionId}`;
  if (!owner) throw new AuthError(404, "incident owner jurisdiction not found");
  const pack: DataPack = {
    name: `${source.name} (catalog)`,
    organizationSlug: owner.slug as string,
    description: `Source: ${source.owner}. License: ${source.license}. Coverage: ${source.coverage.label}.`,
    datasets: [catalogToDataset(source)],
  };
  return registerDataPack(sql, actor, incidentId, pack);
}

/** Every dataset onboarded into the incident, with its source owner and a
 * computed availability. itemCount stays null unless a load has succeeded, so
 * a missing source is never reported as zero. */
export async function listIncidentDatasets(
  sql: Sql,
  actor: Principal,
  incidentId: string,
  now = new Date(),
): Promise<DatasetStatus[]> {
  await getIncidentAuthority(sql, actor, incidentId);
  const rows = await sql`
    select d.id, d.key, d.name, d.kind, j.slug as org_slug, j.name as org_name,
           d.last_success_at, d.last_error, d.item_count, d.stale_after_seconds,
           d.last_received, d.last_rejected,
           ST_Area(d.coverage::geography) as coverage_area
    from data_pack_datasets d
    join data_packs p on p.id = d.pack_id
    join jurisdictions j on j.id = p.organization_id
    where p.incident_id = ${incidentId}
    order by j.name, d.name`;
  return rows.map((r) => {
    const lastSuccessAt = r.last_success_at ? new Date(r.last_success_at as string) : null;
    const availability = datasetAvailability({
      lastSuccessAt,
      lastError: (r.last_error as string | null) ?? null,
      staleAfterSeconds: r.stale_after_seconds as number,
      now,
    });
    const hasData = availability === "available" || availability === "stale";
    return {
      id: r.id as string,
      key: r.key as string,
      name: r.name as string,
      kind: r.kind as string,
      organizationSlug: r.org_slug as string,
      organizationName: r.org_name as string,
      availability,
      itemCount: hasData ? ((r.item_count as number | null) ?? null) : null,
      coverageArea: r.coverage_area === null ? null : Number(r.coverage_area),
      lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
      staleAfterSeconds: r.stale_after_seconds as number,
      reason: (r.last_error as string | null) ?? null,
      lastReceived: (r.last_received as number | null) ?? null,
      lastRejected: (r.last_rejected as number | null) ?? null,
    } satisfies DatasetStatus;
  });
}

export interface DatasetFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<{
    readonly type: "Feature";
    readonly id: string;
    readonly geometry: unknown;
    readonly properties: Record<string, unknown>;
  }>;
}

/**
 * A dataset's persisted items as GeoJSON for the COP map (VEOC-79C2). Only items
 * with geometry are returned; each feature carries its source id and normalized
 * fields as properties. Row-level security limits this to a reader of the
 * dataset's incident, the same wall as the dataset listing.
 */
export async function listDatasetItems(
  sql: Sql,
  actor: Principal,
  datasetId: string,
  limit = 2000,
): Promise<DatasetFeatureCollection> {
  const [ds] = await sql`
    select p.incident_id from data_pack_datasets d
    join data_packs p on p.id = d.pack_id
    where d.id = ${datasetId}`;
  if (!ds) throw new AuthError(404, "dataset not found");
  await getIncidentAuthority(sql, actor, ds.incident_id as string);
  const rows = await sql`
    select source_id, data, ST_AsGeoJSON(geom) as geom
    from data_pack_items
    where dataset_id = ${datasetId} and geom is not null
    order by last_loaded_at desc limit ${limit}`;
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      id: r.source_id as string,
      geometry: JSON.parse(r.geom as string),
      properties: (r.data as Record<string, unknown>) ?? {},
    })),
  };
}

export interface DatasetLoadResult {
  readonly key: string;
  readonly availability: DatasetStatus["availability"];
  readonly itemCount: number | null;
  /** The ingest tally for this load (VEOC-79C2): items the source sent, items
   *  persisted, and items not persisted (invalid or a duplicate). */
  readonly received: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly normalized: ReadonlyArray<Partial<Record<string, unknown>>>;
}

/**
 * Apply a dataset's field mapping to raw source records and record the load.
 * A productive load persists its mapped items and sets the freshness clock and
 * the received/accepted/rejected tally from the real records. A source fetch
 * failure, an empty return, or a batch with no usable item is treated as a
 * failed refresh: the last-good items and count are preserved, the error is
 * recorded, and the dataset reads stale or unavailable, never wiped to zero
 * (VEOC-79C2). A poll or push runs this under a contributor's authority.
 */
export async function loadDataset(
  sql: Sql,
  actor: Principal,
  datasetId: string,
  outcome: { records: readonly unknown[] } | { error: string },
): Promise<DatasetLoadResult> {
  const [ds] = await sql`
    select d.id, d.key, d.field_mapping, d.stale_after_seconds, p.incident_id
    from data_pack_datasets d join data_packs p on p.id = d.pack_id
    where d.id = ${datasetId}`;
  if (!ds) throw new AuthError(404, "dataset not found");
  const authority = await getIncidentAuthority(sql, actor, ds.incident_id as string);
  if (!authority.canContribute) throw new AuthError(403, "requires incident contributor");

  if ("error" in outcome) {
    await sql`update data_pack_datasets set last_error = ${outcome.error} where id = ${datasetId}`;
    return loadStatus(sql, ds, { received: 0, accepted: 0, rejected: 0 });
  }

  const mapping = ds.field_mapping as FieldMapping;
  const incidentId = ds.incident_id as string;
  const batch = prepareItems(mapping, outcome.records);

  if (batch.items.length === 0) {
    // No usable item: an empty source, or every record rejected. Preserve the
    // last-good items and count, and mark the dataset with the reason.
    const reason =
      batch.received === 0
        ? "source returned no items"
        : `no usable items (${batch.rejected} of ${batch.received} rejected)`;
    await sql`update data_pack_datasets set last_error = ${reason} where id = ${datasetId}`;
    return loadStatus(sql, ds, batch);
  }

  // A productive load replaces the dataset's items with exactly what it carried.
  await writeItems(sql, actor, datasetId, incidentId, batch.items);
  await sql`
    update data_pack_datasets
    set last_success_at = now(), item_count = ${batch.accepted}, last_error = null,
        last_received = ${batch.received}, last_rejected = ${batch.rejected}
    where id = ${datasetId}`;
  return {
    key: ds.key as string,
    availability: "available",
    itemCount: batch.accepted,
    received: batch.received,
    accepted: batch.accepted,
    rejected: batch.rejected,
    normalized: batch.items.map((p) => p.data),
  };
}

/** The load result for a non-productive load (fetch error, empty, or all
 *  rejected): the dataset's current freshness and last-good count, plus the
 *  tally of what this attempt carried. */
async function loadStatus(
  sql: Sql,
  ds: Record<string, unknown>,
  tally: { received: number; accepted: number; rejected: number },
): Promise<DatasetLoadResult> {
  const [after] = await sql`
    select last_success_at, last_error, stale_after_seconds, item_count
    from data_pack_datasets where id = ${ds.id as string}`;
  const availability = datasetAvailability({
    lastSuccessAt: after!.last_success_at ? new Date(after!.last_success_at as string) : null,
    lastError: (after!.last_error as string | null) ?? null,
    staleAfterSeconds: after!.stale_after_seconds as number,
  });
  const hasData = availability === "available" || availability === "stale";
  return {
    key: ds.key as string,
    availability,
    itemCount: hasData ? ((after!.item_count as number | null) ?? null) : null,
    received: tally.received,
    accepted: tally.accepted,
    rejected: tally.rejected,
    normalized: [],
  };
}

interface PreparedItem {
  readonly sourceId: string;
  readonly data: Partial<Record<NormalizedField, unknown>>;
  readonly geometry: unknown | null;
}

interface PreparedBatch {
  readonly received: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly items: PreparedItem[];
}

/**
 * Map a raw batch to persistable items (VEOC-79C2), tolerant per item: a record
 * whose mapped geometry is present but not GeoJSON is rejected and counted,
 * never failing the whole load. Items are keyed by source id, or a hash of
 * their mapped content when the source names none, and the last record for a
 * repeated id wins. received counts the source's records, accepted the distinct
 * persisted items, and rejected the difference (invalid or duplicate).
 */
function prepareItems(mapping: FieldMapping, records: readonly unknown[]): PreparedBatch {
  const received = records.length;
  const byId = new Map<string, PreparedItem>();
  for (const rec of records) {
    const item = mapItem(rec, mapping);
    if (!isGeometry(item.geometry)) continue; // present-but-invalid geometry: rejected
    const sourceId = item.sourceId ?? deriveId(item.data);
    byId.set(sourceId, { sourceId, data: item.data, geometry: item.geometry });
  }
  const accepted = byId.size;
  return { received, accepted, rejected: received - accepted, items: [...byId.values()] };
}

/** Upsert a productive batch's items and prune the ones the source dropped, so
 *  the persisted set is exactly this load. Only called for a non-empty batch,
 *  so the prune never empties a dataset. */
async function writeItems(
  sql: Sql,
  actor: Principal,
  datasetId: string,
  incidentId: string,
  items: readonly PreparedItem[],
): Promise<void> {
  for (const item of items) {
    await sql`
      insert into data_pack_items (dataset_id, incident_id, source_id, data, geom, loaded_by)
      values (${datasetId}, ${incidentId}, ${item.sourceId}, ${sql.json(item.data as never)},
              ${geomValue(sql, item.geometry)}, ${actor.person.id})
      on conflict (dataset_id, source_id) do update
        set data = excluded.data, geom = excluded.geom,
            last_loaded_at = now(), loaded_by = ${actor.person.id}`;
  }
  const keep = items.map((i) => i.sourceId);
  await sql`
    delete from data_pack_items
    where dataset_id = ${datasetId} and source_id <> all(${keep})`;
}

/** A deterministic id for a source item that carries none: a hash of its
 *  mapped content, so an identical reload stays one row. */
function deriveId(data: Partial<Record<NormalizedField, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/** Whether a mapped geometry value is usable: absent is fine (the item has no
 *  geometry); a present value must be a structural GeoJSON geometry. */
function isGeometry(geometry: unknown | null): boolean {
  if (geometry === null || geometry === undefined) return true;
  const g = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  const TYPES = [
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
  ];
  return (
    typeof g === "object" &&
    typeof g.type === "string" &&
    TYPES.includes(g.type) &&
    (g.type === "GeometryCollection" ? Array.isArray(g.geometries) : Array.isArray(g.coordinates))
  );
}

/** PostGIS geometry fragment for an item, or null. */
function geomValue(sql: Sql, geometry: unknown | null): never {
  return (
    geometry == null ? null : sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`
  ) as never;
}
