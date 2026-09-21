import { themes, type ThemeName } from "../design/tokens.js";
import { statusColorExpression, symbolStatusFor } from "./symbology.js";
import { basemapBackground, naturalEarthLayers, naturalEarthSources } from "./basemap.js";
import { labelFor } from "./tools.js";
import { statusPatternExpression } from "./hazards.js";
import { facilityIconExpression, facilityTypeFor } from "./facilities.js";

/**
 * COP layer construction: pure functions from board data to MapLibre
 * specs, testable without a GPU. One GeoJSON source per board; three
 * layers (fill, line, circle) so any geometry kind renders; visibility
 * toggles flip the layers, never the data.
 */

export interface CopFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry: unknown;
  readonly properties: Record<string, unknown>;
}

export interface CopFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly CopFeature[];
}

/**
 * Tag features with their status frame and display label so paint and
 * layout expressions stay static.
 */
export function tagFeatures(fc: CopFeatureCollection): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _symbolStatus: symbolStatusFor(f.properties),
        _facilityType: facilityTypeFor(f.properties),
        _label: labelFor(f.properties),
      },
    })),
  };
}

export function sourceId(boardId: string): string {
  return `board-${boardId}`;
}

export function boardLayerIds(boardId: string): string[] {
  const src = sourceId(boardId);
  return [`${src}-fill`, `${src}-hatch`, `${src}-line`, `${src}-point`, `${src}-facility-icon`, `${src}-label`];
}

/**
 * The layers for one board. The label layer needs a glyph stack, which the
 * active basemap style provides; with no font (an external style whose
 * fonts are unknown) the label layer is left out and the map stays quiet
 * rather than logging a glyph error per tile.
 */
export function boardLayerSpecs(boardId: string, theme: ThemeName, labelFont?: string): unknown[] {
  const src = sourceId(boardId);
  const color = statusColorExpression(theme);
  const label = labelFont
    ? [
        {
          id: `${src}-label`,
          type: "symbol",
          source: src,
          minzoom: 9,
          layout: {
            "text-field": ["get", "_label"],
            "text-font": [labelFont],
            "text-size": 11,
            "text-anchor": "top",
            "text-offset": [
              "case",
              ["has", "_facilityType"],
              ["literal", [0, 2.2]],
              ["literal", [0, 0.9]],
            ],
            "text-optional": true,
          },
          paint: {
            "text-color": themes[theme].text,
            "text-halo-color": themes[theme].surface,
            "text-halo-width": 1.2,
          },
        },
      ]
    : [];
  return [
    {
      id: `${src}-fill`,
      type: "fill",
      source: src,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": 0.25 },
    },
    {
      id: `${src}-hatch`,
      type: "fill",
      source: src,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-pattern": statusPatternExpression(theme), "fill-opacity": 0.75 },
    },
    {
      id: `${src}-line`,
      type: "line",
      source: src,
      filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
      paint: { "line-color": color, "line-width": 3 },
    },
    {
      id: `${src}-point`,
      type: "circle",
      source: src,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": color,
        "circle-radius": ["case", ["has", "_facilityType"], 18, 7],
        "circle-stroke-width": 2,
        "circle-stroke-color": themes[theme].surface,
      },
    },
    {
      id: `${src}-facility-icon`,
      type: "symbol",
      source: src,
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["has", "_facilityType"],
      ],
      layout: {
        "icon-image": facilityIconExpression(),
        "icon-size": 0.25,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    ...label,
  ];
}

/** The COP base map: bundled Natural Earth, or a plain canvas as a floor. */
export type BasemapConfig = { readonly kind: "natural-earth"; readonly assetBase: string };

/**
 * A raster tile set offered in the basemap gallery: imagery, topo, or an
 * overlay such as hydrography. Rasters mount hidden above the vector basemap
 * and below the operational layers; the operator picks one basemap and any
 * overlays. A deployment provides the URLs (self-hosted keeps the COP offline;
 * a public service is the deployment's choice).
 */
export interface RasterBasemap {
  readonly id: string;
  readonly title: string;
  /** XYZ tile template. */
  readonly tiles: string;
  readonly attribution?: string | undefined;
  /** Overlays draw over the chosen basemap and toggle independently. */
  readonly overlay?: boolean | undefined;
}

export function rasterLayerId(id: string): string {
  return `raster-${id}`;
}

