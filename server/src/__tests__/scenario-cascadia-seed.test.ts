import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { seedCascadia } from "../demo/cascadia.js";
import { placeOnScenarioClock, type ScenarioRun } from "../demo/scenario-kit.js";
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
});
