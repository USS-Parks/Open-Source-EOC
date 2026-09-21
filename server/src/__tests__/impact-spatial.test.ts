import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CALIFORNIA_CATALOG, type CatalogSource } from "@openeoc/shared";
import { computeSpatialImpact } from "../impact/spatial.js";
import { createJurisdiction, createPerson } from "../auth/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql;
let incidentId: string;
let personId: string;
let packId: string;

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

async function addDataset(input: {
  key: string;
  pack?: string;
  loadedAt: string;
  coverage: unknown | null;
  items: Array<{ id: string; geometry: unknown | null; category?: number; occurredAt?: string }>;
}): Promise<string> {
  const [dataset] = await admin`
    insert into data_pack_datasets
      (pack_id, key, name, kind, field_mapping, coverage, stale_after_seconds,
       last_success_at, item_count, created_at)
    values (${input.pack ?? packId}, ${input.key}, ${input.key}, 'geojson', '{}'::jsonb,
      ST_GeomFromGeoJSON(${input.coverage === null ? null : JSON.stringify(input.coverage)}),
      604800, ${new Date(input.loadedAt)}, ${input.items.length}, ${new Date(input.loadedAt)})
    returning id`;
  const datasetId = dataset!.id as string;
  for (const item of input.items) {
    await admin`
      insert into data_pack_items
        (dataset_id, incident_id, source_id, data, geom, loaded_by, last_loaded_at)
      values (${datasetId}, ${incidentId}, ${item.id},
        ${admin.json({ category: item.category, occurredAt: item.occurredAt } as never)},
        ST_GeomFromGeoJSON(${item.geometry === null ? null : JSON.stringify(item.geometry)}),
        ${personId}, ${new Date(input.loadedAt)})`;
  }
  return datasetId;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const jurisdictionId = await createJurisdiction(admin, "impact-county", "Impact County");
  personId = await createPerson(admin, {
    email: "impact@example.org",
    displayName: "Impact Analyst",
    password: "impact-test-password",
  });
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${jurisdictionId}, 'Spatial impact fixture', 'incident', ${personId}) returning id`;
  incidentId = incident!.id as string;
  const [pack] = await admin`
    insert into data_packs (incident_id, organization_id, name, created_by)
    values (${incidentId}, ${jurisdictionId}, 'Impact baselines', ${personId}) returning id`;
  packId = pack!.id as string;

  await admin`
    insert into incident_area_revisions (incident_id, revision, geometry, reason, created_by)
    values
      (${incidentId}, 1, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 1, 1))}), 'small area', ${personId}),
      (${incidentId}, 2, ST_GeomFromGeoJSON(${JSON.stringify(polygon(0, 0, 2, 1))}), 'expanded area', ${personId})`;

  const coverage = polygon(-1, -1, 3, 2);
  await addDataset({
    key: "humboldt_parcels",
    loadedAt: "2026-09-21T10:00:00Z",
    coverage,
    items: [
      { id: "inside", geometry: { type: "Point", coordinates: [0.5, 0.5] } },
      { id: "boundary", geometry: { type: "Point", coordinates: [1, 0.5] } },
      { id: "expanded", geometry: { type: "Point", coordinates: [1.5, 0.5] } },
      { id: "outside", geometry: { type: "Point", coordinates: [4, 4] } },
    ],
  });
  await addDataset({
    key: "census_acs_population",
    loadedAt: "2026-09-21T10:00:00Z",
    coverage,
    items: [
      { id: "p100", geometry: polygon(0, 0, 1, 1), category: 100, occurredAt: "2024-12-31" },
      { id: "p300", geometry: polygon(1, 0, 3, 1), category: 300, occurredAt: "2024-12-31" },
    ],
  });
});

afterAll(async () => { await runtime.end(); await admin.end(); });

describe("incident impact spatial query", () => {
  it("uses ST_Intersects for inside and boundary records and supports explicit revisions", async () => {
    const revisionOne = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T10:01:00Z"));
    expect(revisionOne.areaRevision).toBe(1);
    expect(revisionOne.categories.structures_parcels.value).toBe(2);
    expect(revisionOne.categories.structures_parcels.sources[0]).toMatchObject({
      catalogSourceId: "humboldt-parcels",
      owner: "Humboldt County Assessor",
      availability: "available",
      loadedAt: "2026-09-21T10:00:00.000Z",
      coverage: "complete",
    });
    expect(revisionOne.method.spatialPredicate).toBe("ST_Intersects");

    const current = await computeSpatialImpact(admin, incidentId, undefined, new Date("2026-09-21T10:01:00Z"));
    expect(current.areaRevision).toBe(2);
    expect(current.categories.structures_parcels.value).toBe(3);
  });

  it("area-weights population polygons and reports source vintage separately", async () => {
    const small = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T10:01:00Z"));
    expect(small.categories.population.value).toBeCloseTo(100, 5);
    expect(small.categories.population.sources[0]).toMatchObject({
      value: 100,
      sourceVintage: "2024-12-31T00:00:00.000Z",
      loadedAt: "2026-09-21T10:00:00.000Z",
      contributingRecords: 1,
    });

    const expanded = await computeSpatialImpact(admin, incidentId, 2, new Date("2026-09-21T10:01:00Z"));
    // Geography area weighting follows the ellipsoid, so the half-longitude
    // slice is near 150 people rather than planar-exact at this latitude.
    expect(expanded.categories.population.value).toBeCloseTo(250, 1);
    expect(expanded.categories.population.sources[0]!.contributingRecords).toBe(2);
  });

  it("selects the newest successful duplicate registration deterministically", async () => {
    const [duplicatePack] = await admin`
      insert into data_packs (incident_id, organization_id, name, created_by)
      select ${incidentId}, organization_id, 'Replacement baseline', ${personId}
      from data_packs where id = ${packId} returning id`;
    const newestId = await addDataset({
      key: "humboldt_parcels",
      pack: duplicatePack!.id as string,
      loadedAt: "2026-09-21T11:00:00Z",
      coverage: polygon(-1, -1, 3, 2),
      items: [{ id: "new-only", geometry: { type: "Point", coordinates: [0.25, 0.25] } }],
    });
    const result = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(result.categories.structures_parcels.value).toBe(1);
    expect(result.categories.structures_parcels.sources[0]).toMatchObject({
      datasetId: newestId,
      registrationsConsidered: 2,
    });
  });

  it("keeps a stale last-good source observable without promoting its headline total", async () => {
    await admin`update data_pack_datasets set last_error = 'refresh failed'
      where key = 'humboldt_parcels' and last_success_at = '2026-09-21T11:00:00Z'`;
    const stale = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(stale.categories.structures_parcels).toMatchObject({
      availability: "stale",
      value: null,
    });
    expect(stale.categories.structures_parcels.sources[0]).toMatchObject({
      availability: "stale",
      value: 1,
    });
    await admin`update data_pack_datasets set last_error = null
      where key = 'humboldt_parcels' and last_success_at = '2026-09-21T11:00:00Z'`;
  });

  it("rejects a negative population baseline instead of estimating from it", async () => {
    await admin`update data_pack_items set data = jsonb_set(data, '{category}', '-1'::jsonb)
      where dataset_id = (select id from data_pack_datasets where key = 'census_acs_population')
        and source_id = 'p100'`;
    const invalid = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(invalid.categories.population.value).toBeNull();
    expect(invalid.categories.population.sources[0]!.value).toBeCloseTo(0, 5);
    await admin`update data_pack_items set data = jsonb_set(data, '{category}', '100'::jsonb)
      where dataset_id = (select id from data_pack_datasets where key = 'census_acs_population')
        and source_id = 'p100'`;
  });

  it("reports vintage only when every source row has one valid normalized timestamp", async () => {
    await admin`update data_pack_items set data = data - 'occurredAt'
      where dataset_id = (select id from data_pack_datasets where key = 'census_acs_population')
        and source_id = 'p300'`;
    const missing = await computeSpatialImpact(admin, incidentId, 2, new Date("2026-09-21T11:01:00Z"));
    expect(missing.categories.population.sources[0]!.sourceVintage).toBeNull();
    await admin`update data_pack_items set data = jsonb_set(data, '{occurredAt}', '"not-a-date"'::jsonb)
      where dataset_id = (select id from data_pack_datasets where key = 'census_acs_population')
        and source_id = 'p300'`;
    const invalid = await computeSpatialImpact(admin, incidentId, 2, new Date("2026-09-21T11:01:00Z"));
    expect(invalid.categories.population.sources[0]!.sourceVintage).toBeNull();
    await admin`update data_pack_items set data = jsonb_set(data, '{occurredAt}', '"2024-12-31"'::jsonb)
      where dataset_id = (select id from data_pack_datasets where key = 'census_acs_population')
        and source_id = 'p300'`;
  });

  it("exposes distinct source aggregates without inventing cross-source deduplication", async () => {
    const template = CALIFORNIA_CATALOG.find((source) => source.id === "caltrans-lcs-closures")!;
    const catalog: CatalogSource[] = [
      { ...template, id: "local-closure-a", name: "Local closures A" },
      { ...template, id: "local-closure-b", name: "Local closures B" },
    ];
    await addDataset({
      key: "local_closure_a",
      loadedAt: "2026-09-21T11:00:00Z",
      coverage: polygon(-1, -1, 3, 2),
      items: [{ id: "shared-upstream-id", geometry: { type: "Point", coordinates: [0.5, 0.5] } }],
    });
    const oneLoaded = await computeSpatialImpact(
      admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"), catalog,
    );
    expect(oneLoaded.categories.closures).toMatchObject({
      value: null,
      coverage: "unknown",
      availability: "mixed",
    });
    expect(oneLoaded.categories.closures.sources).toHaveLength(2);
    expect(oneLoaded.categories.closures.sources[1]).toMatchObject({
      catalogSourceId: "local-closure-b",
      datasetId: null,
      value: null,
    });
    expect(oneLoaded.categories.population).toMatchObject({
      availability: "awaiting",
      value: null,
      coverage: "unknown",
    });
    await addDataset({
      key: "local_closure_b",
      loadedAt: "2026-09-21T11:00:00Z",
      coverage: polygon(0, 0, 0.5, 1),
      items: [{ id: "shared-upstream-id", geometry: { type: "Point", coordinates: [0.5, 0.5] } }],
    });
    const impact = await computeSpatialImpact(
      admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"), catalog,
    );
    expect(impact.categories.closures.value).toBeNull();
    expect(impact.categories.closures.sources.map((source) => source.value)).toEqual([1, 1]);
    expect(impact.categories.closures.coverage).toBe("partial");
    expect(impact.categories.closures.reason).toContain("cross-source identities");
    const reversed = await computeSpatialImpact(
      admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"), [...catalog].reverse(),
    );
    expect(reversed.categories.closures.coverage).toBe("partial");
  });

  it("keeps missing, empty, null, and partial coverage unknown", async () => {
    const missing = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(missing.categories.shelters.value).toBeNull();
    expect(missing.categories.shelters.sources[0]).toMatchObject({
      catalogSourceId: "statewide-shelters",
      availability: "unavailable",
      value: null,
    });

    await addDataset({
      key: "statewide_shelters",
      loadedAt: "2026-09-21T11:00:00Z",
      coverage: polygon(-1, -1, 3, 2),
      items: [],
    });
    const empty = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(empty.categories.shelters).toMatchObject({ value: null, availability: "available" });
    expect(empty.categories.shelters.sources[0]).toMatchObject({ value: 0 });
    expect(empty.categories.shelters.sources[0]!.reason).toContain("no source records");

    await addDataset({
      key: "caltrans_lcs_closures",
      loadedAt: "2026-09-21T11:00:00Z",
      coverage: null,
      items: [{ id: "c1", geometry: { type: "Point", coordinates: [0.5, 0.5] } }],
    });
    const nullCoverage = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(nullCoverage.categories.closures.value).toBeNull();
    expect(nullCoverage.categories.closures.sources[0]).toMatchObject({ value: 1, coverage: "unknown" });

    await addDataset({
      key: "hifld_critical_facilities",
      loadedAt: "2026-09-21T11:00:00Z",
      coverage: polygon(0, 0, 0.5, 1),
      items: [{ id: "f1", geometry: { type: "Point", coordinates: [0.25, 0.5] } }],
    });
    const partial = await computeSpatialImpact(admin, incidentId, 1, new Date("2026-09-21T11:01:00Z"));
    expect(partial.categories.infrastructure_facilities.value).toBeNull();
    expect(partial.categories.infrastructure_facilities.sources[0]).toMatchObject({ value: 1, coverage: "partial" });
  });

  it("does not resurrect an older geometry after a later null revision", async () => {
    await admin`
      insert into incident_area_revisions (incident_id, revision, geometry, reason, created_by)
      values (${incidentId}, 3, null, 'area intentionally cleared', ${personId})`;
    const current = await computeSpatialImpact(admin, incidentId);
    expect(current.areaRevision).toBe(3);
    expect(current.areaGeometryAvailable).toBe(false);
    expect(current.categories.structures_parcels.value).toBeNull();
    const explicit = await computeSpatialImpact(admin, incidentId, 2, new Date("2026-09-21T11:01:00Z"));
    expect(explicit.areaGeometryAvailable).toBe(true);
    expect(explicit.categories.structures_parcels.value).toBe(1);
  });
});