/** Hidden raster sources and layers for the gallery, in gallery order. */
export function rasterBasemapSpecs(rasters: readonly RasterBasemap[]): {
  sources: Record<string, unknown>;
  layers: unknown[];
} {
  const sources: Record<string, unknown> = {};
  const layers: unknown[] = [];
  // Basemaps first, then overlays, so an overlay always draws over the basemap.
  for (const r of [...rasters].sort((a, b) => Number(!!a.overlay) - Number(!!b.overlay))) {
    const id = rasterLayerId(r.id);
    sources[id] = {
      type: "raster",
      tiles: [r.tiles],
      tileSize: 256,
      ...(r.attribution ? { attribution: r.attribution } : {}),
    };
    layers.push({ id, type: "raster", source: id, layout: { visibility: "none" }, paint: {} });
  }
  return { sources, layers };
}

/**
 * A raster DEM tile set for hillshade and 3D terrain. Terrarium encoding is
 * what the public-domain AWS Open Data elevation tiles use; a deployment can
 * mirror them into PMTiles for an air-gapped install.
 */
export interface TerrainSource {
  readonly tiles: string;
  readonly encoding: "terrarium" | "mapbox";
  readonly attribution?: string | undefined;
  readonly maxzoom?: number | undefined;
}

export const DEM_SOURCE_ID = "dem";
export const HILLSHADE_LAYER_ID = "hillshade";

/**
 * The DEM source and a hidden hillshade layer over it. The same source feeds
 * MapLibre's 3D terrain control. Shading is faint and themed so it reads as
 * relief, never as a status color (INV-8).
 */
export function terrainSpecs(
  terrain: TerrainSource | undefined,
  theme: ThemeName,
): { sources: Record<string, unknown>; layers: unknown[] } {
  if (!terrain) return { sources: {}, layers: [] };
  const dark = theme === "dark";
  return {
    sources: {
      [DEM_SOURCE_ID]: {
        type: "raster-dem",
        tiles: [terrain.tiles],
        encoding: terrain.encoding,
        tileSize: 256,
        maxzoom: terrain.maxzoom ?? 15,
        ...(terrain.attribution ? { attribution: terrain.attribution } : {}),
      },
    },
    layers: [
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: DEM_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "hillshade-exaggeration": dark ? 0.5 : 0.35,
          "hillshade-shadow-color": dark ? "#000000" : "#4b5563",
          "hillshade-highlight-color": dark ? "#6b7280" : "#ffffff",
          "hillshade-accent-color": dark ? "#000000" : "#4b5563",
        },
      },
    ],
  };
}

/**
 * Building use, from the OpenStreetMap building tag carried as `class` by
 * the buildings archive (deploy/basemap/buildings-schema.yml). The commercial
 * COPs delineate structures by use; this is the free, license-clean source,
 * with untyped footprints (building=yes) left neutral over the landuse fill.
 */
export type BuildingUse =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic"
  | "religious"
  | "agricultural"
  | "other";

const BUILDING_USE_TAGS: Readonly<Record<BuildingUse, readonly string[]>> = {
  residential: [
    "house",
    "residential",
    "apartments",
    "detached",
    "semidetached_house",
    "terrace",
    "bungalow",
    "cabin",
    "dormitory",
    "static_caravan",
    "hut",
  ],
  commercial: ["commercial", "retail", "office", "supermarket", "kiosk", "hotel", "motel"],
  industrial: ["industrial", "warehouse", "manufacture", "factory", "hangar", "service", "transportation"],
  civic: [
    "civic",
    "public",
    "government",
    "school",
    "university",
    "college",
    "kindergarten",
    "hospital",
    "fire_station",
    "police",
    "train_station",
    "community_centre",
    "library",
    "townhall",
    "stadium",
    "sports_hall",
  ],
  religious: ["church", "chapel", "cathedral", "mosque", "synagogue", "temple", "religious", "shrine"],
  agricultural: ["barn", "farm", "farm_auxiliary", "greenhouse", "stable", "silo", "cowshed", "sty"],
  other: [],
};

/** The use bucket for a building tag value; unknown or plain tags are other. */
export function buildingUseOf(tag: string | undefined): BuildingUse {
  if (!tag) return "other";
  for (const [use, tags] of Object.entries(BUILDING_USE_TAGS)) {
    if (tags.includes(tag)) return use as BuildingUse;
  }
  return "other";
}

