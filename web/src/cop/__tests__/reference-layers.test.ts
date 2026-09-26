import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { AIANNH_PALETTE, LIFELINE_CATEGORY_PALETTE, NRI_RATING_PALETTE, SVI_QUARTILE_PALETTE } from "@openeoc/shared";
import { basemapGroupOf } from "../layers.js";
import { buildStreetStyle } from "../streetstyle.js";
import {
  applyReferenceSpecs,
  DEFAULT_REFERENCE_STATE,
  FACILITY_ICONS,
  FEMA_NRI_STATEMENT,
  LIFELINES,
  readBoundariesManifest,
  readFacilitiesManifest,
  referenceCredits,
  referenceInspection,
  referenceLegends,
  referenceSpecs,
  REFERENCE_INSPECTABLE,
  REFERENCE_LAYER,
  RISK_ATTRIBUTION,
  withReferenceLayers,
  type ReferenceLayersConfig,
  type ReferenceState,
} from "../reference-layers.js";

type Layer = {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  metadata?: unknown;
};

const CONFIG: ReferenceLayersConfig = {
  facilities: { pmtilesUrl: "/basemap/facilities.pmtiles" },
  boundaries: { pmtilesUrl: "/basemap/boundaries.pmtiles" },
  risk: { pmtilesUrl: "/basemap/risk.pmtiles" },
};
const FONT = "Noto Sans Regular";
const street = (theme: "light" | "dark" = "light") =>
  buildStreetStyle({ pmtilesUrl: "/basemap/california.pmtiles", glyphsUrl: "/fonts/{fontstack}/{range}.pbf" }, theme);
const layersOf = (specs: ReturnType<typeof referenceSpecs>) => [...specs.fills, ...specs.lines, ...specs.symbols] as Layer[];
const layer = (state: ReferenceState, id: string, theme: "light" | "dark" = "light") =>
  layersOf(referenceSpecs(CONFIG, theme, FONT, state)).find((candidate) => candidate.id === id)!;
const withState = (change: Partial<ReferenceState>): ReferenceState => ({ ...DEFAULT_REFERENCE_STATE, ...change });

