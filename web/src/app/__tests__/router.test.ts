import { describe, expect, it } from "vitest";
import { parseHash, sectionOf, surfaceHash, type Surface } from "../router.js";

/** The hash router: every surface round-trips, and detail views map to
 *  their list section for rail highlighting. */

describe("surface hash routing", () => {
  const cases: readonly Surface[] = [
    { kind: "map" },
    { kind: "dashboard" },
    { kind: "dashboard", id: "d1" },
    { kind: "boards" },
    { kind: "board", id: "b1" },
    { kind: "sitreps" },
    { kind: "sitrep", id: "s1" },
    { kind: "alerts" },
  ];

  it("round-trips every surface through the hash", () => {
    for (const surface of cases) {
      expect(parseHash(surfaceHash(surface))).toEqual(surface);
    }
  });

  it("defaults unknown or empty hashes to the map", () => {
    expect(parseHash("")).toEqual({ kind: "map" });
    expect(parseHash("#/")).toEqual({ kind: "map" });
    expect(parseHash("#/nonsense")).toEqual({ kind: "map" });
  });

  it("falls back to the list when a detail id is missing", () => {
    expect(parseHash("#/board")).toEqual({ kind: "boards" });
    expect(parseHash("#/sitrep")).toEqual({ kind: "sitreps" });
  });

  it("maps detail surfaces to their rail section", () => {
    expect(sectionOf({ kind: "board", id: "b1" })).toBe("boards");
    expect(sectionOf({ kind: "sitrep", id: "s1" })).toBe("sitreps");
    expect(sectionOf({ kind: "map" })).toBe("map");
  });
});
