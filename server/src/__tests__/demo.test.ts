import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDemoData, type DemoResult } from "../demo/seed.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The demo dataset and the facet coverage gate (VEOC-41). The dataset loads
 * with the real services (so the demo is real data), and the scripted
 * scenario references every facet F1 through F20, checked here so the demo can
 * never silently drop a facet.
 */

let admin: Sql;
let result: DemoResult;

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  result = await ensureDemoData(admin);
}, 60000);

afterAll(async () => {
  if (admin) await admin.end();
});

describe("the demo dataset loads", () => {
  it("stands up a jurisdiction, incident, and a representative slice", async () => {
    expect(result.jurisdictionId).toBeTruthy();
    expect(result.incidentId).toBeTruthy();

    const [boards] = await admin`
      select count(*)::int as n from incident_boards where incident_id = ${result.incidentId}`;
    expect(boards!.n).toBeGreaterThan(0);
    const [records] = await admin`
      select count(*)::int as n from board_records`;
    expect(records!.n).toBeGreaterThanOrEqual(2);
    const [cap] = await admin`select origin from cap_alerts where id = ${result.capAlertId}`;
    expect(cap!.origin).toBe("authored");
    const [rr] = await admin`select state from resource_requests where id = ${result.resourceRequestId}`;
    expect(rr!.state).toBe("triaged");
    const [rel] = await admin`select status from press_releases where id = ${result.releaseId}`;
    expect(rel!.status).toBe("draft");
    const [obs] = await admin`
      select count(*)::int as n from aar_observations where incident_id = ${result.incidentId}`;
    expect(obs!.n).toBe(1);
  });
});

describe("the scripted scenario covers every facet", () => {
  it("references F1 through F20", () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "DEMO-SCENARIO.md");
    const text = readFileSync(path, "utf8");
    for (let i = 1; i <= 20; i += 1) {
      const re = new RegExp(`\\bF${i}\\b`);
      expect(re.test(text), `facet F${i} missing from the demo scenario`).toBe(true);
    }
  });
});
