import { afterEach, describe, expect, it } from "vitest";
import { buildingsSource } from "../../app/config.js";
import { buildingSpecs, buildingUse } from "../building-styles.js";

const runtime = globalThis as unknown as { OPENEOC?: Record<string, string> };

afterEach(() => {
  delete runtime.OPENEOC;
});

describe("H14 Overture building enrichment", () => {
  it("uses Overture only for a still-untyped OSM footprint", () => {
    expect(buildingUse("yes", "commercial")).toBe("commercial");
    expect(buildingUse("yes", "civic")).toBe("government");
    expect(buildingUse("yes", "religious")).toBe("assembly");
    expect(buildingUse("yes", "education")).toBe("education");
    expect(buildingUse("yes", "medical")).toBe("commercial");
    expect(buildingUse("yes", "transportation")).toBe("utility_misc");
    expect(buildingUse("yes", "entertainment")).toBe("unclassified");
    expect(buildingUse("yes", "unknown")).toBe("unclassified");
    expect(buildingUse("yes")).toBe("unclassified");
  });

  it("keeps a current typed OSM class authoritative", () => {
    expect(buildingUse("house", "commercial")).toBe("residential");
    expect(buildingUse("school", "residential")).toBe("education");
    expect(buildingUse("custom_typed_value", "civic")).toBe("unclassified");
  });

  it("keeps osm_id promotion and status precedence in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const spec = buildingSpecs(
        { pmtilesUrl: "/h14/buildings.pmtiles", overtureRelease: "2026-08-19.0" },
        theme,
      ) as {
        sources: Record<string, { promoteId: string; attribution: string }>;
        layers: Array<{ id: string; paint: Record<string, unknown> }>;
      };
      expect(spec.sources.buildings?.promoteId).toBe("osm_id");
      expect(spec.sources.buildings?.attribution).toContain("Overture Maps Foundation");
      expect(spec.sources.buildings?.attribution).toContain("2026-08-19.0");
      const color = JSON.stringify(
        spec.layers.find((layer) => layer.id === "building-use")?.paint["fill-color"],
      );
      expect(color).toContain("overture_subtype");
      expect(color.indexOf("feature-state")).toBeLessThan(color.indexOf("overture_subtype"));
      expect(color).toContain("critical");
      expect(color).toContain("warning");
      expect(color).toContain("normal");
    }
  });

  it("does not claim Overture for a plain OSM archive", () => {
    runtime.OPENEOC = { OPENEOC_BUILDINGS_PMTILES_URL: "/buildings.pmtiles" };
    expect(buildingsSource()).toEqual({ pmtilesUrl: "/buildings.pmtiles" });
    const spec = buildingSpecs(buildingsSource(), "light") as {
      sources: Record<string, { attribution: string }>;
    };
    expect(spec.sources.buildings?.attribution).not.toContain("Overture");
  });

  it("publishes the configured release beside the candidate archive", () => {
    runtime.OPENEOC = {
      OPENEOC_BUILDINGS_PMTILES_URL: "/h14/buildings.pmtiles",
      OPENEOC_BUILDINGS_OVERTURE_RELEASE: "2026-08-19.0",
    };
    expect(buildingsSource()).toEqual({
      pmtilesUrl: "/h14/buildings.pmtiles",
      overtureRelease: "2026-08-19.0",
    });
  });
});
