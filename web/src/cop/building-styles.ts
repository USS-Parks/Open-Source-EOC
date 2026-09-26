import {
  BUILDING_OCCUPANCY_PALETTE,
  BUILDING_ROLE_PALETTE,
  paletteKey,
  paletteLegend,
  type PaletteTheme,
} from "@openeoc/shared";
import { themes, type ThemeName } from "../design/tokens.js";
import type { ReferenceLegend } from "./reference-layers.js";
import { GLYPHS, ICON_IDS, type IconId } from "./symbols/glyphs.js";
import type { CopInspection } from "./workspace.js";

/**
 * Building footprints by use or by role (decision 3 of the map parity plan).
 *
 * A footprint's fill color, highest first:
 * 1. the operational status of a record inside it (feature state `status`,
 *    set by CopMap's status join);
 * 2. in the role theme, critical infrastructure: a facility of the facilities
 *    archive inside it or beside it (feature state `facilityType`, CopMap's
 *    facility join);
 * 3. the use or role it reads as: its OSM tag, else its FEMA USA Structures
 *    occupancy, else its Overture subtype (classify).
 */

export type BuildingTheme = "use" | "role" | "plain" | "off";

export const BUILDING_THEMES: readonly { readonly id: BuildingTheme; readonly title: string }[] = [
  { id: "use", title: "By use" },
  { id: "role", title: "By role" },
  { id: "plain", title: "Plain" },
  { id: "off", title: "Off" },
];

export const DEFAULT_BUILDING_THEME: BuildingTheme = "use";

export type BuildingUse = keyof typeof BUILDING_OCCUPANCY_PALETTE.entries;
export type BuildingRole = keyof typeof BUILDING_ROLE_PALETTE.entries;

/** Footprints draw from here; the archive holds z13 and z14 and overzooms above. */
export const BUILDING_MIN_ZOOM = 14;

/** A self-hosted buildings PMTiles archive (tools/basemap, buildings schema). */
export interface BuildingsConfig {
  readonly pmtilesUrl: string;
  /** Present only when this archive carries the exact-way H14 enrichment. */
  readonly overtureRelease?: string | undefined;
  /** The FEMA USA Structures edition, present only when this archive carries its occupancy classes. */
  readonly usaStructures?: string | undefined;
}

export const BUILDINGS_SOURCE_ID = "buildings";
export const BUILDINGS_SOURCE_LAYER = "buildings";
export const BUILDING_USE_LAYER_ID = "building-use";
export const BUILDING_OUTLINE_LAYER_ID = "building-outline";

export function buildingsAttribution(config: BuildingsConfig): string {
  return [
    "Buildings: © OpenStreetMap contributors (ODbL)",
    ...(config.overtureRelease ? [`enrichment: © Overture Maps Foundation (ODbL, ${config.overtureRelease})`] : []),
    ...(config.usaStructures ? [`occupancy: FEMA USA Structures (public domain, ${config.usaStructures})`] : []),
  ].join("; ");
}

/**
 * OpenStreetMap building tags and Overture subtypes in the palette's own
 * vocabulary: an entry key, or an alias the palette resolves (civic to
 * government, religious to assembly). Values the palette already reads,
 * such as residential or commercial, need no row. Hospitals are commercial,
 * as HAZUS classes them (COM6).
 */
const USE_VALUE = new Map<string, string>(Object.entries({
  house: "residential", detached: "residential", semidetached_house: "residential", terrace: "residential",
  apartments: "residential", bungalow: "residential", cabin: "residential", dormitory: "residential",
  static_caravan: "residential", hut: "residential", farm: "residential", houseboat: "residential",
  retail: "commercial", office: "commercial", supermarket: "commercial", kiosk: "commercial",
  hotel: "commercial", motel: "commercial", hospital: "commercial", medical: "commercial",
  warehouse: "industrial", manufacture: "industrial", factory: "industrial", hangar: "industrial",
  public: "civic", government: "civic", townhall: "civic", fire_station: "civic", police: "civic",
  courthouse: "civic", library: "civic", military: "civic", prison: "civic",
  school: "education", university: "education", college: "education", kindergarten: "education",
  church: "religious", chapel: "religious", cathedral: "religious", mosque: "religious",
  synagogue: "religious", temple: "religious", shrine: "religious",
  stadium: "assembly", sports_hall: "assembly", sports_centre: "assembly", grandstand: "assembly",
  community_centre: "assembly",
  barn: "agriculture", farm_auxiliary: "agriculture", greenhouse: "agriculture", stable: "agriculture",
  silo: "agriculture", cowshed: "agriculture", sty: "agriculture", agricultural: "agriculture",
  garage: "utility_misc", garages: "utility_misc", carport: "utility_misc", shed: "utility_misc",
  roof: "utility_misc", parking: "utility_misc", service: "utility_misc", toilets: "utility_misc",
  transformer_tower: "utility_misc", water_tower: "utility_misc", storage_tank: "utility_misc",
  train_station: "utility_misc", transportation: "utility_misc",
}));

