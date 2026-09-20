import { afterEach, describe, expect, it } from "vitest";
import { streetBasemap } from "../config.js";

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
