import {
  DAMAGE_DEGREE_PALETTE,
  HAZARD_PALETTE,
  INCIDENT_FACILITY_PALETTE,
  LIFELINE_CATEGORY_PALETTE,
  ROAD_CLOSURE_PALETTE,
  SHELTER_STATUS_PALETTE,
  STATUS_FRAME_PALETTE,
  paletteLegend,
  paletteMatch,
  type Palette,
  type PaletteEntry,
  type PaletteLegendEntry,
  type PaletteTheme,
} from "@openeoc/shared";
import { themes, type ThemeName } from "../design/tokens.js";
import type { FacilityType } from "./facilities.js";
import { hatchImage } from "./hazards.js";
import { symbolStatusExpression } from "./symbology.js";
import { GLYPHS, type IconId } from "./symbols/glyphs.js";
import { ensureIconImages, iconImageId, type IconRequest, type ImageHost } from "./symbols/register.js";

/**
 * Operational layer styles in the manner of Esri's emergency management maps
 * (docs/process/ESRI-EM-MAP-RESEARCH-2026-09-26.md, section 3), every color
 * from the shared palette table: data-pack hazards by their category, the
 * status style for records with no map meaning of their own, the tiers every
 * operational layer draws in, the images the styles name and their legends.
 * The Map screen's board cartography (cartography.ts) draws with the same
 * images, sizes and tiers.
 */

/** Where operational layers draw, bottom to top, whichever source they come from. */
export const TIER = {
  /** Status areas of records, and reference areas such as NWS warnings. */
  area: 10,
  /** Hazard impact areas: outages, floods, inundation, liquefaction, damage and road disruption. */
  impact: 20,
  /** Protective action areas: warnings under shelter in place under orders. */
  evacuation: 30,
  /** Fire perimeters, over the zones they drive. */
  perimeter: 40,
  line: 50,
  /** Under the symbols, so a label yields to an icon instead of hiding it. */
  label: 55,
  /** A record's plain status disc, under the typed symbols that say more. */
  dot: 58,
  point: 60,
} as const;

const TIER_KEY = "openeoc:tier";

/** A layer's tier, carried in its metadata. */
export const inTier = (tier: number) => ({ metadata: { [TIER_KEY]: tier } });

/** A layer's tier: its own, else by type, fills under lines under symbols. */
export function layerTier(layer: unknown): number {
  const { type, metadata } = (layer ?? {}) as { type?: string; metadata?: Record<string, unknown> };
  const own = metadata?.[TIER_KEY];
  if (typeof own === "number") return own;
  return type === "fill" ? TIER.area : type === "line" ? TIER.line : TIER.point;
}

/** Specs in tier order, stable within a tier, so one source's layers stack right on any map. */
export function byTier<T>(specs: readonly T[]): T[] {
  return [...specs].sort((a, b) => layerTier(a) - layerTier(b));
}

const OPERATIONAL = /^(board|feed)-/;

/**
 * The layer a new operational layer mounts under, so every source's layers
 * draw in tier order: each data pack's areas under every point, evacuation
 * areas under fire perimeters, labels under icons. `band` is the marker
 * layer a group of sources mounts under when the map draws in bands; the
 * sources in a band sort among themselves.
 */
export function tieredBeforeId(
  map: { getLayersOrder(): string[]; getLayer(id: string): unknown },
  spec: unknown,
  band?: string,
): string | undefined {
  const ids = map.getLayersOrder();
  const marker = band ? ids.indexOf(band) : -1;
  const end = marker < 0 ? ids.length : marker;
  let start = end;
  while (start > 0 && OPERATIONAL.test(ids[start - 1]!)) start -= 1;
  const tier = layerTier(spec);
  return ids.slice(start, end).find((id) => layerTier(map.getLayer(id)) > tier) ?? (marker < 0 ? undefined : band);
}

export const POLYGON = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];
export const LINE = ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]];
export const POINT = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];

/** The stored values that read as the given entries: each key and its aliases. */
export function storedValues(palette: Palette, keys: readonly string[] = Object.keys(palette.entries)): string[] {
  const aliases = Object.entries(palette.aliases ?? {});
  return keys.flatMap((key) => [key, ...aliases.filter(([, to]) => to === key).map(([from]) => from)]);
}

