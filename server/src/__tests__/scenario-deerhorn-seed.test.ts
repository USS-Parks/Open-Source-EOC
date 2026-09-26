import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { DEERHORN_ORIGIN, DEERHORN_PASSWORD, seedDeerhorn } from "../demo/deerhorn.js";
import { placeOnScenarioClock, type ScenarioRun } from "../demo/scenario-kit.js";
import { auth } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";
import { countyOf, expectExerciseLayers, recordsInside, verticesOf } from "./scenario-geography.js";

/**
 * The Deerhorn Lightning Complex exercise as its seed writes it through the
 * API: the counts the console reads, times on the scenario clock, every place
 * in its county, each government's alerts under its own authority, the joint
 * release waiting on two approvals, and cultural resource information kept
 * from the partners who are not the tribes.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let scenario: ScenarioRun;

async function token(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: DEERHORN_PASSWORD } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  scenario = await seedDeerhorn(app, admin);
  await placeOnScenarioClock(admin, scenario);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const records = (templateKey: string) => admin`
  select r.data, r.created_at from board_records r join boards b on b.id = r.board_id
  where r.incident_id = ${scenario.incidentId} and b.template_key = ${templateKey}`;

describe("the Deerhorn Lightning Complex seed", () => {
  it("holds the counts the console reads", async () => {
    const shelters = await records("shelters");
    const open = shelters.filter((row) => !row.data.planned);
    expect(shelters).toHaveLength(6);
    expect(open.reduce((sum, row) => sum + Number(row.data.occupancy), 0)).toBe(229);
    const reports = await records("field_reports");
    expect(reports).toHaveLength(36);
    expect(reports.filter((row) => row.data.verified === true)).toHaveLength(29);
    expect(await records("road_closures")).toHaveLength(5);
    expect(await records("incident_facilities")).toHaveLength(15);
    expect(await records("significant_events")).toHaveLength(10);
    const [requests] = await admin`select count(*)::int as n from resource_requests where incident_id = ${scenario.incidentId}`;
    expect(requests!.n).toBe(22);
    const [coordinator] = await admin`
      select p.role from incident_participants p join persons s on s.id = p.person_id
      where p.incident_id = ${scenario.incidentId} and s.email = 's.hayes@yurok.example'`;
    expect(coordinator!.role).toBe("coordinator");
  });

  it("puts every time on the scenario clock and in the past", async () => {
    const [latest] = await admin`select max(created_at) as at from board_records where incident_id = ${scenario.incidentId}`;
    expect(new Date(latest!.at as string).getTime()).toBeLessThanOrEqual(scenario.clock.getTime());
    expect(scenario.clock.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("puts every place in its county: Klamath in Del Norte, Somes Bar in Siskiyou, the rest in Humboldt", async () => {
    expect(countyOf(DEERHORN_ORIGIN)).toBe("Humboldt");
    const rows = await admin`
      select r.data from board_records r where r.incident_id = ${scenario.incidentId} and r.data ? 'location'`;
    expect(rows.length).toBeGreaterThan(60);
    for (const { data } of rows) {
      const named = String(data.name ?? data.summary ?? data.road ?? "");
      const expected = named.includes("Klamath") ? "Del Norte" : named.includes("Somes Bar") ? "Siskiyou" : "Humboldt";
      for (const vertex of verticesOf(data.location)) expect(countyOf(vertex), `${named} ${vertex.join(",")}`).toBe(expected);
    }
  });

  it("places the Tribe's contacts at their posts in the Hoopa Valley and Willow Creek, so the area tool finds them", async () => {
    const located = await admin`
      select name, ST_X(location) as lon, ST_Y(location) as lat from contacts
      where jurisdiction_id = ${scenario.jurisdictionId} and location is not null`;
    expect(located.length).toBeGreaterThanOrEqual(6);
    for (const row of located) expect(countyOf([row.lon as number, row.lat as number]), row.name as string).toBe("Humboldt");
  });

  it("keeps each government's alerts under its own authority", async () => {
    const alerts = await admin`
      select j.slug, a.incident_id, a.status from cap_alerts a join jurisdictions j on j.id = a.jurisdiction_id
      where a.alert->'info'->0->>'headline' like 'EXERCISE:%'`;
    const bySlug = (slug: string) => alerts.filter((row) => row.slug === slug);
    expect(bySlug("hoopa-oes")).toHaveLength(1);
    expect(bySlug("hoopa-oes")[0]!.incident_id).toBe(scenario.incidentId);
    expect(bySlug("yurok-oes")).toHaveLength(2);
    expect(bySlug("humboldt-oes")).toHaveLength(1);
    expect(alerts.every((row) => row.status === "Exercise")).toBe(true);
  });

  it("holds the joint release for the Yurok Tribe's and CAL FIRE's approval", async () => {
    const [release] = await admin`select id, status, required_agencies from press_releases where incident_id = ${scenario.incidentId}`;
    expect(release!.status).toBe("pending");
    expect(release!.required_agencies).toEqual(["Hoopa Valley Tribe", "Yurok Tribe", "CAL FIRE"]);
    const decisions = await admin`select agency from press_release_approvals where release_id = ${release!.id as string}`;
    expect(decisions.map((row) => row.agency)).toEqual(["Hoopa Valley Tribe"]);
  });

  it("draws the exercise layers from the data pack", async () => {
    const datasets = await admin`
      select d.key, d.item_count from data_pack_datasets d join data_packs p on p.id = d.pack_id
      where p.incident_id = ${scenario.incidentId} order by d.key`;
    expect(datasets.map((row) => [row.key, row.item_count])).toEqual([
      ["evacuation_areas", 4], ["fire_perimeters", 4], ["spot_fires", 3],
    ]);
    const items = await expectExerciseLayers(admin, scenario.incidentId, "Humboldt");
    expect(items.size).toBe(11);
  });

  it("puts the spot fires ahead of every fire and keeps the shelters out of the fires and the orders", async () => {
    const [near] = await admin`
      select count(*)::int as n from data_pack_items spot join data_pack_items fire on fire.incident_id = spot.incident_id
      where spot.incident_id = ${scenario.incidentId} and spot.data->>'category' = 'Spot fire'
        and fire.data->>'category' = 'Fire perimeter' and ST_DWithin(fire.geom::geography, spot.geom::geography, 50)`;
    expect(near!.n).toBe(0);
    expect(await recordsInside(admin, scenario.incidentId, "shelters", ["Fire perimeter", "Evacuation order"])).toEqual([]);
  });

  it("shows the cultural resource board to the tribes and not to CAL FIRE", async () => {
    const [board] = await admin`select id from boards where title = 'Cultural resources: Hoopa and Yurok only'`;
    const read = async (email: string) => (await app.inject({
      method: "GET", url: `/api/v1/boards/${board!.id as string}`, headers: auth(await token(email)),
    })).statusCode;
    expect(await read("t.quinn@hoopa.example")).toBe(200);
    expect(await read("d.lowe@yurok.example")).toBe(200);
    expect(await read("d.kowalski@calfire.example")).not.toBe(200);
    const entries = await admin`select data from board_records where board_id = ${board!.id as string}`;
    expect(entries).toHaveLength(3);
    expect(entries.every((row) => !("location" in row.data))).toBe(true);
  });

  it("gives the task, shelter and after-action dashboards their inputs", async () => {
    const get = async <T,>(email: string, url: string): Promise<T> => {
      const response = await app.inject({ method: "GET", url, headers: auth(await token(email)) });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
      return response.json() as T;
    };
    const tally = (values: readonly string[]) => {
      const counts: Record<string, number> = {};
      for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    };
    const id = scenario.incidentId;

    // Tasks: six categories, every status, four past due at the clock.
    const { tasks } = await get<{ tasks: { category: string; status: string; dueAt: string | null }[] }>("casey.morgan@hoopa.example", `/api/v1/incidents/${id}/tasks`);
    expect(tasks).toHaveLength(22);
    expect(tally(tasks.map((task) => task.status))).toEqual({ open: 6, in_progress: 4, completed: 12 });
    expect(Object.keys(tally(tasks.map((task) => task.category))).sort())
      .toEqual(["command", "cultural_resources", "logistics", "operations", "planning", "public_information"]);
    expect(tasks.filter((task) => task.status !== "completed" && new Date(task.dueAt!) < scenario.clock)).toHaveLength(4);

    // Shelters: occupancy and status changes through the night and the afternoon's orders.
    const [board] = await admin`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${id} and b.template_key = 'shelters'`;
    const boardId = board!.id as string;
    const open = await admin`select id from board_records where board_id = ${boardId} and data->>'planned' = 'false'`;
    let changes = 0;
    for (const shelter of open) {
      const { entries } = await get<{ entries: unknown[] }>("casey.morgan@hoopa.example",
        `/api/v1/boards/${boardId}/records/${shelter.id as string}/history?incidentId=${id}`);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      changes += entries.length - 1;
    }
    expect(changes).toBe(11);

    // Humboldt County's corrective actions, recorded as a participant, under its all-incidents rollup.
    const rollup = await get<{ correctiveActions: { incidentId: string; organizationName: string | null; status: string }[] }>(
      "m.ortega@humboldt.example", "/api/v1/aar/rollup");
    const actions = rollup.correctiveActions.filter((action) => action.incidentId === id);
    expect(actions.map((action) => action.organizationName)).toEqual(["Humboldt County OES", "Humboldt County OES", "Humboldt County OES"]);
    expect(tally(actions.map((action) => action.status))).toEqual({ open: 1, in_progress: 1, complete: 1 });
  });
});
