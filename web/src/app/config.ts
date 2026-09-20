import { BUNDLED_FONT_STACK } from "../cop/bundledbasemap.js";
import type { BuildingsConfig, RasterBasemap, TerrainSource } from "../cop/layers.js";

/**
 * Runtime deployment config. A host can inject `window.OPENEOC = { ... }`
 * before the app loads to override defaults without a rebuild. Everything
 * here is optional; the app has sensible defaults when nothing is set.
 */

interface RuntimeConfig {
  /** A full MapLibre style URL that replaces the bundled basemap. */
  readonly OPENEOC_BASEMAP_STYLE_URL?: string;
  /** A self-hosted OpenMapTiles-schema PMTiles archive (produced by
   * deploy/basemap). When set, the app builds a themed street style over it,
   * giving street-level detail while staying self-hosted and offline-capable. */
  readonly OPENEOC_BASEMAP_PMTILES_URL?: string;
  /** A glyph (font) PBF range URL for the street style's labels. Optional:
   * the app's bundled glyph stack is used when unset. */
  readonly OPENEOC_BASEMAP_GLYPHS_URL?: string;
  /** The font stack name inside that glyph URL (for example "Noto Sans
   * Regular"). Optional: the bundled stack's name is used when unset. */
  readonly OPENEOC_BASEMAP_FONT?: string;
  /** Optional sprite base URL for the street style's icons. */
  readonly OPENEOC_BASEMAP_SPRITE_URL?: string;
  /** A self-hosted buildings PMTiles archive (deploy/basemap buildings
   * schema): footprints classed by use, colorable by operational status. */
  readonly OPENEOC_BUILDINGS_PMTILES_URL?: string;
  /** Raster XYZ tile templates offered in the basemap gallery beside the
   * vector map: aerial imagery, a topographic map, and a hydrography overlay.
   * The deployment provides each (self-hosted keeps the COP offline; a public
   * service such as the USGS National Map is the deployment's choice). Each
   * has an attribution shown while it is visible. */
  readonly OPENEOC_IMAGERY_TILE_URL?: string;
  readonly OPENEOC_IMAGERY_ATTRIBUTION?: string;
  readonly OPENEOC_TOPO_TILE_URL?: string;
  readonly OPENEOC_TOPO_ATTRIBUTION?: string;
  readonly OPENEOC_HYDRO_TILE_URL?: string;
  readonly OPENEOC_HYDRO_ATTRIBUTION?: string;
  /** A raster DEM XYZ tile template for hillshade and 3D terrain, with its
   * encoding ("terrarium", the default, or "mapbox") and attribution. */
  readonly OPENEOC_TERRAIN_TILE_URL?: string;
  readonly OPENEOC_TERRAIN_ENCODING?: string;
  readonly OPENEOC_TERRAIN_ATTRIBUTION?: string;
}

export interface StreetBasemapSettings {
  readonly pmtilesUrl: string;
  readonly glyphsUrl: string;
  readonly fontStack: string;
  readonly spriteUrl?: string | undefined;
}

function runtime(): RuntimeConfig {
  return (globalThis as unknown as { OPENEOC?: RuntimeConfig }).OPENEOC ?? {};
}

/** A deployment's own basemap style URL, if configured. */
export function basemapStyleUrl(): string | undefined {
  const value = runtime().OPENEOC_BASEMAP_STYLE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function setting(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The self-hosted street basemap, if the deployment configured a PMTiles URL.
 * Labels use the app's bundled glyph stack unless the deployment names its
 * own. A full style URL (OPENEOC_BASEMAP_STYLE_URL) takes precedence over
 * this in the caller; both leave the bundled offline basemap as the fallback.
 */
export function streetBasemap(): StreetBasemapSettings | undefined {
  const r = runtime();
  const pmtilesUrl = setting(r.OPENEOC_BASEMAP_PMTILES_URL);
  if (!pmtilesUrl) return undefined;
  const glyphsUrl =
    setting(r.OPENEOC_BASEMAP_GLYPHS_URL) ?? `${assetBase()}fonts/{fontstack}/{range}.pbf`;
  const fontStack = setting(r.OPENEOC_BASEMAP_FONT) ?? BUNDLED_FONT_STACK;
  const spriteUrl = setting(r.OPENEOC_BASEMAP_SPRITE_URL);
  return { pmtilesUrl, glyphsUrl, fontStack, ...(spriteUrl ? { spriteUrl } : {}) };
}

/** The buildings archive, if the deployment configured one. */
export function buildingsSource(): BuildingsConfig | undefined {
  const pmtilesUrl = setting(runtime().OPENEOC_BUILDINGS_PMTILES_URL);
  return pmtilesUrl ? { pmtilesUrl } : undefined;
}

/** The DEM tile set for hillshade and 3D terrain, if the deployment configured one. */
export function terrainSource(): TerrainSource | undefined {
  const r = runtime();
  const tiles = setting(r.OPENEOC_TERRAIN_TILE_URL);
  if (!tiles) return undefined;
  const encoding = r.OPENEOC_TERRAIN_ENCODING === "mapbox" ? "mapbox" : "terrarium";
  return { tiles, encoding, attribution: setting(r.OPENEOC_TERRAIN_ATTRIBUTION) };
}

/** The raster basemaps and overlays the deployment configured, in gallery order. */
export function rasterBasemaps(): RasterBasemap[] {
  const r = runtime();
  const out: RasterBasemap[] = [];
  const add = (id: string, title: string, tiles?: string, attribution?: string, overlay = false) => {
    const url = setting(tiles);
    if (url) out.push({ id, title, tiles: url, attribution: setting(attribution), overlay });
  };
  add("imagery", "Imagery", r.OPENEOC_IMAGERY_TILE_URL, r.OPENEOC_IMAGERY_ATTRIBUTION);
  add("topo", "Topo", r.OPENEOC_TOPO_TILE_URL, r.OPENEOC_TOPO_ATTRIBUTION);
  add("hydro", "Hydrography", r.OPENEOC_HYDRO_TILE_URL, r.OPENEOC_HYDRO_ATTRIBUTION, true);
  return out;
}

/** The base path the app is served under; bundled assets live beneath it. */
export function assetBase(): string {
  return import.meta.env.BASE_URL;
}
