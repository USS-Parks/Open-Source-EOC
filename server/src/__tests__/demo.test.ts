import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { principalForPerson } from "../auth/service.js";
import { computeDashboardConfig } from "../dashboards/config.js";
import { withPerson } from "../db/context.js";
import { ensureDemoData, type DemoResult } from "../demo/seed.js";
import { computeSpatialImpact } from "../impact/spatial.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The demo dataset and the facet coverage gate (VEOC-41/D32). The dataset
 * loads through the real services, remains visibly synthetic, includes honest
 * unknown/stale/partial states, and performs no outbound alert delivery.
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
  it("stands up a synthetic incident with honest operational states", async () => {
    expect(result.jurisdictionId).toBeTruthy();
    expect(result.incidentId).toBeTruthy();

    const [boards] = await admin`
      select count(*)::int as n from incident_boards where incident_id = ${result.incidentId}`;
    expect(boards!.n).toBeGreaterThan(0);
    const [fieldBoard] = await admin`select b.id from boards b
      join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${result.incidentId} and b.template_key = 'field_reports'`;
    expect(fieldBoard?.id).toBeTruthy();
    const [records] = await admin`select count(*)::int as n from board_records
      where incident_id = ${result.incidentId}`;
    expect(records!.n).toBeGreaterThanOrEqual(2);
    const [incident] = await admin`select name from incidents where id = ${result.incidentId}`;
    expect(incident!.name).toContain("SYNTHETIC");

    const [area] = await admin`select revision, period_label,
      geometry is not null as has_geometry from incident_area_revisions
      where incident_id = ${result.incidentId}`;
    expect(area).toMatchObject({ revision: 1, period_label: "OP SYNTHETIC 1", has_geometry: true });

    const lifelines = await admin`select definition_key, condition, assessed_at, payload
      from operational_assessments where incident_id = ${result.incidentId}
        and domain = 'lifeline' order by definition_key`;
    expect(lifelines).toHaveLength(3);
    expect(lifelines.some((row) => row.condition === "unknown")).toBe(true);
    expect(lifelines.some((row) => row.condition === "unstable")).toBe(true);
    expect(lifelines.some((row) => new Date(row.assessed_at as string).getTime()
      < Date.now() - 24 * 60 * 60 * 1_000)).toBe(true);
    const communications = lifelines.find((row) => row.definition_key === "communications");
    expect(communications?.payload).toMatchObject({ confidence: "unknown", actions: [], evidence: [] });

    const esfs = await admin`select definition_key, activation, capacity, assessed_at
      from operational_assessments where incident_id = ${result.incidentId}
        and domain = 'esf' order by definition_key`;
    expect(esfs).toHaveLength(3);
    expect(esfs.some((row) => row.activation === "unknown" && row.capacity === "unknown")).toBe(true);
    expect(esfs.some((row) => new Date(row.assessed_at as string).getTime()
      < Date.now() - 24 * 60 * 60 * 1_000)).toBe(true);

    const [tasks] = await admin`select
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where status = 'in_progress')::int as in_progress
      from checklist_items where incident_id = ${result.incidentId}`;
    expect(tasks!.open).toBeGreaterThan(0);
    expect(tasks!.in_progress).toBeGreaterThan(0);
    const [operatorTask] = await admin`
      select c.status, pa.person_id from checklist_items c
      join positions p on p.id = c.position_id
      join position_assignments pa on pa.position_id = p.id and pa.revoked_at is null
      where c.incident_id = ${result.incidentId}
        and p.key = 'operations_section_chief' and c.status = 'in_progress'`;
    expect(operatorTask).toMatchObject({ status: "in_progress", person_id: result.memberId });

    const [form] = await admin`select title, board_template from form_definitions
      where jurisdiction_id = ${result.jurisdictionId} and key = 'synthetic_field_report'`;
    expect(form).toMatchObject({
      title: "SYNTHETIC rapid field report",
      board_template: "field_reports",
    });

    const impact = await computeSpatialImpact(admin, result.incidentId, 1);
    expect(impact.categories.closures).toMatchObject({
      coverage: "partial",
      value: null,
    });
    expect(impact.categories.closures.reason).toContain("partial");
    const syntheticSource = impact.categories.closures.sources.find(
      (source) => source.datasetKey === "caltrans_lcs_closures",
    );
    expect(syntheticSource).toMatchObject({
      datasetName: "SYNTHETIC partial road coverage — not Caltrans data",
      coverage: "partial",
      contributingRecords: 1,
    });

    const viewer = await principalForPerson(admin, result.viewerId);
    const overview = await withPerson(admin, result.viewerId, (tx) =>
      computeDashboardConfig(
        tx,
        viewer,
        result.incidentId,
        "incident-overview",
        undefined,
        undefined,
        null,
      ));
    expect(overview).toMatchObject({
      key: "incident-overview",
      revision: 1,
      title: "SYNTHETIC Incident Overview",
      scope: { kind: "incident-area" },
    });
    expect(overview.panels.map((panel) => [panel.key, panel.presentation, panel.state])).toEqual([
      ["lifeline_status", "status", "missing"],
      ["closure_map", "map", "ready"],
      ["closure_list", "list", "ready"],
    ]);
    const closureList = overview.panels.find((panel) => panel.key === "closure_list");
    expect(closureList?.data).toMatchObject({ kind: "list" });
    expect((closureList?.data as { records?: unknown[] } | null)?.records).toHaveLength(1);

    const [cap] = await admin`select origin, status, incident_id, alert
      from cap_alerts where id = ${result.capAlertId}`;
    expect(cap!.origin).toBe("authored");
    expect(cap!.status).toBe("Exercise");
    expect(cap!.incident_id).toBe(result.incidentId);
    expect(cap!.alert).toMatchObject({ status: "Exercise" });
    const [outbound] = await admin`select count(*)::int as n from ipaws_submissions
      where cap_alert_id = ${result.capAlertId}`;
    expect(outbound?.n ?? 0).toBe(0);

    const [rr] = await admin`select state, incident_id, item
      from resource_requests where id = ${result.resourceRequestId}`;
    expect(rr).toMatchObject({ state: "triaged", incident_id: result.incidentId });
    expect(rr!.item).toContain("SYNTHETIC");
    const [rel] = await admin`select status, incident_id, title
      from press_releases where id = ${result.releaseId}`;
    expect(rel).toMatchObject({ status: "draft", incident_id: result.incidentId });
    expect(rel!.title).toContain("SYNTHETIC");
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
