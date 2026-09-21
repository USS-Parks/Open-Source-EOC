import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string;
let ownerToken: string, coordinatorToken: string, viewerToken: string, outsiderToken: string;
let firstIncident: string, secondIncident: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return r.json().accessToken as string;
}
async function activate(name: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(ownerToken), payload: { templateKey: "daily_ops", name } });
  expect(r.statusCode).toBe(201);
  return r.json().incidentId as string;
}
async function grant(incidentId: string, email: string, role: string) {
  return app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/participants`,
    headers: auth(ownerToken), payload: { organizationSlug: "valley-mutual-aid", personEmail: email,
      incidentPositionTitle: "Data Liaison", role, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "Bring partner datasets" } });
}
const pack = (over: Record<string, unknown> = {}) => ({
  name: "Valley Mutual Aid data", organizationSlug: "valley-mutual-aid",
  datasets: [{ key: "closures", name: "Road closures", kind: "geojson",
    url: "https://example.org/closures.json", fieldMapping: { title: "properties.name" },
    coverage: { type: "Polygon", coordinates: [[[-124, 40], [-123, 40], [-123, 41], [-124, 41], [-124, 40]]] } }],
  ...over,
});
const register = (incidentId: string, token: string, body: Record<string, unknown> = pack()) =>
  app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/data-packs`, headers: auth(token), payload: body });
const listDatasets = (incidentId: string, token: string) =>
  app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}/datasets`, headers: auth(token) });

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "valley-city", "Valley City EOC");
  partnerId = await createJurisdiction(admin, "valley-mutual-aid", "Valley Mutual Aid");
  const outsiderOrg = await createJurisdiction(admin, "ridge-county", "Ridge County EOC");
  const ownerAdmin = await createPerson(admin, { email: "city@example.org", displayName: "City Admin", password: "owner-good-password" });
  const coordinator = await createPerson(admin, { email: "coord@example.org", displayName: "Coordinator", password: "coord-good-password" });
  const viewer = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-good-password" });
  const outsider = await createPerson(admin, { email: "out@example.org", displayName: "Outsider", password: "outsider-good-password" });
  await addMembership(admin, ownerAdmin, ownerId, "admin");
  await addMembership(admin, coordinator, partnerId, "member");
  await addMembership(admin, viewer, partnerId, "member");
  await addMembership(admin, outsider, outsiderOrg, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  ownerToken = await login("city@example.org", "owner-good-password");
  coordinatorToken = await login("coord@example.org", "coord-good-password");
  viewerToken = await login("viewer@example.org", "viewer-good-password");
  outsiderToken = await login("out@example.org", "outsider-good-password");
  firstIncident = await activate("Valley Response");
  secondIncident = await activate("Separate Flood");
  expect((await grant(firstIncident, "coord@example.org", "coordinator")).statusCode).toBe(201);
  expect((await grant(firstIncident, "viewer@example.org", "viewer")).statusCode).toBe(201);
});
afterAll(async () => { await app.close(); await runtime.end(); await admin.end(); });

describe("activation-time data-pack onboarding", () => {
  it("onboards a partner's datasets, keeps missing data non-zero, and isolates incidents", async () => {
    // A coordinator of the partner org onboards its pack at runtime, no redeploy.
    const created = await register(firstIncident, coordinatorToken);
    expect(created.statusCode).toBe(201);
    expect(created.json().pack.datasetKeys).toEqual(["closures"]);

    // A freshly onboarded dataset is awaiting, never zero, and carries its
    // source owner and coverage.
    const listed = await listDatasets(firstIncident, ownerToken);
    expect(listed.statusCode).toBe(200);
    const ds = listed.json().datasets.find((d: { key: string }) => d.key === "closures");
    expect(ds).toMatchObject({ organizationName: "Valley Mutual Aid", availability: "awaiting" });
    expect(ds.itemCount).toBeNull(); // missing is not zero
    expect(ds.coverageArea).toBeGreaterThan(0);

    // The partner (a reader of the incident) sees the same dataset.
    expect((await listDatasets(firstIncident, coordinatorToken)).statusCode).toBe(200);
    // The owner incident's datasets never leak into a separate incident.
    expect((await listDatasets(secondIncident, ownerToken)).json().datasets).toEqual([]);
    // An uninvolved organization cannot read the incident at all.
    expect((await listDatasets(firstIncident, outsiderToken)).statusCode).toBe(404);

    // Load applies the field mapping and records real freshness and count.
    const datasetId = (await admin`select id from data_pack_datasets where key = 'closures'`)[0]!.id as string;
    const loaded = await app.inject({ method: "POST", url: `/api/v1/data-packs/datasets/${datasetId}/load`,
      headers: auth(coordinatorToken), payload: { records: [{ properties: { name: "SR-96 closed" } }, { properties: {} }] } });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().result).toMatchObject({ availability: "available", itemCount: 2 });
    const after = await listDatasets(firstIncident, ownerToken);
    expect(after.json().datasets[0]).toMatchObject({ availability: "available", itemCount: 2 });

    // A load failure is recorded; the dataset reports unavailable, not zero.
    const failKey = pack({ datasets: [{ key: "sensors", name: "Sensors", kind: "geojson",
      url: "https://example.org/s.json", fieldMapping: { title: "n" } }] });
    expect((await register(firstIncident, coordinatorToken, failKey)).statusCode).toBe(201);
    const sensorsId = (await admin`select id from data_pack_datasets where key = 'sensors'`)[0]!.id as string;
    const failed = await app.inject({ method: "POST", url: `/api/v1/data-packs/datasets/${sensorsId}/load`,
      headers: auth(coordinatorToken), payload: { error: "source unreachable" } });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().result).toMatchObject({ availability: "unavailable", itemCount: null });
  });

  it("denies onboarding to viewers and uninvolved organizations", async () => {
    // A read-only participant cannot onboard datasets.
    expect((await register(firstIncident, viewerToken)).statusCode).toBe(403);
    // An outsider cannot reach the incident.
    expect((await register(firstIncident, outsiderToken)).statusCode).toBe(404);
    // A coordinator cannot onboard a pack for an organization that is not theirs.
    const foreign = await register(firstIncident, coordinatorToken, pack({ organizationSlug: "valley-city" }));
    expect(foreign.statusCode).toBe(403);
  });
});
