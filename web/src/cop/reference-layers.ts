import {
  AIANNH_PALETTE,
  LIFELINE_CATEGORY_PALETTE,
  NRI_RATING_PALETTE,
  paletteLegend,
  paletteMatch,
  paletteStep,
  SVI_QUARTILE_PALETTE,
  type PaletteLegendEntry,
} from "@openeoc/shared";
import { themes, type ThemeName } from "../design/tokens.js";
import { withBasemapGroups } from "./layers.js";
import { CRITICAL_FACILITY_TAGS } from "./streetstyle.js";
import { GLYPHS, ICON_IDS, type IconId } from "./symbols/glyphs.js";
import { iconImageId, type IconRequest } from "./symbols/register.js";
import type { CopInspection } from "./workspace.js";

/**
 * The statewide reference layers the Map screen draws under the incident
 * picture: critical facilities by Community Lifeline, tribal lands and other
 * boundaries, and the FEMA National Risk Index and CDC/ATSDR Social
 * Vulnerability Index. Each comes from its own PMTiles archive built by
 * tools/basemap. Colors come from the shared palette table, so the map, the
 * legend and the inspector agree. Pure functions: style specs, the state the
 * layer list changes, legend rows and the inspector's fields.
 */

/** A reference archive, with the manifest naming its sources. */
export interface ReferenceArchive {
  readonly pmtilesUrl: string;
  readonly manifestUrl?: string | undefined;
}

export interface ReferenceLayersConfig {
  readonly facilities?: ReferenceArchive | undefined;
  readonly boundaries?: ReferenceArchive | undefined;
  readonly risk?: ReferenceArchive | undefined;
}

export type Lifeline = keyof typeof LIFELINE_CATEGORY_PALETTE.entries;
export const LIFELINES = Object.keys(LIFELINE_CATEGORY_PALETTE.entries) as Lifeline[];

/** The risk choropleths, shown one at a time. */
export const RISK_LAYERS = [
  { id: "nri", title: "Composite risk", field: "RISK_RATNG" },
  { id: "nri_earthquake", title: "Earthquake", field: "ERQK_RISKR" },
  { id: "nri_tsunami", title: "Tsunami", field: "TSUN_RISKR" },
  { id: "nri_wildfire", title: "Wildfire", field: "WFIR_RISKR" },
  { id: "nri_inland_flooding", title: "Inland flooding", field: "IFLD_RISKR" },
  { id: "nri_coastal_flooding", title: "Coastal flooding", field: "CFLD_RISKR" },
  { id: "nri_landslide", title: "Landslide", field: "LNDS_RISKR" },
  { id: "nri_winter_weather", title: "Winter weather", field: "WNTW_RISKR" },
  { id: "nri_heat_wave", title: "Heat wave", field: "HWAV_RISKR" },
  { id: "svi", title: "Social vulnerability", field: "RPL_THEMES" },
] as const;
export type RiskLayerId = (typeof RISK_LAYERS)[number]["id"];

/** What the layer list has switched on. */
export interface ReferenceState {
  readonly lifelines: Readonly<Record<Lifeline, boolean>>;
  readonly tribal: boolean;
  readonly bia: boolean;
  readonly counties: boolean;
  readonly places: boolean;
  readonly risk: RiskLayerId | null;
}

export const DEFAULT_REFERENCE_STATE: ReferenceState = {
  lifelines: Object.fromEntries(LIFELINES.map((lifeline) => [lifeline, true])) as Record<Lifeline, boolean>,
  tribal: true,
  bia: false,
  counties: false,
  places: false,
  risk: null,
};

export const BOUNDARY_TOGGLES = [
  { key: "tribal", title: "Tribal areas" },
  { key: "bia", title: "BIA land area representations" },
  { key: "counties", title: "Counties" },
  { key: "places", title: "Cities and places" },
] as const;

// Short, as the map's credits line carries them; the inspector names each record's source in full.
export const FACILITIES_ATTRIBUTION = "Facilities: USGS, FEMA, CMS, EIA, EPA, FCC, FAA, USACE, FHWA, BTS, OpenStreetMap";
export const BOUNDARIES_ATTRIBUTION = "Boundaries: U.S. Census Bureau, BIA";
/** The statement FEMA's terms require wherever the National Risk Index is shown. */
export const FEMA_NRI_STATEMENT =
  "This product uses the Federal Emergency Management Agency's National Risk Index dataset API or downloadable datasets but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have been retrieved from the Agency's website(s).";
const CDC_SVI_CREDIT =
  "CDC/ATSDR Social Vulnerability Index: Centers for Disease Control and Prevention/Agency for Toxic Substances and Disease Registry/Geospatial Research, Analysis, and Services Program";
