import type { ThemeName } from "../design/tokens.js";

export interface JurisdictionOverlays { readonly pmtilesUrl: string; readonly manifestUrl?: string | undefined }
export interface OverlayCoverage { readonly available: boolean; readonly coverage: string; readonly count: number; readonly attribution?: string }
export function readOverlayCoverage(value: unknown): Record<string, OverlayCoverage> {
  if (!value || typeof value !== "object") return {};
  const layers = (value as { layers?: unknown }).layers;
  if (!layers || typeof layers !== "object") return {};
  return Object.fromEntries(Object.entries(layers).filter((entry): entry is [string, OverlayCoverage] => {
    const layer = entry[1] as Partial<OverlayCoverage> | null;
    return !!layer && typeof layer.available === "boolean" && typeof layer.coverage === "string"
      && (layer.attribution === undefined || typeof layer.attribution === "string")
      && typeof layer.count === "number" && Number.isFinite(layer.count) && layer.count >= 0;
  }));
}
export const OVERLAY_SOURCE = "jurisdiction-overlays";
export const ROAD_OVERLAYS = [
  { id: "roads_state", title: "State highways", light: "#6d6386", dark: "#b1a4cc" },
  { id: "roads_usfs", title: "Federal roads: USFS", light: "#536f58", dark: "#92b89a" },
  { id: "roads_blm", title: "Federal roads: BLM", light: "#84683e", dark: "#c4ab79" },
  { id: "roads_nps", title: "Federal roads: NPS", light: "#476d78", dark: "#8bb7c2" },
  { id: "roads_county", title: "County roads", light: "#806471", dark: "#bf9eae" },
] as const;
export const OWNERSHIP_LEVELS = [
  { id: "City", light: "#b8cbd3", dark: "#4e6773" },
  { id: "County", light: "#d4c4b4", dark: "#75634f" },
  { id: "Federal", light: "#b5c9b1", dark: "#536e4e" },
  { id: "Non Profit", light: "#cfc4d7", dark: "#6c587a" },
  { id: "Special District", light: "#d4cfad", dark: "#747044" },
  { id: "State", light: "#b5cbca", dark: "#4a7370" },
  { id: "Tribal", light: "#d0bfc3", dark: "#785961" },
] as const;
export const VECTOR_OVERLAYS = [...ROAD_OVERLAYS, { id: "land_ownership", title: "Public land ownership" }] as const;
export function overlayLayerId(id: string): string { return "overlay-" + id; }
export function overlayGroupOf(layer: { metadata?: unknown }): string | undefined {
  const value = (layer.metadata as Record<string, unknown> | undefined)?.["openeoc:overlay"];
  return typeof value === "string" ? value : undefined;
}

/** Optional source layers stay hidden until selected, above the basemap and below incident records. */
export function withJurisdictionOverlays(
  style: Record<string, unknown>, config: JurisdictionOverlays | undefined, theme: ThemeName,
): Record<string, unknown> {
  if (!config) return style;
  const layers: unknown[] = [{
    id: overlayLayerId("land_ownership"), type: "fill", source: OVERLAY_SOURCE,
    "source-layer": "land_ownership", metadata: { "openeoc:overlay": "land_ownership" },
    layout: { visibility: "none" },
    paint: {
      "fill-color": ["match", ["get", "Own_Level"], ...OWNERSHIP_LEVELS.flatMap((level) => [level.id, level[theme]]), theme === "dark" ? "#646b73" : "#c7cbd0"],
      "fill-opacity": 0.22, "fill-outline-color": theme === "dark" ? "#818b94" : "#7c8791",
    },
  }, ...ROAD_OVERLAYS.map((road) => ({
    id: overlayLayerId(road.id), type: "line", source: OVERLAY_SOURCE,
    "source-layer": road.id, metadata: { "openeoc:overlay": road.id },
    minzoom: 5, layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: { "line-color": road[theme], "line-opacity": 0.9,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 12, 2.5, 17, 5] },
  }))];
  return { ...style,
    sources: { ...(style.sources as Record<string, unknown>), [OVERLAY_SOURCE]: {
      type: "vector", url: "pmtiles://" + config.pmtilesUrl,
      attribution: "Roads: Caltrans, USFS, BLM, NPS, configured county GIS. Public land: CAL FIRE. Coverage varies by source.",
    } },
    layers: [...(style.layers as unknown[]), ...layers],
  };
}
