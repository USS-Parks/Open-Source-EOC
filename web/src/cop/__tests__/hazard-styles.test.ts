import {
  DAMAGE_DEGREE_PALETTE,
  HAZARD_PALETTE,
  INCIDENT_FACILITY_PALETTE,
  ROAD_CLOSURE_PALETTE,
  SHELTER_STATUS_PALETTE,
  STATUS_FRAME_PALETTE,
  type PaletteEntry,
} from "@openeoc/shared";
import { createPropertyExpression, featureFilter, latest, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartographyLayerSpecs, WEATHER_LAYER_SUFFIX } from "../cartography.js";
import { feedLayerSpecs } from "../feeds.js";
import {
  ensureStyleImages,
  HAZARD_AREA_TIERS,
  hazardHatchId,
  HAZARD_POINTS,
  layerTier,
  statusLayerSpecs,
  styleLegend,
  TIER,
  tieredBeforeId,
  type StyleLegendKey,
} from "../hazard-styles.js";
import { iconImageId } from "../symbols/register.js";

/** Kind-aware incident and hazard styles, evaluated as MapLibre evaluates them. */

type Spec = { id: string; type: string; minzoom?: number; filter?: unknown; paint?: Record<string, unknown>; layout?: Record<string, unknown>; metadata?: unknown };
type Theme = "light" | "dark";
type Geometry = "Point" | "LineString" | "Polygon";

const FONT = "Liberation Sans Regular";
const THEMES: readonly Theme[] = ["light", "dark"];
/** Each geometry as a tile feature: a type code and its rings in tile units. */
const FEATURE: Record<Geometry, { type: 1 | 2 | 3; geometry: { x: number; y: number }[][] }> = {
  Point: { type: 1, geometry: [[{ x: 5, y: 5 }]] },
  LineString: { type: 2, geometry: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]] },
  Polygon: { type: 3, geometry: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }]] },
};

/** The data packs' category vocabulary (server/src/__tests__/scenario-geography.ts, HAZARD_CATEGORIES). */
const DATA_PACK_AREAS = [
  "Fire perimeter", "Evacuation order", "Evacuation warning", "Shelter in place", "Flood extent",
  "Tsunami inundation", "Liquefaction", "Power outage", "Damage area", "Road disruption",
];
const DATA_PACK_POINTS = ["Spot fire", "Slide", "Structure fire", "Gas leak", "Bridge damage", "Hazardous materials", "Road block"];

const feed = (theme: Theme = "light") => feedLayerSpecs("f1", theme, FONT) as Spec[];
const board = (template: string, theme: Theme = "light") => cartographyLayerSpecs("b1", template, theme, FONT, "map") as Spec[];

function draws(spec: Spec, properties: Record<string, unknown>, geometry: Geometry, zoom = 11): boolean {
  if (spec.minzoom !== undefined && zoom < spec.minzoom) return false;
  if (spec.filter === undefined) return true;
  return featureFilter(spec.filter as never, "filter").filter({ zoom }, { ...FEATURE[geometry], properties } as never);
}

function value(spec: Spec, property: string, properties: Record<string, unknown>, geometry: Geometry = "Point", zoom = 11): unknown {
  const group = property in (spec.paint ?? {}) ? "paint" : "layout";
  const definition = (latest as unknown as Record<string, Record<string, unknown>>)[`${group}_${spec.type}`]![property];
  const expression = createPropertyExpression((spec[group] as Record<string, unknown>)[property] as never, property, definition as never);
  if (expression.result !== "success") throw new Error(JSON.stringify(expression.value));
  const result = expression.value.evaluate({ zoom }, { ...FEATURE[geometry], properties } as never) as unknown;
  if (result && typeof result === "object") return "name" in result ? (result as { name: string }).name : String(result);
  return result;
}

