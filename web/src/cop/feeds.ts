import {
  EARTHQUAKE_MAGNITUDE_PALETTE,
  NWS_HAZARD_PALETTE,
  OUTAGE_CUSTOMERS_PALETTE,
  OUTAGE_METERS_PALETTE,
  RIVER_GAUGE_PALETTE,
  SHAKEMAP_MMI_PALETTE,
  WILDFIRE_INCIDENT_PALETTE,
  WILDFIRE_PERIMETER_PALETTE,
  paletteKey,
  paletteLegend,
  type Palette,
  type PaletteLegendEntry,
  type PaletteTheme,
  type PolygonStyle,
} from "@openeoc/shared";
import { themes, type ThemeName } from "../design/tokens.js";
import { byTier, hazardLayerSpecs, inTier, IS_HAZARD, statusLayerSpecs, TIER } from "./hazard-styles.js";
import { symbolStatusFor } from "./symbology.js";
import type { CopFeatureCollection } from "./layers.js";
import { floodLayerIds, floodLayerSpecs } from "./hazards.js";
import { facilityTypeFor } from "./facilities.js";
import { iconImageId, type IconRequest } from "./symbols/register.js";

/**
 * Feed layers on the COP (F18). Feed features are read-only:
 * they carry provenance (_source), age, and a staleness flag from the
 * server. A stale feed's features drop to the unknown frame, whatever
 * their severity claimed, because old data must not present as current.
 * A preset feed (NWS, NIFC, USGS, NOAA, a utility's outage map) draws with
 * its source's own symbology instead, and grey with its age when stale.
 */

export interface FeedLayerHealth {
  readonly name: string;
  /** The feed's format; a preset kind draws with that source's symbology. */
  readonly kind?: string | undefined;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
  readonly incomplete?: boolean | undefined;
  /** Drawn from vector tiles whatever its page count, as a parcel layer is. */
  readonly tiled?: boolean | undefined;
  readonly coverage?: string | undefined;
  readonly attribution?: string | undefined;
}

export function tagFeedFeatures(
  fc: CopFeatureCollection,
  feed: FeedLayerHealth,
): CopFeatureCollection {
  const preset = feed.kind ? FEED_PRESET_BY_KIND.get(feed.kind) : undefined;
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _source: feed.name,
        _stale: feed.stale,
        _ageSeconds: feed.ageSeconds,
        _ageLabel: formatAge(feed.ageSeconds),
        _symbolStatus: feed.stale ? "unknown" : symbolStatusFor(f.properties),
        _facilityType: facilityTypeFor(f.properties),
        ...(preset ? presetTags(preset, f.properties, geometryType(f.geometry), feed) : {}),
      },
    })),
  };
}

export function feedSourceId(feedId: string): string {
  return `feed-${feedId}`;
}

export function feedLayerIds(feedId: string, kind: "standard" | "fema-flood" = "standard"): string[] {
  if (kind === "fema-flood") return floodLayerIds(feedId);
  return feedLayerSpecs(feedId, "light", "ids").map((spec) => (spec as { id: string }).id);
}

/**
 * A feed's layers under its own source id, in tier order: a data pack's
 * hazards by category (hazard-styles.ts); a preset's features with the paint
 * presetTags put on them; every other feature in the status style. The map
 * mounts one spec list per feed before it knows the feed's kind, so every
 * set is always present.
 */
export function feedLayerSpecs(
  feedId: string,
  theme: ThemeName,
  labelFont?: string,
  kind: "standard" | "fema-flood" = "standard",
): unknown[] {
  if (kind === "fema-flood") {
    // A flood reference is a reference area, under every incident layer.
    return floodLayerSpecs(feedId, theme, labelFont).map((spec) =>
      ({ ...(spec as object), ...inTier((spec as { type: string }).type === "symbol" ? TIER.label : TIER.area) }));
  }
  const src = feedSourceId(feedId);
  const plain = ["all", ["!", ["has", "_preset"]], ["!", IS_HAZARD]];
  return byTier([
    ...statusLayerSpecs(src, theme, labelFont, plain),
    ...hazardLayerSpecs(src, theme, labelFont),
    ...presetLayerSpecs(feedId, theme, labelFont),
  ]);
}

/** Human age for the provenance line: "live", "4m ago", "2h ago", "never". */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return "live";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/*
 * Live feed presets (MP10). Each reads one public source in its own format
 * (the server's feeds/presets.ts normalizes it) and draws it as Esri's
 * emergency management maps draw that source, from the palettes in
 * shared/src/palette/tables.ts. The data is public at the source; Esri's
 * hosted copies are never used.
 */