/** Use colors: muted per theme so status colors still read first (INV-8). */
export const BUILDING_USE_COLORS: Readonly<Record<ThemeName, Readonly<Record<BuildingUse, string>>>> = {
  light: {
    residential: "#d9c9a3",
    commercial: "#b9c7dd",
    industrial: "#c9bfd6",
    civic: "#b8d1c4",
    religious: "#d8c3d0",
    agricultural: "#cfd6b3",
    other: "#d4d4d0",
  },
  dark: {
    residential: "#6b5a34",
    commercial: "#3e5577",
    industrial: "#574a6e",
    civic: "#3d6b55",
    religious: "#6a4a5e",
    agricultural: "#5c6636",
    other: "#3b4046",
  },
};

export const BUILDING_USE_LEGEND: readonly { readonly id: BuildingUse; readonly title: string }[] = [
  { id: "residential", title: "Residential" },
  { id: "commercial", title: "Commercial" },
  { id: "industrial", title: "Industrial" },
  { id: "civic", title: "Civic, schools, health" },
  { id: "religious", title: "Religious" },
  { id: "agricultural", title: "Agricultural" },
  { id: "other", title: "Untyped" },
];

/** A self-hosted buildings PMTiles archive (deploy/basemap, buildings schema). */
export interface BuildingsConfig {
  readonly pmtilesUrl: string;
}

export const BUILDINGS_SOURCE_ID = "buildings";
export const BUILDING_USE_LAYER_ID = "building-use";

/** MapLibre match expression: building tag -> use color for the theme. */
function buildingUseColorExpression(theme: ThemeName): unknown[] {
  const colors = BUILDING_USE_COLORS[theme];
  const branches: unknown[] = [];
  for (const [use, tags] of Object.entries(BUILDING_USE_TAGS)) {
    if (tags.length === 0) continue;
    branches.push([...tags], colors[use as BuildingUse]);
  }
  return ["match", ["get", "class"], ...branches, colors.other];
}

/**
 * The buildings source and its layers: a fill colored by use, or by the
 * operational status a record has set on the footprint (feature state), and
 * an outline at street zoom. Footprints are keyed by osm_id so status can be
 * set per building at runtime.
 */
export function buildingSpecs(
  config: BuildingsConfig | undefined,
  theme: ThemeName,
): { sources: Record<string, unknown>; layers: unknown[] } {
  if (!config) return { sources: {}, layers: [] };
  const t = themes[theme];
  return {
    sources: {
      [BUILDINGS_SOURCE_ID]: {
        type: "vector",
        url: `pmtiles://${config.pmtilesUrl}`,
        promoteId: "osm_id",
        attribution: "Buildings: © OpenStreetMap contributors (ODbL)",
      },
    },
    layers: [
      {
        id: BUILDING_USE_LAYER_ID,
        type: "fill",
        source: BUILDINGS_SOURCE_ID,
        "source-layer": "buildings",
        minzoom: 13,
        paint: {
          "fill-color": [
            "case",
            ["==", ["coalesce", ["feature-state", "status"], ""], "critical"],
            t.statusCritical,
            ["==", ["coalesce", ["feature-state", "status"], ""], "warning"],
            t.statusWarning,
            ["==", ["coalesce", ["feature-state", "status"], ""], "normal"],
            t.statusSuccess,
            buildingUseColorExpression(theme),
          ],
          "fill-opacity": ["case", ["to-boolean", ["feature-state", "status"]], 0.85, 0.75],
        },
      },
      {
        id: "building-outline",
        type: "line",
        source: BUILDINGS_SOURCE_ID,
        "source-layer": "buildings",
        minzoom: 15,
        paint: { "line-color": t.border, "line-width": 0.5, "line-opacity": 0.6 },
      },
    ],
  };
}

/**
 * Basemap layer groups. Every basemap layer belongs to one group so the
 * operator can switch any part of the base map off (buildings, roads, labels,
 * and so on) the same way as an operational layer. The group rides on the
 * layer's metadata, which MapLibre preserves, so CopMap discovers the groups
 * present in whichever style is active.
 */
export type BasemapGroup =
  | "land"
  | "water"
  | "buildings"
  | "roads"
  | "rail"
  | "airfields"
  | "boundaries"
  | "labels"
  | "facilities";

