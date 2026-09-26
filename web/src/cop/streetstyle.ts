import type { ThemeName } from "../design/tokens.js";
import { BUNDLED_FONT_STACK } from "./bundledbasemap.js";
import { STREET_FACILITY_TYPES, streetFacilityIconExpression } from "./facilities.js";
import {
  buildingSpecs,
  IMAGERY_WATER_LAYER_ID,
  rasterBasemapSpecs,
  terrainSpecs,
  withBasemapGroups,
  type BuildingsConfig,
  type RasterBasemap,
  type TerrainSource,
} from "./layers.js";

/**
 * A themed MapLibre street style over a self-hosted OpenMapTiles-schema PMTiles
 * source. This is what turns the COP into a real street map: roads by
 * class, water, boundaries, buildings, and place and road labels, all served
 * from a deployment's own `california.pmtiles` with a self-hosted glyph stack,
 * so the map stays offline-capable and license-clean (OpenStreetMap, ODbL). The
 * tiles are produced by tools/basemap; this module only builds the style that
 * renders them. Operational layers mount on top at runtime, unchanged.
 *
 * The palette stays deliberately calm (color reserved for operational status,
 * INV-8): muted land and water, gray roads, low-contrast labels, so incident
 * symbology always reads first.
 */

export interface StreetBasemapConfig {
  /** URL of the OpenMapTiles-schema PMTiles archive (pmtiles:// is added here). */
  readonly pmtilesUrl: string;
  /** URL template for the glyph (font) PBF ranges; the app's bundled stack
   * by default, so a deployment needs only the PMTiles URL. */
  readonly glyphsUrl: string;
  /** The font stack name inside that glyph URL (default: the bundled one). */
  readonly fontStack?: string | undefined;
  /** Optional sprite base URL for icons (labels render without it). */
  readonly spriteUrl?: string | undefined;
}

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

/**
 * Line colors while an imagery basemap shows: light roads over a dark casing,
 * as on a hybrid map, and tribal boundaries light enough to read over imagery.
 */
export const IMAGERY_ROAD_INK: Readonly<Record<string, string>> = {
  "road-casing": "rgba(15, 20, 26, 0.45)",
  "road-minor": "rgba(226, 232, 238, 0.4)",
  "road-major": "rgba(238, 242, 246, 0.75)",
  "boundary-tribal": "rgba(244, 212, 156, 0.95)",
};

/** The font stack the street style's labels request. */
export function streetFontStack(config: Pick<StreetBasemapConfig, "fontStack">): string {
  return config.fontStack || BUNDLED_FONT_STACK;
}

interface StreetPalette {
  readonly background: string;
  readonly water: string;
  readonly waterway: string;
  readonly park: string;
  readonly building: string;
  readonly boundary: string;
  readonly tribal: string;
  readonly tribalLabel: string;
  readonly roadMinor: string;
  readonly roadMajor: string;
  readonly roadCasing: string;
  readonly label: string;
  readonly labelHalo: string;
  readonly wood: string;
  readonly grass: string;
  readonly wetland: string;
  readonly residential: string;
  readonly industrial: string;
  readonly civic: string;
  readonly rail: string;
  readonly aeroway: string;
  readonly waterLabel: string;
  readonly peak: string;
}

const PALETTE: Record<ThemeName, StreetPalette> = {
  // The light frame's terrain map: green land shaded by relief, a clear blue sea.
  light: {
    background: "#dfe8cf",
    water: "#9fc8e6",
    waterway: "#86b6dc",
    park: "#cfe0bd",
    building: "#e3e0da",
    boundary: "#b3939f",
    tribal: "#8a5423",
    tribalLabel: "#6b3f12",
    roadMinor: "#ffffff",
    roadMajor: "#f4e6c6",
    roadCasing: "#c9cfc2",
    label: "#2f3a33",
    labelHalo: "#f4f7ee",
    wood: "#c3d8ae",
    grass: "#d6e4c4",
    wetland: "#cfe0d8",
    residential: "#e6e6de",
    industrial: "#e1dfe0",
    civic: "#e9e1da",
    rail: "#b7bcc2",
    aeroway: "#d8dcd2",
    waterLabel: "#2f5d86",
    peak: "#4c5a4e",
  },
  dark: {
    background: "#14181b",
    water: "#0f2231",
    waterway: "#123146",
    park: "#16231a",
    building: "#20262b",
    boundary: "#5a3f49",
    tribal: "#b88d57",
    tribalLabel: "#d8b688",
    roadMinor: "#2b3138",
    roadMajor: "#3d3626",
    roadCasing: "#0e1114",
    label: "#c6ccd2",
    labelHalo: "#0d1013",
    wood: "#17201a",
    grass: "#1a221c",
    wetland: "#152023",
    residential: "#1a1e22",
    industrial: "#1e1d23",
    civic: "#231f1f",
    rail: "#4a5158",
    aeroway: "#272c31",
    waterLabel: "#7d9bb5",
    peak: "#9aa1a8",
  },
}

