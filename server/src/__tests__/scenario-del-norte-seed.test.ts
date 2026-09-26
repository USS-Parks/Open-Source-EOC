import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { DEL_NORTE_PASSWORD, seedDelNorte } from "../demo/del-norte.js";
import { placeOnScenarioClock, type ScenarioRun } from "../demo/scenario-kit.js";
import { auth } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";
import { countyOf, expectExerciseLayers, recordsInside, verticesOf } from "./scenario-geography.js";

/**
 * The Del Norte Atmospheric Rivers exercise as its seed writes it through the
 * API: the counts the console reads, times on the scenario clock, every place
 * in Del Norte County, and the exercise layers drawn from the basemap's
 * rivers, low ground and roads rather than by hand.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let scenario: ScenarioRun;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  scenario = await seedDelNorte(app, admin);
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

describe("the Del Norte Atmospheric Rivers seed", () => {
  it("holds the counts the console reads", async () => {
    const shelters = await records("shelters");
    expect(shelters).toHaveLength(7);
    expect(shelters.filter((row) => !row.data.planned).reduce((sum, row) => sum + Number(row.data.occupancy), 0)).toBe(331);
    const reports = await records("field_reports");
    expect(reports).toHaveLength(40);
    expect(reports.filter((row) => row.data.verified === true)).toHaveLength(32);
    expect(await records("road_closures")).toHaveLength(7);
    expect(await records("incident_facilities")).toHaveLength(14);
    expect(await records("significant_events")).toHaveLength(13);
    const [requests] = await admin`select count(*)::int as n from resource_requests where incident_id = ${scenario.incidentId}`;
    expect(requests!.n).toBe(24);
  });

  it("puts every time on the scenario clock and in the past", async () => {
    const [latest] = await admin`select max(created_at) as at from board_records where incident_id = ${scenario.incidentId}`;
    expect(new Date(latest!.at as string).getTime()).toBeLessThanOrEqual(scenario.clock.getTime());
    expect(scenario.clock.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("puts every place in Del Norte County", async () => {
    const rows = await admin`select r.data from board_records r where r.incident_id = ${scenario.incidentId} and r.data ? 'location'`;
    expect(rows.length).toBeGreaterThan(80);
    for (const { data } of rows) {
      const named = String(data.name ?? data.summary ?? data.road ?? "");
      for (const vertex of verticesOf(data.location)) expect(countyOf(vertex), `${named} ${vertex.join(",")}`).toBe("Del Norte");
    }
  });

  it("places the county's contacts at their posts in Del Norte County, so the area tool finds them", async () => {
    const located = await admin`
      select name, ST_X(location) as lon, ST_Y(location) as lat from contacts
      where jurisdiction_id = ${scenario.jurisdictionId} and location is not null`;
    expect(located.length).toBeGreaterThanOrEqual(6);
    for (const row of located) expect(countyOf([row.lon as number, row.lat as number]), row.name as string).toBe("Del Norte");
  });

  it("draws the exercise layers from the basemap: synthetic, valid and in Del Norte County", async () => {
    const datasets = await admin`
      select d.key, d.item_count from data_pack_datasets d join data_packs p on p.id = d.pack_id
      where p.incident_id = ${scenario.incidentId} order by d.key`;
    expect(datasets.map((row) => [row.key, row.item_count])).toEqual([["flood_extents", 4], ["outage_areas", 3], ["slides", 4]]);
    const items = await expectExerciseLayers(admin, scenario.incidentId, "Del Norte");
    expect(items.size).toBe(11);
  });

  it("keeps a time it wrote in place when seeding runs across that time", async () => {
    // The latest lifeline assessment's next update, placed as if an API call had been running at that very moment.
    const [assessment] = await admin`
      select id, next_update_at from operational_assessments
      where incident_id = ${scenario.incidentId} and next_update_at is not null order by assessed_at desc limit 1`;
    const nextUpdate = new Date(assessment!.next_update_at as string);
    const crossed = {
      ...scenario,
      startedAt: new Date(nextUpdate.getTime() - 1_000),
      endedAt: new Date(nextUpdate.getTime() + 1_000),
      windows: [{
        startedAt: new Date(nextUpdate.getTime() - 500), endedAt: new Date(nextUpdate.getTime() + 500),
        scenarioAt: new Date(scenario.clock.getTime() - 3 * 60 * 60 * 1000),
      }],
    };
    // Moved onto the call's scenario time, the next update would fall before the assessment it follows.
    await expect(placeOnScenarioClock(admin, { ...crossed, supplied: [] })).rejects.toThrow(/next_update_after_assessment/);
    await placeOnScenarioClock(admin, crossed);
    const [after] = await admin`select next_update_at from operational_assessments where id = ${assessment!.id as string}`;
    expect(new Date(after!.next_update_at as string).getTime()).toBe(nextUpdate.getTime());
  });

  it("keeps every open shelter out of the flood", async () => {
    expect(await recordsInside(admin, scenario.incidentId, "shelters", ["Flood extent"])).toEqual([]);
  });

  it("gives the task, shelter and after-action dashboards their inputs", async () => {
    const get = async <T,>(email: string, url: string): Promise<T> => {
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: DEL_NORTE_PASSWORD } });
      const response = await app.inject({ method: "GET", url, headers: auth(login.json().accessToken as string) });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
      return response.json() as T;
    };
    const tally = (values: readonly string[]) => {
      const counts: Record<string, number> = {};
      for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    };
    const id = scenario.incidentId;

    // Tasks: six categories, every status, three past due at the clock.
    const { tasks } = await get<{ tasks: { category: string; status: string; dueAt: string | null }[] }>("alex.rivera@delnorte.example", `/api/v1/incidents/${id}/tasks`);
    expect(tasks).toHaveLength(23);
    expect(tally(tasks.map((task) => task.status))).toEqual({ open: 7, in_progress: 5, completed: 11 });
    expect(Object.keys(tally(tasks.map((task) => task.category))).sort())
      .toEqual(["command", "logistics", "mass_care", "operations", "planning", "public_information"]);
    expect(tasks.filter((task) => task.status !== "completed" && new Date(task.dueAt!) < scenario.clock)).toHaveLength(3);

    // Shelters: occupancy and status changes across the storms, so the history chart has a shape.
    const [board] = await admin`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${id} and b.template_key = 'shelters'`;
    const boardId = board!.id as string;
    const open = await admin`select id from board_records where board_id = ${boardId} and data->>'planned' = 'false'`;
    let changes = 0;
    for (const shelter of open) {
      const { entries } = await get<{ entries: unknown[] }>("alex.rivera@delnorte.example",
        `/api/v1/boards/${boardId}/records/${shelter.id as string}/history?incidentId=${id}`);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      changes += entries.length - 1;
    }
    expect(changes).toBe(19);

    // Humboldt County's corrective actions, recorded as a participant, under its all-incidents rollup.
    const rollup = await get<{ correctiveActions: { incidentId: string; organizationName: string | null; status: string }[] }>(
      "b.lund@humboldt.example", "/api/v1/aar/rollup");
    const actions = rollup.correctiveActions.filter((action) => action.incidentId === id);
    expect(actions.map((action) => action.organizationName)).toEqual(["Humboldt County OES", "Humboldt County OES", "Humboldt County OES"]);
    expect(tally(actions.map((action) => action.status))).toEqual({ open: 1, in_progress: 1, complete: 1 });
  });
});