export const RISK_ATTRIBUTION = `FEMA National Risk Index. ${FEMA_NRI_STATEMENT} ${CDC_SVI_CREDIT}.`;
export const BIA_NOTE =
  "For illustrative and reference use only. No legal inference can or should be made from BIA's land area representations.";
const RISK_NOTE = "Planning reference only, not a substitute for a local risk assessment.";

const FACILITIES = "reference-facilities";
const BOUNDARIES = "reference-boundaries";
const RISK = "reference-risk";

export const REFERENCE_LAYER = {
  clusters: "ref-facility-clusters",
  clusterCount: "ref-facility-cluster-count",
  facilities: "ref-facilities",
  keyFacilities: "ref-key-facilities",
  keyFacilityNames: "ref-key-facility-names",
  tribalFill: "ref-tribal-fill",
  tribalLine: "ref-tribal-line",
  tribalLabel: "ref-tribal-label",
  biaFill: "ref-bia-fill",
  biaLine: "ref-bia-line",
  countiesLine: "ref-counties-line",
  countiesLabel: "ref-counties-label",
  placesLine: "ref-places-line",
  placesLabel: "ref-places-label",
} as const;

const riskLayerId = (index: "nri" | "svi", geography: "counties" | "tracts", kind: "fill" | "line") =>
  `ref-${index}-${geography}-${kind}`;

/** A click on these zooms toward the facilities they count. */
export const REFERENCE_CLUSTER_LAYERS: ReadonlySet<string> = new Set([REFERENCE_LAYER.clusters, REFERENCE_LAYER.clusterCount]);

/** Reference layers a click inspects (or, for clusters, opens). */
export const REFERENCE_INSPECTABLE: ReadonlySet<string> = new Set([
  ...REFERENCE_CLUSTER_LAYERS,
  REFERENCE_LAYER.facilities,
  REFERENCE_LAYER.keyFacilities,
  REFERENCE_LAYER.keyFacilityNames,
  REFERENCE_LAYER.tribalFill,
  REFERENCE_LAYER.biaFill,
  ...(["nri", "svi"] as const).flatMap((index) => (["counties", "tracts"] as const).map((g) => riskLayerId(index, g, "fill"))),
]);

// Critical facilities.

const CRITICAL = ICON_IDS.filter((id) => GLYPHS[id].group === "critical");
const lifelineColor = (lifeline: Lifeline, theme: ThemeName) => LIFELINE_CATEGORY_PALETTE.entries[lifeline][theme];
const facilityColor = (id: IconId) => lifelineColor(GLYPHS[id].lifeline!, "light");

/** Each critical facility icon on its lifeline's square: the only images the layer draws. */
export const FACILITY_ICONS: readonly IconRequest[] = CRITICAL.map((id) => ({ id, color: facilityColor(id) }));

/** Drawn wherever they are, however crowded: the emergency services an EOC calls first. */
const KEY_FACILITIES: readonly IconId[] = ["hospital", "eoc", "fire_station", "law_enforcement", "ems_station"];

/** Collision order: where symbols crowd, the first in this list keeps its place. */
const PRIORITY: readonly IconId[] = [
  "hospital", "eoc", "fire_station", "law_enforcement", "ems_station", "urgent_care", "nursing_home", "dialysis",
  "school", "correctional", "government", "college", "power_plant", "substation", "water_treatment",
  "wastewater_treatment", "airport", "heliport", "port", "dam", "pharmacy", "comms_tower", "hazmat_site", "bridge",
];

/** Types too many to draw before street zoom: every highway bridge and hazardous waste generator. */
const FIRST_ZOOM = ["match", ["get", "type"], ["pharmacy", "comms_tower"], 13, ["bridge", "hazmat_site"], 14, 12];

/** Facilities cluster below z12, draw as icons from z12 and are named from z14 (decision 12). */
const ICON_ZOOM = 12;
const NAME_ZOOM = 14;

