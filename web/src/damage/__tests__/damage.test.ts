import { publicAssistanceTotals, summarizeAssessments } from "@openeoc/shared";
import { describe, expect, it } from "vitest";
import { ApiClient } from "../../app/api/client.js";
import {
  EMPTY_PA_DRAFT,
  declarationFileName,
  declarationIndicators,
  paDraftOf,
  parseBaseline,
  parsePaDraft,
  parseThresholds,
  reportBounds,
  reportFeatures,
  type DamageReport,
  type PaItem,
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

  it("takes the state population and statewide indicator together or not at all", () => {
    const county = { population: "5000", paPerCapitaIndicator: "4.6", iaResidenceThreshold: "25" };
    expect(parseThresholds({ ...county, statePopulation: "", statewidePerCapitaIndicator: " " }))
      .toEqual({ population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 25 });
    expect(parseThresholds({ ...county, statePopulation: "1000000", statewidePerCapitaIndicator: "1.5" }))
      .toEqual({ population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 25, statePopulation: 1000000, statewidePerCapitaIndicator: 1.5 });
    expect(parseThresholds({ ...county, statePopulation: "1000000", statewidePerCapitaIndicator: "" })).toBeNull();
    expect(parseThresholds({ ...county, statePopulation: "", statewidePerCapitaIndicator: "1.5" })).toBeNull();
    expect(parseThresholds({ ...county, statePopulation: "0", statewidePerCapitaIndicator: "1.5" })).toBeNull();
  });

  it("states each indicator against its threshold with the basis of the number", () => {
    const rows = [
      { degree: "destroyed", estimatedLoss: 180000, insured: false },
      { degree: "major", estimatedLoss: 60000, insured: true },
      { degree: "minor", estimatedLoss: 10000, insured: null },
    ];
    const summary = summarizeAssessments(rows, { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3 });
    const [pa, ia] = declarationIndicators(summary);
    expect(pa).toEqual({
      key: "pa",
      title: "Public Assistance county per-capita indicator",
      met: true,
      measured: "$50.00 per resident",
      threshold: "$4.60 per resident, operator-entered",
      basis: "Structure loss, not Public Assistance cost: $250,000.00 estimated loss of counted structures, divided by an operator-entered county population of 5,000.",
    });
    expect(ia).toEqual({
      key: "ia",
      title: "Individual Assistance residences",
      met: false,
      measured: "2 destroyed or major",
      threshold: "3 residences, operator-entered",
      basis: "1 destroyed plus 1 with major damage.",
    });

    // Counted PA line items move the basis to PA cost, and the statewide pair adds its own indicator.
    const withPa = summarizeAssessments(
      rows,
      { population: 5000, paPerCapitaIndicator: 4.6, iaResidenceThreshold: 3, statePopulation: 1_000_000, statewidePerCapitaIndicator: 1.5 },
      publicAssistanceTotals([{ category: "a_debris_removal", costCents: 2_000_000_00, items: 3 }]),
    );
    const [county, state] = declarationIndicators(withPa);
    expect(county!.basis).toBe("Public Assistance cost: $2,000,000.00 in 3 counted line items, categories A to G, divided by an operator-entered county population of 5,000.");
    expect(county!.measured).toBe("$400.00 per resident");
    expect(state).toEqual({
      key: "pa_state",
      title: "Public Assistance statewide per-capita indicator",
      met: true,
      measured: "$2.00 per resident",
      threshold: "$1.50 per resident, operator-entered",
      basis: "Public Assistance cost: $2,000,000.00 in 3 counted line items, categories A to G, divided by an operator-entered state population of 1,000,000.",
    });
    expect(declarationIndicators(withPa).map((i) => i.key)).toEqual(["pa", "pa_state", "ia"]);
  });
});