/** True where the property holds one of the values. */
export const oneOf = (property: string, values: readonly string[]): unknown[] =>
  ["match", ["get", property], [...values], true, false];

/** A match over some of a palette's entries, each key and its aliases in one branch. */
export function byEntry(
  palette: Palette,
  property: string,
  keys: readonly string[],
  value: (entry: PaletteEntry, key: string) => unknown,
  fallback: unknown,
): unknown[] {
  return ["match", ["get", property], ...keys.flatMap((key) => [storedValues(palette, [key]), value(palette.entries[key]!, key)]), fallback];
}

/** A symbol sort key in the palette's legend order, its most urgent entry first. */
export const paletteOrder = (palette: Palette, property: string): unknown[] => {
  const keys = Object.keys(palette.entries);
  return byEntry(palette, property, keys, (_, key) => keys.indexOf(key), keys.length);
};

/** Esri's 13.5 to 18 point symbols: 16 px at a regional zoom to 24 px at street zoom. */
export const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 7, 0.66, 11, 0.83, 15, 1];

/** Below zoom 10 a symbol yields to one already placed, in sort order; from 10 every symbol shows. */
export const ICON_OVERLAP = ["step", ["zoom"], "never", 10, "always"];

/** Critical first, for symbol placement. */
export const SEVERITY = ["match", symbolStatusExpression(), "critical", 0, "warning", 1, "normal", 2, 3];

const STALE = ["==", ["get", "_stale"], true];

/** Old data must not present as current: a stale source draws in the unknown grey. */
const staleColor = (theme: ThemeName) => STATUS_FRAME_PALETTE.entries.unknown[theme];

