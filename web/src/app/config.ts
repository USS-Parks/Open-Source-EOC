import type { JurisdictionOverlays } from "../cop/overlays.js";
import { BUNDLED_FONT_STACK } from "../cop/bundledbasemap.js";
import type { BuildingsConfig, RasterBasemap, TerrainSource } from "../cop/layers.js";
import type { ReferenceArchive, ReferenceLayersConfig } from "../cop/reference-layers.js";

/**
 * Runtime deployment config. A host can inject `window.OPENEOC = { ... }`
 * before the app loads to override defaults without a rebuild. Everything
 * here is optional; the app has sensible defaults when nothing is set.
 */

interface RuntimeConfig {
  readonly OPENEOC_OVERLAYS_PMTILES_URL?: string;
  readonly OPENEOC_OVERLAYS_MANIFEST_URL?: string;
  /** Optional jurisdiction extent: west,south,east,north in WGS84. */
  readonly OPENEOC_MAP_BOUNDS?: string;
  /** A full MapLibre style URL that replaces the bundled basemap. */
  readonly OPENEOC_BASEMAP_STYLE_URL?: string;
  /** A self-hosted OpenMapTiles-schema PMTiles archive (produced by
   * tools/basemap). When set, the app builds a themed street style over it,
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
  /** A self-hosted buildings PMTiles archive (tools/basemap buildings
   * schema): footprints classed by use, colorable by operational status. */
  readonly OPENEOC_BUILDINGS_PMTILES_URL?: string;
  /** Overture release carried by an H14-enriched buildings archive. Omit for
   * a plain OSM archive so attribution never claims enrichment that is absent. */
  readonly OPENEOC_BUILDINGS_OVERTURE_RELEASE?: string;
  /** The statewide reference archives (tools/basemap): critical facilities,
   * boundaries and risk, each with the manifest naming its sources. */
  readonly OPENEOC_FACILITIES_PMTILES_URL?: string;
  readonly OPENEOC_FACILITIES_MANIFEST_URL?: string;
  readonly OPENEOC_BOUNDARIES_PMTILES_URL?: string;
  readonly OPENEOC_BOUNDARIES_MANIFEST_URL?: string;
  readonly OPENEOC_RISK_PMTILES_URL?: string;
  readonly OPENEOC_RISK_MANIFEST_URL?: string;
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
  /** "1" when the deployment serves a synthetic demonstration dataset. */
  readonly OPENEOC_SYNTHETIC_DATA?: string;
  /** The desktop demonstration's director, whom the console signs in by itself. */
  readonly OPENEOC_DEMO_EMAIL?: string;
  readonly OPENEOC_DEMO_PASSWORD?: string;
  /** The incident the desktop demonstration opens on a person's first sign-in. */
  readonly OPENEOC_DEMO_INCIDENT?: string;
  /** "1" when the desktop demonstration lists every section until the person chooses otherwise. */
  readonly OPENEOC_DEMO_ALL_SECTIONS?: string;
  /** Where a host with its own certificate authority serves the authority's root certificate. */
  readonly OPENEOC_TRUST_CERTIFICATE_URL?: string;
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

/** Whether this deployment serves a synthetic demonstration dataset, which every screen then marks. */
export function syntheticData(): boolean {
  return runtime().OPENEOC_SYNTHETIC_DATA === "1";
}

/** The desktop demonstration's director, set only by the demo launcher on its synthetic data. */
export function demoSignIn(): { readonly email: string; readonly password: string } | null {
  const { OPENEOC_DEMO_EMAIL: email, OPENEOC_DEMO_PASSWORD: password } = runtime();
  return email && password && syntheticData() ? { email, password } : null;
}

/** The incident, by name, that the demonstration opens before the person has chosen one. */
export function demoIncident(): string | undefined {
  return syntheticData() ? runtime().OPENEOC_DEMO_INCIDENT || undefined : undefined;
}

/** Whether the demonstration lists every section before the person has chosen in Settings. */
export function demoAllSections(): boolean {
  return syntheticData() && runtime().OPENEOC_DEMO_ALL_SECTIONS === "1";
}

/** Signing out of the demonstration keeps this tab on the sign-in page instead of signing in again. */
export const DEMO_SIGNED_OUT = "openeoc.demo.signed-out";

/** The host's root certificate, which a browser is told to trust once, when the host made its own. */
export function trustCertificateUrl(): string | undefined {
  return runtime().OPENEOC_TRUST_CERTIFICATE_URL || undefined;
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

/** California is the default operating area; a deployment can name its jurisdiction extent. */
export function jurisdictionMapBounds(): [number, number, number, number] {
  const fallback: [number, number, number, number] = [-124.5, 32.5, -114.1, 42.01];
  const value = setting(runtime().OPENEOC_MAP_BOUNDS);
  if (!value) return fallback;
  const parts = value.split(",").map((part) => part.trim());
  const numbers = parts.map(Number);
  if (parts.length !== 4 || parts.some((part) => part === "") || numbers.some((n) => !Number.isFinite(n))) return fallback;
  const [west, south, east, north] = numbers as [number, number, number, number];
  if (west >= east || south >= north || west < -180 || east > 180 || south < -85 || north > 85) return fallback;
  return [west, south, east, north];
}

/** Optional authoritative road and land ownership layers. */
export function jurisdictionOverlays(): JurisdictionOverlays | undefined {
  const pmtilesUrl = setting(runtime().OPENEOC_OVERLAYS_PMTILES_URL);
  if (!pmtilesUrl) return undefined;
  const derived = pmtilesUrl.replace(/\.pmtiles(?=$|[?#])/, "-manifest.json");
  const manifestUrl = setting(runtime().OPENEOC_OVERLAYS_MANIFEST_URL) ?? (derived !== pmtilesUrl ? derived : undefined);
  return { pmtilesUrl, manifestUrl };
}

/** The buildings archive, if the deployment configured one. */
export function buildingsSource(): BuildingsConfig | undefined {
  const r = runtime();
  const pmtilesUrl = setting(r.OPENEOC_BUILDINGS_PMTILES_URL);
  if (!pmtilesUrl) return undefined;
  const overtureRelease = setting(r.OPENEOC_BUILDINGS_OVERTURE_RELEASE);
  return { pmtilesUrl, ...(overtureRelease ? { overtureRelease } : {}) };
}

/** The reference archives the deployment configured; each is left out when absent. */
export function referenceLayers(): ReferenceLayersConfig {
  const r = runtime();
  const archive = (pmtiles: string | undefined, manifest: string | undefined): ReferenceArchive | undefined => {
    const pmtilesUrl = setting(pmtiles);
    return pmtilesUrl ? { pmtilesUrl, manifestUrl: setting(manifest) } : undefined;
  };
  return {
    facilities: archive(r.OPENEOC_FACILITIES_PMTILES_URL, r.OPENEOC_FACILITIES_MANIFEST_URL),
    boundaries: archive(r.OPENEOC_BOUNDARIES_PMTILES_URL, r.OPENEOC_BOUNDARIES_MANIFEST_URL),
    risk: archive(r.OPENEOC_RISK_PMTILES_URL, r.OPENEOC_RISK_MANIFEST_URL),
  };
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
