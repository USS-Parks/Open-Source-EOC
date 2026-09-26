import { describe, expect, it } from "vitest";
import { SYMBOL_STATUS } from "@openeoc/shared";
import { themes } from "../../design/tokens.js";
import {
  basemapGroupOf,
  boardLayerIds,
  boardLayerSpecs,
  buildCopStyle,
  buildingSpecs,
  buildingUseOf,
  sourceId,
  tagFeatures,
} from "../layers.js";
import { statusColor, symbolStatusFor, VALUE_STATUS } from "../symbology.js";
import { buildStreetStyle, CRITICAL_FACILITY_TAGS } from "../streetstyle.js";
import { buildBundledVectorStyle } from "../bundledbasemap.js";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  formatArea,
  geometryBounds,
  labelFor,
  parseCoordinate,
  polygonAreaSqMi,
  searchFeatures,
  totalMiles,
} from "../tools.js";

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

  it("tags features with a display label from their naming field", () => {
    const fc = tagFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "a",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { road: "SR-96 at Weitchpec", status: "closed" },
        },
      ],
    });
    expect(fc.features[0]!.properties._label).toBe("SR-96 at Weitchpec");
  });

  it("builds fill, line, point, and label layers over one source per board", () => {
    const specs = boardLayerSpecs("b1", "light", "Liberation Sans Regular") as Array<{
      id: string;
      source: string;
      type: string;
      paint: Record<string, unknown>;
      layout?: Record<string, unknown>;
    }>;
    expect(specs.map((s) => s.id)).toEqual(boardLayerIds("b1"));
    for (const s of specs) expect(s.source).toBe(sourceId("b1"));
    const point = specs.find((s) => s.type === "circle")!;
    expect(JSON.stringify(point.paint["circle-color"])).toContain("_symbolStatus");
    const label = specs.find((s) => s.id === "board-b1-label")!;
    expect(label.layout?.["text-font"]).toEqual(["Liberation Sans Regular"]);
    expect(JSON.stringify(label.layout?.["text-field"])).toContain("_label");
  });

  it("leaves the text label out when no glyph stack is known", () => {
    const specs = boardLayerSpecs("b1", "dark") as Array<{ id: string }>;
    expect(specs.map((s) => s.id)).toEqual(boardLayerIds("b1").filter((id) => !id.endsWith("-label")));
    expect(specs.some((s) => s.id.endsWith("-facility-icon"))).toBe(true);
  });

  it("the base style renders with zero network references (INV-3)", () => {
    const style = JSON.stringify(buildCopStyle("dark"));
    expect(style).not.toContain("http");
    expect(style).toContain("background-color");
  });

  it("the bundled Natural Earth basemap mounts as offline geojson sources", () => {
    const style = buildCopStyle("light", { kind: "natural-earth", assetBase: "/" }) as {
      glyphs?: string;
      sources: Record<string, { type: string; data: string }>;
      layers: Array<{ id: string }>;
    };
    expect(style.glyphs).toBe("/fonts/{fontstack}/{range}.pbf");
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

  it("mounts the basemap gallery rasters hidden, basemaps before overlays, on every style", () => {
    const rasters = [
      { id: "hydro", title: "Hydrography", tiles: "https://t.gov/h/{z}/{y}/{x}", overlay: true },
      { id: "imagery", title: "Imagery", tiles: "https://t.gov/i/{z}/{y}/{x}", attribution: "USGS" },
      { id: "topo", title: "Topo", tiles: "https://t.gov/t/{z}/{y}/{x}" },
    ];
    const styles = [
      buildBundledVectorStyle({ assetBase: "/" }, "light", rasters),
      buildCopStyle("dark", { kind: "natural-earth", assetBase: "/" }, rasters),
      buildStreetStyle({ pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/f/{fontstack}/{range}.pbf" }, "light", rasters),
    ] as Array<{
      sources: Record<string, { type: string; tiles?: string[]; attribution?: string }>;
      layers: Array<{ id: string; type: string; layout?: { visibility?: string } }>;
    }>;
    for (const style of styles) {
      const ids = style.layers.map((l) => l.id);
      expect(style.sources["raster-imagery"]!.type).toBe("raster");
      expect(style.sources["raster-imagery"]!.tiles).toEqual(["https://t.gov/i/{z}/{y}/{x}"]);
      expect(style.sources["raster-imagery"]!.attribution).toBe("USGS");
      for (const id of ["raster-imagery", "raster-topo", "raster-hydro"]) {
        expect(style.layers.find((l) => l.id === id)!.layout?.visibility).toBe("none");
      }
      // The overlay draws above both basemaps, and every raster above the vector map.
      expect(ids.indexOf("raster-hydro")).toBeGreaterThan(ids.indexOf("raster-topo"));
      expect(ids.indexOf("raster-imagery")).toBeGreaterThan(ids.indexOf("water"));
    }
  });

  it("builds a themed street style over a self-hosted OpenMapTiles PMTiles source", () => {
    const style = buildStreetStyle(
      {
        pmtilesUrl: "https://tiles.eoc.example/california.pmtiles",
        glyphsUrl: "https://tiles.eoc.example/fonts/{fontstack}/{range}.pbf",
        fontStack: "Noto Sans Regular",
        spriteUrl: "https://tiles.eoc.example/sprite",
      },
      "dark",
    ) as {
      glyphs: string;
      sprite?: string;
      sources: Record<string, { type: string; url: string; attribution: string }>;
      layers: Array<{ id: string; "source-layer"?: string; layout?: Record<string, unknown> }>;
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
    const placeLabel = style.layers.find((l) => l.id === "place-label")!;
    expect(placeLabel.layout?.["text-font"]).toEqual(["Noto Sans Regular"]);
  });

  it("draws the EOC context layers: landcover, landuse, rail, airfields, and facility labels", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/fonts/{fontstack}/{range}.pbf" },
      "light",
    ) as {
      layers: Array<{ id: string; "source-layer"?: string; minzoom?: number; filter?: unknown }>;
    };
    const ids = style.layers.map((l) => l.id);
    for (const id of [
      "landcover",
      "landuse",
      "aeroway-area",
      "aeroway-line",
      "rail",
      "water-label",
      "peak-label",
      "facility-label",
    ]) {
      expect(ids, id).toContain(id);
    }
    // Layer order: context under roads, labels on top.
    expect(ids.indexOf("landcover")).toBeLessThan(ids.indexOf("water"));
    expect(ids.indexOf("rail")).toBeLessThan(ids.indexOf("road-casing"));
    expect(ids.indexOf("road-major")).toBeLessThan(ids.indexOf("facility-label"));
    const facilities = style.layers.find((l) => l.id === "facility-label")!;
    expect(facilities["source-layer"]).toBe("poi");
    // The basemap's poi layer starts at z14; an unnamed station keeps its icon.
    expect(facilities.minzoom).toBe(14);
    expect(JSON.stringify(facilities.filter)).toContain("fire_station");
    expect(JSON.stringify(facilities.filter)).not.toContain("name");
    expect(CRITICAL_FACILITY_TAGS).toContain("hospital");
    expect(CRITICAL_FACILITY_TAGS).toContain("shelter");
  });

  it("draws and names tribal lands, which carry no admin level, apart from admin boundaries", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/fonts/{fontstack}/{range}.pbf" },
      "dark",
    ) as { layers: Array<{ id: string; type: string; filter?: unknown; metadata?: unknown }> };
    const layer = (id: string) => style.layers.find((l) => l.id === id)!;
    expect(layer("boundary-admin").filter).toEqual(["all", ["has", "admin_level"], ["<=", ["get", "admin_level"], 6]]);
    expect(layer("boundary-tribal").type).toBe("line");
    expect(layer("boundary-tribal").filter).toEqual(["==", ["get", "class"], "aboriginal_lands"]);
    expect(layer("boundary-tribal-label").type).toBe("symbol");
    for (const id of ["boundary-tribal", "boundary-tribal-label"]) expect(basemapGroupOf(layer(id)), id).toBe("boundaries");
  });

  it("labels the street style with the bundled glyph stack by default", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/fonts/{fontstack}/{range}.pbf" },
      "light",
    ) as { layers: Array<{ id: string; layout?: Record<string, unknown> }> };
    const roadLabel = style.layers.find((l) => l.id === "road-label")!;
    expect(roadLabel.layout?.["text-font"]).toEqual(["Liberation Sans Regular"]);
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

  it("mounts the DEM and a hidden hillshade under water and roads on every style", () => {
    const terrain = {
      tiles: "https://dem.example/{z}/{x}/{y}.png",
      encoding: "terrarium" as const,
      attribution: "Terrain tiles: AWS Open Data",
    };
    const styles = [
      buildBundledVectorStyle({ assetBase: "/" }, "light", [], terrain),
      buildCopStyle("dark", { kind: "natural-earth", assetBase: "/" }, [], terrain),
      buildStreetStyle({ pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/f/{fontstack}/{range}.pbf" }, "dark", [], terrain),
    ] as Array<{
      sources: Record<string, { type: string; encoding?: string; attribution?: string }>;
      layers: Array<{ id: string; type: string; layout?: { visibility?: string } }>;
    }>;
    for (const style of styles) {
      expect(style.sources.dem!.type).toBe("raster-dem");
      expect(style.sources.dem!.encoding).toBe("terrarium");
      expect(style.sources.dem!.attribution).toContain("AWS");
      const hs = style.layers.find((l) => l.id === "hillshade")!;
      expect(hs.type).toBe("hillshade");
      expect(hs.layout?.visibility).toBe("none");
    }
    // On the vector basemaps the relief sits under water, roads, and labels.
    for (const style of [styles[0]!, styles[2]!]) {
      const ids = style.layers.map((l) => l.id);
      expect(ids.indexOf("hillshade")).toBeLessThan(ids.indexOf("water"));
    }
    expect(JSON.stringify(buildBundledVectorStyle({ assetBase: "/" }, "light"))).not.toContain("hillshade");
  });

  it("puts every basemap layer in a switchable group on every style", () => {
    const styles = {
      bundled: buildBundledVectorStyle({ assetBase: "/" }, "light"),
      fallback: buildCopStyle("light", { kind: "natural-earth", assetBase: "/" }),
      street: buildStreetStyle(
        { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/f/{fontstack}/{range}.pbf" },
        "dark",
      ),
    } as unknown as Record<string, { layers: Array<{ id: string; type: string; metadata?: unknown }> }>;
    const expected: Record<string, string[]> = {
      bundled: ["land", "water", "roads", "boundaries", "labels"],
      fallback: ["land", "water", "boundaries"],
      street: ["land", "water", "buildings", "roads", "rail", "airfields", "boundaries", "labels", "facilities"],
    };
    for (const [name, style] of Object.entries(styles)) {
      const groups = new Set<string>();
      for (const layer of style.layers) {
        const g = basemapGroupOf(layer);
        if (layer.type === "background") {
          expect(g, `${name}:${layer.id}`).toBeUndefined();
          continue;
        }
        // Every drawn basemap layer is switchable.
        expect(g, `${name}:${layer.id}`).toBeDefined();
        groups.add(g!);
      }
      expect([...groups].sort()).toEqual(expected[name]!.sort());
    }
  });

  it("keeps every style free of rasters when none are configured", () => {
    const style = JSON.stringify(buildBundledVectorStyle({ assetBase: "/" }, "light"));
    expect(style).not.toContain("raster-");
    expect(style).not.toContain("http");
  });
});

describe("style validity", () => {
  it("every basemap style, fully configured, passes the MapLibre style spec", () => {
    const rasters = [
      { id: "imagery", title: "Imagery", tiles: "https://t.gov/i/{z}/{y}/{x}" },
      { id: "hydro", title: "Hydrography", tiles: "https://t.gov/h/{z}/{y}/{x}", overlay: true },
    ];
    const terrain = { tiles: "https://dem/{z}/{x}/{y}.png", encoding: "terrarium" as const };
    const buildings = { pmtilesUrl: "https://t/buildings.pmtiles" };
    const styles = {
      bundled: buildBundledVectorStyle({ assetBase: "/" }, "light", rasters, terrain, buildings),
      fallback: buildCopStyle("dark", { kind: "natural-earth", assetBase: "/" }, rasters, terrain),
      street: buildStreetStyle(
        { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/f/{fontstack}/{range}.pbf" },
        "dark",
        rasters,
        terrain,
        buildings,
      ),
    };
    for (const [name, style] of Object.entries(styles)) {
      const errors = validateStyleMin(style as never).map((e) => e.message);
      expect(errors, name).toEqual([]);
    }
    // The operational layers too, over the font the styles declare.
    for (const spec of boardLayerSpecs("b1", "light", "Liberation Sans Regular")) {
      const style = { version: 8, sources: { "board-b1": { type: "geojson", data: { type: "FeatureCollection", features: [] } } }, glyphs: "/f/{fontstack}/{range}.pbf", layers: [spec] };
      expect(validateStyleMin(style as never).map((e) => e.message)).toEqual([]);
    }
  });
});

describe("building use and status (the structure delineation layer)", () => {
  it("buckets OpenStreetMap building tags into use classes", () => {
    expect(buildingUseOf("house")).toBe("residential");
    expect(buildingUseOf("apartments")).toBe("residential");
    expect(buildingUseOf("retail")).toBe("commercial");
    expect(buildingUseOf("warehouse")).toBe("industrial");
    expect(buildingUseOf("school")).toBe("civic");
    expect(buildingUseOf("church")).toBe("religious");
    expect(buildingUseOf("barn")).toBe("agricultural");
    expect(buildingUseOf("yes")).toBe("other");
    expect(buildingUseOf(undefined)).toBe("other");
  });

  it("mounts the buildings archive keyed by osm_id, colored by status first and use second", () => {
    const spec = buildingSpecs({ pmtilesUrl: "https://t/buildings.pmtiles" }, "light") as {
      sources: Record<string, { type: string; url: string; promoteId?: string }>;
      layers: Array<{ id: string; type: string; "source-layer": string; minzoom?: number; paint: Record<string, unknown> }>;
    };
    expect(spec.sources.buildings!.url).toBe("pmtiles://https://t/buildings.pmtiles");
    expect(spec.sources.buildings!.promoteId).toBe("osm_id");
    const use = spec.layers.find((l) => l.id === "building-use")!;
    expect(use["source-layer"]).toBe("buildings");
    expect(use.minzoom).toBe(13);
    const color = JSON.stringify(use.paint["fill-color"]);
    expect(color).toContain("feature-state");
    expect(color.indexOf("feature-state")).toBeLessThan(color.indexOf("apartments"));
    expect(spec.layers.some((l) => l.id === "building-outline")).toBe(true);
    expect(buildingSpecs(undefined, "dark").layers).toEqual([]);
  });

  it("is in the buildings group on the street style", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/f/{fontstack}/{range}.pbf" },
      "light",
      [],
      undefined,
      { pmtilesUrl: "https://t/buildings.pmtiles" },
    ) as { layers: Array<{ id: string; metadata?: unknown }> };
    const use = style.layers.find((l) => l.id === "building-use")!;
    expect(basemapGroupOf(use)).toBe("buildings");
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf("building")).toBeLessThan(ids.indexOf("building-use"));
    expect(ids.indexOf("building-use")).toBeLessThan(ids.indexOf("road-casing"));
  });

  it("draws the typed footprints over imagery and its water, as on a hybrid map", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "https://t/x.pmtiles", glyphsUrl: "/f/{fontstack}/{range}.pbf" },
      "dark",
      [{ id: "imagery", title: "Imagery", tiles: "https://t.gov/i/{z}/{y}/{x}" }],
      undefined,
      { pmtilesUrl: "https://t/buildings.pmtiles" },
    ) as { layers: Array<{ id: string }> };
    const ids = style.layers.map((l) => l.id);
    for (const typed of ["building-use", "building-outline"]) {
      expect(ids.indexOf(typed), typed).toBeGreaterThan(ids.indexOf("raster-imagery"));
      expect(ids.indexOf(typed), typed).toBeGreaterThan(ids.indexOf("imagery-water"));
    }
    expect(ids.indexOf("building")).toBeLessThan(ids.indexOf("raster-imagery"));
  });
});