/** A #rrggbb color at an alpha, as MapLibre reads it. */
const tint = (hex: string, alpha: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${Math.round(alpha * 1000) / 1000})`;

/**
 * An area's fill color at its opacity, thinning toward street zoom so the
 * streets under it stay legible. The opacity rides in the color, and every
 * opacity property stays a number: the map multiplies a layer's opacity
 * numbers by the operator's layer opacity.
 */
const fillColor = (color: (scale: number) => unknown) => ["interpolate", ["linear"], ["zoom"], 11, color(1), 15, color(0.55)];

export const labelPaint = (theme: ThemeName) => ({
  "text-color": themes[theme].text,
  "text-halo-color": themes[theme].surface,
  "text-halo-width": 1.4,
});

/*
 * Data-pack hazards. The exercise data packs, and any pack using the same
 * vocabulary, store a category the palette table knows: areas take Esri's
 * status fill under a same-hue outline, a hollow outline for a damage area
 * and a hatch only for road disruption; points take the icon suite's
 * pictogram on a disc of their family's color.
 */

type HazardKey = keyof typeof HAZARD_PALETTE.entries;

/** Hazard areas by tier, bottom to top within each. */
export const HAZARD_AREA_TIERS = {
  // Wide extents under the patchy ones: liquefaction draws over the inundation it sits in.
  impact: ["power_outage", "flood_extent", "tsunami_inundation", "liquefaction", "damage_area", "road_disruption"],
  evacuation: ["evacuation_warning", "shelter_in_place", "evacuation_order"],
  perimeter: ["fire_perimeter"],
} as const satisfies Readonly<Record<"impact" | "evacuation" | "perimeter", readonly HazardKey[]>>;

export const HAZARD_POINTS = (Object.keys(HAZARD_PALETTE.entries) as HazardKey[]).filter((key) => HAZARD_PALETTE.entries[key].icon);

/** True for a feature that draws as a data-pack hazard. */
export const IS_HAZARD = oneOf("category", storedValues(HAZARD_PALETTE));

/** The hatch pattern a hatched hazard area draws with, in its color or the stale grey. */
export const hazardHatchId = (key: string, theme: ThemeName) => `hazard-hatch-${theme}-${key}`;

const TITLE = ["to-string", ["coalesce", ["get", "title"], ""]];

/** An evacuation area's zone name: its title after the issuer, "SYNTHETIC Yurok Tribe order: Weitchpec" reads "Weitchpec". */
const ZONE_NAME = [
  "let", "title", TITLE,
  ["let", "at", ["index-of", ": ", ["var", "title"]],
    ["case", [">=", ["var", "at"], 0], ["slice", ["var", "title"], ["+", ["var", "at"], 2]], ["var", "title"]]],
];

function hazardAreaSpecs(src: string, theme: ThemeName, tier: keyof typeof HAZARD_AREA_TIERS): unknown[] {
  const keys: readonly HazardKey[] = HAZARD_AREA_TIERS[tier];
  const flat = keys.filter((key) => !HAZARD_PALETTE.entries[key].polygon?.hatch);
  const hatched = keys.filter((key) => HAZARD_PALETTE.entries[key].polygon?.hatch);
  const where = (list: readonly string[]) => ["all", POLYGON, oneOf("category", storedValues(HAZARD_PALETTE, list))];
  const grey = staleColor(theme);
  const pick = (list: readonly string[], value: (entry: PaletteEntry, key: string) => unknown, stale: unknown, fallback = stale) =>
    ["case", STALE, stale, byEntry(HAZARD_PALETTE, "category", list, value, fallback)];
  // Within a tier the later entry draws on top, whichever source it comes from.
  const rank = byEntry(HAZARD_PALETTE, "category", keys, (_, key) => keys.indexOf(key as HazardKey), 0);
  const specs: unknown[] = [];
  if (flat.length > 0) {
    specs.push({
      id: `${src}-hazard-${tier}-fill`,
      type: "fill",
      source: src,
      ...inTier(TIER[tier]),
      filter: where(flat),
      layout: { "fill-sort-key": rank },
      paint: {
        "fill-color": fillColor((scale) => {
          const at = (ink: (entry: PaletteEntry) => string) =>
            byEntry(HAZARD_PALETTE, "category", flat, (entry) => tint(ink(entry), entry.polygon!.fillOpacity * scale), tint(grey, 0.5 * scale));
          return ["case", STALE, at(() => grey), at((entry) => entry[theme])];
        }),
        "fill-opacity": 1,
      },
    });
  }
  if (hatched.length > 0) {
    // A hatch's lines cover a quarter of the area, so they draw opaque.
    specs.push({
      id: `${src}-hazard-${tier}-hatch`,
      type: "fill",
      source: src,
      ...inTier(TIER[tier]),
      filter: where(hatched),
      paint: { "fill-pattern": pick(hatched, (_, key) => hazardHatchId(key, theme), hazardHatchId("stale", theme)), "fill-opacity": 1 },
    });
  }
  specs.push({
    id: `${src}-hazard-${tier}-line`,
    type: "line",
    source: src,
    ...inTier(TIER[tier]),
    filter: where(keys),
    layout: { "line-join": "round", "line-sort-key": rank },
    paint: {
      "line-color": pick(keys, (entry) => entry.polygon?.outline ?? entry[theme], grey),
      "line-width": byEntry(HAZARD_PALETTE, "category", keys, (entry) => entry.polygon!.outlineWidth, 2),
    },
  });
  return specs;
}

/**
 * The layers that draw a data pack's hazards: impact areas, evacuation areas
 * and fire perimeters in their tiers; zone names and uppercase fire names
 * from a mid zoom; typed hazard points as icons, sorted by severity.
 */
export function hazardLayerSpecs(src: string, theme: ThemeName, labelFont?: string): unknown[] {
  const perimeter = oneOf("category", storedValues(HAZARD_PALETTE, HAZARD_AREA_TIERS.perimeter));
  const named = storedValues(HAZARD_PALETTE, [...HAZARD_AREA_TIERS.evacuation, ...HAZARD_AREA_TIERS.perimeter]);
  const grey = staleColor(theme);
  const icon = (color: (entry: PaletteEntry) => string) =>
    byEntry(HAZARD_PALETTE, "category", HAZARD_POINTS, (entry) => iconImageId(entry.icon!, color(entry)), "");
  const label = labelFont
    ? [{
        id: `${src}-hazard-label`,
        type: "symbol",
        source: src,
        ...inTier(TIER.label),
        minzoom: 9,
        filter: ["all", POLYGON, oneOf("category", named)],
        layout: {
          // Esri labels an incident's name in capitals and a zone by its name.
          "text-field": ["case", perimeter, ["upcase", TITLE], ZONE_NAME],
          "text-font": [labelFont],
          "text-size": ["case", perimeter, 12, 11],
          "text-letter-spacing": ["case", perimeter, 0.08, 0],
          "text-max-width": 8,
          "text-padding": 6,
          // A name crowded by the area's own symbols moves beside its point rather than dropping out.
          "text-variable-anchor": ["center", "top", "bottom", "left", "right"],
          "text-radial-offset": 0.6,
        },
        paint: labelPaint(theme),
      }]
    : [];
  return [
    ...hazardAreaSpecs(src, theme, "impact"),
    ...hazardAreaSpecs(src, theme, "evacuation"),
    ...hazardAreaSpecs(src, theme, "perimeter"),
    ...label,
    {
      id: `${src}-hazard-point`,
      type: "symbol",
      source: src,
      ...inTier(TIER.point),
      filter: ["all", POINT, oneOf("category", storedValues(HAZARD_PALETTE, HAZARD_POINTS))],
      layout: {
        "icon-image": ["case", STALE, icon(() => grey), icon((entry) => entry[theme])],
        "icon-size": ICON_SIZE,
        "icon-overlap": ICON_OVERLAP,
        "symbol-sort-key": SEVERITY,
      },
    },
  ];
}

/*
 * The status style: a record with no map meaning of its own draws in its
 * status frame, an area as a light fill under a crisp outline and a point as
 * a small disc with a white halo. A record typed as a facility draws as the
 * icon suite's reference symbol for that type.
 */

const FACILITY_TYPE_ICONS: Readonly<Record<FacilityType, IconId>> = {
  hospital: "hospital",
  "urgent-care": "urgent_care",
  "fire-station": "fire_station",
  "law-enforcement": "law_enforcement",
  school: "school",
  shelter: "shelter",
  "local-eoc": "eoc",
  "commercial-airport": "airport",
  heliport: "heliport",
};

/** A facility type's symbol, in its Community Lifeline's color. */
function facilityTypeIcon(id: IconId, theme: ThemeName): IconRequest {
  const lifeline = GLYPHS[id].lifeline ?? "food_hydration_shelter";
  return { id, color: LIFELINE_CATEGORY_PALETTE.entries[lifeline][theme] };
}

/**
 * The status style's layers for one source. `only` narrows every layer to
 * the features it applies to, as a feed's features without a preset or a
 * hazard category.
 */
export function statusLayerSpecs(src: string, theme: ThemeName, labelFont?: string, only?: unknown): unknown[] {
  const unknown = STATUS_FRAME_PALETTE.entries.unknown;
  const color = paletteMatch(STATUS_FRAME_PALETTE, "_symbolStatus", theme, unknown[theme]);
  const area = unknown.polygon!;
  const where = (filter: unknown) => (only ? ["all", only, filter] : filter);
  const facility = ["has", "_facilityType"];
  const icons = Object.entries(FACILITY_TYPE_ICONS).flatMap(([type, id]) => {
    const { color: ink } = facilityTypeIcon(id, theme);
    return [type, iconImageId(id, ink)];
  });
  const label = labelFont
    ? [{
        id: `${src}-label`,
        type: "symbol",
        source: src,
        ...inTier(TIER.label),
        minzoom: 13,
        ...(only ? { filter: only } : {}),
        layout: {
          "text-field": ["get", "_label"],
          "text-font": [labelFont],
          "text-size": 11,
          "text-variable-anchor": ["top", "bottom", "right", "left"],
          "text-radial-offset": ["case", facility, 1.3, 0.8],
          "text-max-width": 10,
        },
        paint: labelPaint(theme),
      }]
    : [];
  return [
    {
      id: `${src}-fill`,
      type: "fill",
      source: src,
      ...inTier(TIER.area),
      filter: where(POLYGON),
      paint: {
        "fill-color": fillColor((scale) =>
          paletteMatch(STATUS_FRAME_PALETTE, "_symbolStatus", (entry) => tint(entry[theme], area.fillOpacity * scale), tint(unknown[theme], area.fillOpacity * scale))),
        "fill-opacity": 1,
      },
    },
    {
      id: `${src}-line`,
      type: "line",
      source: src,
      ...inTier(TIER.line),
      filter: where(["any", LINE, POLYGON]),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": ["case", LINE, 3, area.outlineWidth] },
    },
    ...label,
    {
      id: `${src}-point`,
      type: "circle",
      source: src,
      ...inTier(TIER.dot),
      filter: where(["all", POINT, ["!", facility]]),
      paint: {
        "circle-color": color,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 5, 16, 6.5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: `${src}-facility-icon`,
      type: "symbol",
      source: src,
      ...inTier(TIER.point),
      filter: where(["all", POINT, facility]),
      layout: {
        "icon-image": ["match", ["get", "_facilityType"], ...icons, ""],
        "icon-size": ICON_SIZE,
        "icon-overlap": ICON_OVERLAP,
        "symbol-sort-key": SEVERITY,
      },
    },
  ];
}

/*
 * Images. The styles name icon suite symbols by color, a no-entry disc and
 * direction arrows for road closures, and a hatch for road disruption areas;
 * each is registered once, at the device's pixel ratio.
 */

const hex = (color: string) => color.replace("#", "").toLowerCase();

/** Esri's road block: a no-entry disc in the closure's color, framed as the icon suite frames its discs. */
export const noEntryImageId = (color: string) => `eoc-no-entry-${hex(color)}`;
/** An arrow along a closed road, the way it is drawn, or two for both directions. */
export const arrowImageId = (color: string, both = false) => `eoc-arrow${both ? "s" : ""}-${hex(color)}`;

const NO_ENTRY = (color: string) =>
  `<circle cx="12" cy="12" r="11.5" fill="#000" fill-opacity="0.28"/><circle cx="12" cy="12" r="11" fill="#fff"/>` +
  `<circle cx="12" cy="12" r="10" fill="${color}"/><rect x="5.5" y="9.8" width="13" height="4.4" rx="1" fill="#fff"/>`;
const ARROW = (color: string, both: boolean) =>
  `<path d="${both ? "M1.5 12 9.5 5.5V18.5ZM22.5 12 14.5 5.5V18.5Z" : "M4.5 5 20 12 4.5 19 8 12Z"}" fill="${color}" ` +
  `stroke="#fff" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke"/>`;

