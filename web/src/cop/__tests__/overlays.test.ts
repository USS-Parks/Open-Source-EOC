import { afterEach, describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { withJurisdictionOverlays, readOverlayCoverage, VECTOR_OVERLAYS, OWNERSHIP_LEVELS, overlayGroupOf, OVERLAY_SOURCE } from "../overlays.js";
import { buildCopStyle } from "../layers.js";
import { buildBundledVectorStyle } from "../bundledbasemap.js";
import { buildStreetStyle } from "../streetstyle.js";
import { jurisdictionOverlays, jurisdictionMapBounds } from "../../app/config.js";

const runtime = globalThis as unknown as { OPENEOC?: Record<string, string> };
afterEach(() => { delete runtime.OPENEOC; });
describe("authoritative jurisdiction overlays", () => {
  it("is absent until configured and reads the runtime archive URL", () => {
    expect(jurisdictionOverlays()).toBeUndefined();
    runtime.OPENEOC = { OPENEOC_OVERLAYS_PMTILES_URL: "/basemap/overlays.pmtiles" };
    expect(jurisdictionOverlays()).toEqual({ pmtilesUrl: "/basemap/overlays.pmtiles", manifestUrl: "/basemap/overlays-manifest.json" });
    const base = buildCopStyle("light");
    expect(withJurisdictionOverlays(base, undefined, "light")).toBe(base);
  });
  it.each(["light", "dark"] as const)("validates every configured style in %s", (theme) => {
    const styles = [buildCopStyle(theme), buildBundledVectorStyle({ assetBase: "/" }, theme),
      buildStreetStyle({ pmtilesUrl: "https://tiles/street.pmtiles", glyphsUrl: "/fonts/{fontstack}/{range}.pbf" }, theme)];
    for (const base of styles) {
      const style = withJurisdictionOverlays(base, { pmtilesUrl: "https://tiles/overlays.pmtiles" }, theme);
      expect(validateStyleMin(style as never).map((e) => e.message)).toEqual([]);
      const layers = style.layers as Array<{ id: string; metadata?: unknown; layout?: { visibility?: string }; source?: string }>;
      const overlays = layers.filter((l) => l.source === OVERLAY_SOURCE);
      expect(overlays.map(overlayGroupOf).sort()).toEqual(VECTOR_OVERLAYS.map((o) => o.id).sort());
      expect(overlays.every((l) => l.layout?.visibility === "none")).toBe(true);
      expect(new Set(overlays.map((l) => l.id)).size).toBe(overlays.length);
      expect(JSON.stringify(style.sources)).toContain("CAL FIRE");
      for (const level of OWNERSHIP_LEVELS) expect(JSON.stringify(overlays)).toContain(level.id);
    }
  });
  it("rejects malformed coverage while preserving explicit gaps", () => {
    expect(readOverlayCoverage(null)).toEqual({});
    expect(readOverlayCoverage({ layers: { roads_state: { available: true, coverage: "California", count: 5000 }, roads_county: { available: false, coverage: "Not supplied", count: 0 }, bad: { available: "yes", count: -1 } } })).toEqual({ roads_state: { available: true, coverage: "California", count: 5000 }, roads_county: { available: false, coverage: "Not supplied", count: 0 } });
  });
  it("defaults to all California and accepts any configured jurisdiction extent", () => {
    expect(jurisdictionMapBounds()).toEqual([-124.5, 32.5, -114.1, 42.01]);
    runtime.OPENEOC = { OPENEOC_MAP_BOUNDS: "-117.3,32.5,-116.8,33.1" };
    expect(jurisdictionMapBounds()).toEqual([-117.3, 32.5, -116.8, 33.1]);
  });
  it.each(["", "0,0,0,0", "NaN,32,-114,42", "-125,, -114,42", "-181,32,-114,42", "-125,32,-114,42,10"])("rejects invalid extent %s", (value) => {
    runtime.OPENEOC = { OPENEOC_MAP_BOUNDS: value };
    expect(jurisdictionMapBounds()).toEqual([-124.5, 32.5, -114.1, 42.01]);
  });
});