/** Where a footprint's use comes from, highest first. */
const USE_SOURCES = {
  tag: "OpenStreetMap building tag",
  occ: "FEMA USA Structures occupancy",
  subtype: "Overture subtype",
} as const;

/** The use one value names: an OSM tag, a USA Structures class or an Overture subtype; undefined when it names none. */
function useOf(value: unknown): BuildingUse | undefined {
  if (typeof value !== "string") return undefined;
  const use = paletteKey(BUILDING_OCCUPANCY_PALETTE, USE_VALUE.get(value) ?? value);
  return use === "unclassified" ? undefined : use;
}

/**
 * The use a footprint reads as and where it comes from: its OSM tag where the
 * tag names a use, else the occupancy class of the USA Structures structure
 * inside it, else, for an untyped building=yes, its Overture subtype.
 */
function classify(cls: unknown, subtype?: unknown, occ?: unknown): { use: BuildingUse; from?: keyof typeof USE_SOURCES } {
  const tag = useOf(cls);
  if (tag) return { use: tag, from: "tag" };
  const fema = useOf(occ);
  if (fema) return { use: fema, from: "occ" };
  const overture = cls === "yes" ? useOf(subtype) : undefined;
  return overture ? { use: overture, from: "subtype" } : { use: "unclassified" };
}

/** The use a footprint reads as, from its `class`, `overture_subtype` and `occ` (see classify). */
export function buildingUse(cls: unknown, subtype?: unknown, occ?: unknown): BuildingUse {
  return classify(cls, subtype, occ).use;
}

const PUBLIC_USES: readonly BuildingUse[] = ["government", "education", "assembly"];

/** Critical infrastructure where a facility was joined to the footprint; public for public uses; else private. */
export function buildingRole(use: BuildingUse, facility?: unknown): BuildingRole {
  if (facility) return "critical_infrastructure";
  return PUBLIC_USES.includes(use) ? "public" : "private";
}

/** buildingUse as a MapLibre expression over the archive's `class`, `occ` and `overture_subtype`. */
function useExpression(): unknown[] {
  const palette = BUILDING_OCCUPANCY_PALETTE;
  const values = new Set([...USE_VALUE.keys(), ...Object.keys(palette.entries), ...Object.keys(palette.aliases ?? {})]);
  const byUse = new Map<BuildingUse, string[]>();
  for (const value of values) {
    const use = useOf(value);
    if (use) byUse.set(use, [...(byUse.get(use) ?? []), value]);
  }
  const branches = [...byUse].flatMap(([use, list]) => [list, use]);
  const match = (property: string, fallback: unknown) => ["match", ["to-string", ["get", property]], ...branches, fallback];
  const subtype = ["case", ["==", ["get", "class"], "yes"], match("overture_subtype", "unclassified"), "unclassified"];
  return match("class", match("occ", subtype));
}

const USE = useExpression();
const STATUS = ["to-string", ["coalesce", ["feature-state", "status"], ""]];
const FACILITY = ["to-boolean", ["feature-state", "facilityType"]];

const HAS_STATUS = ["match", STATUS, ["critical", "warning", "normal"], true, false];

/**
 * Rooftops still read through the fill over imagery; the street map takes a
 * stronger one. The theme's quiet class (unclassified by use, private by
 * role) takes a lighter fill, so the classes that say something stand out
 * and untyped rooftops stay visible under their outline.
 */
const FILL_OPACITY = {
  street: { loud: 0.7, quiet: 0.5 },
  imagery: { loud: 0.45, quiet: 0.25 },
  status: 0.85,
} as const;

function quiet(mode: BuildingTheme): unknown {
  if (mode === "use") return ["==", USE, "unclassified"];
  if (mode === "role") return ["all", ["!", FACILITY], ["!", ["in", USE, ["literal", PUBLIC_USES]]]];
  return false;
}

/** The palette's dark values serve the dark theme and imagery alike. */
const variantOf = (theme: ThemeName, imagery: boolean): PaletteTheme => (imagery ? "dark" : theme);

