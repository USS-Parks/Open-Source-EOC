import type { ThemeName } from "../design/tokens.js";

/**
 * A themed MapLibre street style over a self-hosted OpenMapTiles-schema PMTiles
 * source (VEOC-74). This is what turns the COP into a real street map: roads by
 * class, water, boundaries, buildings, and place and road labels, all served
 * from a deployment's own `california.pmtiles` with a self-hosted glyph stack,
 * so the map stays offline-capable and license-clean (OpenStreetMap, ODbL). The
 * tiles are produced by deploy/basemap; this module only builds the style that
 * renders them. Operational layers mount on top at runtime, unchanged.
 *
 * The palette stays deliberately calm (color reserved for operational status,
 * INV-8): muted land and water, gray roads, low-contrast labels, so incident
 * symbology always reads first.
 */

export interface StreetBasemapConfig {
  /** URL of the OpenMapTiles-schema PMTiles archive (pmtiles:// is added here). */
  readonly pmtilesUrl: string;
  /** URL template for the self-hosted glyph (font) PBF ranges. */
  readonly glyphsUrl: string;
  /** Optional sprite base URL for icons (labels render without it). */
  readonly spriteUrl?: string | undefined;
}

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

/** The glyph stack the street style's labels request (see deploy/basemap). */
export const STREET_FONT_STACK = "Noto Sans Regular";

interface StreetPalette {
  readonly background: string;
  readonly water: string;
  readonly waterway: string;
  readonly park: string;
  readonly building: string;
  readonly boundary: string;
  readonly roadMinor: string;
  readonly roadMajor: string;
  readonly roadCasing: string;
  readonly label: string;
  readonly labelHalo: string;
}

const PALETTE: Record<ThemeName, StreetPalette> = {
  light: {
    background: "#eef1f4",
    water: "#c9dced",
    waterway: "#a9c6e0",
    park: "#dfe8db",
    building: "#e3e0da",
    boundary: "#b3939f",
    roadMinor: "#ffffff",
    roadMajor: "#f4e6c6",
    roadCasing: "#d8dce0",
    label: "#41474d",
    labelHalo: "#f7f8f9",
  },
  dark: {
    background: "#14181b",
    water: "#0f2231",
    waterway: "#123146",
    park: "#16231a",
    building: "#20262b",
    boundary: "#5a3f49",
    roadMinor: "#2b3138",
    roadMajor: "#3d3626",
    roadCasing: "#0e1114",
    label: "#c6ccd2",
    labelHalo: "#0d1013",
  },
}

/** Interpolate a line width across zoom for a road class. */
function width(stops: [number, number][]): unknown {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()];
}

/** Build the vector street style for a self-hosted OpenMapTiles PMTiles source. */
export function buildStreetStyle(
  config: StreetBasemapConfig,
  theme: ThemeName,
): Record<string, unknown> {
  const p = PALETTE[theme];
  const src = "openmaptiles";
  const layers: unknown[] = [
    { id: "background", type: "background", paint: { "background-color": p.background } },
    {
      id: "landuse-park",
      type: "fill",
      source: src,
      "source-layer": "park",
      paint: { "fill-color": p.park, "fill-opacity": 0.6 },
    },
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
    {
      id: "building",
      type: "fill",
      source: src,
      "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": p.building, "fill-opacity": 0.7 },
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
      filter: ["<=", ["get", "admin_level"], 6],
      paint: { "line-color": p.boundary, "line-width": width([[4, 0.5], [12, 1.5]]), "line-dasharray": [3, 2] },
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
          "text-font": [STREET_FONT_STACK],
          "text-size": 11,
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "place-label",
        type: "symbol",
        source: src,
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet"]]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": [STREET_FONT_STACK],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 16],
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.4 },
      },
    );
  }

  const style: Record<string, unknown> = {
    version: 8,
    glyphs: config.glyphsUrl,
    sources: {
      [src]: {
        type: "vector",
        url: `pmtiles://${config.pmtilesUrl}`,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers,
  };
  if (config.spriteUrl) style["sprite"] = config.spriteUrl;
  return style;
}
