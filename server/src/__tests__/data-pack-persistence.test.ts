import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Durable dataset persistence (VEOC-79C1): a load persists mapped items keyed by
 * source id, with geometry, incident association and provenance; a reload is
 * idempotent; a changed batch updates and prunes; a refresh that brings nothing
 * usable keeps the last-good items rather than wiping them; two datasets stay
 * apart.
 */

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, coordId: string;
let ownerToken: string, coordToken: string;
let incidentId: string, datasetId: string, otherDatasetId: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return r.json().accessToken as string;
}
const load = (id: string, body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/api/v1/data-packs/datasets/${id}/load`,
    headers: auth(coordToken), payload: body });
const pt = (id: string, title: string) => ({ id, title, geom: { type: "Point", coordinates: [-123.6, 41.2] } });
async function items(dataset: string) {
  const rows = await admin`
    select source_id, data, geom is not null as has_geom, incident_id, loaded_by
    from data_pack_items where dataset_id = ${dataset} order by source_id`;
  return rows as unknown as Array<{
    source_id: string;
    data: Record<string, unknown>;
    has_geom: boolean;
    incident_id: string;
    loaded_by: string;
  }>;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  const partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  coordId = await createPerson(admin, { email: "coord@example.org", displayName: "Coordinator", password: "coord-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, coordId, partnerId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  ownerToken = await login("city@example.org", "owner-good-password");
  coordToken = await login("coord@example.org", "coord-good-password");
  const inc = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(ownerToken), payload: { templateKey: "daily_ops", name: "Valley Response" } });
  incidentId = inc.json().incidentId as string;
  expect((await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/participants`,
    headers: auth(ownerToken), payload: { organizationSlug: "valley-mutual-aid", personEmail: "coord@example.org",
      incidentPositionTitle: "Data Liaison", role: "coordinator",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: "datasets" } })).statusCode).toBe(201);
  const reg = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/data-packs`,
    headers: auth(coordToken),
    payload: { name: "Mutual Aid data", organizationSlug: "valley-mutual-aid", datasets: [
      { key: "closures", name: "Closures", kind: "geojson", url: "https://example.org/c.json",
        fieldMapping: { title: "title", sourceId: "id", geometry: "geom" } },
      { key: "sensors", name: "Sensors", kind: "geojson", url: "https://example.org/s.json",
        fieldMapping: { title: "title", sourceId: "id" } },
    ] } });
  expect(reg.statusCode).toBe(201);
  datasetId = (await admin`select id from data_pack_datasets where key = 'closures'`)[0]!.id as string;
  otherDatasetId = (await admin`select id from data_pack_datasets where key = 'sensors'`)[0]!.id as string;
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("durable dataset persistence (VEOC-79C1)", () => {
  it("persists mapped items with geometry, incident and provenance", async () => {
    const r = await load(datasetId, { records: [pt("a", "Culvert"), pt("b", "Bridge"), pt("c", "Slide")] });
    expect(r.statusCode).toBe(200);
    expect(r.json().result.itemCount).toBe(3);
    const rows = await items(datasetId);
    expect(rows.map((x) => x.source_id)).toEqual(["a", "b", "c"]);
    expect(rows.every((x) => x.has_geom)).toBe(true);
    expect(rows.every((x) => x.incident_id === incidentId)).toBe(true);
    expect(rows.every((x) => x.loaded_by === coordId)).toBe(true);
    expect(rows.find((x) => x.source_id === "a")!.data.title).toBe("Culvert");
  });

  it("is idempotent on reload and updates and prunes on a changed batch", async () => {
    await load(datasetId, { records: [pt("a", "Culvert"), pt("b", "Bridge"), pt("c", "Slide")] });
    expect((await items(datasetId)).map((x) => x.source_id)).toEqual(["a", "b", "c"]);

    // a is updated, b is dropped, d is added.
    const changed = await load(datasetId, { records: [pt("a", "Culvert washout"), pt("c", "Slide"), pt("d", "New")] });
    expect(changed.json().result.itemCount).toBe(3);
    const rows = await items(datasetId);
    expect(rows.map((x) => x.source_id)).toEqual(["a", "c", "d"]);
    expect(rows.find((x) => x.source_id === "a")!.data.title).toBe("Culvert washout");
    expect(rows.some((x) => x.source_id === "b")).toBe(false);
  });

  it("preserves the last-good items when a refresh brings nothing usable", async () => {
    const before = (await items(datasetId)).map((x) => x.source_id);
    // A present-but-invalid geometry rejects that item; with no item left, the
    // refresh is non-productive and the last-good items are kept, not wiped.
    const bad = await load(datasetId, { records: [{ id: "z", title: "Broken", geom: "not-a-geometry" }] });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().result).toMatchObject({ received: 1, accepted: 0, rejected: 1 });
    // An empty source is likewise non-productive.
    expect((await load(datasetId, { records: [] })).json().result).toMatchObject({ received: 0, accepted: 0 });
    expect((await items(datasetId)).map((x) => x.source_id)).toEqual(before);
  });

  it("keeps two datasets isolated", async () => {
    await load(otherDatasetId, { records: [{ id: "s1", title: "Sensor 1" }] });
    expect((await items(otherDatasetId)).map((x) => x.source_id)).toEqual(["s1"]);
    expect((await items(datasetId)).map((x) => x.source_id)).toEqual(["a", "c", "d"]);
  });
});

describe("dataset items as COP features (VEOC-79C2)", () => {
  it("serves a dataset's loaded items as GeoJSON to an incident reader", async () => {
    await load(datasetId, { records: [pt("a", "Culvert"), pt("b", "Bridge")] });
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items`,
      headers: auth(coordToken),
    });
    expect(r.statusCode).toBe(200);
    const fc = r.json() as {
      type: string;
      features: Array<{
        id: string;
        geometry: { type: string; coordinates: number[] };
        properties: Record<string, unknown>;
      }>;
    };
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    const a = fc.features.find((f) => f.id === "a")!;
    expect(a.geometry).toMatchObject({ type: "Point", coordinates: [-123.6, 41.2] });
    expect(a.properties.title).toBe("Culvert");
  });

  it("lets the incident owner read the same items", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items`,
      headers: auth(ownerToken),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().features).toHaveLength(2);
  });
});

describe("California catalog onboarding (VEOC-79F)", () => {
  it("lists the catalog with coverage and onboards a statewide source", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/catalog`,
      headers: auth(ownerToken),
    });
    expect(list.statusCode).toBe(200);
    const sources = list.json().sources as Array<{ id: string; onboarded: boolean; coversIncident: boolean }>;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.find((s) => s.id === "ca-county-boundaries")!.onboarded).toBe(false);

    const onboard = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/catalog/ca-county-boundaries/onboard`,
      headers: auth(ownerToken),
    });
    expect(onboard.statusCode).toBe(201);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/catalog`,
      headers: auth(ownerToken),
    });
    const afterSources = after.json().sources as Array<{ id: string; onboarded: boolean }>;
    expect(afterSources.find((s) => s.id === "ca-county-boundaries")!.onboarded).toBe(true);
  });

  it("refuses a named-gap source and requires owner admin", async () => {
    const gap = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/catalog/fema-nfhl-flood/onboard`,
      headers: auth(ownerToken),
    });
    expect(gap.statusCode).toBe(409);
    const partner = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/catalog/calfire-incidents/onboard`,
      headers: auth(coordToken),
    });
    expect(partner.statusCode).toBe(403);
  });
});

