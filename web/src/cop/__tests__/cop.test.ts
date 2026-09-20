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
import { buildStreetStyle } from "../streetstyle.js";
import { buildBundledVectorStyle } from "../bundledbasemap.js";

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

  it("builds the bundled Natural Earth vector style over the offline PMTiles", () => {
    const style = buildBundledVectorStyle({ assetBase: "/" }, "dark") as {
      glyphs: string;
      sources: Record<string, { type: string; url: string; attribution: string }>;
      layers: Array<{ id: string; "source-layer"?: string }>;
    };
    expect(style.sources.basemap!.type).toBe("vector");
    expect(style.sources.basemap!.url).toBe("pmtiles:///basemap/basemap.pmtiles");
    expect(style.sources.basemap!.attribution).toContain("Natural Earth");
    expect(style.glyphs).toBe("/fonts/{fontstack}/{range}.pbf");
    const ids = style.layers.map((l) => l.id);
    // Real vector content: land, water, roads (major + minor), counties, labels.
    for (const id of ["land", "water", "roads-major", "roads-minor", "counties", "place-label"]) {
      expect(ids, id).toContain(id);
    }
    expect(style.layers.some((l) => l["source-layer"] === "places")).toBe(true);
    expect(JSON.stringify(style)).not.toContain("http");
  });

  it("adds the imagery raster to the bundled style when a tile URL is set", () => {
    const style = buildBundledVectorStyle({ assetBase: "/" }, "light", "https://t.gov/{z}/{x}/{y}.png") as {
      sources: Record<string, { type: string }>;
      layers: Array<{ id: string }>;
    };
    expect(style.sources.imagery!.type).toBe("raster");
    expect(style.layers.some((l) => l.id === "imagery")).toBe(true);
  });

  it("builds a themed street style over a self-hosted OpenMapTiles PMTiles source", () => {
    const style = buildStreetStyle(
      {
        pmtilesUrl: "https://tiles.eoc.example/california.pmtiles",
        glyphsUrl: "https://tiles.eoc.example/fonts/{fontstack}/{range}.pbf",
        spriteUrl: "https://tiles.eoc.example/sprite",
      },
      "dark",
    ) as {
      glyphs: string;
      sprite?: string;
      sources: Record<string, { type: string; url: string; attribution: string }>;
      layers: Array<{ id: string; "source-layer"?: string }>;
    };
    const omt = style.sources.openmaptiles!;
    expect(omt.type).toBe("vector");
    expect(omt.url).toBe("pmtiles://https://tiles.eoc.example/california.pmtiles");
    expect(omt.attribution).toContain("OpenStreetMap");
    expect(style.glyphs).toContain("{fontstack}");
    expect(style.sprite).toBe("https://tiles.eoc.example/sprite");
    // Real street content: roads by class, water, boundaries, and labels.
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain("road-major");
    expect(ids).toContain("water");
    expect(ids).toContain("road-label");
    expect(ids).toContain("place-label");
    expect(style.layers.some((l) => l["source-layer"] === "transportation")).toBe(true);
  });

  it("omits label layers when no glyph stack is available", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "" },
      "light",
    ) as { layers: Array<{ id: string }> };
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain("road-major");
    expect(ids).not.toContain("road-label");
    expect(ids).not.toContain("place-label");
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