describe("operator map tools", () => {
  const sf: [number, number] = [-122.4194, 37.7749];
  const la: [number, number] = [-118.2437, 34.0522];

  it("measures a path in statute miles", () => {
    expect(totalMiles([sf])).toBe(0);
    expect(totalMiles([sf, la])).toBeCloseTo(347.4, 0);
    expect(totalMiles([sf, la, sf])).toBeCloseTo(694.8, 0);
  });

  it("measures a ring's area on the sphere", () => {
    // A one-degree square at the equator is about 4,770 square miles.
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const sqMi = polygonAreaSqMi(square);
    expect(sqMi).toBeGreaterThan(4700);
    expect(sqMi).toBeLessThan(4850);
    expect(polygonAreaSqMi([sf, la])).toBe(0);
    expect(formatArea(0.5)).toBe("320.0 ac");
    expect(formatArea(2)).toBe("2.00 sq mi (1,280 ac)");
  });

  it("parses lat, lng the way an operator types it", () => {
    expect(parseCoordinate("41.3, -123.5")).toEqual([-123.5, 41.3]);
    expect(parseCoordinate("41.3 -123.5")).toEqual([-123.5, 41.3]);
    // A pair that only fits as lng, lat is taken that way.
    expect(parseCoordinate("-123.5, 41.3")).toEqual([-123.5, 41.3]);
    expect(parseCoordinate("Hoopa")).toBeNull();
    expect(parseCoordinate("200, 300")).toBeNull();
  });

  it("labels a record from its first naming field", () => {
    expect(labelFor({ name: "Hoopa High Gym", status: "normal" })).toBe("Hoopa High Gym");
    expect(labelFor({ road: "SR-96", reason: "Rockslide" })).toBe("SR-96");
    expect(labelFor({ status: "closed" })).toBe("");
  });

  it("bounds any geometry kind", () => {
    expect(geometryBounds({ type: "Point", coordinates: [1, 2] })).toEqual([1, 2, 1, 2]);
    expect(
      geometryBounds({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 3],
            [0, 0],
          ],
        ],
      }),
    ).toEqual([0, 0, 2, 3]);
    expect(geometryBounds(null)).toBeNull();
  });

  it("finds records by any readable property, never by hidden tags", () => {
    const collections = {
      "board-shelters": {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "s1",
            geometry: { type: "Point", coordinates: [-123.6, 41.1] },
            properties: { name: "Weitchpec Center", status: "evacuating", _symbolStatus: "critical" },
          },
          {
            type: "Feature" as const,
            id: "s2",
            geometry: { type: "Point", coordinates: [-123.5, 41.2] },
            properties: { name: "Klamath Hall", status: "closed", _symbolStatus: "critical" },
          },
        ],
      },
    };
    const hits = searchFeatures(collections, "weitch");
    expect(hits.map((h) => h.featureId)).toEqual(["s1"]);
    expect(hits[0]!.title).toBe("Weitchpec Center");
    expect(hits[0]!.bounds).toEqual([-123.6, 41.1, -123.6, 41.1]);
    expect(searchFeatures(collections, "critical")).toEqual([]);
    expect(searchFeatures(collections, "a", 1)).toHaveLength(1);
    expect(searchFeatures(collections, "  ")).toEqual([]);
  });
});
