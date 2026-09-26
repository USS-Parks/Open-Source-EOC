import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { seedCascadia } from "../demo/cascadia.js";
import { NORTH_COAST_PASSWORD } from "../demo/north-coast.js";
import { placeOnScenarioClock, zoned, type ScenarioRun } from "../demo/scenario-kit.js";
import { auth } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";
import { countyOf, expectExerciseLayers, recordsInside, verticesOf } from "./scenario-geography.js";

/**
 * The Cascadia Earthquake and Tsunami exercise as its seed writes it through
 * the API: the counts the console reads, times on the scenario clock, every
 * place in Humboldt County, and the exercise layers drawn from the basemap's
 * shoreline, low ground and roads rather than by hand.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let scenario: ScenarioRun;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  scenario = await seedCascadia(app, admin);
  await placeOnScenarioClock(admin, scenario);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const records = (templateKey: string) => admin`
  select r.data from board_records r join boards b on b.id = r.board_id
  where r.incident_id = ${scenario.incidentId} and b.template_key = ${templateKey}`;

describe("the Cascadia Earthquake and Tsunami seed", () => {
  it("holds the counts the console reads", async () => {
    const shelters = await records("shelters");
    expect(shelters).toHaveLength(11);
    expect(shelters.filter((row) => !row.data.planned).reduce((sum, row) => sum + Number(row.data.occupancy), 0)).toBe(2315);
    expect(await records("field_reports")).toHaveLength(30);
    expect(await records("road_closures")).toHaveLength(11);
    expect(await records("incident_facilities")).toHaveLength(13);
    expect(await records("significant_events")).toHaveLength(11);
  });

  it("puts every time on the scenario clock and in the past", async () => {
    const [latest] = await admin`select max(created_at) as at from board_records where incident_id = ${scenario.incidentId}`;
    expect(new Date(latest!.at as string).getTime()).toBeLessThanOrEqual(scenario.clock.getTime());
    expect(scenario.clock.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("puts every place in Humboldt County", async () => {
    const rows = await admin`select r.data from board_records r where r.incident_id = ${scenario.incidentId} and r.data ? 'location'`;
    expect(rows.length).toBeGreaterThan(60);
    for (const { data } of rows) {
      const named = String(data.name ?? data.summary ?? data.road ?? "");
      for (const vertex of verticesOf(data.location)) expect(countyOf(vertex), `${named} ${vertex.join(",")}`).toBe("Humboldt");
    }
  });

  it("draws the exercise layers from the basemap: synthetic, valid and in Humboldt County", async () => {
    const datasets = await admin`
      select d.key, d.item_count from data_pack_datasets d join data_packs p on p.id = d.pack_id
      where p.incident_id = ${scenario.incidentId} order by d.key`;
    expect(datasets.map((row) => [row.key, row.item_count])).toEqual([["hazards", 12], ["inundation", 4], ["liquefaction", 3]]);
    const items = await expectExerciseLayers(admin, scenario.incidentId, "Humboldt");
    expect(items.size).toBe(19);
  });

  it("keeps every open shelter on ground the tsunami did not reach", async () => {
    expect(await recordsInside(admin, scenario.incidentId, "shelters", ["Tsunami inundation", "Liquefaction"])).toEqual([]);
  });

  it("gives every dashboard its inputs, read as the county's lead reads them", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "a.delgado@humboldt.example", password: NORTH_COAST_PASSWORD } });
    const token = login.json().accessToken as string;
    const get = async <T,>(url: string): Promise<T> => {
      const response = await app.inject({ method: "GET", url, headers: auth(token) });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
      return response.json() as T;
    };
    const tally = (values: readonly string[]) => {
      const counts: Record<string, number> = {};
      for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    };
    const ended = ["closed", "declined", "cancelled"];
    const id = scenario.incidentId;
    const j = scenario.jurisdictionId;

    // Tasks: six categories, every status, four past due at the clock.
    const { tasks } = await get<{ tasks: { category: string; status: string; dueAt: string | null }[] }>(`/api/v1/incidents/${id}/tasks`);
    expect(tasks).toHaveLength(27);
    expect(tally(tasks.map((task) => task.status))).toEqual({ open: 4, in_progress: 10, completed: 13 });
    expect(Object.keys(tally(tasks.map((task) => task.category))).sort())
      .toEqual(["command", "logistics", "mass_care", "operations", "planning", "public_information"]);
    expect(tasks.filter((task) => task.status !== "completed" && new Date(task.dueAt!) < scenario.clock)).toHaveLength(4);

    // Plans in every display state.
    const iaps = await get<{ summary: { byState: Record<string, number> } }>(`/api/v1/incidents/${id}/iaps`);
    expect(iaps.summary.byState).toEqual({ not_started: 1, in_progress: 1, in_approval: 1, approved: 1, complete: 2 });

    // Requests: overdue ones, ended ones and recorded costs.
    const { requests } = await get<{ requests: { state: string; neededBy: string | null; costCents: number | null }[] }>(
      `/api/v1/jurisdictions/${j}/resource-requests?incidentId=${id}`);
    expect(requests).toHaveLength(24);
    expect(tally(requests.filter((request) => ended.includes(request.state)).map((request) => request.state)))
      .toEqual({ closed: 2, declined: 1, cancelled: 1 });
    expect(requests.filter((request) => !ended.includes(request.state) && new Date(request.neededBy!) < scenario.clock)).toHaveLength(5);
    expect(requests.filter((request) => (request.costCents ?? 0) > 0)).toHaveLength(9);

    // Damage: accepted reports in every FEMA degree, the intake queue, one rejection, and Public Assistance A to G in every status.
    const { assessments } = await get<{ assessments: { status: string; source: string; degree: string; structure_type: string; incident_id: string | null }[] }>(
      `/api/v1/jurisdictions/${j}/damage/assessments?incidentId=${id}`);
    expect(assessments.every((report) => report.incident_id === id)).toBe(true);
    const accepted = assessments.filter((report) => report.status === "approved");
    expect(tally(accepted.map((report) => report.degree))).toEqual({ affected: 2, minor: 3, major: 4, destroyed: 5, inaccessible: 2 });
    expect(new Set(accepted.map((report) => report.structure_type)).size).toBe(4);
    expect(tally(assessments.filter((report) => report.source === "public").map((report) => report.status))).toEqual({ submitted: 3, rejected: 1 });
    const { items } = await get<{ items: { category: string; status: string; incident_id: string }[] }>(`/api/v1/jurisdictions/${j}/damage/pa-items?incidentId=${id}`);
    expect(items.every((item) => item.incident_id === id)).toBe(true);
    expect(new Set(items.map((item) => item.category)).size).toBe(7);
    expect(tally(items.map((item) => item.status))).toEqual({ draft: 4, submitted: 6, reviewed: 3 });

    // Shelters: each open shelter's occupancy changed through the periods, so the history chart has a shape.
    const [board] = await admin`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${id} and b.template_key = 'shelters'`;
    const boardId = board!.id as string;
    const open = await admin`select id from board_records where board_id = ${boardId} and data->>'planned' = 'false'`;
    expect(open).toHaveLength(10);
    for (const shelter of open) {
      const { entries } = await get<{ entries: unknown[] }>(`/api/v1/boards/${boardId}/records/${shelter.id as string}/history?incidentId=${id}`);
      expect(entries.length).toBeGreaterThanOrEqual(3);
    }

    // After-action review: observations, and corrective actions across capabilities, priorities and statuses, past due and due later.
    const aar = await get<{
      observations: unknown[];
      correctiveActions: { capability: string; capabilityElement: string; priority: string; status: string; dueDate: string | null }[];
    }>(`/api/v1/incidents/${id}/aar/analytics`);
    expect(aar.observations).toHaveLength(9);
    const actions = aar.correctiveActions;
    expect(actions).toHaveLength(11);
    expect(new Set(actions.map((action) => action.capability)).size).toBe(10);
    expect(new Set(actions.map((action) => action.capabilityElement)).size).toBe(6);
    expect(tally(actions.map((action) => action.priority))).toEqual({ critical: 2, high: 4, medium: 3, low: 1, unspecified: 1 });
    expect(tally(actions.map((action) => action.status))).toEqual({ open: 6, in_progress: 3, complete: 2 });
    const today = zoned(scenario.clock).date;
    expect(actions.filter((action) => action.status !== "complete" && action.dueDate !== null && action.dueDate < today)).toHaveLength(2);
    const rollup = await get<{ correctiveActions: { incidentId: string }[] }>("/api/v1/aar/rollup");
    expect(rollup.correctiveActions.filter((action) => action.incidentId === id)).toHaveLength(11);
  });
});
