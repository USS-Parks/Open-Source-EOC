import type { ThemeName } from "../design/tokens.js";
import { rasterBasemapSpecs, type RasterBasemap } from "./layers.js";

/**
 * The bundled offline vector basemap (VEOC-75). Natural Earth 10m and US Census
 * county data, clipped to California and tiled to PMTiles with tippecanoe (see
 * deploy/basemap), rendered as real vector tiles with labeled towns, highways,
 * urban footprints, water, and county lines. This ships with the app, needs no
 * external tile provider, and works fully offline. It is a genuine step up from
 * the raw-GeoJSON fallback; a deployment that hosts full OpenStreetMap street
 * tiles (deploy/basemap/generate-california.sh + streetstyle.ts) overrides it.
 *
 * The palette stays calm: color is reserved for operational status (INV-8), so
 * the basemap never competes with the incident symbology drawn on top.
 */

export const BUNDLED_BASEMAP_ATTRIBUTION =
  "Natural Earth 10m + US Census counties (public domain)";

export const BUNDLED_FONT_STACK = "Liberation Sans Regular";

export interface BundledBasemapConfig {
  /** Base path the app is served under; the PMTiles and glyphs live beneath it. */
  readonly assetBase: string;
}

interface Palette {
  readonly background: string;
  readonly land: string;
  readonly urban: string;
  readonly water: string;
  readonly river: string;
  readonly county: string;
  readonly roadMajor: string;
  readonly roadMinor: string;
  readonly roadCasing: string;
  readonly placeDot: string;
  readonly label: string;
  readonly labelHalo: string;
}

const PALETTE: Record<ThemeName, Palette> = {
  light: {
    background: "#dbe6ef",
    land: "#f3f1ec",
    urban: "#e7e3d8",
    water: "#cfe0ee",
    river: "#a9c6e0",
    county: "#c2c8ce",
    roadMajor: "#e6d3a3",
    roadMinor: "#ffffff",
    roadCasing: "#d3d8dd",
    placeDot: "#8a929a",
    label: "#3a4045",
    labelHalo: "#f7f8f9",
  },
  dark: {
    background: "#0d1215",
    land: "#191d21",
    urban: "#23282e",
    water: "#0f2231",
    river: "#173445",
    county: "#2f363d",
    roadMajor: "#4a4128",
    roadMinor: "#2c333a",
    roadCasing: "#0c0f12",
    placeDot: "#5b646d",
    label: "#c6ccd2",
    labelHalo: "#0d1013",
  },
};

const MAJOR_ROAD_TYPES = ["Major Highway", "Beltway", "US Highway", "Bypass"];

function zoomWidth(stops: [number, number][]): unknown {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()];
}

/** Build the MapLibre style for the bundled Natural Earth PMTiles basemap. */
export function buildBundledVectorStyle(
  config: BundledBasemapConfig,
  theme: ThemeName,
  rasters: readonly RasterBasemap[] = [],
): Record<string, unknown> {
  const p = PALETTE[theme];
  const base = config.assetBase.endsWith("/") ? config.assetBase : `${config.assetBase}/`;
  const src = "basemap";
  const sources: Record<string, unknown> = {
    [src]: {
      type: "vector",
      url: `pmtiles://${base}basemap/basemap.pmtiles`,
      attribution: BUNDLED_BASEMAP_ATTRIBUTION,
    },
  };
  // Gallery rasters: hidden until chosen; above the vector basemap, below the
  // runtime operational layers.
  const raster = rasterBasemapSpecs(rasters);
  Object.assign(sources, raster.sources);
  return {
    version: 8,
    glyphs: `${base}fonts/{fontstack}/{range}.pbf`,
    sources,
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.background } },
      { id: "land", type: "fill", source: src, "source-layer": "land", paint: { "fill-color": p.land } },
      {
        id: "urban",
        type: "fill",
        source: src,
        "source-layer": "urban",
        paint: { "fill-color": p.urban },
      },
      { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": p.water } },
      {
        id: "rivers",
        type: "line",
        source: src,
        "source-layer": "rivers",
        paint: { "line-color": p.river, "line-width": zoomWidth([[5, 0.4], [10, 1.6]]) },
      },
      {
        id: "counties",
        type: "line",
        source: src,
        "source-layer": "counties",
        paint: { "line-color": p.county, "line-width": zoomWidth([[5, 0.5], [10, 1.2]]) },
      },
      {
        id: "roads-casing",
        type: "line",
        source: src,
        "source-layer": "roads",
        paint: {
          "line-color": p.roadCasing,
          "line-width": zoomWidth([[5, 1.2], [10, 4], [14, 9]]),
          "line-opacity": 0.6,
        },
      },
      {
        id: "roads-minor",
        type: "line",
        source: src,
        "source-layer": "roads",
        filter: ["!", ["in", ["get", "type"], ["literal", MAJOR_ROAD_TYPES]]],
        paint: { "line-color": p.roadMinor, "line-width": zoomWidth([[6, 0.4], [10, 1.4], [14, 4]]) },
      },
      {
        id: "roads-major",
        type: "line",
        source: src,
        "source-layer": "roads",
        filter: ["in", ["get", "type"], ["literal", MAJOR_ROAD_TYPES]],
        paint: { "line-color": p.roadMajor, "line-width": zoomWidth([[4, 0.6], [10, 2.6], [14, 7]]) },
      },
      {
        id: "place-dots",
        type: "circle",
        source: src,
        "source-layer": "places",
        paint: {
          "circle-radius": zoomWidth([[5, 1.4], [10, 3]]),
          "circle-color": p.placeDot,
        },
      },
      {
        id: "road-label",
        type: "symbol",
        source: src,
        "source-layer": "roads",
        minzoom: 8,
        filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": [BUNDLED_FONT_STACK],
          "text-size": 11,
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "place-label",
        type: "symbol",
        source: src,
        "source-layer": "places",
        layout: {
          "text-field": ["coalesce", ["get", "NAME"], ["get", "name"]],
          "text-font": [BUNDLED_FONT_STACK],
          // Bigger labels for higher-ranked places (lower SCALERANK).
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            ["case", ["<=", ["get", "SCALERANK"], 4], 13, 10],
            11,
            ["case", ["<=", ["get", "SCALERANK"], 4], 18, 13],
          ],
          "text-anchor": "top",
          "text-offset": [0, 0.5],
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.5 },
      },
      ...raster.layers,
    ],
  };
}