/** Every icon suite image the styles name, the Map screen's board cartography included. */
export function styleIcons(theme: ThemeName): IconRequest[] {
  const colored = (palette: Palette, id: IconId): IconRequest[] => Object.values(palette.entries).map((entry) => ({ id, color: entry[theme] }));
  const grey = staleColor(theme);
  const requests: IconRequest[] = [
    ...HAZARD_POINTS.flatMap((key) => {
      const entry = HAZARD_PALETTE.entries[key];
      return [{ id: entry.icon!, color: entry[theme] }, { id: entry.icon!, color: grey }];
    }),
    ...Object.values(FACILITY_TYPE_ICONS).map((id) => facilityTypeIcon(id, theme)),
    ...Object.values(INCIDENT_FACILITY_PALETTE.entries).map((entry) => ({ id: entry.icon!, color: entry[theme] })),
    ...colored(SHELTER_STATUS_PALETTE, "shelter"),
    ...colored(DAMAGE_DEGREE_PALETTE, "damage_report"),
    { id: "damage_report", color: grey },
  ];
  return [...new Map(requests.map((request) => [iconImageId(request.id, request.color), request])).values()];
}

/** SVG bodies on the icon suite's 24 unit grid, rasterized as ensureIconImages rasterizes the suite. */
async function ensureSvgImages(map: ImageHost, images: ReadonlyMap<string, string>, size: number): Promise<void> {
  const ratio = Math.max(2, globalThis.devicePixelRatio || 1);
  const px = Math.round(size * ratio);
  await Promise.all([...images].map(async ([name, body]) => {
    if (map.hasImage(name)) return;
    const image = new Image(px, px);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">${body}</svg>`;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio: px / size });
  }));
}

