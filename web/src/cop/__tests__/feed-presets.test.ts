import { FEED_PALETTES, NWS_HAZARD_PALETTE, paletteKey } from "@openeoc/shared";
import { createPropertyExpression, featureFilter, latest, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
  FEED_PRESETS,
  FEED_PRESET_BY_KIND,
  feedLayerIds,
  feedLayerSpecs,
  feedPresetLegend,
  tagFeedFeatures,
  type FeedLayerHealth,
} from "../feeds.js";
import type { CopFeatureCollection } from "../layers.js";

/** Live feed presets (MP10): classes, paint and staleness, evaluated as MapLibre evaluates them. */

type Geometry = "Point" | "LineString" | "Polygon" | "MultiPolygon";
const GEOMETRY: Record<Geometry, Record<string, unknown>> = {
  Point: { type: "Point", coordinates: [-124.1, 40.8] },
  LineString: { type: "LineString", coordinates: [[-124.1, 40.8], [-124, 40.9]] },
  Polygon: { type: "Polygon", coordinates: [[[-124.2, 40.7], [-124, 40.7], [-124, 40.9], [-124.2, 40.7]]] },
  MultiPolygon: { type: "MultiPolygon", coordinates: [[[[-124.2, 40.7], [-124, 40.7], [-124, 40.9], [-124.2, 40.7]]]] },
};

const fresh = (kind: string): FeedLayerHealth => ({ name: kind, kind, stale: false, ageSeconds: 120 });

function tag(kind: string, properties: Record<string, unknown>, geometry: Geometry = "Point", health = fresh(kind)) {
  const fc: CopFeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", id: "f", geometry: GEOMETRY[geometry], properties }] };
  return tagFeedFeatures(fc, health).features[0]!.properties;
}

const specs = (theme: "light" | "dark" = "light") =>
  feedLayerSpecs("f1", theme, "Liberation Sans Regular") as Array<{ id: string; type: string; filter?: unknown; paint?: Record<string, unknown>; layout?: Record<string, unknown> }>;
const layer = (suffix: string) => specs().find((spec) => spec.id === `feed-f1-${suffix}`)!;
const TYPE_CODE: Record<Geometry, 1 | 2 | 3> = { Point: 1, LineString: 2, Polygon: 3, MultiPolygon: 3 };