function themeColor(mode: BuildingTheme, variant: PaletteTheme): unknown {
  const use = BUILDING_OCCUPANCY_PALETTE.entries;
  const role = BUILDING_ROLE_PALETTE.entries;
  if (mode === "use") {
    return ["match", USE, ...Object.entries(use).flatMap(([key, entry]) => [key, entry[variant]]), use.unclassified[variant]];
  }
  if (mode === "role") {
    return ["case", FACILITY, role.critical_infrastructure[variant],
      ["match", USE, [...PUBLIC_USES], role.public[variant], role.private[variant]]];
  }
  return use.unclassified[variant];
}

export interface BuildingPaint {
  readonly visibility: "visible" | "none";
  readonly fill: Record<string, unknown>;
  readonly outline: Record<string, unknown>;
}

/**
 * The footprint layers' paint for a theme, over the street map or imagery.
 * A footprint with a record's status takes the status color under a heavier
 * outline in the map's ink, so it never reads as a use or role that shares
 * its hue (commercial red, residential amber).
 */
export function buildingPaint(theme: ThemeName, mode: BuildingTheme, imagery = false): BuildingPaint {
  const t = themes[theme];
  const color = ["match", STATUS,
    "critical", t.statusCritical,
    "warning", t.statusWarning,
    "normal", t.statusSuccess,
    themeColor(mode, variantOf(theme, imagery))];
  const opacity = imagery ? FILL_OPACITY.imagery : FILL_OPACITY.street;
  const width = (plain: number) => ["case", HAS_STATUS, plain + 1.5, plain];
  return {
    visibility: mode === "off" ? "none" : "visible",
    fill: {
      "fill-color": color,
      "fill-opacity": ["case", HAS_STATUS, FILL_OPACITY.status, quiet(mode), opacity.quiet, opacity.loud],
    },
    outline: {
      "line-color": ["case", HAS_STATUS, t.text, color],
      "line-width": ["interpolate", ["linear"], ["zoom"], BUILDING_MIN_ZOOM, width(0.5), 16, width(1), 18, width(1.5)],
      "line-opacity": 0.9,
    },
  };
}

/**
 * The buildings source and its layers: a translucent fill and a thin
 * outline of the same color. Footprints are keyed by osm_id so the joins can
 * set state per building.
 */
export function buildingSpecs(
  config: BuildingsConfig | undefined,
  theme: ThemeName,
): { sources: Record<string, unknown>; layers: unknown[] } {
  if (!config) return { sources: {}, layers: [] };
  const paint = buildingPaint(theme, DEFAULT_BUILDING_THEME);
  const layer = { source: BUILDINGS_SOURCE_ID, "source-layer": BUILDINGS_SOURCE_LAYER, minzoom: BUILDING_MIN_ZOOM, layout: { visibility: paint.visibility } };
  return {
    sources: {
      [BUILDINGS_SOURCE_ID]: {
        type: "vector",
        url: `pmtiles://${config.pmtilesUrl}`,
        promoteId: "osm_id",
        attribution: buildingsAttribution(config),
      },
    },
    layers: [
      { id: BUILDING_USE_LAYER_ID, type: "fill", ...layer, paint: paint.fill },
      { id: BUILDING_OUTLINE_LAYER_ID, type: "line", ...layer, paint: paint.outline },
    ],
  };
}

/** The parts of a map a theme change touches. */
export interface BuildingMap {
  getLayer(id: string): unknown;
  setLayoutProperty(id: string, name: string, value: unknown): unknown;
  setPaintProperty(id: string, name: string, value: unknown): unknown;
}

export function applyBuildingPaint(map: BuildingMap, paint: BuildingPaint): void {
  for (const [id, props] of [[BUILDING_USE_LAYER_ID, paint.fill], [BUILDING_OUTLINE_LAYER_ID, paint.outline]] as const) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", paint.visibility);
    for (const [name, value] of Object.entries(props)) map.setPaintProperty(id, name, value);
  }
}

/** The theme's legend rows, for the layer list and MP8's legend. */
export function buildingLegend(mode: BuildingTheme, theme: ThemeName, imagery = false): ReferenceLegend | undefined {
  const variant = variantOf(theme, imagery);
  const base = { id: "buildings", patch: "area", minzoom: BUILDING_MIN_ZOOM } as const;
  if (mode === "use") return { ...base, title: BUILDING_OCCUPANCY_PALETTE.title, rows: paletteLegend(BUILDING_OCCUPANCY_PALETTE, variant) };
  if (mode === "role") return { ...base, title: BUILDING_ROLE_PALETTE.title, rows: paletteLegend(BUILDING_ROLE_PALETTE, variant) };
  if (mode === "plain") {
    return { ...base, title: "Buildings", rows: [{ key: "building", label: "Building", color: BUILDING_OCCUPANCY_PALETTE.entries.unclassified[variant] }] };
  }
  return undefined;
}