describe("configurable parcel overlays (Handoff 10)", () => {
  const inBox = (b: readonly [number, number, number, number]) => ({
    type: "Polygon" as const,
    coordinates: [
      [
        [b[0] + 0.1, b[1] + 0.1],
        [b[2] - 0.1, b[1] + 0.1],
        [b[2] - 0.1, b[3] - 0.1],
        [b[0] + 0.1, b[3] - 0.1],
        [b[0] + 0.1, b[1] + 0.1],
      ],
    ],
  });
  const setArea = (geometry: unknown, expectedRevision: number) =>
    app.inject({
      method: "PUT",
      url: `/api/v1/incidents/${incidentId}/operational-area`,
      headers: auth(ownerToken),
      payload: { expectedRevision, geometry, operationalPeriod: null, reason: "parcel overlay scenario" },
    });
  const coversParcels = async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/catalog`,
      headers: auth(ownerToken),
    });
    return (list.json().sources as Array<{ id: string; coversIncident: boolean }>).find(
      (s) => s.id === "humboldt-parcels",
    )!.coversIncident;
  };
  const HUMBOLDT: [number, number, number, number] = [-124.44, 40.0, -123.41, 41.47];
  const SAN_DIEGO: [number, number, number, number] = [-117.6, 32.5, -116.1, 33.5];

  it("parcel coverage follows the incident area, not a hard-coded county", async () => {
    const r1 = await setArea(inBox(HUMBOLDT), 0);
    expect(r1.statusCode).toBe(200);
    expect(await coversParcels()).toBe(true);
    const r2 = await setArea(inBox(SAN_DIEGO), r1.json().revision as number);
    expect(r2.statusCode).toBe(200);
    expect(await coversParcels()).toBe(false); // uncovered area stays explicitly unknown
  });

  it("renders a configured parcel with its APN and outline on the COP", async () => {
    const cur = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/operational-area`,
      headers: auth(ownerToken),
    });
    await setArea(inBox(HUMBOLDT), cur.json().revision as number);
    const onboard = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/catalog/humboldt-parcels/onboard`,
      headers: auth(ownerToken),
    });
    expect(onboard.statusCode).toBe(201);
    const parcelDatasetId = (await admin`select id from data_pack_datasets where key = 'humboldt_parcels'`)[0]!
      .id as string;
    const parcel = {
      type: "Feature",
      properties: { APN: "511-021-14", UseCode: "Residential" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-124.1, 40.8], [-124.09, 40.8], [-124.09, 40.81], [-124.1, 40.81], [-124.1, 40.8]]],
      },
    };
    const load = await app.inject({
      method: "POST",
      url: `/api/v1/data-packs/datasets/${parcelDatasetId}/load`,
      headers: auth(ownerToken),
      payload: { records: [parcel] },
    });
    expect(load.statusCode).toBe(200);
    const feats = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${parcelDatasetId}/items`,
      headers: auth(ownerToken),
    });
    const fc = feats.json() as {
      features: Array<{ properties: Record<string, unknown>; geometry: { type: string } }>;
    };
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties.title).toBe("511-021-14"); // APN via the catalog field mapping
    expect(fc.features[0]!.geometry.type).toBe("Polygon"); // selectable parcel outline
  });
});
