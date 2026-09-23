import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DamageSummary } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The Public Assistance damage inventory: writers record line items by FEMA
 * work category, row-level security keeps them inside the jurisdiction, the
 * counted cost moves the per-capita indicators off structure loss, and the
 * declaration summary carries the PA categories and the shelter census when
 * the facilities integration runs.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let withFacilities: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let memberToken: string;
let viewerToken: string;
let outsiderId: string;
let outsiderToken: string;
let otherIncidentId: string;
let ownIncidentId: string;

const THRESHOLDS = { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 25 };
type PaList = {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  totals: DamageSummary["publicAssistance"];
};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null, integrations: [] });
  withFacilities = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const viewerId = await createPerson(admin, { email: "pa-viewer@example.org", displayName: "Viewer", password: "another-good-password" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  viewerToken = await tokenFor(app, "pa-viewer@example.org", "another-good-password");
  const other = await createJurisdiction(admin, "pa-other", "Other County OES");
  outsiderId = await createPerson(admin, { email: "pa-outsider@example.org", displayName: "Out", password: "another-good-password" });
  await addMembership(admin, outsiderId, other, "member");
  outsiderToken = await tokenFor(app, "pa-outsider@example.org", "another-good-password");
  [{ id: otherIncidentId }] = (await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${other}, 'Other flood', 'incident', ${outsiderId}) returning id`) as unknown as [{ id: string }];
  [{ id: ownIncidentId }] = (await admin`
    insert into incidents (jurisdiction_id, name, kind, activated_by)
    values (${seed.jurisdictionId}, 'Winter Storms 2026', 'incident', ${seed.adminId}) returning id`) as unknown as [{ id: string }];
});

afterAll(async () => {
  await app.close();
  await withFacilities.close();
  await runtime.end();
  await admin.end();
});

const item = (overrides: Record<string, unknown> = {}) => ({
  applicant: "Yurok Tribe Public Works",
  category: "a_debris_removal",
  site: "Klamath River Road, mile 2",
  description: "Remove storm debris from the right of way",
  estimatedCostCents: 1_250_000_00,
  insured: false,
  percentComplete: 10,
  ...overrides,
});

async function add(payload: Record<string, unknown>, token = memberToken) {
  return app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`,
    headers: auth(token),
    payload,
  });
}

async function list(token = memberToken): Promise<PaList> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`,
    headers: auth(token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as PaList;
}

async function summary(target = app, thresholds: Record<string, unknown> = THRESHOLDS): Promise<DamageSummary> {
  const res = await target.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/summary`,
    headers: auth(memberToken),
    payload: thresholds,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as DamageSummary;
}

