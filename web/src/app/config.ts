import { BUNDLED_FONT_STACK } from "../cop/bundledbasemap.js";

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
  /** A raster XYZ tile template (e.g. satellite/aerial imagery) offered as a
   * switchable basemap. The deployment provides it (self-hosted keeps the COP
   * offline; a public provider is the deployment's choice). */
  readonly OPENEOC_IMAGERY_TILE_URL?: string;
  readonly OPENEOC_IMAGERY_ATTRIBUTION?: string;
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

/** A raster imagery tile template offered as a switchable basemap, if set. */
export function imageryTileUrl(): string | undefined {
  const value = runtime().OPENEOC_IMAGERY_TILE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function imageryAttribution(): string | undefined {
  const value = runtime().OPENEOC_IMAGERY_ATTRIBUTION;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The base path the app is served under; bundled assets live beneath it. */
export function assetBase(): string {
  return import.meta.env.BASE_URL;
}