export type FeedPresetKind =
  | "nws_alerts" | "wfigs_perimeters" | "wfigs_incidents" | "usgs_earthquakes"
  | "usgs_shakemap" | "nwps_gauges" | "utility_outages" | "odin_outages";

type Properties = Readonly<Record<string, unknown>>;

export interface FeedPreset {
  readonly kind: FeedPresetKind;
  readonly title: string;
  /** Who publishes the data, and what the preset reads. */
  readonly source: string;
  /** The data's terms of use. */
  readonly terms: string;
  readonly pollIntervalSeconds: number;
  readonly staleAfterSeconds: number;
  /** What the administrator supplies: an area, a period or a URL. */
  readonly input: { readonly label: string; readonly initial: string; readonly choices?: Readonly<Record<string, string>> };
  /** The source URL for the administrator's input; throws with the reason when the input will not do. */
  url(input: string): string;
  /** The palette whose keys classify the preset's features, in legend order. */
  readonly palette: Palette;
  /** How a class draws: an area, a circle, or the icon suite's pictogram on a disc. */
  readonly shape: "area" | "circle" | "icon";
  /** Point radius in CSS pixels by palette key; 4 without one. */
  readonly radius?: Readonly<Record<string, number>>;
  classify(properties: Properties): string | undefined;
  /** A label beside the feature. Esri labels fire names and magnitudes, and nothing else. */
  label?(properties: Properties): string | undefined;
}

function stateCode(input: string): string {
  const state = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Enter a two-letter state code, such as CA.");
  return state;
}

function feedUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter the feed's full URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Enter an http or https URL.");
  return url.toString();
}

const matchKey = (palette: Palette, value: unknown) =>
  (typeof value === "string" ? paletteKey(palette, value) : undefined);

/** The class holding a number: the entry with the highest lower bound at or below it. */
function stepKey(palette: Palette, value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const classes = Object.entries(palette.entries)
    .filter(([, entry]) => entry.min !== undefined && entry.min <= value)
    .sort(([, a], [, b]) => a.min! - b.min!);
  return classes.at(-1)?.[0];
}

/** NIFC's own ArcGIS Online organization, which publishes WFIGS. */
const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";
const wfigsQuery = (service: string, where: string) =>
  `${WFIGS}/${service}/FeatureServer/0/query?where=${encodeURIComponent(where)}&outFields=*&f=geojson`;
const PUBLIC_DOMAIN = "Public domain: a U.S. Government work.";
const NIFC_TERMS = "Public domain: NIFC open data, a U.S. Government work. Read from NIFC's own service; Esri's Living Atlas copy is not used.";

