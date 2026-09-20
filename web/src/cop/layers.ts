import { themes, type ThemeName } from "../design/tokens.js";
import { statusColorExpression, symbolStatusFor } from "./symbology.js";
import { basemapBackground, naturalEarthLayers, naturalEarthSources } from "./basemap.js";
import { labelFor } from "./tools.js";

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
  return [`${src}-fill`, `${src}-line`, `${src}-point`, `${src}-label`];
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
            "text-offset": [0, 0.9],
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
        "circle-radius": 7,
        "circle-stroke-width": 2,
        "circle-stroke-color": themes[theme].surface,
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
  const raster = rasterBasemapSpecs(rasters);
  Object.assign(sources, raster.sources);
  layers.push(...raster.layers);
  return { version: 8, ...(glyphs ? { glyphs } : {}), sources, layers };
}
