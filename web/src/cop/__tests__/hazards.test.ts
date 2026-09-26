import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { femaFloodHazardFor } from "@openeoc/shared";
import { feedLayerIds, feedLayerSpecs } from "../feeds.js";
import {
  FEMA_NFHL_ATTRIBUTION,
  FLOOD_LEGEND,
  floodLayerSpecs,
  hatchImage,
  tagFloodFeatures,
} from "../hazards.js";

describe("hazard hatching", () => {
  it("generates a transparent local hatch tile without an asset or network request", () => {
    const image = hatchImage("#123456", "cross");
    expect(image).toMatchObject({ width: 8, height: 8 });
    expect(image.data).toHaveLength(8 * 8 * 4);
    expect([...image.data].some((value) => value !== 0)).toBe(true);
  });
});

describe("FEMA static flood reference", () => {
  it("classifies only the locally documented families and keeps every other value unknown", () => {
    expect(femaFloodHazardFor({ FLD_ZONE: "A" })).toBe("high");
    expect(femaFloodHazardFor({ title: "AE" })).toBe("high");
    expect(femaFloodHazardFor({ title: "AO" })).toBe("high");
    expect(femaFloodHazardFor({ title: "X", category: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" })).toBe("moderate");
    expect(femaFloodHazardFor({ title: "X", category: "AREA OF MINIMAL FLOOD HAZARD - UNSHADED" })).toBe("unknown");
    expect(femaFloodHazardFor({ title: "X", category: "AREA OF MINIMAL FLOOD HAZARD" })).toBe("unknown");
    expect(femaFloodHazardFor({ title: "VE" })).toBe("unknown");
    expect(femaFloodHazardFor({})).toBe("unknown");
  });

  it("keeps every feed hatch inside its visibility toggle", () => {
    const ids = feedLayerIds("alerts");
    const specs = feedLayerSpecs("alerts", "light") as Array<{ id: string }>;
    expect(ids).toContain("feed-alerts-hazard-impact-hatch");
    expect(specs.every((spec) => ids.includes(spec.id))).toBe(true);
  });

  it("tags flood category separately from current incident status", () => {
    const tagged = tagFloodFeatures({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        id: "synthetic-ae",
        geometry: { type: "Polygon", coordinates: [] },
        properties: { title: "AE", status: "normal" },
      }],
    }, { name: "Synthetic local NFHL fixture", stale: false, ageSeconds: 30 });
    expect(tagged.features[0]!.properties._floodCategory).toBe("high");
    expect(tagged.features[0]!.properties._symbolStatus).toBeUndefined();
    expect(tagged.features[0]!.properties._source).toBe("Synthetic local NFHL fixture");
  });

  it.each(["light", "dark"] as const)("builds valid distinct flood layers in %s", (theme) => {
    const layers = floodLayerSpecs("nfhl", theme) as Array<Record<string, unknown>>;
    expect(layers.map((layer) => layer.id)).toEqual([
      "feed-nfhl-flood-fill",
      "feed-nfhl-flood-hatch",
      "feed-nfhl-flood-line",
    ]);
    expect(JSON.stringify(layers)).toContain("_floodCategory");
    expect(JSON.stringify(layers)).not.toContain("_symbolStatus");
    for (const layer of layers) {
      const style = {
        version: 8,
        sources: { "feed-nfhl": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [layer],
      };
      expect(validateStyleMin(style as never).map((error) => error.message)).toEqual([]);
    }
  });

  it("ships a plain complete legend and constrained attribution", () => {
    expect(FLOOD_LEGEND.map((entry) => entry.id)).toEqual(["high", "moderate", "unknown"]);
    expect(FEMA_NFHL_ATTRIBUTION).toContain("mapped flood panels");
  });
});