async function declaration(target = app): Promise<string[]> {
  const res = await target.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/declaration`,
    headers: auth(memberToken),
    payload: { ...THRESHOLDS, statePopulation: 1_000_000, statewidePerCapitaIndicator: 1.5, incident: "Winter Storms 2026" },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { document: string }).document.split("\n");
}

describe("Public Assistance line items", () => {
  it("divides structure loss while no PA line item is counted", async () => {
    const assessed = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/assessments`,
      headers: auth(memberToken),
      payload: { address: "1 River Rd", structureType: "single_family", degree: "destroyed", estimatedLoss: 200000 },
    });
    expect(assessed.statusCode).toBe(201);
    const s = await summary();
    expect(s.declaration).toMatchObject({ perCapitaBasis: "structure_loss", perCapitaAmount: 200000, perCapitaImpact: 40, statewide: null });
    expect(s.publicAssistance.items).toBe(0);
  });

  it("lets a member record line items and totals the counted ones by category", async () => {
    const debris = await add(item({ incidentId: ownIncidentId, location: { lon: -123.9, lat: 41.5 } }));
    expect(debris.statusCode, debris.body).toBe(201);
    expect((await add(item({ category: "c_roads_and_bridges", applicant: "Del Norte County Roads", estimatedCostCents: 30_000_05, status: "reviewed" }))).statusCode).toBe(201);
    expect((await add(item({ category: "f_utilities", applicant: "Klamath Community Services District", estimatedCostCents: 9_999_99, status: "draft" }))).statusCode).toBe(201);

    const listed = await list();
    expect(listed.items).toHaveLength(3);
    expect(listed.items[2]).toMatchObject({
      applicant: "Yurok Tribe Public Works", category: "a_debris_removal", incident_id: ownIncidentId,
      estimated_cost_cents: 125000000, insured: false, percent_complete: 10, status: "submitted", lon: -123.9, lat: 41.5,
    });
    // The draft is listed but not counted.
    expect(listed.totals.byCategory).toMatchObject({ a_debris_removal: 1_250_000, c_roads_and_bridges: 30_000.05, f_utilities: 0 });
    expect(listed.totals).toMatchObject({ totalCost: 1_280_000.05, items: 2 });

    const [audit] = await admin`
      select category, incident_id from audit_events where subject_id = ${(debris.json() as { id: string }).id}`;
    expect(audit).toEqual({ category: "damage.pa_item.created", incident_id: ownIncidentId });
  });

  it("switches the per-capita basis to PA cost and computes the statewide indicator when both figures are entered", async () => {
    const s = await summary();
    expect(s.declaration).toMatchObject({ perCapitaBasis: "pa_cost", perCapitaAmount: 1_280_000.05, paThresholdMet: true });
    expect(s.declaration.perCapitaImpact).toBeCloseTo(256.00001, 5);
    expect(s.totalEstimatedLoss).toBe(200000);
    const state = await summary(app, { ...THRESHOLDS, statePopulation: 1_000_000, statewidePerCapitaIndicator: 1.5 });
    expect(state.declaration.statewide).toMatchObject({ population: 1_000_000, indicator: 1.5, met: false });
  });

  it("edits a line item, and counts a draft once it is submitted", async () => {
    const draft = (await list()).items.find((row) => row.status === "draft")!;
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/damage/pa-items/${draft.id as string}`,
      headers: auth(memberToken),
      payload: item({ category: "f_utilities", applicant: "Klamath Community Services District", estimatedCostCents: 20_000_00, status: "submitted", percentComplete: 50, insured: null }),
    });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await admin`
      select category, estimated_cost_cents::int as cents, status, percent_complete, insured, updated_by
      from damage_pa_items where id = ${draft.id as string}`;
    expect(row).toEqual({ category: "f_utilities", cents: 2000000, status: "submitted", percent_complete: 50, insured: null, updated_by: seed.memberId });
    expect((await list()).totals).toMatchObject({ totalCost: 1_300_000.05, items: 3 });

    const missing = await app.inject({
      method: "PUT",
      url: "/api/v1/damage/pa-items/00000000-0000-4000-8000-000000000000",
      headers: auth(memberToken),
      payload: item(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses an unknown category, an out-of-range percent and another jurisdiction's incident", async () => {
    expect((await add(item({ category: "h_everything_else" }))).statusCode).toBe(400);
    expect((await add(item({ percentComplete: 101 }))).statusCode).toBe(400);
    expect((await add(item({ estimatedCostCents: 12.5 }))).statusCode).toBe(400);
    const foreign = await add(item({ incidentId: otherIncidentId }));
    expect(foreign.statusCode).toBe(400);
    expect(foreign.body).toContain("incident is not in this jurisdiction");
  });

  it("lets a viewer read but not write, and keeps an outsider out", async () => {
    expect((await list(viewerToken)).items).toHaveLength(3);
    expect((await add(item(), viewerToken)).statusCode).toBe(403);
    const id = (await list()).items[0]!.id as string;
    const edit = await app.inject({ method: "PUT", url: `/api/v1/damage/pa-items/${id}`, headers: auth(viewerToken), payload: item() });
    expect(edit.statusCode).toBe(403);
    const outside = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`,
      headers: auth(outsiderToken),
    });
    expect(outside.statusCode).toBe(403);
    // Below the route checks, row-level security holds the same wall.
    expect(await withPerson(runtime, outsiderId, (tx) => tx`select id from damage_pa_items`)).toHaveLength(0);
    await expect(withPerson(runtime, outsiderId, (tx) => tx`
      insert into damage_pa_items (jurisdiction_id, applicant, category, estimated_cost_cents, created_by, updated_by)
      values (${seed.jurisdictionId}, 'x', 'a_debris_removal', 1, ${outsiderId}, ${outsiderId})`)).rejects.toThrow(/row-level security/);
    const updated = await withPerson(runtime, outsiderId, (tx) => tx`update damage_pa_items set estimated_cost_cents = 0`);
    expect(updated.count).toBe(0);
  });
});

