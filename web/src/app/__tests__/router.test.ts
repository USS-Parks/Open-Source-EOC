import { describe, expect, it } from "vitest";
import { parseHash, sectionOf, surfaceHash, type Surface } from "../router.js";

/** The hash router: every surface round-trips, and detail views map to
 *  their list section for rail highlighting. */

describe("surface hash routing", () => {
  const cases: readonly Surface[] = [
    { kind: "map" },
    { kind: "dashboard" },
    { kind: "dashboard", id: "d1" },
    { kind: "dashboard", id: "d1", filterField: "severity", filterEquals: "critical" },
    { kind: "datasets" },
    { kind: "boards" },
    { kind: "board", id: "b1" },
    { kind: "sitreps" },
    { kind: "sitrep", id: "s1" },
    { kind: "alerts" },
    { kind: "lifelines" },
    { kind: "lifeline", id: "energy" },
    { kind: "esf", id: "utilities" },
    { kind: "tasks" },
    { kind: "field-reports" },
    { kind: "periods" },
    { kind: "participants" },
    { kind: "jic" },
    { kind: "templates" },
    { kind: "settings" },
    { kind: "board-design", id: "b1" },
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
    expect(sectionOf({ kind: "field-reports" })).toBe("fieldReports");
    expect(sectionOf({ kind: "map" })).toBe("map");
  });
});