export const BASEMAP_GROUPS: readonly { readonly id: BasemapGroup; readonly title: string }[] = [
  { id: "land", title: "Land cover and use" },
  { id: "water", title: "Water" },
  { id: "buildings", title: "Buildings" },
  { id: "roads", title: "Roads" },
  { id: "rail", title: "Rail" },
  { id: "airfields", title: "Airfields" },
  { id: "boundaries", title: "Boundaries" },
  { id: "labels", title: "Labels" },
  { id: "facilities", title: "Critical facilities" },
];

const GROUP_KEY = "openeoc:group";

const GROUP_BY_LAYER: Readonly<Record<string, BasemapGroup>> = {
  // Bundled Natural Earth vector basemap.
  land: "land",
  urban: "land",
  water: "water",
  rivers: "water",
  counties: "boundaries",
  "roads-casing": "roads",
  "roads-minor": "roads",
  "roads-major": "roads",
  "place-dots": "labels",
  "road-label": "labels",
  "place-label": "labels",
  // Self-hosted OpenStreetMap street basemap.
  landcover: "land",
  landuse: "land",
  "landuse-park": "land",
  waterway: "water",
  "aeroway-area": "airfields",
  "aeroway-line": "airfields",
  building: "buildings",
  "building-use": "buildings",
  "building-outline": "buildings",
  rail: "rail",
  "road-casing": "roads",
  "road-minor": "roads",
  "road-major": "roads",
  "boundary-admin": "boundaries",
  "water-label": "labels",
  "water-label-line": "labels",
  "peak-label": "labels",
  "facility-label": "facilities",
  // Fallback GeoJSON canvas.
  "ne-land": "land",
  "ne-coast": "land",
  "ca-counties-fill": "land",
  "ne-lakes": "water",
  "ne-rivers": "water",
  "ca-counties-line": "boundaries",
  "ne-admin1": "boundaries",
  "ne-admin0": "boundaries",
  "ca-state-outline": "boundaries",
};

/** Stamp each known basemap layer with its group. Unknown ids pass through. */
export function withBasemapGroups(layers: readonly unknown[]): unknown[] {
  return layers.map((layer) => {
    const l = layer as { id?: string; metadata?: Record<string, unknown> };
    const group = l.id ? GROUP_BY_LAYER[l.id] : undefined;
    return group ? { ...l, metadata: { ...(l.metadata ?? {}), [GROUP_KEY]: group } } : layer;
  });
}

/** The group a rendered layer belongs to, if it is a basemap layer. */
export function basemapGroupOf(layer: { readonly metadata?: unknown }): BasemapGroup | undefined {
  const m = layer.metadata as Record<string, unknown> | undefined;
  const g = m?.[GROUP_KEY];
  return typeof g === "string" ? (g as BasemapGroup) : undefined;
}

/**
 * The base style. With the bundled basemap it is a calm land/water canvas
 * that renders with zero external network (INV-3); without it, a neutral
 * background floor. Board layers mount on top at runtime, so the basemap
 * never blocks the COP. A deployment's own MapLibre style replaces this
 * entirely (handled by the caller), for street-level detail.
 */
export function buildCopStyle(
  theme: ThemeName,
  basemap?: BasemapConfig,
  rasters: readonly RasterBasemap[] = [],
  terrain?: TerrainSource,
): Record<string, unknown> {
  const t = themes[theme];
  const bg = basemap?.kind === "natural-earth" ? basemapBackground(theme) : t.surfaceRaised;
  const sources: Record<string, unknown> = {};
  const layers: unknown[] = [
    { id: "background", type: "background", paint: { "background-color": bg } },
  ];
  // The bundled glyph stack ships next to the basemap assets, so feature
  // labels render on this fallback canvas too.
  const glyphs =
    basemap?.kind === "natural-earth" ? `${basemap.assetBase}fonts/{fontstack}/{range}.pbf` : undefined;
  if (basemap?.kind === "natural-earth") {
    Object.assign(sources, naturalEarthSources(basemap.assetBase));
    layers.push(...naturalEarthLayers(theme));
  }
  const relief = terrainSpecs(terrain, theme);
  Object.assign(sources, relief.sources);
  layers.push(...relief.layers);
  const raster = rasterBasemapSpecs(rasters);
  Object.assign(sources, raster.sources);
  layers.push(...raster.layers);
  return { version: 8, ...(glyphs ? { glyphs } : {}), sources, layers: withBasemapGroups(layers) };
}
