/**
 * Runtime deployment config. A host can inject `window.OPENEOC = { ... }`
 * before the app loads to override defaults without a rebuild. Everything
 * here is optional; the app has sensible defaults when nothing is set.
 */

interface RuntimeConfig {
  /** A full MapLibre style URL that replaces the bundled basemap. */
  readonly OPENEOC_BASEMAP_STYLE_URL?: string;
  /** A raster XYZ tile template (e.g. satellite/aerial imagery) offered as a
   * switchable basemap. The deployment provides it (self-hosted keeps the COP
   * offline; a public provider is the deployment's choice). */
  readonly OPENEOC_IMAGERY_TILE_URL?: string;
  readonly OPENEOC_IMAGERY_ATTRIBUTION?: string;
}

function runtime(): RuntimeConfig {
  return (globalThis as unknown as { OPENEOC?: RuntimeConfig }).OPENEOC ?? {};
}

/** A deployment's own basemap style URL, if configured. */
export function basemapStyleUrl(): string | undefined {
  const value = runtime().OPENEOC_BASEMAP_STYLE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