/** The map as the hatch patterns need it. */
interface PatternHost {
  hasImage(id: string): boolean;
  addImage(id: string, image: { width: number; height: number; data: Uint8Array }, options: { pixelRatio: number }): unknown;
}

/** Register every image the styles name. Images already on the map are left alone. */
export async function ensureStyleImages(map: ImageHost & PatternHost, theme: ThemeName): Promise<void> {
  const hatched = (Object.keys(HAZARD_PALETTE.entries) as HazardKey[]).filter((key) => HAZARD_PALETTE.entries[key].polygon?.hatch);
  for (const [key, color] of [...hatched.map((key) => [key, HAZARD_PALETTE.entries[key][theme]] as const), ["stale", staleColor(theme)] as const]) {
    // Esri's backward diagonal, at twice the pixels for a crisp hatch on a scaled display.
    if (!map.hasImage(hazardHatchId(key, theme))) map.addImage(hazardHatchId(key, theme), hatchImage(color, "back", 2), { pixelRatio: 2 });
  }
  const closures = [...new Set(Object.values(ROAD_CLOSURE_PALETTE.entries).map((entry) => entry[theme]))];
  await Promise.all([
    ensureIconImages(map, styleIcons(theme)),
    ensureSvgImages(map, new Map(closures.map((color) => [noEntryImageId(color), NO_ENTRY(color)])), 24),
    ensureSvgImages(map, new Map(closures.flatMap((color) => [
      [arrowImageId(color), ARROW(color, false)],
      [arrowImageId(color, true), ARROW(color, true)],
    ])), 14),
  ]);
}

