import { summarizeAssessments } from "@openeoc/shared";
import { describe, expect, it } from "vitest";
import { ApiClient } from "../../app/api/client.js";
import {
  declarationFileName,
  declarationIndicators,
  parseThresholds,
  reportBounds,
  reportFeatures,
  type DamageReport,
} from "../model.js";

const report = (overrides: Partial<DamageReport>): DamageReport => ({
  id: "r1",
  address: "12 Oak St",
  structure_type: "single_family",
  degree: "destroyed",
  source: "public",
  status: "approved",
  estimated_loss: 180000,
  insured: false,
  notes: null,
  reporter_contact: null,
  created_at: "2026-09-23T18:00:00.000Z",
  lon: -123.8,
  lat: 41.2,
  ...overrides,
});

describe("declaration thresholds", () => {
  it("accepts whole positive population and non-negative indicators only", () => {
    expect(parseThresholds({ population: "5000", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25" }))
      .toEqual({ population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 25 });
    expect(parseThresholds({ population: "", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25" })).toBeNull();
    expect(parseThresholds({ population: "0", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25" })).toBeNull();
    expect(parseThresholds({ population: "12.5", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25" })).toBeNull();
    expect(parseThresholds({ population: "5000", paPerCapitaIndicator: "", iaResidenceThreshold: "25" })).toBeNull();
    expect(parseThresholds({ population: "5000", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "-1" })).toBeNull();
  });

  it("states each indicator against its threshold with the basis of the number", () => {
    const summary = summarizeAssessments([
      { degree: "destroyed", estimatedLoss: 180000, insured: false },
      { degree: "major", estimatedLoss: 60000, insured: true },
      { degree: "minor", estimatedLoss: 10000, insured: null },
    ], { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3 });
    const [pa, ia] = declarationIndicators(summary);
    expect(pa).toEqual({
      key: "pa",
      title: "Public Assistance per-capita indicator",
      met: true,
      measured: "$50.00 per resident",
      threshold: "$4.60 per resident",
      basis: "$250,000.00 counted loss divided by a population of 5,000.",
    });
    expect(ia).toEqual({
      key: "ia",
      title: "Individual Assistance residences",
      met: false,
      measured: "2 destroyed or major",
      threshold: "3 residences",
      basis: "1 destroyed plus 1 with major damage.",
    });
  });
});

describe("damage map layer", () => {
  it("maps positioned reports only, framed by degree status", () => {
    const layer = reportFeatures([
      report({}),
      report({ id: "r2", address: "40 Pine Rd", degree: "minor", lon: null, lat: null }),
      report({ id: "r3", address: "7 Elm Ct", degree: "inaccessible", source: "official", lon: -123.7, lat: 41.3 }),
    ]);
    expect(layer.features.map((f) => f.id)).toEqual(["r1", "r3"]);
    expect(layer.features[0]).toEqual({
      type: "Feature",
      id: "r1",
      geometry: { type: "Point", coordinates: [-123.8, 41.2] },
      properties: { title: "12 Oak St", degree: "Destroyed", source: "Public report", estimated_loss: "$180,000.00", severity: "critical" },
    });
    expect(layer.features[1]!.properties).toMatchObject({ degree: "Inaccessible", source: "Field assessment", severity: "unknown" });
  });

  it("frames the positioned reports with a margin and names the download by day", () => {
    const bounds = reportBounds([report({}), report({ id: "r2", lon: -123.7, lat: 41.3 }), report({ id: "r3", lon: null, lat: null })])!;
    expect(bounds.map((n) => Number(n.toFixed(2)))).toEqual([-123.81, 41.19, -123.69, 41.31]);
    expect(reportBounds([report({ lon: null, lat: null })])).toBeNull();
    expect(declarationFileName(new Date(2026, 8, 3, 23, 30))).toBe("declaration-support-2026-09-03.md");
  });
});

describe("damage client methods", () => {
  it("sends damage reads and changes to their routes", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    const thresholds = { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 25 };
    await client.listDamageReports("j/1");
    await client.listDamageReports("j/1", { status: "submitted", cursor: "next", limit: 50 });
    await client.moderateDamageReport("a/1", "rejected");
    await client.recordDamageAssessment("j/1", { address: "7 Elm Ct", structureType: "mobile_home", degree: "major", estimatedLoss: 60000, location: { lon: -123.7, lat: 41.3 } });
    await client.damageSummary("j/1", thresholds);
    await client.damageDeclaration("j/1", { ...thresholds, incident: "Winter storms" });
    await client.enableDamageIntake("j/1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/jurisdictions/j%2F1/damage/assessments",
      "GET /api/v1/jurisdictions/j%2F1/damage/assessments?cursor=next&limit=50&status=submitted",
      "POST /api/v1/damage/assessments/a%2F1/moderate",
      "POST /api/v1/jurisdictions/j%2F1/damage/assessments",
      "POST /api/v1/jurisdictions/j%2F1/damage/summary",
      "POST /api/v1/jurisdictions/j%2F1/damage/declaration",
      "POST /api/v1/jurisdictions/j%2F1/damage/intake/enable",
    ]);
    expect(calls.map((c) => c.body)).toEqual([
      undefined,
      undefined,
      { decision: "rejected" },
      { address: "7 Elm Ct", structureType: "mobile_home", degree: "major", estimatedLoss: 60000, location: { lon: -123.7, lat: 41.3 } },
      thresholds,
      { ...thresholds, incident: "Winter storms" },
      undefined,
    ]);
  });
});