/** Whether the layer draws the feature, and the value its paint or layout property takes, as MapLibre computes them. */
function draws(suffix: string, properties: Record<string, unknown>, geometry: Geometry): boolean {
  const spec = layer(suffix);
  return featureFilter(spec.filter as never, "layers[0].filter").filter({ zoom: 9 }, { type: TYPE_CODE[geometry], properties } as never);
}
function value(suffix: string, property: string, properties: Record<string, unknown>): string | number {
  const spec = layer(suffix);
  const group = property in (spec.paint ?? {}) ? "paint" : "layout";
  const definition = (latest as unknown as Record<string, Record<string, unknown>>)[`${group}_${spec.type}`]![property];
  const expression = createPropertyExpression((spec[group] as Record<string, unknown>)[property] as never, property, definition as never);
  if (expression.result !== "success") throw new Error(JSON.stringify(expression.value));
  const result = expression.value.evaluate({ zoom: 9 }, { type: 1, properties } as never) as unknown;
  return typeof result === "object" && result !== null ? String(result) : result as string | number;
}
const rgb = (hex: string, alpha = 1) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${alpha})`;

describe("the NWS preset", () => {
  // The products an EOC on the North Coast sees: every one of the plan's hazards, as warning, watch or advisory.
  const EVENTS: Record<string, string> = {
    "Tsunami Warning": "#fd6347", "Tsunami Advisory": "#d2691e", "Tsunami Watch": "#ff00ff",
    "Flood Warning": "#00ff00", "Flood Watch": "#2e8b57", "Flood Advisory": "#00ff7f",
    "Flash Flood Warning": "#8b0000", "Flash Flood Watch": "#2e8b57",
    "Coastal Flood Warning": "#228b22", "Coastal Flood Watch": "#66cdaa", "Coastal Flood Advisory": "#7cfc00",
    "High Surf Warning": "#228b22", "High Surf Advisory": "#ba55d3",
    "High Wind Warning": "#daa520", "High Wind Watch": "#b8860b", "Wind Advisory": "#d2b48c",
    "Winter Storm Warning": "#ff69b4", "Winter Storm Watch": "#4682b4", "Winter Weather Advisory": "#7b68ee",
    "Red Flag Warning": "#ff1493", "Fire Weather Watch": "#ffdead",
    "Excessive Heat Warning": "#c71585", "Excessive Heat Watch": "#800000", "Extreme Heat Warning": "#c71585", "Heat Advisory": "#ff7f50",
    "Air Quality Alert": "#808080",
    "Severe Thunderstorm Warning": "#ffa500", "Severe Thunderstorm Watch": "#db7093",
    "Tornado Warning": "#ff0000", "Tornado Watch": "#ffff00",
  };

  it.each(Object.entries(EVENTS))("draws %s in the NWS color %s at a quarter fill under a full outline", (event, color) => {
    expect(paletteKey(NWS_HAZARD_PALETTE, event), event).toBeDefined();
    const p = tag("nws_alerts", { event }, "MultiPolygon");
    expect(draws("preset-fill", p, "MultiPolygon")).toBe(true);
    expect(value("preset-fill", "fill-color", p)).toBe(rgb(color, 0.25));
    expect(value("preset-line", "line-color", p)).toBe(rgb(color));
    expect(value("preset-line", "line-width", p)).toBe(1.5);
  });

  it("draws a product the table does not list in NWS silver, and a standard feed as before", () => {
    const p = tag("nws_alerts", { event: "Lakeshore Flood Advisory" }, "Polygon");
    expect(p._presetClass).toBe("other");
    expect(value("preset-fill", "fill-color", p)).toBe(rgb("#c0c0c0", 0.25));
    const plain = tag("geojson", { title: "Flood Warning", severity: "critical" }, "Polygon");
    expect(plain).not.toHaveProperty("_preset");
    expect(draws("preset-fill", plain, "Polygon")).toBe(false);
    expect(draws("fill", plain, "Polygon")).toBe(true);
    expect(draws("fill", p, "Polygon")).toBe(false);
  });
});

describe("the wildfire, earthquake, gauge and outage presets", () => {
  it("draws WFIGS perimeters as Esri does, and incidents by size class with the wildfire icon and an uppercase name", () => {
    const wildfire = tag("wfigs_perimeters", { name: "Bluff Creek", type: "wildfire" }, "Polygon");
    expect(value("preset-fill", "fill-color", wildfire)).toBe(rgb("#f7ada4", 0.54));
    expect(value("preset-line", "line-color", wildfire)).toBe(rgb("#e60c0c"));
    const rx = tag("wfigs_perimeters", { type: "prescribed" }, "Polygon");
    expect(value("preset-fill", "fill-color", rx)).toBe(rgb("#e8bd71", 0.54));
    expect(value("preset-line", "line-color", rx)).toBe(rgb("#e5a53e"));
    const sizes = [45, 1000, 12480, 64210, 150000, 400000].map((acres) => tag("wfigs_incidents", { name: "Bluff Creek", type: "wildfire", acres }));
    expect(sizes.map((p) => p._presetClass)).toEqual(["under_1k", "ac_1k", "ac_10k", "ac_50k", "ac_100k", "ac_300k"]);
    expect(sizes.map((p) => value("preset-circle", "circle-radius", p))).toEqual([7, 9, 11, 13, 15, 17]);
    expect(value("preset-icon", "icon-image", sizes[2]!)).toBe("eoc-sym-wildfire-c93100");
    expect(value("preset-label", "text-field", sizes[2]!)).toBe("BLUFF CREEK");
    expect(tag("wfigs_incidents", { name: "Redwood Valley Rx", type: "prescribed", acres: 80 })._presetIcon).toBe("eoc-sym-wildfire-b36b00");
  });

  it("draws earthquakes by Esri's magnitude classes, with the magnitude as the label", () => {
    const quakes = [-0.4, 2.9, 3, 4.4, 4.5, 5.9, 6, 7.4, 7.5, 8.2].map((mag) => tag("usgs_earthquakes", { mag }));
    expect(quakes.map((p) => p._presetClass)).toEqual(["under_3", "under_3", "m3", "m3", "m4_5", "m4_5", "m6", "m6", "m7_5", "m7_5"]);
    expect([quakes[0], quakes[2], quakes[4], quakes[6], quakes[8]].map((p) => [value("preset-circle", "circle-color", p!), value("preset-circle", "circle-radius", p!)]))
      .toEqual([[rgb("#a8a8a8"), 2], [rgb("#6ceae6"), 3.5], [rgb("#f2e643"), 5], [rgb("#fc0316"), 9], [rgb("#242424"), 11]]);
    expect(value("preset-label", "text-field", quakes[4]!)).toBe("4.5");
  });

  it("draws ShakeMap intensity at 0.6, leaving I to III undrawn", () => {
    const weak = tag("usgs_shakemap", { mmi: 3 }, "LineString");
    expect(value("preset-line", "line-color", weak)).toBe(rgb("#ffffff", 0));
    expect(value("preset-line", "line-color", tag("usgs_shakemap", { mmi: 4.5 }, "LineString"))).toBe(rgb("#f7bfc5", 0.6));
    expect(value("preset-fill", "fill-color", tag("usgs_shakemap", { mmi: 9 }, "Polygon"))).toBe(rgb("#eb2128", 0.6));
    expect(tag("usgs_shakemap", { mmi: 7 }, "Polygon")._presetClass).toBe("mmi_6_7");
  });

  it("draws gauges by NWPS flood category with Esri's colors and sizes, the source's other codes as unknown or low", () => {
    const expected: Array<[string, string, string, number]> = [
      ["major", "major", "#b50000", 5], ["moderate", "moderate", "#f73500", 4], ["minor", "minor", "#ff8b00", 3.5],
      ["action", "action", "#f2ca00", 3], ["no_flooding", "no_flooding", "#ffffff", 3], ["low_threshold", "low", "#c1976f", 2.5],
      ["obs_not_current", "unknown", "#72d2e8", 2.5], ["out_of_service", "unknown", "#72d2e8", 2.5], ["something_new", "unknown", "#72d2e8", 2.5],
    ];
    for (const [category, key, color, radius] of expected) {
      const p = tag("nwps_gauges", { category });
      expect([p._presetClass, value("preset-circle", "circle-color", p), value("preset-circle", "circle-radius", p)], category).toEqual([key, rgb(color), radius]);
    }
  });

  it("grades outages by customers out", () => {
    const grades = [0, 1, 99, 100, 999, 1000, 4999, 5000, 20000, null].map((customersOut) => tag("utility_outages", { customersOut }));
    expect(grades.map((p) => p._presetClass)).toEqual(["none", "c1", "c1", "c100", "c100", "c1k", "c1k", "c5k", "c20k", "none"]);
    const radii = grades.slice(0, 9).map((p) => value("preset-circle", "circle-radius", p) as number);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(value("preset-fill", "fill-color", tag("utility_outages", { customersOut: 7810 }, "Polygon"))).toBe(rgb("#f03b20", 0.5));
  });

  it("grades ODIN counties by meters out and says meters, never customers", () => {
    const counties = [0, 4, 123, 1891, 7810, 25000].map((metersOut) => tag("odin_outages", { metersOut }, "MultiPolygon"));
    expect(counties.map((p) => p._presetClass)).toEqual(["none", "m1", "m100", "m1k", "m5k", "m20k"]);
    expect(counties.map((p) => value("preset-fill", "fill-color", p))).toEqual(
      ["#bdbdbd", "#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"].map((color) => rgb(color, 0.5)));
    expect(value("preset-label", "text-field", counties[3]!)).toBe("1,891 meters out");
    const legend = feedPresetLegend("odin_outages", "light")!;
    expect(legend.title).toMatch(/meters/i);
    for (const row of legend.rows) expect(row.label).not.toMatch(/customer/i);
    expect(legend.rows.map((row) => row.label)).toContain("1,000 to 4,999 meters out");
    const preset = FEED_PRESET_BY_KIND.get("odin_outages")!;
    expect(preset.terms).toContain("ODIN publishes no terms of use");
    expect(preset.terms).toContain("2026-09-26");
    expect(preset.url(" 06 ")).toBe("https://odin.ornl.gov/odi/map?stateCd=06&scale=COUNTY");
    expect(() => preset.url("CA")).toThrow("two-digit FIPS code");
  });
});

describe("a stale preset", () => {
  it("draws grey, drops the icon, and labels each feature with its age", () => {
    const stale: FeedLayerHealth = { name: "USGS", kind: "usgs_earthquakes", stale: true, ageSeconds: 7300 };
    const quake = tag("usgs_earthquakes", { mag: 4.8 }, "Point", stale);
    expect(value("preset-circle", "circle-color", quake)).toBe(rgb("#8d99ae"));
    expect(value("preset-label", "text-field", quake)).toBe("4.8 · stale 2h ago");
    const warning = tag("nws_alerts", { event: "Tornado Warning" }, "Polygon", { ...stale, kind: "nws_alerts" });
    expect(value("preset-fill", "fill-color", warning)).toBe(rgb("#8d99ae", 0.25));
    expect(value("preset-label", "text-field", warning)).toBe("stale 2h ago");
    const fire = tag("wfigs_incidents", { name: "Panther", acres: 452 }, "Point", { ...stale, kind: "wfigs_incidents" });
    expect(fire).not.toHaveProperty("_presetIcon");
    expect(fire._presetLabel).toBe("PANTHER · stale 2h ago");
    const shaking = { ...stale, kind: "usgs_shakemap" };
    expect(tag("usgs_shakemap", { mmi: 5 }, "LineString", shaking)._presetLabel).toBe("stale 2h ago");
    expect(tag("usgs_shakemap", { mmi: 3 }, "LineString", shaking)).not.toHaveProperty("_presetLabel");
  });
});

describe("the preset layers and catalog", () => {
  it.each(["light", "dark"] as const)("builds valid layers that the ids and the standard layers agree with (%s)", (theme) => {
    const list = specs(theme);
    expect(list.map((spec) => spec.id)).toEqual(feedLayerIds("f1"));
    for (const spec of list) {
      const style = {
        version: 8,
        glyphs: "/fonts/{fontstack}/{range}.pbf",
        sources: { "feed-f1": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [spec],
      };
      expect(validateStyleMin(style as never).map((error) => error.message), spec.id).toEqual([]);
    }
  });

  it("gives every preset a source, terms, a schedule and a legend, and builds its URL from the administrator's input", () => {
    expect(FEED_PRESETS.map((preset) => preset.kind)).toEqual([
      "nws_alerts", "wfigs_perimeters", "wfigs_incidents", "usgs_earthquakes", "usgs_shakemap", "nwps_gauges", "utility_outages",
      "odin_outages",
    ]);
    for (const preset of FEED_PRESETS) {
      expect(preset.source.length, preset.kind).toBeGreaterThan(20);
      expect(preset.terms.length, preset.kind).toBeGreaterThan(20);
      expect(preset.staleAfterSeconds).toBeGreaterThan(preset.pollIntervalSeconds);
      expect(FEED_PALETTES).toContain(preset.palette);
      const legend = feedPresetLegend(preset.kind, "light")!;
      expect(legend.rows.length, preset.kind).toBe(Object.keys(preset.palette.entries).length);
    }
    const url = (kind: string, input: string) => FEED_PRESET_BY_KIND.get(kind)!.url(input);
    expect(url("nws_alerts", "ca")).toBe("https://api.weather.gov/alerts/active?area=CA");
    expect(url("nws_alerts", "CAZ103")).toBe("https://api.weather.gov/alerts/active?zone=CAZ103");
    expect(() => url("nws_alerts", "California")).toThrow("two-letter state");
    expect(url("wfigs_perimeters", "CA")).toContain("WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=attr_POOState%3D'US-CA'");
    expect(url("wfigs_incidents", "CA")).toMatch(/^https:\/\/services3\.arcgis\.com\/T4QMspbfLg3qTGWY\/.*WFIGS_Incident_Locations_Current.*f=geojson$/);
    expect(url("usgs_earthquakes", "week")).toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson");
    expect(url("nwps_gauges", "-124.5, 39.9, -123.3, 42.0")).toBe(
      "https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=-124.5&bbox.ymin=39.9&bbox.xmax=-123.3&bbox.ymax=42&srid=EPSG_4326");
    expect(() => url("nwps_gauges", "-123, 42, -124, 40")).toThrow("west, south, east, north");
    expect(() => url("utility_outages", "outages.json")).toThrow("full URL");
    expect(feedPresetLegend("geojson", "light")).toBeUndefined();
  });

  it("lists only the classes the map shows, with the size each draws at", () => {
    const legend = feedPresetLegend("usgs_earthquakes", "dark", ["m3", "m6"])!;
    expect(legend.rows.map((row) => [row.label, row.color, row.shape, row.radius])).toEqual([
      ["3.0 to 4.4", "#6ceae6", "circle", 3.5], ["6.0 to 7.4", "#fc0316", "circle", 9],
    ]);
    expect(legend.title).toBe("Earthquake magnitude");
  });

  it("keeps the feed palettes well formed", () => {
    for (const palette of FEED_PALETTES) {
      for (const [key, entry] of Object.entries(palette.entries)) {
        expect(key, palette.id).toMatch(/^[a-z][a-z0-9_]*$/);
        for (const color of [entry.light, entry.dark, entry.polygon?.outline ?? entry.light]) expect(color, `${palette.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      for (const [alias, key] of Object.entries(palette.aliases ?? {})) expect(palette.entries, `${palette.id} ${alias}`).toHaveProperty(key);
    }
  });
});