describe("reference layers in the style", () => {
  it("adds a valid style in both themes, with each archive credited", () => {
    for (const theme of ["light", "dark"] as const) {
      const style = withReferenceLayers(street(theme), CONFIG, theme, FONT);
      expect(validateStyleMin(style as never)).toEqual([]);
      const sources = style.sources as Record<string, { url: string; attribution: string }>;
      expect(sources["reference-facilities"]!.url).toBe("pmtiles:///basemap/facilities.pmtiles");
      expect(sources["reference-boundaries"]!.attribution).toContain("Census Bureau");
      expect(sources["reference-facilities"]!.attribution).toContain("OpenStreetMap");
      expect(sources["reference-risk"]!.attribution).toContain(FEMA_NRI_STATEMENT);
      expect(sources["reference-risk"]!.attribution).toContain("Centers for Disease Control and Prevention");
    }
  });

  it("puts areas under the roads, outlines under the labels and facilities above the basemap", () => {
    const ids = (withReferenceLayers(street(), CONFIG, "light", FONT).layers as Layer[]).map((l) => l.id);
    expect(ids.indexOf(REFERENCE_LAYER.tribalFill)).toBeLessThan(ids.indexOf("road-casing"));
    expect(ids.indexOf("ref-nri-tracts-fill")).toBeLessThan(ids.indexOf("road-casing"));
    expect(ids.indexOf(REFERENCE_LAYER.tribalLine)).toBeGreaterThan(ids.indexOf("road-major"));
    expect(ids.indexOf(REFERENCE_LAYER.tribalLine)).toBeLessThan(ids.indexOf("road-label"));
    expect(ids.slice(-3)).toEqual([REFERENCE_LAYER.facilities, REFERENCE_LAYER.keyFacilityNames, REFERENCE_LAYER.keyFacilities]);
  });

  it("leaves a style alone when no archive is configured", () => {
    const style = street();
    expect(withReferenceLayers(style, undefined, "light", FONT)).toBe(style);
    expect(withReferenceLayers(style, {}, "light", FONT)).toBe(style);
  });

  it("drops the basemap's facility icons and tribal line only when their archive is present", () => {
    const ids = (config: ReferenceLayersConfig) => (withReferenceLayers(street(), config, "light", FONT).layers as Layer[]).map((l) => l.id);
    expect(ids({ risk: CONFIG.risk })).toEqual(expect.arrayContaining(["facility-label", "boundary-tribal", "boundary-tribal-label"]));
    expect(ids({ boundaries: CONFIG.boundaries })).not.toContain("boundary-tribal");
    expect(ids({ boundaries: CONFIG.boundaries })).not.toContain("boundary-tribal-label");
    const layers = withReferenceLayers(street(), { facilities: CONFIG.facilities }, "light", FONT).layers as Layer[];
    expect(layers.map((l) => l.id)).not.toContain("facility-label");
    const places = layers.find((l) => l.id === "poi-label")!;
    expect(places.layout).not.toHaveProperty("icon-image");
    expect(JSON.stringify(places.filter)).toContain("community_centre");
    for (const tag of ["hospital", "fire_station", "police", "school", "helipad"]) expect(JSON.stringify(places.filter)).not.toContain(`"${tag}"`);
    expect(basemapGroupOf(places)).toBe("labels");
  });

  it("keeps the facility icons hidden until their images are registered", () => {
    const layers = withReferenceLayers(street(), CONFIG, "light", FONT).layers as Layer[];
    for (const id of [REFERENCE_LAYER.facilities, REFERENCE_LAYER.keyFacilities]) {
      expect(layers.find((l) => l.id === id)!.layout!.visibility, id).toBe("none");
      expect(layer(DEFAULT_REFERENCE_STATE, id).layout!.visibility, id).toBe("visible");
    }
  });

  it("leaves labels out without a glyph stack", () => {
    const ids = layersOf(referenceSpecs(CONFIG, "light", undefined, DEFAULT_REFERENCE_STATE)).map((l) => l.id);
    expect(ids).not.toContain(REFERENCE_LAYER.tribalLabel);
    expect(ids).not.toContain(REFERENCE_LAYER.clusterCount);
    expect(ids).not.toContain(REFERENCE_LAYER.keyFacilityNames);
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.facilities).layout!["text-font"]).toEqual([FONT]);
  });
});

describe("critical facilities", () => {
  it("clusters below z12, draws icons from z12 and names from z14", () => {
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.clusters)).toMatchObject({ "source-layer": "facility_clusters", maxzoom: 12 });
    const icons = layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.facilities);
    expect(icons).toMatchObject({ "source-layer": "facilities", minzoom: 12 });
    expect(icons.layout!["text-field"]).toEqual(["step", ["zoom"], "", 14, ["coalesce", ["get", "name"], ""]]);
    expect(icons.layout!["icon-allow-overlap"]).toBeUndefined();
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.keyFacilities)).toMatchObject({ "source-layer": "facilities", minzoom: 12 });
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.keyFacilityNames)).toMatchObject({ "source-layer": "facilities", minzoom: 14 });
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.keyFacilityNames).layout).not.toHaveProperty("icon-image");
  });

  it("draws each type on its lifeline's square and lets hospitals, EOCs and fire stations win collisions", () => {
    expect(FACILITY_ICONS).toHaveLength(24);
    expect(FACILITY_ICONS.find((icon) => icon.id === "hospital")!.color).toBe(LIFELINE_CATEGORY_PALETTE.entries.health_medical.light);
    // The key emergency services always draw, above the rest, so they are placed first.
    const key = layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.keyFacilities);
    expect(key.layout!["icon-allow-overlap"]).toBe(true);
    expect(JSON.stringify(key.filter)).toContain('["hospital","eoc","fire_station","law_enforcement","ems_station"]');
    const image = key.layout!["icon-image"] as unknown[];
    expect(image[image.indexOf("fire_station") + 1]).toBe(`eoc-sym-fire_station-${LIFELINE_CATEGORY_PALETTE.entries.safety_security.light.slice(1)}`);
    const rank = (id: string, type: string) => {
      const sort = layer(DEFAULT_REFERENCE_STATE, id).layout!["symbol-sort-key"] as unknown[];
      return sort[sort.indexOf(type) + 1] as number;
    };
    expect(["hospital", "eoc", "fire_station"].map((type) => rank(REFERENCE_LAYER.keyFacilities, type))).toEqual([0, 1, 2]);
    expect(rank(REFERENCE_LAYER.facilities, "bridge")).toBeGreaterThan(rank(REFERENCE_LAYER.facilities, "school"));
    expect(JSON.stringify(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.facilities).filter)).not.toContain('"hospital"');
  });

  it("shows only the lifelines switched on, in the clusters' counts as well", () => {
    const state = withState({ lifelines: { ...DEFAULT_REFERENCE_STATE.lifelines, transportation: false, communications: false } });
    const icons = JSON.stringify(layer(state, REFERENCE_LAYER.facilities).filter);
    expect(icons).toContain("health_medical");
    expect(icons).not.toContain("transportation");
    const radius = JSON.stringify(layer(state, REFERENCE_LAYER.clusters).paint!["circle-radius"]);
    expect(radius).toContain('"energy"');
    expect(radius).not.toContain('"transportation"');
    const none = withState({ lifelines: Object.fromEntries(LIFELINES.map((l) => [l, false])) as ReferenceState["lifelines"] });
    for (const id of [REFERENCE_LAYER.facilities, REFERENCE_LAYER.keyFacilities, REFERENCE_LAYER.clusters]) {
      expect(layer(none, id).layout!.visibility, id).toBe("none");
    }
  });
});

