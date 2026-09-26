import { afterEach, describe, expect, it } from "vitest";
import { buildingsSource, rasterBasemaps, referenceLayers, streetBasemap, terrainSource } from "../config.js";

type Runtime = { OPENEOC?: Record<string, string> };
const g = globalThis as unknown as Runtime;

describe("street basemap runtime config", () => {
  afterEach(() => {
    delete g.OPENEOC;
  });

  it("is off until a PMTiles URL is set", () => {
    expect(streetBasemap()).toBeUndefined();
    g.OPENEOC = { OPENEOC_BASEMAP_GLYPHS_URL: "https://x/{fontstack}/{range}.pbf" };
    expect(streetBasemap()).toBeUndefined();
  });

  it("needs only the PMTiles URL; labels fall back to the bundled glyph stack", () => {
    g.OPENEOC = { OPENEOC_BASEMAP_PMTILES_URL: "https://tiles/california.pmtiles" };
    const s = streetBasemap()!;
    expect(s.pmtilesUrl).toBe("https://tiles/california.pmtiles");
    expect(s.glyphsUrl).toMatch(/fonts\/\{fontstack\}\/\{range\}\.pbf$/);
    expect(s.fontStack).toBe("Liberation Sans Regular");
    expect(s.spriteUrl).toBeUndefined();
  });

  it("honors a deployment's own glyphs, font, and sprite", () => {
    g.OPENEOC = {
      OPENEOC_BASEMAP_PMTILES_URL: "https://tiles/california.pmtiles",
      OPENEOC_BASEMAP_GLYPHS_URL: "https://tiles/fonts/{fontstack}/{range}.pbf",
      OPENEOC_BASEMAP_FONT: "Noto Sans Regular",
      OPENEOC_BASEMAP_SPRITE_URL: "https://tiles/sprite",
    };
    const s = streetBasemap()!;
    expect(s.glyphsUrl).toBe("https://tiles/fonts/{fontstack}/{range}.pbf");
    expect(s.fontStack).toBe("Noto Sans Regular");
    expect(s.spriteUrl).toBe("https://tiles/sprite");
  });
});

describe("basemap gallery runtime config", () => {
  afterEach(() => {
    delete g.OPENEOC;
  });

  it("is empty until a raster is configured", () => {
    expect(rasterBasemaps()).toEqual([]);
  });

  it("lists imagery, topo, and the hydrography overlay in gallery order", () => {
    g.OPENEOC = {
      OPENEOC_TOPO_TILE_URL: "https://usgs/topo/{z}/{y}/{x}",
      OPENEOC_TOPO_ATTRIBUTION: "USGS The National Map",
      OPENEOC_IMAGERY_TILE_URL: "https://usgs/img/{z}/{y}/{x}",
      OPENEOC_HYDRO_TILE_URL: "https://usgs/hydro/{z}/{y}/{x}",
    };
    const list = rasterBasemaps();
    expect(list.map((b) => b.id)).toEqual(["imagery", "topo", "hydro"]);
    expect(list[1]!.attribution).toBe("USGS The National Map");
    expect(list[0]!.attribution).toBeUndefined();
    expect(list.map((b) => !!b.overlay)).toEqual([false, false, true]);
  });

  it("reads the buildings archive when configured", () => {
    expect(buildingsSource()).toBeUndefined();
    g.OPENEOC = { OPENEOC_BUILDINGS_PMTILES_URL: "https://tiles/buildings.pmtiles" };
    expect(buildingsSource()).toEqual({ pmtilesUrl: "https://tiles/buildings.pmtiles" });
  });

  it("reads each reference archive and its manifest when configured", () => {
    expect(referenceLayers()).toEqual({ facilities: undefined, boundaries: undefined, risk: undefined });
    g.OPENEOC = {
      OPENEOC_FACILITIES_PMTILES_URL: "/basemap/facilities.pmtiles",
      OPENEOC_FACILITIES_MANIFEST_URL: "/basemap/facilities-manifest.json",
      OPENEOC_RISK_PMTILES_URL: "/basemap/risk.pmtiles",
    };
    expect(referenceLayers()).toEqual({
      facilities: { pmtilesUrl: "/basemap/facilities.pmtiles", manifestUrl: "/basemap/facilities-manifest.json" },
      boundaries: undefined,
      risk: { pmtilesUrl: "/basemap/risk.pmtiles", manifestUrl: undefined },
    });
  });

  it("reads the terrain DEM with terrarium encoding by default", () => {
    expect(terrainSource()).toBeUndefined();
    g.OPENEOC = { OPENEOC_TERRAIN_TILE_URL: "https://dem/{z}/{x}/{y}.png" };
    expect(terrainSource()).toEqual({
      tiles: "https://dem/{z}/{x}/{y}.png",
      encoding: "terrarium",
      attribution: undefined,
    });
    g.OPENEOC = {
      OPENEOC_TERRAIN_TILE_URL: "https://dem/{z}/{x}/{y}.png",
      OPENEOC_TERRAIN_ENCODING: "mapbox",
      OPENEOC_TERRAIN_ATTRIBUTION: "USGS 3DEP",
    };
    expect(terrainSource()?.encoding).toBe("mapbox");
    expect(terrainSource()?.attribution).toBe("USGS 3DEP");
  });
});
