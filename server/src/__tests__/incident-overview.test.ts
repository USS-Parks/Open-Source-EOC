import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, placeOnScenarioClock, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { auth } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The incident overview's engines against a real database: the counts, the
 * recent activity, request and task numbers, and adding a task, all read from
 * the North Coast Storm scenario as its seed wrote it through the API.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let scenario: NorthCoastScenario;

async function token(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: NORTH_COAST_PASSWORD } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  scenario = await seedNorthCoast(app, admin);
  await placeOnScenarioClock(admin, scenario);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the incident overview's engines", () => {
  it("counts the scenario for the current operational period", async () => {
    const lee = await token("jordan.lee@humboldt.example");
    const response = await app.inject({ method: "GET", url: `/api/v1/incidents/${scenario.incidentId}/summary`, headers: auth(lee) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      incidentId: scenario.incidentId,
      period: { label: "OP 03" },
      openRequests: 24,
      urgentRequests: 6,
      activeShelters: 8,
      shelterOccupants: 312,
      fieldReports: 46,
      unverifiedFieldReports: 9,
      tasksDue: 12,
      participatingOrganizations: 7,
    });
    const earlier = await app.inject({ method: "GET", url: `/api/v1/incidents/${scenario.incidentId}/summary?periodRevision=1`, headers: auth(lee) });
    expect(earlier.json()).toMatchObject({ period: { label: "OP 01" }, tasksDue: 0 });
    const missing = await app.inject({ method: "GET", url: `/api/v1/incidents/${scenario.incidentId}/summary?periodRevision=99`, headers: auth(lee) });
    expect(missing.statusCode).toBe(404);
  });

  it("lists recent activity newest first with each author's organization and the record's fields", async () => {
    const lee = await token("jordan.lee@humboldt.example");
    const response = await app.inject({ method: "GET", url: `/api/v1/incidents/${scenario.incidentId}/activity?limit=3`, headers: auth(lee) });
    expect(response.statusCode, response.body).toBe(200);
    const [first, second] = response.json().entries as Array<Record<string, unknown>>;
    expect(first).toMatchObject({ category: "board.record.updated", person: "L. Moreno", organization: "Humboldt County OES",
      payload: { board: "shelters", patch: { occupancy: 187 } }, record: { name: "Arcata Community Center", capacity: 240 } });
    expect(second).toMatchObject({ category: "board.record.created", person: "Taylor Kim",
      record: { summary: "Flooding on 14th St near Eureka High School. Photos attached." } });
    expect(Date.parse(first!.at as string)).toBeGreaterThan(Date.parse(second!.at as string));

    // A participating organization reads the counts its grant allows, but not the owner's record of events.
    const partner = await token("r.kim@caltrans.example");
    const refused = await app.inject({ method: "GET", url: `/api/v1/incidents/${scenario.incidentId}/activity`, headers: auth(partner) });
    expect(refused.statusCode).toBe(403);
    const counts = await app.inject({ method: "GET", url: `/api/v1/incidents/${scenario.incidentId}/summary`, headers: auth(partner) });
    expect(counts.statusCode, counts.body).toBe(200);
  });

  it("numbers requests and tasks, and lets the owner's administrator add a task", async () => {
    const lee = await token("jordan.lee@humboldt.example");
    const requests = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${scenario.jurisdictionId}/resource-requests?incidentId=${scenario.incidentId}`, headers: auth(lee) });
    const list = requests.json().requests as Array<{ number: number; item: string; neededBy: string | null }>;
    expect(new Set(list.map((request) => request.number)).size).toBe(list.length);
    expect(Math.min(...list.map((request) => request.number))).toBeGreaterThanOrEqual(1001);
    expect(list.find((request) => request.item === "Generator support for Wendy's Shelter")?.neededBy).toBeTruthy();

    const payload = { item: "Stage sandbags at the Arcata Marsh gate", category: "operations", dueAt: new Date(scenario.clock.getTime() + 60 * 60 * 1000).toISOString() };
    const member = await token("d.nguyen@humboldt.example");
    const refused = await app.inject({ method: "POST", url: `/api/v1/incidents/${scenario.incidentId}/tasks`, headers: auth(member), payload });
    expect(refused.statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: `/api/v1/incidents/${scenario.incidentId}/tasks`, headers: auth(lee), payload });
    expect(created.statusCode, created.body).toBe(201);
    const task = created.json();
    expect(task).toMatchObject({ item: payload.item, category: "operations", status: "open", dueAt: payload.dueAt });
    expect(task.number).toBeGreaterThanOrEqual(201);
    const [audit] = await admin`select category, payload from audit_events where subject_id = ${task.id as string}`;
    expect(audit).toMatchObject({ category: "checklist.task.created", payload: { number: task.number } });
  });
});
