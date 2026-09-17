import { themes, type ThemeName } from "../design/tokens.js";
import { statusColorExpression, symbolStatusFor } from "./symbology.js";

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

/**
 * The base style: a calm neutral canvas that renders with zero network
 * (INV-3). A PMTiles vector basemap, when configured, mounts underneath
 * the board layers; its absence never blocks the COP.
 */
export function buildCopStyle(theme: ThemeName, basemapUrl?: string): Record<string, unknown> {
  const t = themes[theme];
  const style: Record<string, unknown> = {
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": t.surfaceRaised } },
    ],
  };
  if (basemapUrl) {
    (style.sources as Record<string, unknown>)["basemap"] = {
      type: "vector",
      url: `pmtiles://${basemapUrl}`,
    };
  }
  return style;
}
