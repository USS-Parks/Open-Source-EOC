import { describe, expect, it } from "vitest";
import { scaleBar } from "../CardOverlays.js";
import {
  CARD_LEGEND,
  cartographyLayerSpecs,
  incidentAreaSpecs,
  symbolSvgs,
  WEATHER_LAYER_SUFFIX,
} from "../cartography.js";
import { rasterBasemapSpecs, terrainSpecs } from "../layers.js";

type Spec = { id: string; type: string; filter?: unknown; layout?: Record<string, unknown>; paint?: Record<string, unknown> };
const specs = (template: string, theme: "light" | "dark" = "light") =>
  cartographyLayerSpecs("b1", template, theme, "Noto Sans Regular") as Spec[];

describe("incident cartography", () => {
  it("leaves boards without a map meaning of their own to the status markers", () => {
    expect(cartographyLayerSpecs("b1", "field_reports", "light")).toBeUndefined();
    expect(cartographyLayerSpecs("b1", undefined, "dark")).toBeUndefined();
  });

  it("draws closures as lines with a closure point at the middle of each closed road", () => {
    const layers = specs("road_closures");
    expect(layers.map((layer) => layer.id)).toEqual(["board-b1-line", "board-b1-closure", "board-b1-closure-point", "board-b1-label"]);
    const middle = layers.find((layer) => layer.id === "board-b1-closure")!;
    expect(middle.layout).toMatchObject({ "symbol-placement": "line-center", "icon-image": "eoc-closure" });
    expect(JSON.stringify(middle.filter)).toContain('["==",["get","status"],"closed"]');
  });

  it("marks planned shelters apart from open ones", () => {
    const [shelter] = specs("shelters");
    expect(shelter!.layout!["icon-image"]).toEqual(["case", ["==", ["get", "planned"], true], "eoc-shelter-planned", "eoc-shelter-open"]);
  });

  it("gives weather stations their own layer and names hospitals by theme", () => {
    const dark = specs("incident_facilities", "dark");
    const light = specs("incident_facilities", "light");
    expect(dark.some((layer) => layer.id === `board-b1${WEATHER_LAYER_SUFFIX}`)).toBe(true);
    const icon = (layers: Spec[]) => JSON.stringify(layers.find((layer) => layer.id === "board-b1-facility")!.layout!["icon-image"]);
    expect(icon(dark)).toContain('"hospital","eoc-key-facility"');
    expect(icon(light)).toContain('"hospital","eoc-hospital"');
    expect(light.find((layer) => layer.id === "board-b1-command-label")!.layout!["text-field"]).toBe("ICP");
  });

  it("dashes the incident boundary and fills it only faintly on imagery", () => {
    const dark = incidentAreaSpecs({ type: "Polygon", coordinates: [] }, "dark").layers as Spec[];
    const light = incidentAreaSpecs({ type: "Polygon", coordinates: [] }, "light").layers as Spec[];
    expect(dark[1]!.paint!["line-dasharray"]).toBeTruthy();
    expect(Number(dark[0]!.paint!["fill-opacity"])).toBeLessThan(Number(light[0]!.paint!["fill-opacity"]));
  });

  it("has a symbol for every legend row", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const entry of CARD_LEGEND[theme]) {
        if (entry.symbol) expect(symbolSvgs(theme)[entry.symbol]).toMatch(/^<svg /);
        else expect(entry.key).toBeTruthy();
      }
    }
  });
});

describe("card scale bar", () => {
  it("picks the largest round distance that fits, in quarters for miles and thirds for kilometres", () => {
    const metersPerPixel = 100;
    expect(scaleBar(metersPerPixel, "mi", 170)).toMatchObject({ length: 10, ticks: [0, 0.25, 0.5, 1] });
    const km = scaleBar(metersPerPixel, "km", 320);
    expect(km.length).toBe(30);
    expect(km.ticks).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(km.pixels).toBeCloseTo(300);
  });
});

describe("offline raster archives", () => {
  it("reads a pmtiles archive through its header and a template as tiles", () => {
    const { sources } = rasterBasemapSpecs([
      { id: "imagery", title: "Imagery", tiles: "pmtiles:///basemap/north-coast-imagery.pmtiles" },
      { id: "topo", title: "Topo", tiles: "https://tiles.example/{z}/{x}/{y}.png" },
    ]);
    expect(sources["raster-imagery"]).toMatchObject({ url: "pmtiles:///basemap/north-coast-imagery.pmtiles" });
    expect(sources["raster-topo"]).toMatchObject({ tiles: ["https://tiles.example/{z}/{x}/{y}.png"] });
    const dem = terrainSpecs({ tiles: "pmtiles:///basemap/north-coast-terrain.pmtiles", encoding: "terrarium" }, "light").sources.dem as Record<string, unknown>;
    expect(dem).toMatchObject({ url: "pmtiles:///basemap/north-coast-terrain.pmtiles", encoding: "terrarium" });
    expect(dem).not.toHaveProperty("maxzoom");
  });
});