describe("boundaries", () => {
  it("draws tribal areas by class with a light fill, on by default, and names them from z8", () => {
    const fill = layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.tribalFill);
    expect(fill.layout!.visibility).toBe("visible");
    expect(fill.paint!["fill-opacity"]).toBeLessThanOrEqual(0.2);
    const color = fill.paint!["fill-color"] as unknown[];
    expect(color[color.indexOf("federal") + 1]).toBe(AIANNH_PALETTE.entries.federal_reservation.light);
    expect(color[color.indexOf("tdsa") + 1]).toBe(AIANNH_PALETTE.entries.tdsa.light);
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.tribalLine).paint!["line-color"]).toEqual(color);
    expect(layer(DEFAULT_REFERENCE_STATE, REFERENCE_LAYER.tribalLabel)).toMatchObject({ "source-layer": "labels", minzoom: 8 });
  });

  it("keeps BIA, counties and places off until chosen", () => {
    for (const id of [REFERENCE_LAYER.biaFill, REFERENCE_LAYER.countiesLine, REFERENCE_LAYER.placesLabel]) {
      expect(layer(DEFAULT_REFERENCE_STATE, id).layout!.visibility, id).toBe("none");
    }
    expect(layer(withState({ bia: true }), REFERENCE_LAYER.biaFill).layout!.visibility).toBe("visible");
  });
});