function facilityLayers(theme: ThemeName, font: string | undefined, state: ReferenceState, iconsReady: boolean) {
  const t = themes[theme];
  const on = LIFELINES.filter((lifeline) => state.lifelines[lifeline]);
  const visibility = on.length > 0 ? "visible" : "none";
  const n = (lifeline: Lifeline) => ["number", ["get", lifeline], 0];
  const count = ["+", 0, ...on.map(n)];
  // A cluster takes the color of its most numerous lifeline among those shown.
  const dominant = on.length <= 1
    ? lifelineColor(on[0] ?? "safety_security", theme)
    : ["case", ...on.flatMap((lifeline) => [
        ["all", ...on.filter((other) => other !== lifeline).map((other) => [">=", n(lifeline), n(other)])],
        lifelineColor(lifeline, theme),
      ]), lifelineColor(on[0]!, theme)];
  const clustered = [">", count, 0];
  const clusters = [
    {
      id: REFERENCE_LAYER.clusters,
      type: "circle",
      source: FACILITIES,
      "source-layer": "facility_clusters",
      maxzoom: ICON_ZOOM,
      filter: clustered,
      layout: { visibility },
      // Quiet rings, so a count never reads as an incident symbol.
      paint: {
        "circle-color": dominant,
        "circle-opacity": theme === "dark" ? 0.3 : 0.2,
        "circle-radius": ["interpolate", ["linear"], count, 1, 6, 10, 9, 100, 13, 1000, 18, 10000, 23],
        "circle-stroke-color": dominant,
        "circle-stroke-width": 1.25,
        "circle-stroke-opacity": 0.9,
      },
    },
    ...(font ? [{
      id: REFERENCE_LAYER.clusterCount,
      type: "symbol",
      source: FACILITIES,
      "source-layer": "facility_clusters",
      maxzoom: ICON_ZOOM,
      filter: clustered,
      layout: {
        visibility,
        "text-field": ["case", [">=", count, 1000], ["concat", ["to-string", ["/", ["round", ["/", count, 100]], 10]], "k"], ["to-string", count]],
        "text-font": [font],
        "text-size": 10,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": t.text, "text-halo-color": t.surface, "text-halo-width": 1 },
    }] : []),
  ];
  const symbol = (id: string, types: readonly IconId[], minzoom: number, layout: Record<string, unknown>) => ({
    id,
    type: "symbol",
    source: FACILITIES,
    "source-layer": "facilities",
    minzoom,
    filter: [
      "all",
      ["in", ["get", "lifeline"], ["literal", on]],
      ["in", ["get", "type"], ["literal", types]],
      [">=", ["zoom"], FIRST_ZOOM],
    ],
    // Hidden until the icons are on the map, so no frame asks for a missing image.
    layout: {
      visibility: iconsReady ? visibility : "none",
      "symbol-sort-key": ["match", ["get", "type"], ...types.flatMap((type) => [type, PRIORITY.indexOf(type)]), PRIORITY.length],
      ...layout,
    },
    paint: font ? { "text-color": t.text, "text-halo-color": t.surface, "text-halo-width": 1.4 } : {},
  });
  const icon = (types: readonly IconId[]) => ({
    "icon-image": ["match", ["get", "type"], ...types.flatMap((type) => [type, iconImageId(type, facilityColor(type))]), ""],
    "icon-size": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM, 0.75, 15, 0.9, 18, 1],
    "icon-padding": 1,
  });
  // Under the icon, or beside it where that is taken. A name in a layer of its
  // own must also clear its icon's collision box, at the largest icon size.
  const name = (field: unknown, offset = 1.1) => (font ? {
    "text-field": field,
    "text-font": [font],
    "text-size": 11,
    "text-variable-anchor": ["top", "bottom", "right", "left"],
    "text-radial-offset": offset,
    "text-justify": "auto",
    "text-max-width": 9,
  } : {});
  const others = CRITICAL.filter((type) => !KEY_FACILITIES.includes(type));
  // Top to bottom, so placed in this order: the key icons, which always draw as
  // Esri draws a point layer; their names, around them; the other facilities,
  // each named only where its icon found room.
  return {
    symbols: [
      ...clusters,
      symbol(REFERENCE_LAYER.facilities, others, ICON_ZOOM,
        { ...icon(others), ...name(["step", ["zoom"], "", NAME_ZOOM, ["coalesce", ["get", "name"], ""]]), ...(font ? { "text-optional": true } : {}) }),
      ...(font ? [symbol(REFERENCE_LAYER.keyFacilityNames, KEY_FACILITIES, NAME_ZOOM, name(["coalesce", ["get", "name"], ""], 1.45))] : []),
      symbol(REFERENCE_LAYER.keyFacilities, KEY_FACILITIES, ICON_ZOOM, { ...icon(KEY_FACILITIES), "icon-allow-overlap": true }),
    ],
  };
}

/** OpenStreetMap poi subclasses the facilities archive already draws. */
const ARCHIVE_POI = new Set(["hospital", "fire_station", "police", "school", "college", "university", "helipad", "airport"]);

/**
 * With the facilities archive on the map, the basemap's facility points keep
 * only the places the archive lacks (clinics, community centres, town halls
 * and the like), as plain labels, so nothing is drawn or named twice.
 */
function basemapPlacesOnly(layer: { id: string; layout?: Record<string, unknown> }): unknown {
  if (layer.id !== "facility-label") return layer;
  const { "icon-image": _image, "icon-size": _size, "icon-optional": _optional, ...layout } = layer.layout ?? {};
  return {
    ...layer,
    id: "poi-label",
    filter: ["in", ["get", "subclass"], ["literal", CRITICAL_FACILITY_TAGS.filter((tag) => !ARCHIVE_POI.has(tag))]],
    layout: { ...layout, "text-offset": [0, 0.3] },
  };
}

// Boundaries.

