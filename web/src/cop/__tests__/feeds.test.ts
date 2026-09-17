import { describe, expect, it } from "vitest";
import { feedLayerSpecs, feedSourceId, formatAge, tagFeedFeatures } from "../feeds.js";
import type { CopFeatureCollection } from "../layers.js";

const fc: CopFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "a",
      geometry: { type: "Point", coordinates: [-123.6, 41.3] },
      properties: { title: "Flood Warning", severity: "critical" },
    },
  ],
};

describe("feed layers carry provenance and staleness (VEOC-19)", () => {
  it("keeps severity symbology while the feed is fresh, with source and age visible", () => {
    const tagged = tagFeedFeatures(fc, { name: "NWS Alerts", stale: false, ageSeconds: 42 });
    const p = tagged.features[0]!.properties;
    expect(p._symbolStatus).toBe("critical");
    expect(p._source).toBe("NWS Alerts");
    expect(p._ageLabel).toBe("live");
    expect(p._stale).toBe(false);
  });

  it("drops a STALE feed's features to the unknown frame whatever they claim", () => {
    const tagged = tagFeedFeatures(fc, { name: "NWS Alerts", stale: true, ageSeconds: 7200 });
    const p = tagged.features[0]!.properties;
    expect(p._symbolStatus).toBe("unknown");
    expect(p._stale).toBe(true);
    expect(p._ageLabel).toBe("2h ago");
  });

  it("builds the three layer specs against the feed source", () => {
    const specs = feedLayerSpecs("f1", "light") as Array<Record<string, unknown>>;
    expect(specs.map((s) => s.id)).toEqual(["feed-f1-fill", "feed-f1-line", "feed-f1-point"]);
    for (const s of specs) expect(s.source).toBe(feedSourceId("f1"));
  });

  it("formats ages for the provenance line", () => {
    expect(formatAge(null)).toBe("never");
    expect(formatAge(30)).toBe("live");
    expect(formatAge(240)).toBe("4m ago");
    expect(formatAge(90000)).toBe("1d ago");
  });
});