describe("risk and vulnerability", () => {
  const riskIds = ["nri", "svi"].flatMap((index) => ["counties", "tracts"].map((g) => `ref-${index}-${g}-fill`));
  const visible = (state: ReferenceState) => riskIds.filter((id) => layer(state, id).layout!.visibility === "visible");

  it("shows none by default and one index at a time", () => {
    expect(visible(DEFAULT_REFERENCE_STATE)).toEqual([]);
    expect(visible(withState({ risk: "nri_tsunami" }))).toEqual(["ref-nri-counties-fill", "ref-nri-tracts-fill"]);
    expect(visible(withState({ risk: "svi" }))).toEqual(["ref-svi-counties-fill", "ref-svi-tracts-fill"]);
  });

  it("switches from counties to tracts at z8", () => {
    expect(layer(DEFAULT_REFERENCE_STATE, "ref-nri-counties-fill")).toMatchObject({ "source-layer": "nri_counties", maxzoom: 8 });
    expect(layer(DEFAULT_REFERENCE_STATE, "ref-svi-tracts-line")).toMatchObject({ "source-layer": "svi_tracts", minzoom: 8 });
  });

  it("colors the chosen NRI rating and the SVI percentile from the palette, at its opacity, with a hairline", () => {
    const tsunami = layer(withState({ risk: "nri_tsunami" }), "ref-nri-tracts-fill");
    const color = tsunami.paint!["fill-color"] as unknown[];
    expect(color[1]).toEqual(["get", "TSUN_RISKR"]);
    expect(color).toContain(NRI_RATING_PALETTE.entries.very_high.light);
    expect(JSON.stringify(color)).toContain("Very High");
    expect(tsunami.paint!["fill-opacity"]).toBe(0.65);
    expect(JSON.stringify(tsunami.filter)).not.toContain("Not Applicable");
    const svi = layer(withState({ risk: "svi" }), "ref-svi-tracts-fill").paint!["fill-color"] as unknown[];
    expect(svi[0]).toBe("step");
    expect(svi).toContain(SVI_QUARTILE_PALETTE.entries.highest.light);
    expect(layer(DEFAULT_REFERENCE_STATE, "ref-nri-tracts-line").paint).toMatchObject({ "line-color": "#000000", "line-opacity": 0.25 });
  });
});

describe("state changes on a live map", () => {
  it("sets filters, layout and paint only on layers the map holds", () => {
    const map = {
      getLayer: vi.fn((id: string) => (id === REFERENCE_LAYER.tribalFill ? {} : undefined)),
      setFilter: vi.fn(),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
    };
    applyReferenceSpecs(map, referenceSpecs(CONFIG, "light", FONT, withState({ tribal: false })));
    expect(map.setLayoutProperty).toHaveBeenCalledWith(REFERENCE_LAYER.tribalFill, "visibility", "none");
    expect(new Set(map.setPaintProperty.mock.calls.map(([id]) => id))).toEqual(new Set([REFERENCE_LAYER.tribalFill]));
  });

  it("inspects facilities, areas and risk fills and opens clusters", () => {
    for (const id of [REFERENCE_LAYER.facilities, REFERENCE_LAYER.clusters, REFERENCE_LAYER.tribalFill, "ref-svi-tracts-fill"]) {
      expect(REFERENCE_INSPECTABLE.has(id), id).toBe(true);
    }
    expect(REFERENCE_INSPECTABLE.has(REFERENCE_LAYER.tribalLabel)).toBe(false);
  });
});