/** The archive's AIANNH class codes, as the palette's entries. */
const TRIBAL_CLASS: Readonly<Record<string, keyof typeof AIANNH_PALETTE.entries>> = {
  federal: "federal_reservation",
  joint_use: "joint_use",
  state: "state_reservation",
  anvsa: "anvsa",
  hhl: "hawaiian_home_land",
  otsa: "otsa",
  tdsa: "tdsa",
  sdtsa: "tdsa",
};

const INK: Readonly<Record<ThemeName, { tribal: string; county: string; place: string; bia: string }>> = {
  light: { tribal: "#7a2626", county: "#5b4a70", place: "#6b7280", bia: "#a8812f" },
  dark: { tribal: "#f5b7ae", county: "#c9b8dd", place: "#9aa3ad", bia: "#e0bb73" },
};
/** Esri's BIA LAR fill. */
const BIA_FILL = "#f5ca7a";

function boundaryLayers(theme: ThemeName, font: string | undefined, state: ReferenceState) {
  const t = themes[theme];
  const ink = INK[theme];
  const shown = (on: boolean) => ({ visibility: on ? "visible" : "none" });
  const tribalColor = [
    "match", ["get", "class"],
    ...Object.entries(TRIBAL_CLASS).flatMap(([code, key]) => [code, AIANNH_PALETTE.entries[key][theme]]),
    AIANNH_PALETTE.entries.federal_reservation[theme],
  ];
  const width = (stops: number[]) => ["interpolate", ["linear"], ["zoom"], ...stops];
  const label = (id: string, layer: string, on: boolean, minzoom: number, layout: Record<string, unknown>, color: string, maxzoom?: number) => ({
    id,
    type: "symbol",
    source: BOUNDARIES,
    "source-layer": "labels",
    minzoom,
    ...(maxzoom ? { maxzoom } : {}),
    // Small areas are named only closer in.
    filter: ["all", ["==", ["get", "layer"], layer], [">=", ["to-number", ["get", "area_km2"], 0], ["step", ["zoom"], 25, 10, 2, 12, 0]]],
    layout: {
      ...shown(on),
      "text-field": ["get", "name"],
      "text-font": [font],
      "text-max-width": 8,
      "symbol-sort-key": ["-", 0, ["to-number", ["get", "area_km2"], 0]],
      ...layout,
    },
    paint: { "text-color": color, "text-halo-color": t.surface, "text-halo-width": 1.4 },
  });
  const fills = [
    {
      id: REFERENCE_LAYER.tribalFill, type: "fill", source: BOUNDARIES, "source-layer": "aiannh", minzoom: 5,
      layout: shown(state.tribal), paint: { "fill-color": tribalColor, "fill-opacity": theme === "dark" ? 0.18 : 0.15 },
    },
    {
      id: REFERENCE_LAYER.biaFill, type: "fill", source: BOUNDARIES, "source-layer": "bia_lar", minzoom: 5,
      layout: shown(state.bia), paint: { "fill-color": BIA_FILL, "fill-opacity": 0.3 },
    },
  ];
  const lines = [
    {
      id: REFERENCE_LAYER.tribalLine, type: "line", source: BOUNDARIES, "source-layer": "aiannh", minzoom: 5,
      layout: { ...shown(state.tribal), "line-join": "round" },
      // Dashed, as a boundary: a solid red edge would read as a fire perimeter or an evacuation order.
      paint: { "line-color": tribalColor, "line-width": width([6, 0.8, 10, 1.4, 14, 2]), "line-opacity": 0.9, "line-dasharray": [3, 1.5] },
    },
    {
      id: REFERENCE_LAYER.biaLine, type: "line", source: BOUNDARIES, "source-layer": "bia_lar", minzoom: 5,
      layout: { ...shown(state.bia), "line-join": "round" },
      paint: { "line-color": ink.bia, "line-width": width([6, 0.6, 12, 1.2]) },
    },
    {
      id: REFERENCE_LAYER.countiesLine, type: "line", source: BOUNDARIES, "source-layer": "counties",
      layout: { ...shown(state.counties), "line-join": "round" },
      paint: { "line-color": ink.county, "line-width": width([5, 0.8, 10, 1.6]), "line-opacity": 0.85 },
    },
    {
      id: REFERENCE_LAYER.placesLine, type: "line", source: BOUNDARIES, "source-layer": "places", minzoom: 8,
      layout: { ...shown(state.places), "line-join": "round" },
      paint: { "line-color": ink.place, "line-width": 0.9, "line-dasharray": [2, 1.5] },
    },
  ];
  const symbols = font ? [
    // A name gives way to incident labels; moving about its point finds it room beside them.
    label(REFERENCE_LAYER.tribalLabel, "aiannh", state.tribal, 8,
      { "text-size": 12, "text-variable-anchor": ["center", "top", "bottom", "left", "right"], "text-radial-offset": 0.6 }, ink.tribal),
    label(REFERENCE_LAYER.countiesLabel, "counties", state.counties, 6,
      { "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.12 }, ink.county, 11),
    label(REFERENCE_LAYER.placesLabel, "places", state.places, 10, { "text-size": 10.5 }, ink.place),
  ] : [];
  return { fills, lines, symbols };
}

// Risk and vulnerability.

/** The NRI's own rating strings; No Rating, Not Applicable and Insufficient Data are left undrawn. */
const NRI_RATINGS = Object.keys(NRI_RATING_PALETTE.aliases ?? {});
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const HAIRLINE = { color: "#000000", opacity: 0.25 };
/** Tracts from z8, counties below (Esri's tract and county pair). */
const TRACT_ZOOM = 8;

function riskLayers(theme: ThemeName, state: ReferenceState) {
  const choice = RISK_LAYERS.find((layer) => layer.id === state.risk);
  const nriField = choice && choice.id !== "svi" ? choice.field : "RISK_RATNG";
  const nri = NRI_RATING_PALETTE.entries.very_high.polygon!;
  const svi = SVI_QUARTILE_PALETTE.entries.highest.polygon!;
  return (["nri", "svi"] as const).flatMap((index) => {
    const on = !!choice && (choice.id === "svi") === (index === "svi");
    const filter = index === "nri" ? ["in", ["get", nriField], ["literal", NRI_RATINGS]] : ["has", "RPL_THEMES"];
    return (["counties", "tracts"] as const).flatMap((geography) => {
      const common = {
        source: RISK,
        "source-layer": `${index}_${geography}`,
        ...(geography === "counties" ? { maxzoom: TRACT_ZOOM } : { minzoom: TRACT_ZOOM }),
        filter,
        layout: { visibility: on ? "visible" : "none" },
      };
      return [
        {
          id: riskLayerId(index, geography, "fill"),
          type: "fill",
          ...common,
          paint: index === "nri"
            ? { "fill-color": paletteMatch(NRI_RATING_PALETTE, nriField, theme, TRANSPARENT), "fill-opacity": nri.fillOpacity }
            : { "fill-color": paletteStep(SVI_QUARTILE_PALETTE, "RPL_THEMES", theme, TRANSPARENT), "fill-opacity": svi.fillOpacity },
        },
        {
          id: riskLayerId(index, geography, "line"),
          type: "line",
          ...common,
          // The NRI's 25 percent black hairline; the SVI, drawn without one, takes a finer line.
          paint: {
            "line-color": HAIRLINE.color,
            "line-opacity": HAIRLINE.opacity,
            "line-width": index === "nri" ? nri.outlineWidth : 0.6,
          },
        },
      ];
    });
  });
}

// The style.

export interface ReferenceSpecs {
  readonly sources: Record<string, unknown>;
  /** Areas: under the basemap's roads. */
  readonly fills: unknown[];
  /** Outlines: over the roads, under the labels. */
  readonly lines: unknown[];
  /** Labels and symbols: over everything the basemap draws; incident layers mount above them. */
  readonly symbols: unknown[];
}

/**
 * Sources and layers for the configured archives in a state. Labels and
 * icons need the basemap's glyph stack; without one they are left out.
 */
export function referenceSpecs(
  config: ReferenceLayersConfig,
  theme: ThemeName,
  font: string | undefined,
  state: ReferenceState,
  iconsReady = true,
): ReferenceSpecs {
  const sources: Record<string, unknown> = {};
  const fills: unknown[] = [];
  const lines: unknown[] = [];
  const symbols: unknown[] = [];
  if (config.risk) {
    sources[RISK] = { type: "vector", url: `pmtiles://${config.risk.pmtilesUrl}`, attribution: RISK_ATTRIBUTION };
    fills.push(...riskLayers(theme, state));
  }
  if (config.boundaries) {
    sources[BOUNDARIES] = { type: "vector", url: `pmtiles://${config.boundaries.pmtilesUrl}`, attribution: BOUNDARIES_ATTRIBUTION };
    const boundaries = boundaryLayers(theme, font, state);
    fills.push(...boundaries.fills);
    lines.push(...boundaries.lines);
    symbols.push(...boundaries.symbols);
  }
  if (config.facilities) {
    sources[FACILITIES] = { type: "vector", url: `pmtiles://${config.facilities.pmtilesUrl}`, attribution: FACILITIES_ATTRIBUTION };
    symbols.push(...facilityLayers(theme, font, state, iconsReady).symbols);
  }
  return { sources, fills, lines, symbols };
}

/** Basemap layers the reference areas go under, in the street, bundled and fallback styles. */
const ROADS = new Set(["rail", "road-casing", "roads-casing", "roads-minor"]);

/**
 * The style with the reference layers placed in it: areas under the roads,
 * outlines over them, labels and icons above the basemap. Where an archive
 * replaces a basemap layer it takes its place: the facilities archive the
 * basemap's facility icons, the tribal areas the basemap's tribal line.
 * The icons stay hidden until their images are registered.
 */
export function withReferenceLayers(
  style: Record<string, unknown>,
  config: ReferenceLayersConfig | undefined,
  theme: ThemeName,
  font: string | undefined,
  state: ReferenceState = DEFAULT_REFERENCE_STATE,
): Record<string, unknown> {
  if (!config || !(config.facilities || config.boundaries || config.risk)) return style;
  const specs = referenceSpecs(config, theme, font, state, false);
  let layers = style.layers as { id: string; type: string; layout?: Record<string, unknown> }[];
  if (config.facilities) layers = layers.map(basemapPlacesOnly) as typeof layers;
  if (config.boundaries) layers = layers.filter((layer) => layer.id !== "boundary-tribal" && layer.id !== "boundary-tribal-label");
  const labels = layers.findIndex((layer) => layer.type === "symbol");
  const top = labels < 0 ? layers.length : labels;
  const roads = layers.findIndex((layer, index) => index < top && ROADS.has(layer.id));
  const under = roads < 0 ? top : roads;
  return {
    ...style,
    sources: { ...(style.sources as Record<string, unknown>), ...specs.sources },
    layers: withBasemapGroups([
      ...layers.slice(0, under),
      ...specs.fills,
      ...layers.slice(under, top),
      ...specs.lines,
      ...layers.slice(top),
      ...specs.symbols,
    ]),
  };
}

/** The parts of a map a state change touches. */
export interface ReferenceMap {
  getLayer(id: string): unknown;
  setFilter(id: string, filter: never): unknown;
  setLayoutProperty(id: string, name: string, value: unknown): unknown;
  setPaintProperty(id: string, name: string, value: unknown): unknown;
}

/** Bring the mounted layers to a state. MapLibre skips a value that has not changed. */
export function applyReferenceSpecs(map: ReferenceMap, specs: ReferenceSpecs): void {
  for (const spec of [...specs.fills, ...specs.lines, ...specs.symbols]) {
    const layer = spec as { id: string; filter?: unknown; layout?: Record<string, unknown>; paint?: Record<string, unknown> };
    if (!map.getLayer(layer.id)) continue;
    map.setFilter(layer.id, (layer.filter ?? null) as never);
    for (const [name, value] of Object.entries(layer.layout ?? {})) map.setLayoutProperty(layer.id, name, value);
    for (const [name, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, name, value);
  }
}

/** The credits of the reference layers shown, for an exported image. */
export function referenceCredits(config: ReferenceLayersConfig | undefined, state: ReferenceState): string[] {
  if (!config) return [];
  return [
    ...(config.facilities && LIFELINES.some((lifeline) => state.lifelines[lifeline]) ? [FACILITIES_ATTRIBUTION] : []),
    ...(config.boundaries && (state.tribal || state.bia || state.counties || state.places) ? [BOUNDARIES_ATTRIBUTION] : []),
    ...(config.risk && state.risk ? [RISK_ATTRIBUTION] : []),
  ];
}

// What the manifests add.

/** Facts from the archives' manifests, for the layer list and the inspector. */
export interface ReferenceInfo {
  /** Each facility type's coverage note. */
  readonly facilityCoverage?: Readonly<Record<string, string>>;
  /** Each facility source's credit, by source id. */
  readonly facilitySources?: Readonly<Record<string, string>>;
  /** The lifelines the archive holds facilities for. */
  readonly lifelines?: readonly string[];
  readonly biaDisclaimer?: string;
  /** The archive's AIANNH class codes. */
  readonly tribalClasses?: readonly string[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** Reads a facilities manifest; anything malformed is left out. */
export function readFacilitiesManifest(value: unknown): ReferenceInfo {
  const types = Object.entries(record(record(value).types)).map(([type, entry]) => [type, record(entry)] as const);
  const sources = Array.isArray(record(value).sources) ? record(value).sources as unknown[] : [];
  return {
    facilityCoverage: Object.fromEntries(types.flatMap(([type, entry]) => {
      const coverage = string(entry.coverage);
      return coverage ? [[type, coverage]] : [];
    })),
    facilitySources: Object.fromEntries(sources.flatMap((source) => {
      const id = string(record(source).id);
      const credit = string(record(source).attribution);
      return id && credit ? [[id, credit]] : [];
    })),
    lifelines: [...new Set(types.flatMap(([, entry]) => {
      const lifeline = string(entry.lifeline);
      return lifeline && typeof entry.count === "number" && entry.count > 0 ? [lifeline] : [];
    }))],
  };
}

/** Reads a boundaries manifest; anything malformed is left out. */
export function readBoundariesManifest(value: unknown): ReferenceInfo {
  const biaDisclaimer = string(record(value).biaDisclaimer);
  return {
    ...(biaDisclaimer ? { biaDisclaimer } : {}),
    tribalClasses: Object.keys(record(record(record(value).aiannhClasses).byClass)),
  };
}

// Legends.

export interface ReferenceLegend {
  readonly id: string;
  readonly title: string;
  /** How each row's patch draws: an icon square, an area or a line. */
  readonly patch: "square" | "area" | "line";
  readonly minzoom?: number;
  readonly maxzoom?: number;
  readonly rows: readonly Pick<PaletteLegendEntry, "key" | "label" | "color">[];
}

/** Legend entries for the reference layers switched on, in palette order. */
export function referenceLegends(
  config: ReferenceLayersConfig | undefined,
  state: ReferenceState,
  theme: ThemeName,
  info: ReferenceInfo = {},
): ReferenceLegend[] {
  if (!config) return [];
  const out: ReferenceLegend[] = [];
  const held = (lifeline: string) => !info.lifelines || info.lifelines.includes(lifeline);
  const lifelines = LIFELINES.filter((lifeline) => state.lifelines[lifeline] && held(lifeline));
  if (config.facilities && lifelines.length > 0) {
    out.push({ id: "facilities", title: "Critical facilities by lifeline", patch: "square", minzoom: 6, rows: paletteLegend(LIFELINE_CATEGORY_PALETTE, theme, lifelines) });
  }
  if (config.boundaries) {
    const ink = INK[theme];
    if (state.tribal) {
      const present = info.tribalClasses?.flatMap((code) => TRIBAL_CLASS[code] ?? []);
      out.push({ id: "tribal", title: "Tribal areas (Census)", patch: "area", minzoom: 5, rows: paletteLegend(AIANNH_PALETTE, theme, present) });
    }
    if (state.bia) out.push({ id: "bia", title: "BIA land areas", patch: "area", minzoom: 5, rows: [{ key: "bia", label: "Land area representation", color: BIA_FILL }] });
    if (state.counties) out.push({ id: "counties", title: "Counties", patch: "line", rows: [{ key: "county", label: "County boundary", color: ink.county }] });
    if (state.places) out.push({ id: "places", title: "Cities and places", patch: "line", minzoom: 8, rows: [{ key: "place", label: "City or census place", color: ink.place }] });
  }
  const choice = RISK_LAYERS.find((layer) => layer.id === state.risk);
  if (config.risk && choice) {
    out.push(choice.id === "svi"
      ? { id: "svi", title: "Social vulnerability (CDC/ATSDR SVI)", patch: "area", minzoom: 4, rows: paletteLegend(SVI_QUARTILE_PALETTE, theme) }
      : { id: "nri", title: `National Risk Index: ${choice.title.toLowerCase()}`, patch: "area", minzoom: 4, rows: paletteLegend(NRI_RATING_PALETTE, theme) });
  }
  return out;
}

// The inspector.

const OSM_CREDIT = "© OpenStreetMap contributors (ODbL)";
const NRI_FIELDS: readonly (readonly [string, string])[] = [
  ["EAL_RATNG", "Expected annual loss"],
  ["SOVI_RATNG", "Social vulnerability"],
  ["RESL_RATNG", "Community resilience"],
];
const SVI_THEMES: readonly (readonly [string, string])[] = [
  ["RPL_THEME1", "Socioeconomic status"],
  ["RPL_THEME2", "Household characteristics"],
  ["RPL_THEME3", "Racial and ethnic minority status"],
  ["RPL_THEME4", "Housing type and transportation"],
];

const isIconId = (value: string): value is IconId => (ICON_IDS as readonly string[]).includes(value);

/**
 * The inspector's view of a reference feature, with Esri's critical
 * infrastructure fields for a facility; undefined for any other layer.
 */
export function referenceInspection(
  layerId: string,
  properties: Record<string, unknown>,
  state: ReferenceState,
  info: ReferenceInfo = {},
): CopInspection | undefined {
  const text = (key: string) => string(properties[key]);
  const number = (key: string) => (typeof properties[key] === "number" && Number.isFinite(properties[key]) ? properties[key] as number : undefined);
  const rows = (pairs: readonly (readonly [string, string | undefined])[]) =>
    pairs.flatMap(([label, value]) => (value ? [{ label, value }] : []));
  const freshness = "Static reference data";
  if (layerId === REFERENCE_LAYER.facilities || layerId === REFERENCE_LAYER.keyFacilities || layerId === REFERENCE_LAYER.keyFacilityNames) {
    const type = text("type");
    const glyph = type && isIconId(type) ? GLYPHS[type] : undefined;
    const lifeline = text("lifeline");
    const lifelineLabel = lifeline && Object.hasOwn(LIFELINE_CATEGORY_PALETTE.entries, lifeline)
      ? LIFELINE_CATEGORY_PALETTE.entries[lifeline as Lifeline].label : lifeline;
    const capacity = number("capacity");
    const source = text("source");
    return {
      title: text("name") ?? glyph?.title ?? "Critical facility",
      kind: "Critical facility",
      source: (source && info.facilitySources?.[source]) ?? source ?? "Critical facilities",
      facilityType: glyph?.title ?? type,
      freshness,
      ...(type && info.facilityCoverage?.[type] ? { coverage: info.facilityCoverage[type] } : {}),
      attribution: source === "osm" ? OSM_CREDIT : "A work of the U.S. Government, in the public domain",
      rows: rows([
        ["Name", text("name")],
        ["Type", glyph?.title ?? type],
        ["Subtype", text("subtype")],
        ["Sector", text("sector")],
        ["Lifeline", lifelineLabel],
        ["Address", text("address")],
        ["City", text("city")],
        ["County", text("county")],
        ["Phone", text("phone")],
        ["Operator", text("operator")],
        ["Capacity", capacity === undefined ? undefined : `${capacity.toLocaleString()}${text("capacity_unit") ? ` ${text("capacity_unit")}` : ""}`],
        ["Source record", text("source_id")],
      ]),
    };
  }
  if (layerId === REFERENCE_LAYER.tribalFill) {
    return {
      title: text("namelsad") ?? text("name") ?? "Tribal area",
      kind: "Tribal area",
      source: "U.S. Census Bureau TIGER/Line, American Indian, Alaska Native and Native Hawaiian Areas",
      freshness,
      attribution: "U.S. Census Bureau TIGER/Line, public domain",
      rows: rows([["Name", text("name")], ["Class", text("class_label")], ["Census class code", text("classfp")], ["GEOID", text("geoid")]]),
    };
  }
  if (layerId === REFERENCE_LAYER.biaFill) {
    const acres = number("gisacres");
    return {
      title: text("larname") ?? "BIA land area",
      kind: "BIA land area representation",
      source: "Bureau of Indian Affairs, AIAN Land Area Representations",
      freshness,
      coverage: BIA_NOTE,
      attribution: "Bureau of Indian Affairs, Office of Trust Services, Branch of Geospatial Support",
      rows: rows([
        ["Name", text("larname")],
        ["Classification", text("classification")],
        ["Area", acres === undefined ? undefined : `${Math.round(acres).toLocaleString()} acres`],
        ["BIA region", text("region")],
        ["LAR id", text("larid")],
      ]),
    };
  }
  const risk = /^ref-(nri|svi)-(counties|tracts)-fill$/.exec(layerId);
  if (!risk) return undefined;
  const county = text("county");
  const name = text("name");
  const title = risk[2] === "counties" ? `${county ?? name ?? "County"} County` : [name, county && `${county} County`].filter(Boolean).join(", ");
  if (risk[1] === "svi") {
    const percentile = (key: string) => {
      const value = number(key);
      return value === undefined ? undefined : value.toFixed(4);
    };
    const overall = number("RPL_THEMES");
    const quartile = overall === undefined ? undefined : paletteLegend(SVI_QUARTILE_PALETTE, "light").filter((entry) => overall >= (entry.min ?? 0)).at(-1)?.label;
    return {
      title,
      kind: "Social Vulnerability Index",
      source: "CDC/ATSDR Social Vulnerability Index, national percentile ranks",
      freshness,
      coverage: RISK_NOTE,
      attribution: CDC_SVI_CREDIT,
      rows: rows([
        ["Overall percentile", overall === undefined ? undefined : `${percentile("RPL_THEMES")}${quartile ? ` (${quartile})` : ""}`],
        ...SVI_THEMES.map(([key, label]) => [label, percentile(key)] as const),
      ]),
    };
  }
  const choice = RISK_LAYERS.find((layer) => layer.id === state.risk && layer.id !== "svi") ?? RISK_LAYERS[0];
  const score = number("RISK_SCORE");
  const hazards = RISK_LAYERS.filter((layer) => layer.id !== "svi" && layer.id !== "nri" && layer.id !== choice.id);
  return {
    title,
    kind: "National Risk Index",
    source: "FEMA National Risk Index",
    freshness,
    coverage: RISK_NOTE,
    attribution: `FEMA National Risk Index. ${FEMA_NRI_STATEMENT}`,
    rows: rows([
      [`${choice.title} rating`, text(choice.field)],
      ["Composite risk score", score === undefined ? undefined : `${score} of 100`],
      ...(choice.id === "nri" ? [] : [["Composite risk rating", text("RISK_RATNG")] as const]),
      ...NRI_FIELDS.map(([key, label]) => [label, text(key)] as const),
      ...hazards.map((layer) => [`${layer.title} rating`, text(layer.field)] as const),
    ]),
  };
}
