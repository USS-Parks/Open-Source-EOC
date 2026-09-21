import { createHash } from "node:crypto";
import {
  datasetAvailability,
  mapItem,
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
    select d.key, d.name, d.kind, j.slug as org_slug, j.name as org_name,
           d.last_success_at, d.last_error, d.item_count, d.stale_after_seconds,
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
    } satisfies DatasetStatus;
  });
}

export interface DatasetLoadResult {
  readonly key: string;
  readonly availability: DatasetStatus["availability"];
  readonly itemCount: number | null;
  readonly normalized: ReadonlyArray<Partial<Record<string, unknown>>>;
}

/**
 * Apply a dataset's field mapping to raw source records and record the load.
 * On success the freshness clock and item count are set from the real records;
 * on failure the error is recorded and the item count is never invented. A
 * poll or push runs this under a contributor's authority.
 */
export async function loadDataset(
  sql: Sql,
  actor: Principal,
  datasetId: string,
  outcome: { records: readonly unknown[] } | { error: string },
): Promise<DatasetLoadResult> {
  const [ds] = await sql`
    select d.id, d.key, d.field_mapping, d.stale_after_seconds, p.incident_id, p.organization_id
    from data_pack_datasets d join data_packs p on p.id = d.pack_id
    where d.id = ${datasetId}`;
  if (!ds) throw new AuthError(404, "dataset not found");
  const authority = await getIncidentAuthority(sql, actor, ds.incident_id as string);
  const orgId = ds.organization_id as string;
  const ownerAdmin = authority.canManageParticipation;
  const sameOrgContributor =
    authority.canContribute &&
    (authority.participation?.organizationId === orgId ||
      actor.memberships.some(
        (m) => m.jurisdictionId === orgId && (m.role === "admin" || m.role === "member"),
      ));
  if (!ownerAdmin && !sameOrgContributor)
    throw new AuthError(403, "requires incident owner admin or a contributor of that organization");

  if ("error" in outcome) {
    await sql`update data_pack_datasets set last_error = ${outcome.error} where id = ${datasetId}`;
    const [after] = await sql`
      select last_success_at, last_error, stale_after_seconds, item_count
      from data_pack_datasets where id = ${datasetId}`;
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
      normalized: [],
    };
  }

  const mapping = ds.field_mapping as FieldMapping;
  const incidentId = ds.incident_id as string;
  const persisted = await persistItems(sql, actor, datasetId, incidentId, mapping, outcome.records);
  await sql`
    update data_pack_datasets
    set last_success_at = now(), item_count = ${persisted.length}, last_error = null
    where id = ${datasetId}`;
  return {
    key: ds.key as string,
    availability: "available",
    itemCount: persisted.length,
    normalized: persisted.map((p) => p.data),
  };
}

interface PreparedItem {
  readonly sourceId: string;
  readonly data: Partial<Record<NormalizedField, unknown>>;
  readonly geometry: unknown | null;
}

/**
 * Persist a dataset's mapped items durably (VEOC-79C1). Each item is keyed by
 * its source id, or a hash of its mapped content when the source names none,
 * and upserted, so a repeated load is idempotent and a changed item updates in
 * place. Items the source no longer sends are pruned, so the persisted set is
 * exactly the last successful load. The batch is validated before any write: a
 * source that reuses an id, or a value that is not GeoJSON geometry, rejects
 * the whole load and leaves the previously persisted items untouched.
 */
async function persistItems(
  sql: Sql,
  actor: Principal,
  datasetId: string,
  incidentId: string,
  mapping: FieldMapping,
  records: readonly unknown[],
): Promise<PreparedItem[]> {
  const prepared: PreparedItem[] = records.map((rec) => {
    const item = mapItem(rec, mapping);
    assertGeometry(item.geometry);
    return { sourceId: item.sourceId ?? deriveId(item.data), data: item.data, geometry: item.geometry };
  });
  if (mapping.sourceId) {
    // A mapped source id is the source's own identity: reusing it for two items
    // in one batch is ambiguous, so the load is rejected.
    const ids = new Set<string>();
    for (const p of prepared) {
      if (ids.has(p.sourceId)) throw new AuthError(400, "duplicate source id in batch");
      ids.add(p.sourceId);
    }
  }
  // Derived ids hash the content, so two identical id-less items are one item.
  const byId = new Map(prepared.map((p) => [p.sourceId, p]));
  for (const item of byId.values()) {
    await sql`
      insert into data_pack_items (dataset_id, incident_id, source_id, data, geom, loaded_by)
      values (${datasetId}, ${incidentId}, ${item.sourceId}, ${sql.json(item.data as never)},
              ${geomValue(sql, item.geometry)}, ${actor.person.id})
      on conflict (dataset_id, source_id) do update
        set data = excluded.data, geom = excluded.geom,
            last_loaded_at = now(), loaded_by = ${actor.person.id}`;
  }
  const keep = [...byId.keys()];
  if (keep.length === 0) {
    await sql`delete from data_pack_items where dataset_id = ${datasetId}`;
  } else {
    await sql`
      delete from data_pack_items
      where dataset_id = ${datasetId} and source_id <> all(${keep})`;
  }
  return [...byId.values()];
}

/** A deterministic id for a source item that carries none: a hash of its
 *  mapped content, so an identical reload stays one row. */
function deriveId(data: Partial<Record<NormalizedField, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/** Reject a value that is not a GeoJSON geometry before any write, so an
 *  invalid batch is an attributable 400, not a mid-transaction database error. */
function assertGeometry(geometry: unknown | null): void {
  if (geometry === null || geometry === undefined) return;
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
  const ok =
    typeof g === "object" &&
    typeof g.type === "string" &&
    TYPES.includes(g.type) &&
    (g.type === "GeometryCollection" ? Array.isArray(g.geometries) : Array.isArray(g.coordinates));
  if (!ok) throw new AuthError(400, "invalid geometry in dataset batch");
}

/** PostGIS geometry fragment for an item, or null. */
function geomValue(sql: Sql, geometry: unknown | null): never {
  return (
    geometry == null ? null : sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`
  ) as never;
}
