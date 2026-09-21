import {
  applyFieldMapping,
  datasetAvailability,
  type DataPack,
  type DatasetStatus,
  type FieldMapping,
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
    select d.id, d.key, d.field_mapping, d.stale_after_seconds, p.incident_id
    from data_pack_datasets d join data_packs p on p.id = d.pack_id
    where d.id = ${datasetId}`;
  if (!ds) throw new AuthError(404, "dataset not found");
  const authority = await getIncidentAuthority(sql, actor, ds.incident_id as string);
  if (!authority.canContribute) throw new AuthError(403, "requires incident contributor");

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
  const normalized = outcome.records.map((rec) => applyFieldMapping(rec, mapping));
  await sql`
    update data_pack_datasets
    set last_success_at = now(), item_count = ${normalized.length}, last_error = null
    where id = ${datasetId}`;
  return { key: ds.key as string, availability: "available", itemCount: normalized.length, normalized };
}