/*
 * Legends: one per style, in the palette's legend order, each row naming the
 * patch it draws with, for the Map screen's legend to list.
 */

export type LegendPatch = "area" | "hatch" | "hollow" | "casing" | "icon" | "disc";

/** A legend row; an icon patch names its icon, and the row the map image its symbol draws with. */
export interface StyleLegendRow extends PaletteLegendEntry {
  readonly patch: LegendPatch;
  /** The map image of the row's symbol: an icon, or a road closure's no-entry disc. */
  readonly image?: string;
}

export interface StyleLegend {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly rows: readonly StyleLegendRow[];
}

export type StyleLegendKey = "hazard" | "status" | "road_closures" | "shelters" | "incident_facilities" | "damage_assessment";

const LEGEND_STYLES: Readonly<Record<StyleLegendKey, {
  readonly palette: Palette;
  readonly patch: (entry: PaletteLegendEntry) => Pick<StyleLegendRow, "patch" | "icon">;
}>> = {
  hazard: {
    palette: HAZARD_PALETTE,
    patch: (entry) => entry.icon
      ? { patch: "icon", icon: entry.icon }
      : { patch: entry.polygon?.hatch ? "hatch" : entry.polygon?.fillOpacity === 0 ? "hollow" : "area" },
  },
  status: { palette: STATUS_FRAME_PALETTE, patch: () => ({ patch: "area" }) },
  road_closures: { palette: ROAD_CLOSURE_PALETTE, patch: () => ({ patch: "casing" }) },
  shelters: { palette: SHELTER_STATUS_PALETTE, patch: () => ({ patch: "icon", icon: "shelter" }) },
  incident_facilities: { palette: INCIDENT_FACILITY_PALETTE, patch: (entry) => ({ patch: "icon", icon: entry.icon! }) },
  damage_assessment: { palette: DAMAGE_DEGREE_PALETTE, patch: () => ({ patch: "icon", icon: "damage_report" }) },
};

/**
 * A style's legend. Given the values the features carry (categories,
 * statuses, degrees, kinds), only the rows the map shows.
 */
export function styleLegend(key: StyleLegendKey, theme: PaletteTheme, present?: Iterable<string>): StyleLegend {
  const { palette, patch } = LEGEND_STYLES[key];
  return {
    id: key,
    title: palette.title,
    source: palette.source,
    rows: paletteLegend(palette, theme, present).map((entry) => {
      const row = patch(entry);
      const image = row.icon ? iconImageId(row.icon, entry.color) : key === "road_closures" ? noEntryImageId(entry.color) : undefined;
      return { ...entry, ...row, ...(image ? { image } : {}) };
    }),
  };
}
