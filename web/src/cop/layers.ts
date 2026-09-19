import { themes, type ThemeName } from "../design/tokens.js";
import { statusColorExpression, symbolStatusFor } from "./symbology.js";
import { basemapBackground, naturalEarthLayers, naturalEarthSources } from "./basemap.js";

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

/** Tag features with their status frame so paint expressions stay static. */
export function tagFeatures(fc: CopFeatureCollection): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: { ...f.properties, _symbolStatus: symbolStatusFor(f.properties) },
    })),
  };
}

export function sourceId(boardId: string): string {
  return `board-${boardId}`;
}

export function boardLayerIds(boardId: string): string[] {
  return [`${sourceId(boardId)}-fill`, `${sourceId(boardId)}-line`, `${sourceId(boardId)}-point`];
}

export function boardLayerSpecs(boardId: string, theme: ThemeName): unknown[] {
  const src = sourceId(boardId);
  const color = statusColorExpression(theme);
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
  ];
}

/** The COP base map: bundled Natural Earth, or a plain canvas as a floor. */
export type BasemapConfig = { readonly kind: "natural-earth"; readonly assetBase: string };

/**
 * The base style. With the bundled basemap it is a calm land/water canvas
 * that renders with zero external network (INV-3); without it, a neutral
 * background floor. Board layers mount on top at runtime, so the basemap
 * never blocks the COP. A deployment's own MapLibre style replaces this
 * entirely (handled by the caller), for street-level detail.
 */
export function buildCopStyle(theme: ThemeName, basemap?: BasemapConfig): Record<string, unknown> {
  const t = themes[theme];
  const bg = basemap?.kind === "natural-earth" ? basemapBackground(theme) : t.surfaceRaised;
  const sources: Record<string, unknown> = {};
  const layers: unknown[] = [
    { id: "background", type: "background", paint: { "background-color": bg } },
  ];
  if (basemap?.kind === "natural-earth") {
    Object.assign(sources, naturalEarthSources(basemap.assetBase));
    layers.push(...naturalEarthLayers(theme));
  }
  return { version: 8, sources, layers };
}
