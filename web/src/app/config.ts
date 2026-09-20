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
  /** The self-hosted glyph (font) PBF range URL for the street style's labels. */
  readonly OPENEOC_BASEMAP_GLYPHS_URL?: string;
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

/**
 * The self-hosted street basemap, if the deployment configured PMTiles and a
 * glyph URL. A full style URL (OPENEOC_BASEMAP_STYLE_URL) takes precedence over
 * this in the caller; both leave the bundled offline basemap as the fallback.
 */
export function streetBasemap(): StreetBasemapSettings | undefined {
  const r = runtime();
  const pmtilesUrl = r.OPENEOC_BASEMAP_PMTILES_URL;
  const glyphsUrl = r.OPENEOC_BASEMAP_GLYPHS_URL;
  if (typeof pmtilesUrl !== "string" || pmtilesUrl.length === 0) return undefined;
  if (typeof glyphsUrl !== "string" || glyphsUrl.length === 0) return undefined;
  const spriteUrl =
    typeof r.OPENEOC_BASEMAP_SPRITE_URL === "string" && r.OPENEOC_BASEMAP_SPRITE_URL.length > 0
      ? r.OPENEOC_BASEMAP_SPRITE_URL
      : undefined;
  return { pmtilesUrl, glyphsUrl, ...(spriteUrl ? { spriteUrl } : {}) };
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