describe("Public Assistance line item form", () => {
  const item: PaItem = {
    id: "p1", incident_id: null, applicant: "Del Norte County Roads", category: "c_roads_and_bridges", site: null,
    description: "Culvert washout", estimated_cost_cents: 3000005, insured: true, percent_complete: 40, status: "reviewed",
    lon: -123.9, lat: 41.5, created_at: "2026-09-23T18:00:00.000Z", updated_at: "2026-09-23T18:00:00.000Z",
  };

  it("round-trips a listed item through the form, dollars to cents", () => {
    const draft = paDraftOf(item);
    expect(draft).toMatchObject({ cost: "30000.05", insured: "insured", percent: "40", site: "", lon: "-123.9" });
    expect(parsePaDraft(draft)).toEqual({
      applicant: "Del Norte County Roads", category: "c_roads_and_bridges", site: null, description: "Culvert washout",
      estimatedCostCents: 3000005, insured: true, percentComplete: 40, status: "reviewed", location: { lon: -123.9, lat: 41.5 },
    });
    expect(parsePaDraft({ ...EMPTY_PA_DRAFT, applicant: " Klamath CSD ", cost: "19.99" }))
      .toMatchObject({ applicant: "Klamath CSD", estimatedCostCents: 1999, insured: null, percentComplete: 0, status: "submitted", location: null });
  });

  it("names the first field to fix", () => {
    const ok = { ...EMPTY_PA_DRAFT, applicant: "Klamath CSD", cost: "10" };
    expect(() => parsePaDraft({ ...ok, applicant: " " })).toThrow("Enter the applicant");
    expect(() => parsePaDraft({ ...ok, cost: "" })).toThrow("Enter the estimated cost");
    expect(() => parsePaDraft({ ...ok, cost: "-1" })).toThrow("Enter the estimated cost");
    expect(() => parsePaDraft({ ...ok, percent: "101" })).toThrow("percent complete");
    expect(() => parsePaDraft({ ...ok, percent: "2.5" })).toThrow("percent complete");
    expect(() => parsePaDraft({ ...ok, lon: "-123.9" })).toThrow("both longitude and latitude");
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

  it("sends Public Assistance line item reads and changes to their routes", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    const input = parsePaDraft({ ...EMPTY_PA_DRAFT, applicant: "Klamath CSD", category: "f_utilities", cost: "2500" });
    await client.listPaItems("j/1");
    await client.listPaItems("j/1", { cursor: "next" });
    await client.createPaItem("j/1", input);
    await client.updatePaItem("p/1", { ...input, incidentId: null });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/jurisdictions/j%2F1/damage/pa-items",
      "GET /api/v1/jurisdictions/j%2F1/damage/pa-items?cursor=next",
      "POST /api/v1/jurisdictions/j%2F1/damage/pa-items",
      "PUT /api/v1/damage/pa-items/p%2F1",
    ]);
    expect(calls[2]!.body).toEqual({
      applicant: "Klamath CSD", category: "f_utilities", site: null, description: "", estimatedCostCents: 250000,
      insured: null, percentComplete: 0, status: "submitted", location: null,
    });
    expect(calls[3]!.body).toMatchObject({ incidentId: null, estimatedCostCents: 250000 });
  });
});

describe("parcel baseline files", () => {
  it("reads a CSV with quoted cells, loose headers and optional coordinates", () => {
    const csv = 'Parcel ID,Address,structure_type,Replacement Value,lon,lat\r\n'
      + 'P-1,"12 Main St, Unit 2",single_family,"$250,000",-123.9,41.5\r\n'
      + 'P-2,"The ""Old"" Mill",business,90000,,\n\n';
    expect(parseBaseline(csv, "parcels.csv")).toEqual([
      { parcelId: "P-1", address: "12 Main St, Unit 2", structureType: "single_family", replacementValue: 250000, location: { lon: -123.9, lat: 41.5 } },
      { parcelId: "P-2", address: 'The "Old" Mill', structureType: "business", replacementValue: 90000 },
    ]);
  });

  it("passes JSON parcels through and names what a file lacks", () => {
    const rows = [{ parcelId: "P-3", address: "3 Oak", structureType: "mobile_home", replacementValue: 1 }];
    expect(parseBaseline(JSON.stringify(rows), "parcels.json")).toEqual(rows);
    expect(parseBaseline(JSON.stringify({ rows }), "upload")).toEqual(rows);
    expect(() => parseBaseline("parcelId,address\nP,1 Main", "p.csv")).toThrow("needs parcelId, address, structureType and replacementValue");
    expect(() => parseBaseline("parcelId,address,structureType,replacementValue\nP,1 Main,business,lots", "p.csv"))
      .toThrow("Row 2: the replacement value is not a number.");
    expect(() => parseBaseline("{", "p.json")).toThrow("not valid JSON");
  });
});
