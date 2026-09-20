import type { ThemeName } from "../design/tokens.js";

/**
 * The bundled Natural Earth basemap (public domain, VEOC map-first / INV-3):
 * a calm, muted land/water/boundary/river canvas served as static GeoJSON,
 * so the COP has geographic context with no external tile provider and works
 * fully offline. It is deliberately low-contrast: color is reserved for
 * operational status (INV-8), so the basemap never competes with the layers
 * drawn on top. A deployment that wants street-level detail points at its own
 * MapLibre style (OPENEOC_BASEMAP_STYLE_URL), which replaces this wholesale.
 */

export const NATURAL_EARTH_ATTRIBUTION =
  "Basemap: Natural Earth + US county boundaries, US Census (public domain)";

const FILES = {
  land: "ne_50m_land",
  admin0: "ne_50m_admin_0_boundary_lines_land",
  admin1: "ne_50m_admin_1_states_provinces_lines",
  lakes: "ne_50m_lakes",
  rivers: "ne_50m_rivers_lake_centerlines",
  // Higher-detail local context: California counties and the state outline,
  // from the US Census cartographic boundaries (10m, public domain). Natural
  // Earth alone is blank at county zoom; these give the COP recognizable local
  // geography offline until a deployment mounts full street tiles.
  caCounties: "ca_counties",
  caState: "ca_state",
} as const;

interface Palette {
  readonly water: string;
  readonly land: string;
  readonly coast: string;
  readonly admin0: string;
  readonly admin1: string;
  readonly river: string;
  readonly county: string;
  readonly countyFill: string;
  readonly stateOutline: string;
}

const PALETTE: Record<ThemeName, Palette> = {
  light: {
    water: "#e7edf2",
    land: "#f3f1ec",
    coast: "#c2ccd4",
    admin0: "#aeb8c0",
    admin1: "#d4d9de",
    river: "#c3d2dd",
    county: "#c2c8ce",
    countyFill: "#efece5",
    stateOutline: "#9aa4ad",
  },
  dark: {
    water: "#0d1215",
    land: "#191d21",
    coast: "#333b42",
    admin0: "#3d454d",
    admin1: "#2a3138",
    river: "#26343d",
    county: "#2f363d",
    countyFill: "#1c2126",
    stateOutline: "#46505a",
  },
};

/** The ocean/background color under the land, per theme. */
export function basemapBackground(theme: ThemeName): string {
  return PALETTE[theme].water;
}

export function naturalEarthSources(assetBase: string): Record<string, unknown> {
  const url = (name: string) => `${assetBase}basemap/${name}.geojson`;
  return {
    ne_land: { type: "geojson", data: url(FILES.land) },
    ne_admin0: { type: "geojson", data: url(FILES.admin0) },
    ne_admin1: { type: "geojson", data: url(FILES.admin1) },
    ne_lakes: { type: "geojson", data: url(FILES.lakes) },
    ne_rivers: { type: "geojson", data: url(FILES.rivers) },
    ca_counties: { type: "geojson", data: url(FILES.caCounties) },
    ca_state: { type: "geojson", data: url(FILES.caState) },
  };
}

export function naturalEarthLayers(theme: ThemeName): unknown[] {
  const p = PALETTE[theme];
  return [
    { id: "ne-land", type: "fill", source: "ne_land", paint: { "fill-color": p.land } },
    { id: "ne-coast", type: "line", source: "ne_land", paint: { "line-color": p.coast, "line-width": 0.6 } },
    // California counties: a faint fill so the land reads at county zoom, then
    // the county mesh, then a stronger state outline. These carry the local
    // detail Natural Earth's world scale lacks.
    {
      id: "ca-counties-fill",
      type: "fill",
      source: "ca_counties",
      paint: { "fill-color": p.countyFill, "fill-opacity": 0.55 },
    },
    { id: "ne-lakes", type: "fill", source: "ne_lakes", paint: { "fill-color": p.water } },
    { id: "ne-rivers", type: "line", source: "ne_rivers", paint: { "line-color": p.river, "line-width": 0.6 } },
    {
      id: "ca-counties-line",
      type: "line",
      source: "ca_counties",
      paint: { "line-color": p.county, "line-width": 0.8 },
    },
    { id: "ne-admin1", type: "line", source: "ne_admin1", paint: { "line-color": p.admin1, "line-width": 0.5 } },
    { id: "ne-admin0", type: "line", source: "ne_admin0", paint: { "line-color": p.admin0, "line-width": 0.9 } },
    {
      id: "ca-state-outline",
      type: "line",
      source: "ca_state",
      paint: { "line-color": p.stateOutline, "line-width": 1.4 },
    },
  ];
}
