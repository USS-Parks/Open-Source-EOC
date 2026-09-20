import { describe, expect, it } from "vitest";
import { SYMBOL_STATUS } from "@openeoc/shared";
import { themes } from "../../design/tokens.js";
import {
  boardLayerIds,
  boardLayerSpecs,
  buildCopStyle,
  sourceId,
  tagFeatures,
} from "../layers.js";
import { statusColor, symbolStatusFor, VALUE_STATUS } from "../symbology.js";

describe("NAPSG status symbology (F19, F14)", () => {
  it("every status frame resolves to a distinct token color in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const colors = SYMBOL_STATUS.values.map((s) => statusColor(s as never, theme));
      expect(new Set(colors).size).toBe(SYMBOL_STATUS.values.length);
      for (const c of colors) expect(Object.values(themes[theme])).toContain(c);
    }
  });

  it("covers the standard boards' status vocabularies", () => {
    for (const v of ["closed", "one_lane", "reopened"]) expect(VALUE_STATUS[v]).toBeTruthy();
    for (const v of ["normal", "compromised", "evacuating"]) expect(VALUE_STATUS[v]).toBeTruthy();
    for (const v of ["stable", "stabilizing", "unstable", "unknown"])
      expect(VALUE_STATUS[v]).toBeTruthy();
    for (const v of ["routine", "priority", "immediate"]) expect(VALUE_STATUS[v]).toBeTruthy();
  });

  it("prefers severity, falls back to status, defaults to unknown", () => {
    expect(symbolStatusFor({ severity: "critical", status: "reopened" })).toBe("critical");
    expect(symbolStatusFor({ status: "one_lane" })).toBe("warning");
    expect(symbolStatusFor({ note: "no status here" })).toBe("unknown");
  });
});

describe("layer construction", () => {
  it("tags features with their status frame", () => {
    const fc = tagFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "a",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { status: "closed" },
        },
      ],
    });
    expect(fc.features[0]!.properties._symbolStatus).toBe("critical");
  });

  it("builds fill, line, and point layers over one source per board", () => {
    const specs = boardLayerSpecs("b1", "light") as Array<{
      id: string;
      source: string;
      type: string;
      paint: Record<string, unknown>;
    }>;
    expect(specs.map((s) => s.id)).toEqual(boardLayerIds("b1"));
    for (const s of specs) expect(s.source).toBe(sourceId("b1"));
    const point = specs.find((s) => s.type === "circle")!;
    expect(JSON.stringify(point.paint["circle-color"])).toContain("_symbolStatus");
  });

  it("the base style renders with zero network references (INV-3)", () => {
    const style = JSON.stringify(buildCopStyle("dark"));
    expect(style).not.toContain("http");
    expect(style).toContain("background-color");
  });

  it("the bundled Natural Earth basemap mounts as offline geojson sources", () => {
    const style = buildCopStyle("light", { kind: "natural-earth", assetBase: "/" }) as {
      sources: Record<string, { type: string; data: string }>;
      layers: Array<{ id: string }>;
    };
    expect(style.sources.ne_land!.type).toBe("geojson");
    expect(style.sources.ne_land!.data).toBe("/basemap/ne_50m_land.geojson");
    expect(JSON.stringify(style)).not.toContain("http");
    expect(style.layers.some((l) => l.id === "ne-land")).toBe(true);
    // Local detail: California counties and the state outline mount offline too.
    expect(style.sources.ca_counties!.type).toBe("geojson");
    expect(style.sources.ca_counties!.data).toBe("/basemap/ca_counties.geojson");
    expect(style.layers.some((l) => l.id === "ca-counties-line")).toBe(true);
    expect(style.layers.some((l) => l.id === "ca-state-outline")).toBe(true);
  });

  it("adds a hidden imagery raster basemap when a tile URL is configured", () => {
    const url = "https://tiles.example.gov/{z}/{x}/{y}.png";
    const style = buildCopStyle("light", { kind: "natural-earth", assetBase: "/" }, url) as {
      sources: Record<string, { type: string; tiles?: string[] }>;
      layers: Array<{ id: string; layout?: { visibility?: string } }>;
    };
    expect(style.sources.imagery!.type).toBe("raster");
    expect(style.sources.imagery!.tiles).toEqual([url]);
    const imagery = style.layers.find((l) => l.id === "imagery")!;
    expect(imagery.layout?.visibility).toBe("none");
  });
});
