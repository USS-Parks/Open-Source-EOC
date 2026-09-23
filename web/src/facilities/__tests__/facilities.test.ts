import { describe, expect, it } from "vitest";
import { ApiClient } from "../../app/api/client.js";
import {
  facilityBounds,
  facilityFeatures,
  freshness,
  parseBeds,
  shelterCounts,
  windowLabel,
  type FacilityBoardRow,
} from "../model.js";

const row = (overrides: Partial<FacilityBoardRow>): FacilityBoardRow => ({
  organizationId: "f1",
  organizationName: "Klamath General",
  facilityKind: "hospital",
  operatingStatus: "normal",
  beds: [],
  capabilities: [],
  lastUpdate: "2026-09-23T18:00:00.000Z",
  stale: false,
  contact: null,
  location: { lon: -124.0, lat: 41.5 },
  staleAfterSeconds: 3600,
  ...overrides,
});

describe("facility freshness and counts", () => {
  it("reads the server's staleness and tells a never-reported facility apart", () => {
    expect(freshness(row({}))).toEqual({ label: "Current", status: "success" });
    expect(freshness(row({ stale: true }))).toEqual({ label: "Stale", status: "warning" });
    expect(freshness(row({ stale: true, lastUpdate: "", operatingStatus: "unknown" }))).toEqual({ label: "No report yet", status: "unknown" });
    expect([3600, 7200, 900, 60].map(windowLabel)).toEqual(["Every hour", "Every 2 hours", "Every 15 minutes", "Every minute"]);
  });

  it("derives shelter occupancy from capacity and open spaces", () => {
    expect(shelterCounts([{ bedType: "other", available: 40, baseline: 120 }])).toEqual({ capacity: 120, open: 40, occupied: 80 });
    expect(shelterCounts([{ bedType: "other", available: 130, baseline: 120 }]).occupied).toBe(0);
    expect(shelterCounts([])).toEqual({ capacity: 0, open: 0, occupied: 0 });
  });

  it("reports only the bed rows filled in, as whole numbers", () => {
    expect(parseBeds({
      adult_icu: { available: "4", baseline: "12" },
      burn: { available: "", baseline: "" },
      other: { available: "0", baseline: "3" },
    })).toEqual([
      { bedType: "adult_icu", available: 4, baseline: 12 },
      { bedType: "other", available: 0, baseline: 3 },
    ]);
    expect(() => parseBeds({ adult_icu: { available: "4", baseline: "" } })).toThrow("Enter both adult icu counts");
    expect(() => parseBeds({ burn: { available: "1.5", baseline: "2" } })).toThrow("whole numbers");
    expect(() => parseBeds({ burn: { available: "-1", baseline: "2" } })).toThrow("zero or more");
  });
});

describe("facility map layer", () => {
  it("maps placed facilities with the NAPSG type where one ships and the frame from the operating status", () => {
    const layer = facilityFeatures([
      row({}),
      row({ organizationId: "f2", organizationName: "Weitchpec Gym", facilityKind: "shelter", operatingStatus: "compromised", stale: true }),
      row({ organizationId: "f3", organizationName: "Hoopa Dialysis", facilityKind: "dialysis_center", lastUpdate: "", operatingStatus: "unknown" }),
      row({ organizationId: "f4", organizationName: "Unplaced", location: null }),
    ]);
    expect(layer.features.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(layer.features[0]).toEqual({
      type: "Feature",
      id: "f1",
      geometry: { type: "Point", coordinates: [-124.0, 41.5] },
      properties: { title: "Klamath General", type: "Hospital", status: "normal", report: "Current", _facilityType: "hospital" },
    });
    expect(layer.features[1]!.properties).toMatchObject({ type: "Shelter", status: "compromised", report: "Stale", _facilityType: "shelter" });
    // No shipped symbol for a dialysis center: it draws as a plain status marker.
    expect(layer.features[2]!.properties).not.toHaveProperty("_facilityType");
    const bounds = facilityBounds([row({}), row({ location: { lon: -123.8, lat: 41.2 } }), row({ location: null })])!;
    expect(bounds.map((n) => Number(n.toFixed(2)))).toEqual([-124.01, 41.19, -123.79, 41.51]);
    expect(facilityBounds([row({ location: null })])).toBeNull();
  });
});

describe("facility client methods", () => {
  it("sends facility reads and changes to their routes and reads the integration state", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const status = 200;
    let enabled = true;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return {
        ok: status === 200, status, statusText: status === 200 ? "OK" : "Not Found",
        json: async () => (String(url).endsWith("/integrations")
          ? { variable: "OPENEOC_INTEGRATIONS", integrations: [{ key: "facilities", enabled }] }
          : { facilities: [row({})] }),
        text: async () => "<EDXL-HAVE/>",
      };
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    expect(await client.facilityBoard("j/1")).toHaveLength(1);
    await client.registerFacility("j/1", { name: "Weitchpec Gym", kind: "shelter", staleAfterSeconds: 7200, location: { lon: -123.6, lat: 41.2 } });
    await client.reportFacilityStatus("f/1", { operatingStatus: "normal", beds: [{ bedType: "other", available: 40, baseline: 120 }] });
    expect(await client.facilityHave("j/1", "hospital")).toBe("<EDXL-HAVE/>");
    expect(await client.facilitiesEnabled()).toBe(true);
    enabled = false;
    expect(await client.facilitiesEnabled()).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/jurisdictions/j%2F1/facilities/board",
      "POST /api/v1/jurisdictions/j%2F1/facilities",
      "POST /api/v1/facilities/f%2F1/status",
      "GET /api/v1/jurisdictions/j%2F1/facilities/have?kind=hospital",
      "GET /api/v1/integrations",
      "GET /api/v1/integrations",
    ]);
    expect(calls[1]!.body).toEqual({ name: "Weitchpec Gym", kind: "shelter", staleAfterSeconds: 7200, location: { lon: -123.6, lat: 41.2 } });
    expect(calls[2]!.body).toEqual({ operatingStatus: "normal", beds: [{ bedType: "other", available: 40, baseline: 120 }] });
  });
});