export const FEED_PRESETS: readonly FeedPreset[] = [
  {
    kind: "nws_alerts",
    title: "NWS watches, warnings and advisories",
    source: "National Weather Service active alerts, api.weather.gov (GeoJSON), with zone boundaries for zone-based alerts",
    terms: `${PUBLIC_DOMAIN} NWS asks each application to identify itself, which the server does on every poll.`,
    pollIntervalSeconds: 300,
    staleAfterSeconds: 900,
    input: { label: "State or NWS zone", initial: "CA" },
    url: (input) => {
      const area = input.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(area)) return `https://api.weather.gov/alerts/active?area=${area}`;
      if (/^[A-Z]{2}[CZ]\d{3}$/.test(area)) return `https://api.weather.gov/alerts/active?zone=${area}`;
      throw new Error("Enter a two-letter state (CA) or an NWS zone (CAZ103).");
    },
    palette: NWS_HAZARD_PALETTE,
    shape: "area",
    classify: (p) => matchKey(NWS_HAZARD_PALETTE, p.event),
  },
  {
    kind: "wfigs_perimeters",
    title: "NIFC wildfire perimeters",
    source: "NIFC Wildland Fire Interagency Geospatial Services (WFIGS) current interagency perimeters",
    terms: NIFC_TERMS,
    pollIntervalSeconds: 900,
    staleAfterSeconds: 3600,
    input: { label: "State", initial: "CA" },
    url: (input) => wfigsQuery("WFIGS_Interagency_Perimeters_Current", `attr_POOState='US-${stateCode(input)}'`),
    palette: WILDFIRE_PERIMETER_PALETTE,
    shape: "area",
    classify: (p) => matchKey(WILDFIRE_PERIMETER_PALETTE, p.type),
  },
  {
    kind: "wfigs_incidents",
    title: "NIFC wildfire incidents",
    source: "NIFC Wildland Fire Interagency Geospatial Services (WFIGS) current incident locations",
    terms: NIFC_TERMS,
    pollIntervalSeconds: 900,
    staleAfterSeconds: 3600,
    input: { label: "State", initial: "CA" },
    url: (input) => wfigsQuery("WFIGS_Incident_Locations_Current", `POOState='US-${stateCode(input)}'`),
    palette: WILDFIRE_INCIDENT_PALETTE,
    shape: "icon",
    radius: { under_1k: 7, ac_1k: 9, ac_10k: 11, ac_50k: 13, ac_100k: 15, ac_300k: 17, prescribed: 7 },
    classify: (p) => (p.type === "prescribed" ? "prescribed" : stepKey(WILDFIRE_INCIDENT_PALETTE, p.acres ?? 0)),
    label: (p) => (typeof p.name === "string" ? p.name.toUpperCase() : undefined),
  },
  {
    kind: "usgs_earthquakes",
    title: "USGS earthquakes",
    source: "U.S. Geological Survey Earthquake Hazards Program summary feed (GeoJSON)",
    terms: PUBLIC_DOMAIN,
    pollIntervalSeconds: 300,
    staleAfterSeconds: 900,
    // The week's feed of every magnitude runs past the map's 1,000-feature page; 2.5 and over stays inside it.
    input: { label: "Period", initial: "day", choices: { day: "Past day, every magnitude", week: "Past week, magnitude 2.5 and over" } },
    url: (input) => {
      if (input !== "day" && input !== "week") throw new Error("Choose the past day or the past week.");
      return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${input === "week" ? "2.5_week" : "all_day"}.geojson`;
    },
    palette: EARTHQUAKE_MAGNITUDE_PALETTE,
    shape: "circle",
    // Esri's sizes (3, 5.25, 7.5, 13.5 and 16.5 points) as radii in CSS pixels.
    radius: { under_3: 2, m3: 3.5, m4_5: 5, m6: 9, m7_5: 11 },
    classify: (p) => stepKey(EARTHQUAKE_MAGNITUDE_PALETTE, p.mag),
    label: (p) => (typeof p.mag === "number" ? p.mag.toFixed(1) : undefined),
  },
  {
    kind: "usgs_shakemap",
    title: "USGS ShakeMap intensity",
    source: "U.S. Geological Survey ShakeMap for one event: the event's cont_mmi.json product",
    terms: PUBLIC_DOMAIN,
    pollIntervalSeconds: 900,
    staleAfterSeconds: 86400,
    input: { label: "The event's cont_mmi.json URL", initial: "" },
    url: feedUrl,
    palette: SHAKEMAP_MMI_PALETTE,
    shape: "area",
    classify: (p) => stepKey(SHAKEMAP_MMI_PALETTE, p.mmi),
  },
  {
    kind: "nwps_gauges",
    title: "NOAA river gauges",
    source: "NOAA National Water Prediction Service gauges, api.water.noaa.gov/nwps/v1, observed flood category",
    terms: PUBLIC_DOMAIN,
    pollIntervalSeconds: 900,
    staleAfterSeconds: 3600,
    input: { label: "Area: west, south, east, north", initial: "-124.5, 39.9, -123.3, 42.0" },
    url: (input) => {
      const box = input.split(",").map((part) => Number(part.trim()));
      const [xmin, ymin, xmax, ymax] = box as [number, number, number, number];
      if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || xmin >= xmax || ymin >= ymax)
        throw new Error("Enter the area as west, south, east, north in degrees.");
      return `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${xmin}&bbox.ymin=${ymin}&bbox.xmax=${xmax}&bbox.ymax=${ymax}&srid=EPSG_4326`;
    },
    palette: RIVER_GAUGE_PALETTE,
    shape: "circle",
    // Esri's sizes (7.5, 6, 5.25 and 4.5 points, then small) as radii in CSS pixels.
    radius: { major: 5, moderate: 4, minor: 3.5, action: 3, no_flooding: 3, low: 2.5, unknown: 2.5 },
    classify: (p) => matchKey(RIVER_GAUGE_PALETTE, p.category) ?? "unknown",
  },
  {
    kind: "utility_outages",
    title: "Utility power outages",
    source: "A utility's public outage map feed, as GeoJSON points or areas with a customers-out count",
    terms: "The utility's own terms apply; confirm them before adding. No national source publishes live outage data under stated public terms: "
      + "DOE's EAGLE-I needs a sign-in for live data and offers history only in public, and ORNL's ODIN (its own preset) publishes no terms of use.",
    pollIntervalSeconds: 300,
    staleAfterSeconds: 900,
    input: { label: "The utility's outage feed URL (GeoJSON)", initial: "" },
    url: feedUrl,
    palette: OUTAGE_CUSTOMERS_PALETTE,
    shape: "circle",
    radius: { none: 3, c1: 5, c100: 7, c1k: 10, c5k: 14, c20k: 18 },
    classify: (p) => stepKey(OUTAGE_CUSTOMERS_PALETTE, p.customersOut ?? 0),
  },
  {
    kind: "odin_outages",
    title: "ODIN power outages by county",
    source: "ORNL Outage Data Initiative Nationwide (ODIN), public county-level current outages, odin.ornl.gov/odi/map; no token",
    terms: "ODIN publishes no terms of use. Basho chose to offer this preset on 2026-09-26. "
      + "Counts are electric meters out as the reporting utilities send them, not customers.",
    pollIntervalSeconds: 300,
    staleAfterSeconds: 1800,
    input: { label: "State FIPS code (California is 06)", initial: "06" },
    url: (input) => {
      const state = input.trim();
      if (!/^\d{2}$/.test(state)) throw new Error("Enter the state's two-digit FIPS code, such as 06 for California.");
      return `https://odin.ornl.gov/odi/map?stateCd=${state}&scale=COUNTY`;
    },
    palette: OUTAGE_METERS_PALETTE,
    shape: "area",
    classify: (p) => stepKey(OUTAGE_METERS_PALETTE, p.metersOut ?? 0),
    label: (p) => (typeof p.metersOut === "number" ? `${p.metersOut.toLocaleString("en-US")} meters out` : undefined),
  },
];