/** A color as MapLibre renders it. */
const rgba = (hex: string, alpha = 1) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${alpha})`;
const color = (spec: Spec, property: string, properties: Record<string, unknown>, geometry: Geometry = "Point") =>
  String(value(spec, property, properties, geometry));
const drawing = (specs: Spec[], properties: Record<string, unknown>, geometry: Geometry) =>
  specs.filter((spec) => draws(spec, properties, geometry)).map((spec) => spec.id);

describe("data-pack hazards", () => {
  it("gives every category the data packs store a style of its own, and leaves nothing to the status style", () => {
    const specs = feed();
    for (const category of DATA_PACK_AREAS) {
      const ids = drawing(specs, { category }, "Polygon");
      expect(ids.length, category).toBeGreaterThanOrEqual(1);
      expect(ids.every((id) => id.includes("-hazard-")), `${category}: ${ids}`).toBe(true);
    }
    for (const category of DATA_PACK_POINTS) {
      expect(drawing(specs, { category }, "Point"), category).toEqual(["feed-f1-hazard-point"]);
    }
    // A record outside the vocabulary keeps the status style.
    expect(drawing(specs, { category: "Downed trees" }, "Point")).toEqual(["feed-f1-point"]);
    // Every area entry belongs to exactly one tier, every point entry has an icon.
    const areas = Object.entries(HAZARD_PALETTE.entries).filter(([, entry]) => entry.polygon).map(([key]) => key);
    expect(Object.values(HAZARD_AREA_TIERS).flat().sort()).toEqual(areas.sort());
    expect(HAZARD_POINTS).toHaveLength(DATA_PACK_POINTS.length);
  });

  it.each(THEMES)("draws each area in its palette color with Esri's fill and outline, stale in grey (%s)", (theme) => {
    const specs = feed(theme);
    const grey = rgba(STATUS_FRAME_PALETTE.entries.unknown[theme]);
    for (const [key, entry] of Object.entries(HAZARD_PALETTE.entries) as [string, PaletteEntry][]) {
      if (!entry.polygon) continue;
      const properties = { category: entry.label };
      const ids = drawing(specs, properties, "Polygon");
      const line = specs.find((spec) => ids.includes(spec.id) && spec.type === "line")!;
      expect(color(line, "line-color", properties, "Polygon"), key).toBe(rgba(entry.polygon.outline ?? entry[theme]));
      expect(value(line, "line-width", properties, "Polygon"), key).toBe(entry.polygon.outlineWidth);
      expect(color(line, "line-color", { ...properties, _stale: true }, "Polygon"), key).toBe(grey);
      const fill = specs.find((spec) => ids.includes(spec.id) && spec.type === "fill")!;
      if (entry.polygon.hatch) {
        expect(value(fill, "fill-pattern", properties, "Polygon"), key).toBe(hazardHatchId(key, theme));
      } else {
        const opacity = entry.polygon.fillOpacity;
        expect(color(fill, "fill-color", properties, "Polygon"), key).toBe(rgba(entry[theme], opacity));
        expect(color(fill, "fill-color", { ...properties, _stale: true }, "Polygon"), key)
          .toBe(rgba(STATUS_FRAME_PALETTE.entries.unknown[theme], opacity));
      }
      expect(value(fill, "fill-opacity", properties, "Polygon"), key).toBe(1);
    }
    // Only road disruption is hatched; a damage area is hollow.
    expect(Object.entries(HAZARD_PALETTE.entries).filter(([, entry]) => entry.polygon?.hatch).map(([key]) => key)).toEqual(["road_disruption"]);
    const impact = specs.find((spec) => spec.id === "feed-f1-hazard-impact-fill")!;
    expect(color(impact, "fill-color", { category: "Damage area" }, "Polygon")).toMatch(/,0\)$/);
    // The fill thins toward street zoom.
    expect(String(value(impact, "fill-color", { category: "Flood extent" }, "Polygon", 15))).toMatch(/,0\.193\)$/);
    expect(String(value(impact, "fill-color", { category: "Flood extent" }, "Polygon", 11))).toMatch(/,0\.35\)$/);
  });

  it("keeps every opacity a number, which the map scales by the operator's layer opacity", () => {
    const specs = [
      ...feed(),
      ...["road_closures", "shelters", "incident_facilities", "damage_assessment"].flatMap((template) => board(template)),
      ...(statusLayerSpecs("board-b1", "light", FONT) as Spec[]),
    ];
    for (const spec of specs) {
      for (const [property, setting] of Object.entries(spec.paint ?? {})) {
        if (property.endsWith("-opacity")) expect(typeof setting, `${spec.id} ${property}`).toBe("number");
      }
    }
  });

  it.each(THEMES)("draws hazard points as the icon suite's pictogram on a disc of the family color, critical first (%s)", (theme) => {
    const point = feed(theme).find((spec) => spec.id === "feed-f1-hazard-point")!;
    for (const key of HAZARD_POINTS) {
      const entry = HAZARD_PALETTE.entries[key];
      expect(value(point, "icon-image", { category: entry.label }), key).toBe(iconImageId(entry.icon!, entry[theme]));
      expect(value(point, "icon-image", { category: key, _stale: true }), key)
        .toBe(iconImageId(entry.icon!, STATUS_FRAME_PALETTE.entries.unknown[theme]));
    }
    expect(value(point, "symbol-sort-key", { category: "Slide", status: "closed" })).toBe(0);
    expect(value(point, "symbol-sort-key", { category: "Slide", status: "one_lane" })).toBe(1);
    expect(value(point, "symbol-sort-key", { category: "Slide" })).toBe(3);
    // Sized with zoom, and every point shows from zoom 10.
    expect(value(point, "icon-size", {}, "Point", 7)).toBeLessThan(value(point, "icon-size", {}, "Point", 15) as number);
    expect(value(point, "icon-overlap", {}, "Point", 9)).toBe("never");
    expect(value(point, "icon-overlap", {}, "Point", 10)).toBe("always");
  });

  it("labels an evacuation area by its zone and a fire by its name in capitals, and nothing else", () => {
    const label = feed().find((spec) => spec.id === "feed-f1-hazard-label")!;
    const text = (properties: Record<string, unknown>) => value(label, "text-field", properties, "Polygon");
    expect(text({ category: "Evacuation order", title: "SYNTHETIC Yurok Tribe order: Weitchpec" })).toBe("Weitchpec");
    expect(text({ category: "Shelter in place", title: "SYNTHETIC Yurok Tribe order: SR-169 to the Pecwan refuge area" }))
      .toBe("SR-169 to the Pecwan refuge area");
    expect(text({ category: "Fire perimeter", title: "SYNTHETIC Deerhorn Fire" })).toBe("SYNTHETIC DEERHORN FIRE");
    expect(text({ category: "Evacuation warning", title: "Zone HUM-E012" })).toBe("Zone HUM-E012");
    expect(draws(label, { category: "Flood extent", title: "Smith River" }, "Polygon")).toBe(false);
    expect(draws(label, { category: "Spot fire", title: "SR-96" }, "Point")).toBe(false);
    expect(draws(label, { category: "Evacuation order" }, "Polygon", 8)).toBe(false);
  });
});

describe("draw order", () => {
  it("stacks warnings under shelter in place under orders, whichever source they come from", () => {
    const fill = feed().find((spec) => spec.id === "feed-f1-hazard-evacuation-fill")!;
    const rank = (category: string) => value(fill, "fill-sort-key", { category }, "Polygon") as number;
    expect(rank("Evacuation warning")).toBeLessThan(rank("Shelter in place"));
    expect(rank("Shelter in place")).toBeLessThan(rank("Evacuation order"));
    expect(TIER.impact).toBeLessThan(TIER.evacuation);
    expect(TIER.evacuation).toBeLessThan(TIER.perimeter);
    expect(TIER.perimeter).toBeLessThan(TIER.line);
    expect(TIER.label).toBeLessThan(TIER.point);
  });

  /** A map that mounts specs as CopMap does, each under the layer tieredBeforeId names. */
  function mapOf(initial: string[] = []) {
    const layers = new Map<string, Spec>(initial.map((id) => [id, { id, type: "background" }]));
    const order = [...initial];
    const map = { getLayersOrder: () => [...order], getLayer: (id: string) => layers.get(id) };
    const mount = (specs: Spec[], band?: string) => {
      for (const spec of specs) {
        const before = tieredBeforeId(map, spec, band);
        order.splice(before ? order.indexOf(before) : order.length, 0, spec.id);
        layers.set(spec.id, spec);
      }
    };
    return { order, mount };
  }
  const renamed = (specs: Spec[], name: string) => specs.map((spec) => ({ ...spec, id: spec.id.replace("feed-f1", `feed-${name}`) }));

  it("draws every data pack's areas under every point, and perimeters over evacuation areas mounted after them", () => {
    // Deerhorn's order: fire perimeters, spot fires, then evacuation areas.
    const { order, mount } = mapOf(["background", "road-label", "band-point-feeds", "band-boards"]);
    for (const name of ["perimeters", "spots", "zones"]) mount(renamed(feed(), name), "band-point-feeds");
    mount(board("shelters"), "band-boards");
    const at = (id: string) => order.indexOf(id);
    expect(at("feed-perimeters-hazard-perimeter-fill")).toBeGreaterThan(at("feed-zones-hazard-evacuation-fill"));
    expect(at("feed-spots-hazard-point")).toBeGreaterThan(at("feed-zones-hazard-evacuation-line"));
    expect(at("feed-zones-hazard-label")).toBeLessThan(at("feed-spots-hazard-point"));
    // Bands keep their order: every data pack layer under the band marker, boards above it.
    expect(Math.max(...order.filter((id) => id.startsWith("feed-")).map(at))).toBeLessThan(at("band-point-feeds"));
    expect(at("board-b1-shelter")).toBeGreaterThan(at("band-point-feeds"));
    expect(at("board-b1-shelter")).toBeLessThan(at("band-boards"));
    expect(at("road-label")).toBeLessThan(at("feed-perimeters-fill"));
  });

  it("stacks sources at the top of the map when it has no bands, and reads a layer's tier from its type when it names none", () => {
    const { order, mount } = mapOf(["background"]);
    mount(board("road_closures"));
    mount(renamed(feed(), "zones"));
    expect(order.indexOf("feed-zones-hazard-evacuation-fill")).toBeLessThan(order.indexOf("board-b1-line"));
    expect(order.indexOf("board-b1-casing")).toBeLessThan(order.indexOf("board-b1-line"));
    expect(layerTier({ type: "fill" })).toBe(TIER.area);
    expect(layerTier({ type: "line" })).toBe(TIER.line);
    expect(layerTier({ type: "symbol" })).toBe(TIER.point);
  });
});

describe("the status style for records with no map meaning of their own", () => {
  it.each(THEMES)("draws a light status fill under a crisp outline, no hatch, and small discs with a white halo (%s)", (theme) => {
    const specs = statusLayerSpecs("board-b1", theme, FONT) as Spec[];
    expect(specs.map((spec) => spec.id)).toEqual(["board-b1-fill", "board-b1-line", "board-b1-label", "board-b1-point", "board-b1-facility-icon"]);
    const fill = specs[0]!;
    const critical = STATUS_FRAME_PALETTE.entries.critical;
    expect(critical.polygon!.fillOpacity).toBeLessThanOrEqual(0.5);
    expect(color(fill, "fill-color", { _symbolStatus: "critical" }, "Polygon")).toBe(rgba(critical[theme], critical.polygon!.fillOpacity));
    expect(value(specs[1]!, "line-width", {}, "Polygon")).toBe(critical.polygon!.outlineWidth);
    expect(value(specs[1]!, "line-width", {}, "LineString")).toBe(3);
    const point = specs.find((spec) => spec.id === "board-b1-point")!;
    expect(value(point, "circle-radius", {}, "Point", 12)).toBeLessThanOrEqual(6);
    expect(color(point, "circle-stroke-color", {})).toBe(rgba("#ffffff"));
    expect(JSON.stringify(specs)).not.toContain("pattern");
    const icon = specs.find((spec) => spec.id === "board-b1-facility-icon")!;
    expect(value(icon, "icon-image", { _facilityType: "hospital" })).toMatch(/^eoc-sym-hospital-/);
    expect(draws(point, { _facilityType: "hospital" }, "Point")).toBe(false);
    expect(specs.find((spec) => spec.id === "board-b1-label")!.minzoom).toBe(13);
  });
});

describe("the Map screen's board cartography", () => {
  it.each(THEMES)("draws a closure over a white casing, arrows only where it has a direction, a detour orange and road blocks as no-entry discs (%s)", (theme) => {
    const specs = board("road_closures", theme);
    const ids = specs.map((spec) => spec.id);
    expect(ids.indexOf("board-b1-casing")).toBeLessThan(ids.indexOf("board-b1-line"));
    const [casing, line] = [specs.find((spec) => spec.id === "board-b1-casing")!, specs.find((spec) => spec.id === "board-b1-line")!];
    expect(color(casing, "line-color", {}, "LineString")).toBe(rgba("#ffffff"));
    expect(value(casing, "line-width", {}, "LineString")).toBeGreaterThan(value(line, "line-width", {}, "LineString") as number);
    for (const [status, entry] of Object.entries(ROAD_CLOSURE_PALETTE.entries)) {
      expect(color(line, "line-color", { status }, "LineString"), status).toBe(rgba(entry[theme]));
    }
    expect(color(line, "line-color", { status: "detour" }, "LineString")).toBe(rgba("#e69800"));
    const arrow = specs.find((spec) => spec.id === "board-b1-arrow")!;
    expect(draws(arrow, { status: "closed" }, "LineString")).toBe(false);
    expect(draws(arrow, { status: "closed", direction: "One Direction" }, "LineString")).toBe(true);
    expect(value(arrow, "icon-image", { status: "closed", direction: "one_direction" })).toMatch(/^eoc-arrow-/);
    expect(value(arrow, "icon-image", { status: "closed", direction: "Both Directions" })).toMatch(/^eoc-arrows-/);
    expect(arrow.layout!["icon-rotation-alignment"]).toBe("map");
    const block = specs.find((spec) => spec.id === "board-b1-closure-point")!;
    expect(value(block, "icon-image", { status: "closed" })).toBe(`eoc-no-entry-${ROAD_CLOSURE_PALETTE.entries.closed[theme].slice(1)}`);
    expect(specs.find((spec) => spec.id === "board-b1-label")!.layout!["symbol-placement"]).toBe("line");
  });

  it.each(THEMES)("draws shelters by status with their occupancy against capacity at street zoom (%s)", (theme) => {
    const specs = board("shelters", theme);
    const shelter = specs.find((spec) => spec.id === "board-b1-shelter")!;
    expect(value(shelter, "icon-image", { status: "normal" })).toBe(iconImageId("shelter", SHELTER_STATUS_PALETTE.entries.open[theme]));
    expect(value(shelter, "icon-image", { status: "normal", planned: true })).toBe(iconImageId("shelter", SHELTER_STATUS_PALETTE.entries.planned[theme]));
    const label = specs.find((spec) => spec.id === "board-b1-label")!;
    const record = { _label: "Hoopa Neighborhood Facility", occupancy: 42, capacity: 150 };
    expect(value(label, "text-field", record, "Point", 12)).toBe("Hoopa Neighborhood Facility");
    expect(value(label, "text-field", record, "Point", 14)).toBe("Hoopa Neighborhood Facility\n42 of 150");
    expect(value(label, "text-field", { _label: "Gym", capacity: 80 }, "Point", 15)).toBe("Gym\nCapacity 80");
    expect(specs.indexOf(label)).toBeLessThan(specs.indexOf(shelter));
  });

  it.each(THEMES)("draws damage assessments by FEMA degree, Destroyed purple and first (%s)", (theme) => {
    const [damage] = board("damage_assessment", theme);
    for (const [degree, entry] of Object.entries(DAMAGE_DEGREE_PALETTE.entries)) {
      expect(value(damage!, "icon-image", { degree }), degree).toBe(iconImageId("damage_report", entry[theme]));
    }
    expect(value(damage!, "icon-image", { degree: "destroyed" })).toBe("eoc-sym-damage_report-8335a8");
    expect(value(damage!, "symbol-sort-key", { degree: "destroyed" })).toBe(0);
    expect(cartographyLayerSpecs("b1", "damage_assessment", theme, FONT)).toBeUndefined();
  });

  it.each(THEMES)("draws incident facilities as the ICS symbols, weather stations on their own toggle (%s)", (theme) => {
    const specs = board("incident_facilities", theme);
    const facility = specs.find((spec) => spec.id === "board-b1-facility")!;
    const icon = (kind: string) => value(facility, "icon-image", { kind });
    const entries = INCIDENT_FACILITY_PALETTE.entries;
    expect(icon("incident_command_post")).toBe(iconImageId("command_post", entries.incident_command_post[theme]));
    expect(icon("staging_area")).toBe(iconImageId("staging_area", entries.staging_area[theme]));
    expect(icon("base")).toBe(iconImageId("incident_base", entries.base[theme]));
    expect(icon("camp")).toBe(iconImageId("camp", entries.camp[theme]));
    expect(icon("helispot")).toBe(iconImageId("helibase", entries.helibase[theme]));
    expect(icon("point_of_distribution")).toBe(iconImageId("distribution_point", entries.distribution_point[theme]));
    expect(icon("camera")).toBe("eoc-camera");
    expect(specs.some((spec) => spec.id === `board-b1${WEATHER_LAYER_SUFFIX}`)).toBe(true);
    // An icon always wins over its own label: the label draws under it and is placed after it.
    const label = specs.find((spec) => spec.id === "board-b1-label")!;
    expect(specs.indexOf(label)).toBeLessThan(specs.indexOf(facility));
    expect(label.layout!["text-variable-anchor"]).toBeTruthy();
  });

  it("keeps the Overview card's own symbols, with its facility labels under the icons", () => {
    const card = cartographyLayerSpecs("b1", "incident_facilities", "light", FONT) as Spec[];
    expect(JSON.stringify(card)).not.toContain("eoc-sym-");
    expect(card.map((spec) => spec.id)).toEqual(["board-b1-label", "board-b1-facility", `board-b1${WEATHER_LAYER_SUFFIX}`, "board-b1-command-label"]);
    expect(cartographyLayerSpecs("b1", "shelters", "dark", FONT)).toEqual(cartographyLayerSpecs("b1", "shelters", "dark", FONT, "card"));
  });
});

describe("validity, images and legends", () => {
  afterEach(() => vi.unstubAllGlobals());

  const everySpec = (theme: Theme) => [
    ...feed(theme),
    ...["road_closures", "shelters", "incident_facilities", "damage_assessment"].flatMap((template) => board(template, theme)),
  ];

  it.each(THEMES)("builds valid MapLibre layers (%s)", (theme) => {
    for (const spec of everySpec(theme)) {
      const style = {
        version: 8,
        glyphs: "/fonts/{fontstack}/{range}.pbf",
        sources: { [spec.id.startsWith("feed") ? "feed-f1" : "board-b1"]: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [spec],
      };
      expect(validateStyleMin(style as never).map((error) => error.message), spec.id).toEqual([]);
    }
  });

  it.each(THEMES)("registers every image the styles name (%s)", async (theme) => {
    vi.stubGlobal("Image", class {
      src = "";
      constructor(public width: number, public height: number) {}
      decode() { return Promise.resolve(); }
    });
    const images = new Set<string>();
    const map = { hasImage: (id: string) => images.has(id), addImage: (id: string) => void images.add(id) };
    await ensureStyleImages(map, theme);
    const named = new Set(JSON.stringify(everySpec(theme)).match(/"(eoc-(?:sym|no-entry|arrows?)-[a-z0-9_-]+|hazard-hatch-[a-z_-]+)"/g)!
      .map((quoted) => quoted.slice(1, -1)));
    expect(named.size).toBeGreaterThan(40);
    for (const name of named) expect(images, name).toContain(name);
  });

  it.each(THEMES)("gives every style a legend in its palette's colors (%s)", (theme) => {
    const keys: StyleLegendKey[] = ["hazard", "status", "road_closures", "shelters", "incident_facilities", "damage_assessment"];
    for (const key of keys) {
      const legend = styleLegend(key, theme);
      expect(legend.rows.length, key).toBeGreaterThan(1);
      for (const row of legend.rows) {
        expect(row.color, `${key} ${row.key}`).toMatch(/^#[0-9a-f]{6}$/);
        if (row.patch === "icon") expect(row.image, `${key} ${row.key}`).toMatch(/^eoc-sym-/);
      }
    }
    const hazard = styleLegend("hazard", theme);
    expect(hazard.rows.find((row) => row.key === "road_disruption")!.patch).toBe("hatch");
    expect(hazard.rows.find((row) => row.key === "damage_area")!.patch).toBe("hollow");
    expect(hazard.rows.find((row) => row.key === "fire_perimeter")!.patch).toBe("area");
    expect(styleLegend("hazard", theme, ["Evacuation order", "Spot fire"]).rows.map((row) => row.key)).toEqual(["evacuation_order", "spot_fire"]);
    expect(styleLegend("road_closures", theme).rows[0]!.image).toMatch(/^eoc-no-entry-/);
  });
});
