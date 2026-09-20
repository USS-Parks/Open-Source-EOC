import { afterEach, describe, expect, it } from "vitest";
import { rasterBasemaps, streetBasemap, terrainSource } from "../config.js";

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
