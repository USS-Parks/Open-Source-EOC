import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let incidentId: string;
let datasetId: string;
let adminToken: string;
let outsiderToken: string;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

function square(id: string, west: number, south: number, east: number, north: number) {
  return {
    id,
    zone: id === "moderate" ? "X" : "AE",
    subtype: id === "moderate" ? "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" : "",
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
  };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  const outsiderOrg = await createJurisdiction(admin, "outside-county", "Outside County");
  const outsider = await createPerson(admin, {
    email: "outside@example.org",
    displayName: "Outside Reader",
    password: "outside-good-password",
  });
  await addMembership(admin, outsider, outsiderOrg, "viewer");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("admin@example.org", "correct-horse-battery");
  outsiderToken = await login("outside@example.org", "outside-good-password");

  const incident = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "daily_ops", name: "Synthetic H11 flood fixture" },
  });
  expect(incident.statusCode).toBe(201);
  incidentId = incident.json().incidentId as string;

  const registered = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentId}/data-packs`,
    headers: auth(adminToken),
    payload: {
      name: "Synthetic local NFHL fixture",
      organizationSlug: "yurok",
      description: "Synthetic test polygons; no live FEMA data.",
      datasets: [{
        key: "fema_nfhl_flood",
        name: "Synthetic FEMA flood zones",
        kind: "geojson",
        fieldMapping: {
          title: "zone",
          category: "subtype",
          sourceId: "id",
          geometry: "geometry",
        },
      }],
    },
  });
  expect(registered.statusCode).toBe(201);
  datasetId = (await admin`
    select id from data_pack_datasets where pack_id = ${registered.json().pack.id as string}`)[0]!.id as string;

  const loaded = await app.inject({
    method: "POST",
    url: `/api/v1/data-packs/datasets/${datasetId}/load`,
    headers: auth(adminToken),
    payload: { records: [
      square("a-inside", 0.1, 0.1, 0.4, 0.4),
      square("b-inside", 0.8, 0.8, 1.1, 1.1),
      square("c-partial", 1.8, 1.8, 2.2, 2.2),
      square("moderate", 1.2, 0.2, 1.5, 0.5),
      square("z-outside", 4, 4, 5, 5),
    ] },
  });
  expect(loaded.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("dataset item area paging (H11)", () => {
  it("returns a deterministic, complete sequence of intersecting polygons", async () => {
    const first = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items?bbox=0,0,2,2&limit=2&offset=0`,
      headers: auth(adminToken),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().features.map((feature: { id: string }) => feature.id)).toEqual(["a-inside", "b-inside"]);
    expect(first.json().page).toEqual({ limit: 2, offset: 0, returned: 2, hasMore: true });

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items?bbox=0,0,2,2&limit=2&offset=2`,
      headers: auth(adminToken),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().features.map((feature: { id: string }) => feature.id)).toEqual(["c-partial", "moderate"]);
    expect(second.json().page).toEqual({ limit: 2, offset: 2, returned: 2, hasMore: false });
  });

  it("keeps the unpaged FeatureCollection compatible while exposing truncation state", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items`,
      headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().type).toBe("FeatureCollection");
    expect(response.json().features).toHaveLength(5);
    expect(response.json().page).toMatchObject({ offset: 0, returned: 5, hasMore: false });
  });

  it("validates the WGS84 bbox and preserves incident read authority", async () => {
    const malformed = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items?bbox=2,0,1,2`,
      headers: auth(adminToken),
    });
    expect(malformed.statusCode).toBe(400);

    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/items?bbox=0,0,2,2&limit=2`,
      headers: auth(outsiderToken),
    });
    expect(denied.statusCode).toBe(404);
  });
});
