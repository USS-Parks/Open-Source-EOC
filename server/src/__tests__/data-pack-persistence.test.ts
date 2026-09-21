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
 * idempotent; a changed batch updates and prunes; an invalid batch is rejected
 * atomically and leaves the last-good items untouched; two datasets stay apart.
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

  it("rejects an invalid batch atomically and preserves the last-good items", async () => {
    const before = (await items(datasetId)).map((x) => x.source_id);
    // A non-geometry value in the geometry field rejects the whole load.
    expect((await load(datasetId, { records: [{ id: "z", title: "Broken", geom: "not-a-geometry" }] })).statusCode).toBe(400);
    // A source that reuses an id in one batch is rejected too.
    expect((await load(datasetId, { records: [pt("x", "One"), pt("x", "Two")] })).statusCode).toBe(400);
    expect((await items(datasetId)).map((x) => x.source_id)).toEqual(before);
  });

  it("keeps two datasets isolated", async () => {
    await load(otherDatasetId, { records: [{ id: "s1", title: "Sensor 1" }] });
    expect((await items(otherDatasetId)).map((x) => x.source_id)).toEqual(["s1"]);
    expect((await items(datasetId)).map((x) => x.source_id)).toEqual(["a", "c", "d"]);
  });
});
