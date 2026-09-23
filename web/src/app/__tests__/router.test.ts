import { describe, expect, it } from "vitest";
import { parseHash, parseRouteHash, sectionOf, surfaceHash, type Surface } from "../router.js";

/** The hash router: every surface round-trips, and detail views map to
 *  their list section for rail highlighting. */

describe("surface hash routing", () => {
  const cases: readonly Surface[] = [
    { kind: "map" },
    { kind: "map", datasetId: "11111111-1111-4111-8111-111111111111", featureId: "road/closure 7" },
    { kind: "dashboard" },
    { kind: "dashboard", id: "d1" },
    { kind: "dashboard", id: "d1", filterField: "severity", filterEquals: "critical" },
    { kind: "datasets" },
    { kind: "resources" },
    { kind: "resources", id: "request-1" },
    { kind: "boards" },
    { kind: "board", id: "b1" },
    { kind: "sitreps" },
    { kind: "sitrep", id: "s1" },
    { kind: "alerts" },
    { kind: "lifelines" },
    { kind: "lifeline", id: "energy" },
    { kind: "esf", id: "utilities" },
    { kind: "tasks" },
    { kind: "periods" },
    { kind: "participants" },
    { kind: "jic" },
    { kind: "templates" },
    { kind: "board-design", id: "b1" },
    { kind: "contacts" },
    { kind: "mass-notification" },
    { kind: "reports" },
    { kind: "damage" },
    { kind: "facilities" },
    { kind: "admin" },
    { kind: "federation" },
    { kind: "field-reports" },
    { kind: "not-found", path: "not-a-workspace" },
  ];

  it("round-trips every surface through the hash", () => {
    for (const surface of cases) {
      expect(parseHash(surfaceHash(surface))).toEqual(surface);
    }
  });

  it("defaults an empty hash to Map and preserves unknown routes for a not-found screen", () => {
    expect(parseHash("")).toEqual({ kind: "map" });
    expect(parseHash("#/")).toEqual({ kind: "map" });
    expect(parseHash("#/nonsense")).toEqual({ kind: "not-found", path: "nonsense" });
  });

  it("falls back to the list when a detail id is missing", () => {
    expect(parseHash("#/board")).toEqual({ kind: "boards" });
    expect(parseHash("#/sitrep")).toEqual({ kind: "sitreps" });
  });

  it("maps detail surfaces to their rail section", () => {
    expect(sectionOf({ kind: "board", id: "b1" })).toBe("boards");
    expect(sectionOf({ kind: "sitrep", id: "s1" })).toBe("sitreps");
    expect(sectionOf({ kind: "dashboard" })).toBe("overview");
    expect(sectionOf({ kind: "board-design", id: "b1" })).toBe("boards");
    expect(sectionOf({ kind: "periods" })).toBe("operationalPeriods");
    expect(sectionOf({ kind: "field-reports" })).toBe("fieldReports");
    expect(sectionOf({ kind: "map" })).toBe("map");
  });

  it("round-trips bounded incident, period, view, filter, record, and return context", () => {
    const hash = surfaceHash(
      { kind: "board", id: "board-1" },
      {
        incidentId: "incident-1",
        periodRevision: 12,
        view: "priority",
        filter: "status:open",
        boardId: "board-1",
        recordId: "record-9",
        returnTo: "#/dashboard?incident=incident-1",
      },
    );
    expect(parseRouteHash(hash)).toEqual({
      surface: { kind: "board", id: "board-1" },
      context: {
        incidentId: "incident-1",
        periodRevision: 12,
        view: "priority",
        filter: "status:open",
        boardId: "board-1",
        recordId: "record-9",
        returnTo: "#/dashboard?incident=incident-1",
      },
    });
  });

  it("round-trips an explicit operational-period not-set choice", () => {
    const hash = surfaceHash({ kind: "map" }, { incidentId: "incident-1", periodRevision: null });
    expect(hash).toBe("#/?incident=incident-1&period=unset");
    expect(parseRouteHash(hash).context.periodRevision).toBeNull();
  });

  it("rejects malformed, duplicate, oversized, and nested-return deep links without throwing", () => {
    expect(parseHash("#/dashboard/d1/severity/%E0%A4%A")).toEqual({ kind: "not-found", path: "invalid-link" });
    expect(parseHash("#/map/only-a-dataset")).toEqual({ kind: "not-found", path: "invalid-link" });
    expect(parseHash("#/boards?incident=one&incident=two")).toEqual({ kind: "not-found", path: "invalid-link" });
    expect(parseHash(`#/boards?filter=${"a".repeat(257)}`)).toEqual({ kind: "not-found", path: "invalid-link" });
    expect(parseHash("#/boards?return=%23%2Fmap%3Freturn%3Dloop")).toEqual({ kind: "not-found", path: "invalid-link" });
  });
});
