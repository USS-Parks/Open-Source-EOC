import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { DEERHORN_ORIGIN, DEERHORN_PASSWORD, seedDeerhorn } from "../demo/deerhorn.js";
import { placeOnScenarioClock, type ScenarioRun } from "../demo/scenario-kit.js";
import { auth } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";
import { countyOf, verticesOf } from "./scenario-geography.js";

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
});