describe("shelter census and the declaration summary", () => {
  it("says the shelter census is not available while the facilities integration is off", async () => {
    expect((await summary()).shelterCensus).toBeNull();
    const doc = await declaration();
    for (const line of [
      "## Public Assistance: estimated cost by work category",
      "- Category A: Debris removal: $1,250,000.00",
      "- Category C: Roads and bridges: $30,000.05",
      "- Category F: Utilities: $20,000.00",
      "- Total, categories A to G: $1,300,000.05",
      "- Counted line items: 3",
      "- Basis: Public Assistance cost, categories A to G",
      "- County population (operator-entered): 5,000",
      "- State population (operator-entered): 1,000,000",
      "- Statewide threshold met: no",
      "## Shelter census",
      "- Shelter census not available: the facilities integration is not enabled on this server.",
    ]) expect(doc).toContain(line);
  });

  it("reads the latest report of each shelter when the facilities integration runs", async () => {
    const register = async (name: string, kind: string) => {
      const res = await withFacilities.inject({
        method: "POST",
        url: `/api/v1/jurisdictions/${seed.jurisdictionId}/facilities`,
        headers: auth(memberToken),
        payload: { name, kind },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { id: string }).id;
    };
    const report = async (id: string, available: number, baseline: number) => {
      const res = await withFacilities.inject({
        method: "POST",
        url: `/api/v1/facilities/${id}/status`,
        headers: auth(memberToken),
        payload: { operatingStatus: "normal", beds: [{ bedType: "other", available, baseline }] },
      });
      expect(res.statusCode, res.body).toBe(201);
    };
    const gym = await register("Klamath Gym", "shelter");
    const school = await register("Weitchpec School", "shelter");
    await register("Pecwan Hall", "shelter");
    const hospital = await register("Sutter Coast Hospital", "hospital");
    await report(gym, 90, 120);
    await report(gym, 40, 120);
    await report(school, 50, 60);
    await report(hospital, 3, 10);

    const census = (await summary(withFacilities)).shelterCensus!;
    expect(census).toMatchObject({ capacity: 180, occupied: 90, open: 90 });
    expect(census.shelters.map((s) => [s.name, s.capacity, s.open, s.reportedAt !== null]))
      .toEqual([["Klamath Gym", 120, 40, true], ["Pecwan Hall", 0, 0, false], ["Weitchpec School", 60, 50, true]]);

    const doc = await declaration(withFacilities);
    for (const line of [
      "- Source: the latest report from each shelter in the facilities integration",
      "- Shelters: 3, 2 reporting",
      "- Capacity: 180",
      "- Occupied: 90",
      "- Open spaces: 90",
      "- Pecwan Hall: no report yet",
    ]) expect(doc).toContain(line);
    expect(doc.some((line) => line.startsWith("- Klamath Gym: 80 occupied of 120, 40 open, reported "))).toBe(true);
    expect(doc.join("\n")).not.toContain("Sutter Coast Hospital");
  });
});