describe("the inspector", () => {
  const info = readFacilitiesManifest({
    types: { hospital: { lifeline: "health_medical", count: 3, coverage: "USGS NSD hospitals." }, substation: { lifeline: "energy", count: 0 } },
    sources: [{ id: "usgs_nsd", attribution: "USGS The National Map, National Structures Dataset" }, { id: 7 }],
  });

  it("gives a facility Esri's critical infrastructure fields", () => {
    const view = referenceInspection(REFERENCE_LAYER.facilities, {
      type: "hospital", lifeline: "health_medical", sector: "Healthcare and Public Health", name: "Sutter Coast Hospital",
      address: "800 E Washington Blvd", city: "Crescent City", county: "Del Norte", phone: "707-464-8511",
      capacity: 49, capacity_unit: "beds", source: "usgs_nsd", source_id: "abc",
    }, DEFAULT_REFERENCE_STATE, info)!;
    expect(view).toMatchObject({ title: "Sutter Coast Hospital", kind: "Critical facility", facilityType: "Hospital", coverage: "USGS NSD hospitals." });
    expect(view.source).toBe("USGS The National Map, National Structures Dataset");
    expect(view.status).toBeUndefined();
    expect(view.rows.map((row) => row.label)).toEqual(["Name", "Type", "Sector", "Lifeline", "Address", "City", "County", "Phone", "Capacity", "Source record"]);
    expect(view.rows.find((row) => row.label === "Lifeline")!.value).toBe("Health & Medical");
    expect(view.rows.find((row) => row.label === "Capacity")!.value).toBe("49 beds");
    expect(referenceInspection(REFERENCE_LAYER.facilities, { type: "fire_station", source: "osm" }, DEFAULT_REFERENCE_STATE)!)
      .toMatchObject({ title: "Fire station", attribution: "© OpenStreetMap contributors (ODbL)" });
  });

  it("gives the chosen risk rating and the composite score, with FEMA's statement", () => {
    const view = referenceInspection("ref-nri-tracts-fill", {
      name: "Census Tract 1", county: "Humboldt", RISK_SCORE: 99.8, RISK_RATNG: "Very High", TSUN_RISKR: "Relatively High",
    }, withState({ risk: "nri_tsunami" }))!;
    expect(view.title).toBe("Census Tract 1, Humboldt County");
    expect(view.rows.slice(0, 3)).toEqual([
      { label: "Tsunami rating", value: "Relatively High" },
      { label: "Composite risk score", value: "99.8 of 100" },
      { label: "Composite risk rating", value: "Very High" },
    ]);
    expect(view.attribution).toContain(FEMA_NRI_STATEMENT);
    const svi = referenceInspection("ref-svi-counties-fill", { name: "Del Norte", county: "Del Norte", RPL_THEMES: 0.9004 }, withState({ risk: "svi" }))!;
    expect(svi.title).toBe("Del Norte County");
    expect(svi.rows[0]).toEqual({ label: "Overall percentile", value: "0.9004 (Highest (0.75 to 1))" });
  });

  it("names tribal areas and leaves other layers to the operational inspector", () => {
    expect(referenceInspection(REFERENCE_LAYER.tribalFill, { namelsad: "Hoopa Valley Reservation", class_label: "Federal" }, DEFAULT_REFERENCE_STATE))
      .toMatchObject({ title: "Hoopa Valley Reservation", kind: "Tribal area" });
    expect(referenceInspection("board-abc-point", { name: "x" }, DEFAULT_REFERENCE_STATE)).toBeUndefined();
  });
});

describe("legends, credits and manifests", () => {
  it("lists a legend for each reference layer shown, in palette order", () => {
    const legends = referenceLegends(CONFIG, withState({ risk: "nri_tsunami" }), "light", { lifelines: ["health_medical", "energy"], tribalClasses: ["federal", "tdsa"] });
    expect(legends.map((legend) => legend.id)).toEqual(["facilities", "tribal", "nri"]);
    expect(legends[0]!.rows.map((row) => row.key)).toEqual(["health_medical", "energy"]);
    expect(legends[1]!.rows.map((row) => row.key)).toEqual(["federal_reservation", "tdsa"]);
    expect(legends[2]).toMatchObject({ title: "National Risk Index: tsunami", patch: "area" });
    expect(legends[2]!.rows).toHaveLength(5);
    expect(referenceLegends(undefined, DEFAULT_REFERENCE_STATE, "light")).toEqual([]);
  });

  it("credits the risk index only while a risk layer shows", () => {
    expect(referenceCredits(CONFIG, DEFAULT_REFERENCE_STATE)).not.toContain(RISK_ATTRIBUTION);
    expect(referenceCredits(CONFIG, withState({ risk: "svi" }))).toContain(RISK_ATTRIBUTION);
  });

  it("reads manifests defensively", () => {
    expect(info0()).toEqual({ facilityCoverage: {}, facilitySources: {}, lifelines: [] });
    expect(readBoundariesManifest({ biaDisclaimer: "No legal inference.", aiannhClasses: { byClass: { federal: 150 } } }))
      .toEqual({ biaDisclaimer: "No legal inference.", tribalClasses: ["federal"] });
    expect(readBoundariesManifest(null)).toEqual({ tribalClasses: [] });
    function info0() { return readFacilitiesManifest("nonsense"); }
  });

  const manifest = fileURLToPath(new URL("../../../public/basemap/risk-manifest.json", import.meta.url));
  it.skipIf(!existsSync(manifest))("carries FEMA's statement exactly as the risk archive's manifest records it", () => {
    const terms = JSON.parse(readFileSync(manifest, "utf8")) as { femaTerms: { statement: string } };
    expect(FEMA_NRI_STATEMENT).toBe(terms.femaTerms.statement);
  });
});
