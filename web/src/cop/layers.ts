import { themes, type ThemeName } from "../design/tokens.js";
import { statusColorExpression, symbolStatusExpression, symbolStatusFor } from "./symbology.js";
import { basemapBackground, naturalEarthLayers, naturalEarthSources } from "./basemap.js";
import { labelExpression, labelFor } from "./tools.js";
import { statusPatternExpression } from "./hazards.js";
import { facilityIconExpression, facilityTypeExpression, facilityTypeFor } from "./facilities.js";

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
  /** OGC API paging links; a `next` link means the layer is past one page. */
  readonly links?: readonly { readonly rel: string }[] | undefined;
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
        _featureId: f.id,
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

/** Source layers in an operational vector tile (server/src/geo/tiles.ts). */
export const TILE_FEATURES_LAYER = "features";
export const TILE_CLUSTERS_LAYER = "clusters";

/**
 * The vector-tile form of a layer's GeoJSON specs. Tiles carry raw record
 * fields, so the tags tagFeatures precomputes become expressions over those
 * fields, and server-side clusters get a neutral count marker that never
 * reads as a status (INV-8). A stale feed keeps every feature in the unknown
 * frame, as tagFeedFeatures does.
 */
export function tileLayerSpecs(
  specs: readonly unknown[],
  src: string,
  theme: ThemeName,
  labelFont?: string,
  stale = false,
): unknown[] {
  const tags = new Map<string, unknown>([
    ["_symbolStatus", stale ? "unknown" : symbolStatusExpression()],
    ["_facilityType", facilityTypeExpression()],
    ["_label", labelExpression()],
  ]);
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const [op, key] = value as unknown[];
      if (value.length === 2 && typeof key === "string" && tags.has(key)) {
        if (op === "get") return tags.get(key);
        if (op === "has") return ["!=", tags.get(key), ""];
      }
      return value.map(rewrite);
    }
    return value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
      : value;
  };
  const t = themes[theme];
  const count = labelFont
    ? [{
        id: `${src}-cluster-count`,
        type: "symbol",
        source: src,
        "source-layer": TILE_CLUSTERS_LAYER,
        layout: {
          "text-field": ["to-string", ["get", "point_count"]],
          "text-font": [labelFont],
          "text-size": 11,
          "text-allow-overlap": true,
        },
        paint: { "text-color": t.text },
      }]
    : [];
  return [
    ...specs.map((spec) => ({ ...(rewrite(spec) as object), "source-layer": TILE_FEATURES_LAYER })),
    {
      id: `${src}-cluster`,
      type: "circle",
      source: src,
      "source-layer": TILE_CLUSTERS_LAYER,
      paint: {
        "circle-color": t.surface,
        "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 10, 100, 16, 1000, 24],
        "circle-stroke-width": 2,
        "circle-stroke-color": t.text,
      },
    },
    ...count,
  ];
}

const OPACITY_PAINT: Readonly<Record<string, readonly string[]>> = {
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  circle: ["circle-opacity", "circle-stroke-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
};

/** A layer's opacity paint scaled by the operator's layer opacity (0 to 1). */
export function opacityPaint(spec: unknown, factor: number): Record<string, number> {
  const s = spec as { type: string; paint?: Record<string, unknown> };
  return Object.fromEntries((OPACITY_PAINT[s.type] ?? []).map((prop) => {
    const base = s.paint?.[prop];
    return [prop, (typeof base === "number" ? base : 1) * factor];
  }));
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
  /** An XYZ tile template, or a pmtiles:// archive URL whose header supplies the zoom range and bounds. */
  readonly tiles: string;
  readonly attribution?: string | undefined;
  /** Overlays draw over the chosen basemap and toggle independently. */
  readonly overlay?: boolean | undefined;
}

/** Open water drawn over an imagery basemap, so the sea reads as one surface rather than mixed tiles. */
export const IMAGERY_WATER_LAYER_ID = "imagery-water";

export function rasterLayerId(id: string): string {
  return `raster-${id}`;
}

/** A tile template as a source's tiles; an archive URL as its TileJSON url. */
function tileSource(tiles: string): Record<string, unknown> {
  return tiles.includes("{z}") ? { tiles: [tiles] } : { url: tiles };
}

/**
 * Hidden raster sources and layers for the gallery, in gallery order: the
 * basemaps, which a style places under its roads and labels so an imagery
 * basemap keeps its place names, and the overlays, which go on top.
 */
export function rasterBasemapSpecs(rasters: readonly RasterBasemap[]): {
  sources: Record<string, unknown>;
  layers: unknown[];
  overlays: unknown[];
} {
  const sources: Record<string, unknown> = {};
  const layers: unknown[] = [];
  const overlays: unknown[] = [];
  for (const r of rasters) {
    const id = rasterLayerId(r.id);
    sources[id] = {
      type: "raster",
      ...tileSource(r.tiles),
      tileSize: 256,
      ...(r.attribution ? { attribution: r.attribution } : {}),
    };
    (r.overlay ? overlays : layers).push({ id, type: "raster", source: id, layout: { visibility: "none" }, paint: {} });
  }
  return { sources, layers, overlays };
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
        ...tileSource(terrain.tiles),
        encoding: terrain.encoding,
        tileSize: 256,
        ...(terrain.tiles.includes("{z}") ? { maxzoom: terrain.maxzoom ?? 15 } : {}),
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
          // Light shades in a muted green so relief reads as forested terrain.
          "hillshade-exaggeration": dark ? 0.5 : 0.55,
          "hillshade-shadow-color": dark ? "#000000" : "#3f6440",
          "hillshade-highlight-color": dark ? "#6b7280" : "#eef5e2",
          "hillshade-accent-color": dark ? "#000000" : "#557a4f",
        },
      },
    ],
  };
}

// Building footprints live in building-styles.ts; the street and bundled styles import them from here.
export { buildingSpecs, BUILDINGS_SOURCE_ID, BUILDING_USE_LAYER_ID, type BuildingsConfig } from "./building-styles.js";

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
  // The archive footprints (building-use, building-outline) follow the building theme instead.
  building: "buildings",
  rail: "rail",
  "road-casing": "roads",
  "road-minor": "roads",
  "road-major": "roads",
  "boundary-admin": "boundaries",
  "boundary-tribal": "boundaries",
  "boundary-tribal-label": "boundaries",
  "water-label": "labels",
  "water-label-line": "labels",
  "peak-label": "labels",
  "facility-label": "facilities",
  // The basemap's other places once the facilities archive draws the critical ones (reference-layers.ts).
  "poi-label": "labels",
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
  layers.push(...raster.layers, ...raster.overlays);
  return { version: 8, ...(glyphs ? { glyphs } : {}), sources, layers: withBasemapGroups(layers) };
}