/** Facility types that are not buildings, so never mark one as critical infrastructure. */
const NOT_BUILDINGS: ReadonlySet<string> = new Set(["bridge", "dam", "comms_tower"]);

/** A facility joins the footprint it lies in, or else the nearest one this close. */
export const FACILITY_REACH_METERS = 20;

type Ring = readonly (readonly number[])[];
type Footprint = { readonly id?: string | number | undefined; readonly geometry: { readonly type: string; readonly coordinates?: unknown } };

/**
 * The footprint a facility point lies in, or else the nearest one within
 * reach; undefined for a facility type that is not a building. Distances are
 * local meters around the point, fine at footprint scale.
 */
export function footprintFor(
  type: unknown,
  point: readonly [number, number],
  footprints: readonly Footprint[],
  reach = FACILITY_REACH_METERS,
): string | number | undefined {
  if (typeof type !== "string" || NOT_BUILDINGS.has(type)) return undefined;
  const kx = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  const ky = 110_540;
  let best: { id: string | number; d: number } | undefined;
  for (const footprint of footprints) {
    if (footprint.id === undefined) continue;
    const g = footprint.geometry;
    const polygons = (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) as Ring[][];
    for (const rings of polygons) {
      let inside = false;
      let d = Infinity;
      for (const ring of rings) {
        const xy = ring.map(([x, y]) => [(x! - point[0]) * kx, (y! - point[1]) * ky] as const);
        for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
          const [ax, ay] = xy[i]!;
          const [bx, by] = xy[j]!;
          if ((ay > 0) !== (by > 0) && 0 < ((bx - ax) * (0 - ay)) / (by - ay) + ax) inside = !inside;
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
          d = Math.min(d, Math.hypot(ax + t * dx, ay + t * dy));
        }
      }
      if (inside) return footprint.id;
      if (d <= reach && (!best || d < best.d)) best = { id: footprint.id, d };
    }
  }
  return best?.id;
}

/** Key facilities take a footprint over any other facility joined to it first. */
export const KEY_FACILITY_TYPES: ReadonlySet<string> = new Set(["hospital", "eoc", "fire_station", "law_enforcement", "ems_station"]);

const isIconId = (value: unknown): value is IconId => typeof value === "string" && (ICON_IDS as readonly string[]).includes(value);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** The inspector's view of a footprint: its use, role and any facility joined to it. */
export function buildingInspection(
  properties: Record<string, unknown>,
  state: Record<string, unknown>,
  config: BuildingsConfig | undefined,
): CopInspection {
  const { use, from } = classify(properties.class, properties.overture_subtype, properties.occ);
  const role = buildingRole(use, state.facilityType);
  const facility = text(state.facility);
  const facilityType = isIconId(state.facilityType) ? GLYPHS[state.facilityType].title : text(state.facilityType);
  const status = text(state.status);
  const occ = text(properties.occ);
  const occPrimary = text(properties.occ_prim);
  const rows = [
    ["Use", BUILDING_OCCUPANCY_PALETTE.entries[use].label],
    ["Use from", from ? USE_SOURCES[from] : undefined],
    ["Role", BUILDING_ROLE_PALETTE.entries[role].label],
    ["OpenStreetMap building tag", text(properties.class)],
    ["USA Structures occupancy", occ && occPrimary ? `${occ}: ${occPrimary}` : occ],
    ["Overture subtype", text(properties.overture_subtype)],
    ["Facility inside", facility],
    ["Facility type", facilityType],
    ["Levels", typeof properties.levels === "number" ? String(properties.levels) : undefined],
    ["OpenStreetMap id", properties.osm_id === undefined ? undefined : String(properties.osm_id)],
  ] as const;
  return {
    title: text(properties.name) ?? facility ?? `${BUILDING_OCCUPANCY_PALETTE.entries[use].label} building`,
    kind: "Building footprint",
    source: "OpenStreetMap building footprints",
    ...(status === "critical" || status === "warning" || status === "normal" ? { status } : {}),
    ...(facilityType ? { facilityType } : {}),
    freshness: "Static reference data",
    coverage: "Use comes from the building's OpenStreetMap tag where it names a use, else from the FEMA USA Structures occupancy of the structure inside it where the archive carries one, else from its Overture subtype where the tag says only building; a footprint with none is Unclassified.",
    ...(config ? { attribution: buildingsAttribution(config) } : {}),
    rows: rows.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
  };
}