export const FEED_PRESET_BY_KIND: ReadonlyMap<string, FeedPreset> = new Map(FEED_PRESETS.map((preset) => [preset.kind, preset]));

/** Grey for a stale preset, whatever its class: the product's unknown-status grey. */
const STALE_COLOR = "#8d99ae";
/** A class the table does not list, such as a rare NWS product: NWS's silver. */
const OTHER_COLOR = "#c0c0c0";
const DEFAULT_AREA: PolygonStyle = { fillOpacity: 0.5, outlineWidth: 1 };

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function geometryType(geometry: unknown): string | undefined {
  return (geometry as { type?: string } | null | undefined)?.type;
}

/**
 * A preset feature's paint, carried on the feature so one set of preset
 * layers draws every preset; the operator's layer opacity still scales it.
 * The feed palettes' colors are their sources' own, the same in both themes.
 * A stale feed draws grey and labels each feature with its age.
 */
function presetTags(preset: FeedPreset, properties: Properties, type: string | undefined, feed: FeedLayerHealth) {
  const key = preset.classify(properties);
  const entry = key === undefined ? undefined : preset.palette.entries[key];
  const color = feed.stale ? STALE_COLOR : entry?.light ?? OTHER_COLOR;
  const area = entry?.polygon ?? Object.values(preset.palette.entries).find((e) => e.polygon)?.polygon ?? DEFAULT_AREA;
  const isArea = type === "Polygon" || type === "MultiPolygon";
  const isLine = type === "LineString" || type === "MultiLineString";
  // ShakeMap's I to III draw nothing, so they carry no label either.
  const drawn = !(isArea || isLine) || area.fillOpacity > 0 || (isArea && area.outlineWidth > 0);
  const base = preset.label?.(properties);
  const label = feed.stale ? [base, `stale ${formatAge(feed.ageSeconds)}`].filter(Boolean).join(" · ") : base;
  const tags: Record<string, unknown> = { _preset: preset.kind, _presetClass: key ?? "other" };
  if (label && drawn) tags._presetLabel = label;
  if (isArea) {
    tags._presetFill = rgba(color, area.fillOpacity);
    tags._presetLine = rgba(feed.stale ? color : area.outline ?? color, area.outlineWidth > 0 ? area.outlineOpacity ?? 1 : 0);
    tags._presetLineWidth = area.outlineWidth;
  } else if (isLine) {
    // A contour draws at Esri's ShakeMap opacity, and not at all where its class draws no area.
    tags._presetLine = rgba(color, area.fillOpacity > 0 ? 0.6 : 0);
    tags._presetLineWidth = 2;
  } else {
    const radius = preset.radius?.[key ?? ""] ?? 4;
    tags._presetColor = rgba(color, 1);
    tags._presetRadius = radius;
    // The icon suite's pictogram on a disc of the class color; the circle beneath draws until the map has the image.
    if (preset.shape === "icon" && entry?.icon && !feed.stale) {
      tags._presetIcon = iconImageId(entry.icon, color);
      tags._presetIconSize = (radius * 2) / 24;
    }
  }
  return tags;
}