/**
 * OpenStreetMap tags (the OpenMapTiles poi subclass) for the facilities an
 * EOC opens, staffs, or protects, labeled on the street basemap.
 */
export const CRITICAL_FACILITY_TAGS = [
  "hospital",
  "clinic",
  "fire_station",
  "police",
  "school",
  "college",
  "university",
  "community_centre",
  "townhall",
  "shelter",
  "place_of_worship",
  "stadium",
  "airport",
  "helipad",
] as const;

/** Interpolate a line width across zoom for a road class. */
function width(stops: [number, number][]): unknown {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()];
}

/** Build the vector street style for a self-hosted OpenMapTiles PMTiles source. */
export function buildStreetStyle(
  config: StreetBasemapConfig,
  theme: ThemeName,
  rasters: readonly RasterBasemap[] = [],
  terrain?: TerrainSource,
  buildings?: BuildingsConfig,
): Record<string, unknown> {
  const p = PALETTE[theme];
  const src = "openmaptiles";
  const font = streetFontStack(config);
  // Typed, status-colorable footprints draw over the plain building fill and
  // over imagery, as on a hybrid map.
  const built = buildingSpecs(buildings, theme);
  // Hillshade sits over the land fills and under water, roads, and labels.
  const relief = terrainSpecs(terrain, theme);
  const raster = rasterBasemapSpecs(rasters);
  const layers: unknown[] = [
    { id: "background", type: "background", paint: { "background-color": p.background } },
    // Landcover and landuse first: the wildland-urban context an EOC reads
    // fire, flood, and evacuation planning against.
    {
      id: "landcover",
      type: "fill",
      source: src,
      "source-layer": "landcover",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "wood",
          p.wood,
          "wetland",
          p.wetland,
          p.grass,
        ],
        "fill-opacity": 0.7,
      },
    },
    {
      id: "landuse",
      type: "fill",
      source: src,
      "source-layer": "landuse",
      filter: [
        "in",
        ["get", "class"],
        [
          "literal",
          ["residential", "commercial", "retail", "industrial", "hospital", "school", "university", "college"],
        ],
      ],
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "residential",
          p.residential,
          ["hospital", "school", "university", "college"],
          p.civic,
          p.industrial,
        ],
        "fill-opacity": 0.6,
      },
    },
    {
      id: "landuse-park",
      type: "fill",
      source: src,
      "source-layer": "park",
      paint: { "fill-color": p.park, "fill-opacity": 0.6 },
    },
    ...relief.layers,
    {
      id: "water",
      type: "fill",
      source: src,
      "source-layer": "water",
      paint: { "fill-color": p.water },
    },
    {
      id: "waterway",
      type: "line",
      source: src,
      "source-layer": "waterway",
      paint: { "line-color": p.waterway, "line-width": width([[8, 0.5], [16, 2]]) },
    },
    // Airfields: runways and taxiways are staging and evacuation assets.
    {
      id: "aeroway-area",
      type: "fill",
      source: src,
      "source-layer": "aeroway",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": p.aeroway, "fill-opacity": 0.8 },
    },
    {
      id: "aeroway-line",
      type: "line",
      source: src,
      "source-layer": "aeroway",
      filter: ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]],
      paint: {
        "line-color": p.aeroway,
        // One zoom curve, runway or taxiway width at each stop (MapLibre allows
        // a single zoom interpolation per expression).
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["case", ["==", ["get", "class"], "runway"], 1, 0.5],
          16,
          ["case", ["==", ["get", "class"], "runway"], 12, 4],
        ],
      },
    },
    {
      id: "building",
      type: "fill",
      source: src,
      "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": p.building, "fill-opacity": 0.7 },
    },
    ...raster.layers,
    ...(raster.layers.length > 0
      ? [{
          id: IMAGERY_WATER_LAYER_ID,
          type: "fill",
          source: src,
          "source-layer": "water",
          layout: { visibility: "none" },
          paint: { "fill-color": p.water, "fill-opacity": 0.82 },
        }]
      : []),
    ...built.layers,
    {
      id: "rail",
      type: "line",
      source: src,
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["rail", "transit"]]],
      paint: {
        "line-color": p.rail,
        "line-width": width([[8, 0.5], [14, 1.5], [18, 3]]),
        "line-dasharray": [4, 2],
      },
    },
    // Road casing then fill, minor then major, so majors draw on top.
    {
      id: "road-casing",
      type: "line",
      source: src,
      "source-layer": "transportation",
      paint: {
        "line-color": p.roadCasing,
        "line-width": width([[8, 1], [14, 4], [18, 20]]),
      },
    },
    {
      id: "road-minor",
      type: "line",
      source: src,
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]],
      paint: { "line-color": p.roadMinor, "line-width": width([[12, 0.5], [16, 3], [18, 12]]) },
    },
    {
      id: "road-major",
      type: "line",
      source: src,
      "source-layer": "transportation",
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]],
      ],
      paint: { "line-color": p.roadMajor, "line-width": width([[6, 0.5], [12, 3], [18, 18]]) },
    },
    {
      id: "boundary-admin",
      type: "line",
      source: src,
      "source-layer": "boundary",
      // Tribal lands in this layer carry no admin level and have a line of their own.
      filter: ["all", ["has", "admin_level"], ["<=", ["get", "admin_level"], 6]],
      paint: { "line-color": p.boundary, "line-width": width([[4, 0.5], [12, 1.5]]), "line-dasharray": [3, 2] },
    },
    // Tribal lands (reservations and rancherias, OpenMapTiles aboriginal_lands areas).
    {
      id: "boundary-tribal",
      type: "line",
      source: src,
      "source-layer": "boundary",
      filter: ["==", ["get", "class"], "aboriginal_lands"],
      paint: { "line-color": p.tribal, "line-width": width([[6, 1.2], [12, 2.6]]), "line-dasharray": [4, 2] },
    },
  ];

  // Labels require a glyph stack. With one configured, add road and place
  // labels; without, the map still renders every geometry, just unlabeled.
  if (config.glyphsUrl) {
    layers.push(
      {
        id: "road-label",
        type: "symbol",
        source: src,
        "source-layer": "transportation_name",
        minzoom: 12,
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name"], ["get", "ref"]],
          "text-font": [font],
          "text-size": 11,
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
      },
      // The tribe's name inside its lands, from county to town zoom.
      {
        id: "boundary-tribal-label",
        type: "symbol",
        source: src,
        "source-layer": "boundary",
        minzoom: 8,
        maxzoom: 14,
        filter: ["all", ["==", ["get", "class"], "aboriginal_lands"], ["has", "name"]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": [font],
          "text-size": 12,
          "text-max-width": 9,
          // Each tile places its own label; one near a tile edge would be cut.
          "symbol-avoid-edges": true,
        },
        paint: { "text-color": p.tribalLabel, "text-halo-color": p.labelHalo, "text-halo-width": 1.4 },
      },
      {
        id: "place-label",
        type: "symbol",
        source: src,
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet"]]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": [font],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 16],
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.4 },
      },
      // Water names: lakes and bays as point labels, rivers along the line
      // (symbol placement cannot vary per feature, so two layers).
      {
        id: "water-label",
        type: "symbol",
        source: src,
        "source-layer": "water_name",
        minzoom: 9,
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "name"], "text-font": [font], "text-size": 11 },
        paint: { "text-color": p.waterLabel, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "water-label-line",
        type: "symbol",
        source: src,
        "source-layer": "water_name",
        minzoom: 9,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": [font],
          "text-size": 11,
        },
        paint: { "text-color": p.waterLabel, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "peak-label",
        type: "symbol",
        source: src,
        "source-layer": "mountain_peak",
        minzoom: 11,
        filter: ["has", "name"],
        layout: {
          "text-field": [
            "case",
            ["has", "ele"],
            ["concat", ["get", "name"], "\n", ["to-string", ["round", ["*", ["get", "ele"], 3.28084]]], " ft"],
            ["get", "name"],
          ],
          "text-font": [font],
          "text-size": 10,
          "text-anchor": "top",
          "text-offset": [0, 0.4],
        },
        paint: { "text-color": p.peak, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
      },
      // Critical facilities by OSM tag. Only source-specific subclasses with
      // unambiguous meanings receive a licensed NAPSG icon; broader tags keep
      // their useful text label without being relabeled as another type.
      {
        id: "facility-label",
        type: "symbol",
        source: src,
        "source-layer": "poi",
        // The basemap holds these points from z14.
        minzoom: 14,
        // An unnamed fire station still gets its icon; only the text needs a name.
        filter: ["in", ["get", "subclass"], ["literal", CRITICAL_FACILITY_TAGS]],
        layout: {
          "icon-image": streetFacilityIconExpression(),
          "icon-size": 0.25,
          "icon-optional": true,
          "text-field": ["coalesce", ["get", "name"], ""],
          "text-font": [font],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [
            "case",
            ["in", ["get", "subclass"], ["literal", Object.keys(STREET_FACILITY_TYPES)]],
            ["literal", [0, 2.1]],
            ["literal", [0, 0.3]],
          ],
          "text-optional": true,
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.4 },
      },
    );
  }

  // Raster overlays: hidden until chosen; above the street map, below the
  // runtime operational layers.
  layers.push(...raster.overlays);
  const style: Record<string, unknown> = {
    version: 8,
    glyphs: config.glyphsUrl,
    sources: {
      [src]: {
        type: "vector",
        url: `pmtiles://${config.pmtilesUrl}`,
        attribution: OSM_ATTRIBUTION,
      },
      ...raster.sources,
      ...relief.sources,
      ...built.sources,
    },
    layers: withBasemapGroups(layers),
  };
  if (config.spriteUrl) style["sprite"] = config.spriteUrl;
  return style;
}
