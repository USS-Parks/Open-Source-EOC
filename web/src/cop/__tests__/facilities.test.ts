import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FACILITY_TYPE } from "@openeoc/shared";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it, vi } from "vitest";
import { featureHtml } from "../CopMap.js";
import {
  ensureFacilityImages,
  FACILITY_SYMBOLS,
  facilityTypeFor,
  streetFacilityIconExpression,
} from "../facilities.js";
import { feedLayerIds, feedLayerSpecs, tagFeedFeatures } from "../feeds.js";
import { boardLayerIds, boardLayerSpecs, tagFeatures, type CopFeatureCollection } from "../layers.js";
import { buildStreetStyle } from "../streetstyle.js";

const point = (properties: Record<string, unknown>): CopFeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", id: "facility", geometry: { type: "Point", coordinates: [-121, 38] }, properties }],
});

describe("licensed NAPSG facility registry", () => {
  it("has one licensed symbol for every shared facility type", () => {
    expect(FACILITY_SYMBOLS.map((entry) => entry.type)).toEqual(FACILITY_TYPE.values);
    expect(new Set(FACILITY_SYMBOLS.map((entry) => entry.iconId)).size).toBe(9);
    expect(FACILITY_SYMBOLS.every((entry) => entry.assetFile.endsWith(".png"))).toBe(true);
  });

  it("classifies explicit source values without broad facility guesses", () => {
    expect(facilityTypeFor({ facility_type: "urgent-care" })).toBe("urgent-care");
    expect(facilityTypeFor({ NAICS_DESC: "Urgent Care Facilities" })).toBe("urgent-care");
    expect(facilityTypeFor({ category: "Aircraft Landing Facilities, Commercial" })).toBe("commercial-airport");
    expect(facilityTypeFor({ subclass: "hospital" })).toBe("hospital");
    expect(facilityTypeFor({ subclass: "helipad" })).toBe("heliport");
    expect(facilityTypeFor({ subclass: "clinic" })).toBeUndefined();
    expect(facilityTypeFor({ subclass: "townhall" })).toBeUndefined();
    expect(facilityTypeFor({ subclass: "community_centre" })).toBeUndefined();
    expect(facilityTypeFor({ subclass: "airport" })).toBeUndefined();
    expect(facilityTypeFor({ category: "Medical facility" })).toBeUndefined();
  });

  it("keeps facility type independent from explicit and stale status", () => {
    const current = tagFeatures(point({ facilityType: "hospital", status: "closed" }));
    expect(current.features[0]!.properties).toMatchObject({
      _facilityType: "hospital",
      _symbolStatus: "critical",
    });
    const missing = tagFeatures(point({ facilityType: "hospital" }));
    expect(missing.features[0]!.properties._symbolStatus).toBe("unknown");
    const stale = tagFeedFeatures(point({ facilityType: "hospital", status: "reopened" }), {
      name: "Synthetic facilities",
      stale: true,
      ageSeconds: 7200,
    });
    expect(stale.features[0]!.properties).toMatchObject({
      _facilityType: "hospital",
      _symbolStatus: "unknown",
    });
  });

  it.each(["light", "dark"] as const)("builds valid status frames and type icons in %s", (theme) => {
    const specs = boardLayerSpecs("facilities", theme, "Liberation Sans Regular") as Array<Record<string, unknown>>;
    expect(specs.map((layer) => layer.id)).toEqual(boardLayerIds("facilities"));
    const circle = specs.find((layer) => layer.id === "board-facilities-point")!;
    const icon = specs.find((layer) => layer.id === "board-facilities-facility-icon")!;
    expect(JSON.stringify(circle)).toContain("_symbolStatus");
    expect(JSON.stringify(circle)).toContain("_facilityType");
    expect(JSON.stringify((icon.layout as Record<string, unknown>)["icon-image"])).toContain("eoc-sym-hospital-");
    for (const layer of specs) {
      const style = {
        version: 8,
        glyphs: "/fonts/{fontstack}/{range}.pbf",
        sources: { "board-facilities": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [layer],
      };
      expect(validateStyleMin(style as never).map((error) => error.message)).toEqual([]);
    }
    expect(feedLayerSpecs("facilities", theme, "Liberation Sans Regular").map((layer) => (layer as { id: string }).id))
      .toEqual(feedLayerIds("facilities"));
  });

  it("adds icons only for source-safe OpenMapTiles subclasses", () => {
    const style = buildStreetStyle(
      { pmtilesUrl: "/basemap/california.pmtiles", glyphsUrl: "/fonts/{fontstack}/{range}.pbf" },
      "light",
    ) as { layers: Array<{ id: string; layout?: Record<string, unknown> }> };
    const layout = style.layers.find((layer) => layer.id === "facility-label")!.layout!;
    expect(layout["icon-image"]).toEqual(streetFacilityIconExpression());
    const expression = JSON.stringify(layout["icon-image"]);
    for (const safe of ["hospital", "fire_station", "police", "school", "shelter", "helipad"]) {
      expect(expression).toContain(safe);
    }
    for (const broad of ["clinic", "townhall", "community_centre", "airport"]) {
      expect(expression).not.toContain(`"${broad}"`);
    }
  });

  it("loads every local image once and remains idempotent", async () => {
    const images = new Set<string>();
    const loadImage = vi.fn(async (url: string) => ({ data: { url } }));
    const map = {
      hasImage: (id: string) => images.has(id),
      loadImage,
      addImage: (id: string) => { images.add(id); },
    };
    await ensureFacilityImages(map as never);
    await ensureFacilityImages(map as never);
    expect(images.size).toBe(9);
    expect(loadImage).toHaveBeenCalledTimes(9);
    expect(loadImage.mock.calls.every(([url]) => String(url).startsWith("/napsg/"))).toBe(true);
  });

  it("inspection names the type and never invents normal status", () => {
    const unknown = featureHtml({ facilityType: "local-eoc", name: "County EOC" });
    expect(unknown).toContain("Facility type");
    expect(unknown).toContain("Local EOC");
    expect(unknown).toContain("Operational status");
    expect(unknown).toContain("unknown");
    const critical = featureHtml({ facilityType: "hospital", _symbolStatus: "critical" });
    expect(critical).toContain("Hospital");
    expect(critical).toContain("critical");
  });

  it("ships byte-identical assets and license recorded by the manifest", () => {
    const root = resolve(process.cwd(), "web/public/napsg");
    const manifest = JSON.parse(readFileSync(resolve(root, "acquisition-manifest.json"), "utf8")) as {
      licenseSha256: string;
      assets: Array<{ file: string; sha256: string }>;
    };
    const sha = (file: string) => createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex").toUpperCase();
    expect(manifest.assets).toHaveLength(9);
    for (const asset of manifest.assets) expect(sha(asset.file)).toBe(asset.sha256);
    expect(sha("CC-BY-4.0.txt")).toBe(manifest.licenseSha256);

    for (const [suffix, pixelRatio, width, height] of [
      ["", 1, 288, 32],
      ["@2x", 2, 576, 64],
    ] as const) {
      const metadata = JSON.parse(readFileSync(resolve(root, `sprite${suffix}.json`), "utf8")) as Record<
        string,
        { pixelRatio: number; attribution: string; license: string; source: string; sourceSha256: string }
      >;
      expect(Object.keys(metadata).sort()).toEqual(FACILITY_SYMBOLS.map((entry) => entry.iconId).sort());
      for (const entry of Object.values(metadata)) {
        expect(entry.pixelRatio).toBe(pixelRatio);
        expect(entry.attribution).toContain("NAPSG Foundation");
        expect(entry.license).toBe("CC BY 4.0");
        expect(entry.source).toMatch(/^https:\/\/napsg-web\.s3\.amazonaws\.com\//);
        expect(entry.sourceSha256).toMatch(/^[A-F0-9]{64}$/);
      }
      const png = readFileSync(resolve(root, `sprite${suffix}.png`));
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(height);
    }
  });
});