/** The icon images the preset layers ask for, for the map to register with ensureIconImages. */
export const FEED_PRESET_ICONS: readonly IconRequest[] = [
  { id: "wildfire", color: WILDFIRE_INCIDENT_PALETTE.entries.under_1k.light },
  { id: "wildfire", color: WILDFIRE_INCIDENT_PALETTE.entries.prescribed.light },
];

/** Preset areas and contours are reference areas, under every incident layer; preset points draw with the others. */
function presetLayerSpecs(feedId: string, theme: ThemeName, labelFont?: string): unknown[] {
  const src = feedSourceId(feedId);
  const t = themes[theme];
  const on = (...types: string[]) => ["all", ["has", "_preset"], ["in", ["geometry-type"], ["literal", types]]];
  const layers: unknown[] = [
    {
      id: `${src}-preset-fill`,
      type: "fill",
      source: src,
      ...inTier(TIER.area),
      filter: on("Polygon", "MultiPolygon"),
      paint: { "fill-color": ["get", "_presetFill"], "fill-opacity": 1 },
    },
    {
      id: `${src}-preset-line`,
      type: "line",
      source: src,
      ...inTier(TIER.area),
      filter: ["all", on("Polygon", "MultiPolygon", "LineString", "MultiLineString"), ["has", "_presetLine"]],
      layout: { "line-join": "round" },
      paint: { "line-color": ["get", "_presetLine"], "line-width": ["get", "_presetLineWidth"], "line-opacity": 1 },
    },
    {
      id: `${src}-preset-circle`,
      type: "circle",
      source: src,
      ...inTier(TIER.point),
      filter: on("Point", "MultiPoint"),
      paint: {
        "circle-color": ["get", "_presetColor"],
        "circle-radius": ["get", "_presetRadius"],
        // The theme's ink rings a white gauge on the light map and a black magnitude 7.5 circle on the dark one.
        "circle-stroke-color": t.text,
        "circle-stroke-width": 0.75,
      },
    },
    {
      id: `${src}-preset-icon`,
      type: "symbol",
      source: src,
      ...inTier(TIER.point),
      filter: ["all", on("Point", "MultiPoint"), ["has", "_presetIcon"]],
      layout: {
        "icon-image": ["get", "_presetIcon"],
        "icon-size": ["get", "_presetIconSize"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
  ];
  if (labelFont) {
    layers.push({
      id: `${src}-preset-label`,
      type: "symbol",
      source: src,
      ...inTier(TIER.label),
      filter: ["has", "_presetLabel"],
      layout: {
        "text-field": ["get", "_presetLabel"],
        "text-font": [labelFont],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-optional": true,
      },
      paint: { "text-color": t.text, "text-halo-color": t.surface, "text-halo-width": 1.2 },
    });
  }
  return layers;
}

export type FeedLegendRow = PaletteLegendEntry & { readonly shape: FeedPreset["shape"]; readonly radius?: number };

export interface FeedLegend {
  readonly title: string;
  readonly source: string;
  readonly rows: readonly FeedLegendRow[];
}

/**
 * A preset feed's legend for the map legend (MP8): its palette's rows in
 * table order, with the shape and radius each class draws at. Given the
 * features' `_presetClass` values, only the classes the map shows.
 * Undefined for a feed that is not a preset.
 */
export function feedPresetLegend(kind: string, theme: PaletteTheme, present?: Iterable<string>): FeedLegend | undefined {
  const preset = FEED_PRESET_BY_KIND.get(kind);
  if (!preset) return undefined;
  return {
    title: preset.palette.title,
    source: preset.source,
    rows: paletteLegend(preset.palette, theme, present).map((row) => {
      const radius = preset.radius?.[row.key];
      return { ...row, shape: preset.shape, ...(radius === undefined ? {} : { radius }) };
    }),
  };
}
