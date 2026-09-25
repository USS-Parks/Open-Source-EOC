import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { Icon } from "../design/icons/index.js";
import { pollWhileVisible } from "../app/data/hooks.js";
import { preferences, toDms, usePreferences } from "../app/preferences.js";
import "./cop-workspace.css";
import { withJurisdictionOverlays, readOverlayCoverage, type OverlayCoverage, VECTOR_OVERLAYS, ROAD_OVERLAYS, OWNERSHIP_LEVELS, overlayGroupOf, type JurisdictionOverlays } from "./overlays.js";
import { themes, type ThemeName } from "../design/tokens.js";
import {
  boardLayerSpecs,
  BASEMAP_GROUPS,
  basemapGroupOf,
  buildCopStyle,
  BUILDING_USE_COLORS,
  BUILDING_USE_LAYER_ID,
  BUILDING_USE_LEGEND,
  BUILDINGS_SOURCE_ID,
  DEM_SOURCE_ID,
  HILLSHADE_LAYER_ID,
  IMAGERY_WATER_LAYER_ID,
  opacityPaint,
  rasterLayerId,
  sourceId,
  tagFeatures,
  TILE_CLUSTERS_LAYER,
  tileLayerSpecs,
  type BasemapConfig,
  type BuildingsConfig,
  type CopFeatureCollection,
  type RasterBasemap,
  type TerrainSource,
} from "./layers.js";
import { NATURAL_EARTH_ATTRIBUTION } from "./basemap.js";
import {
  buildBundledVectorStyle,
  BUNDLED_BASEMAP_ATTRIBUTION,
  BUNDLED_FONT_STACK,
  type BundledBasemapConfig,
} from "./bundledbasemap.js";
import {
  buildStreetStyle,
  IMAGERY_ROAD_INK,
  OSM_ATTRIBUTION,
  streetFontStack,
  type StreetBasemapConfig,
} from "./streetstyle.js";
import { statusColor, symbolStatusFor, type SymbolStatus } from "./symbology.js";
import { toMgrs, toUsng } from "./mgrs.js";
import {
  feedLayerSpecs,
  feedSourceId,
  formatAge,
  tagFeedFeatures,
  type FeedLayerHealth,
} from "./feeds.js";
import {
  ensureHazardPatterns,
  FEMA_NFHL_ATTRIBUTION,
  FLOOD_LEGEND,
  floodColor,
  tagFloodFeatures,
} from "./hazards.js";
import {
  ensureFacilityImages,
  FACILITY_SYMBOLS,
  facilitySymbol,
  facilityTypeFor,
  NAPSG_ATTRIBUTION,
} from "./facilities.js";
import {
  formatArea,
  geometryBounds,
  labelFor,
  parseCoordinate,
  polygonAreaSqMi,
  searchFeatures,
  totalMiles,
} from "./tools.js";
import { COUNTY_BOUNDS } from "./county-bounds.js";
import {
  CARTOGRAPHY_TEMPLATES,
  cartographyLayerSpecs,
  ensureCartographyImages,
  INCIDENT_AREA_LAYERS,
  INCIDENT_AREA_SOURCE,
  incidentAreaSpecs,
  WEATHER_LAYER_SUFFIX,
} from "./cartography.js";
import { CardOverlays, type CardToggle } from "./CardOverlays.js";
import {
  CopFeatureInspector,
  EmptyLayerSearch,
  WorkspaceSection,
  type CopInspection,
} from "./workspace.js";
import {
  downloadMapExport,
  renderMapExport,
  type MapExportContext,
  type MapExportLayer,
} from "./map-export.js";

export interface CopBoard {
  readonly id: string;
  readonly title: string;
  readonly kind?: "standard" | "fema-flood" | undefined;
  readonly coverage?: string | undefined;
  readonly attribution?: string | undefined;
  /** The board's template; road closures, shelters and incident facilities draw as incident map symbols. */
  readonly templateKey?: string | undefined;
}

/** The incident area drawn as the dashed boundary, with the light card's callout text. */
export interface CopIncidentArea {
  readonly geometry: unknown;
  readonly title?: string | undefined;
  readonly detail?: readonly string[] | undefined;
}

export type FeedItemsData = CopFeatureCollection & { readonly feed: FeedLayerHealth };

export interface CopSelectedDatasetFeature {
  readonly datasetId: string;
  readonly featureId: string;
  readonly title: string;
}

/** A non-wrapping WGS84 bounding box: west, south, east, north. */
export type CopMapBounds = readonly [number, number, number, number];

interface ReadableMapBounds {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

interface BoundsEventSource {
  getBounds(): ReadableMapBounds;
  on(type: "moveend", listener: () => void): unknown;
  off(type: "moveend", listener: () => void): unknown;
}

function clampLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

function wrapLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/**
 * Convert MapLibre's potentially world-copied bounds into one bounded WGS84
 * box. A viewport spanning or crossing the antimeridian uses world longitude;
 * a single west/east box cannot represent both wrapped halves without loss.
 */
export function normalizeCopMapBounds(bounds: ReadableMapBounds): CopMapBounds {
  const south = clampLatitude(Math.min(bounds.getSouth(), bounds.getNorth()));
  const north = clampLatitude(Math.max(bounds.getSouth(), bounds.getNorth()));
  const west = bounds.getWest();
  const span = bounds.getEast() - west;
  if (!Number.isFinite(west) || !Number.isFinite(span) || span <= 0 || span >= 360) {
    return [-180, south, 180, north];
  }
  const normalizedWest = wrapLongitude(west);
  const normalizedEast = normalizedWest + span;
  return normalizedEast > 180
    ? [-180, south, 180, north]
    : [normalizedWest, south, normalizedEast, north];
}

/** Bind initial-ready and move-end bounds reports; returns the unmount cleanup. */
export function bindCopMapBounds(
  map: BoundsEventSource,
  currentCallback: () => CopMapProps["onBoundsChange"],
): () => void {
  let active = true;
  const report = () => {
    if (active) currentCallback()?.(normalizeCopMapBounds(map.getBounds()));
  };
  map.on("moveend", report);
  report();
  return () => {
    active = false;
    map.off("moveend", report);
  };
}

export interface CopMapProps {
  readonly theme: ThemeName;
  readonly boards: readonly CopBoard[];
  readonly fetchItems: (boardId: string) => Promise<CopFeatureCollection>;
  /** External/sensor feeds rendered as read-only layers, with staleness. */
  readonly feeds?: readonly CopBoard[] | undefined;
  readonly fetchFeedItems?: ((feedId: string) => Promise<FeedItemsData>) | undefined;
  /** The bundled basemap, when one should render under the layers. */
  readonly basemap?: BasemapConfig | undefined;
  /** A deployment's own MapLibre style URL, which replaces the basemap. */
  readonly basemapStyleUrl?: string | undefined;
  /** A self-hosted OpenMapTiles PMTiles basemap; the app builds the street
   * style over it (used only when basemapStyleUrl is not set). */
  readonly streetBasemap?: StreetBasemapConfig | undefined;
  /** The bundled Natural Earth PMTiles vector basemap (the default offline
   * basemap), used when no external style or self-hosted street tiles are set. */
  readonly bundledBasemap?: BundledBasemapConfig | undefined;
  /** Raster basemaps and overlays (imagery, topo, hydrography) offered in
   * the gallery beside the vector map. */
  readonly rasterBasemaps?: readonly RasterBasemap[] | undefined;
  /** A DEM tile set enabling the hillshade toggle and the 3D terrain control. */
  readonly terrain?: TerrainSource | undefined;
  /** A buildings archive: footprints by use, colored by the status of the
   * records that fall inside them. */
  readonly buildings?: BuildingsConfig | undefined;
  readonly jurisdictionOverlays?: JurisdictionOverlays | undefined;
  readonly pollMs?: number | undefined;
  readonly center?: [number, number] | undefined;
  readonly zoom?: number | undefined;
  readonly initialBounds?: [number, number, number, number] | undefined;
  /** When true, a map click reports its position instead of inspecting. */
  readonly picking?: boolean | undefined;
  readonly onPickPoint?: ((lngLat: [number, number]) => void) | undefined;
  /** Current non-wrapping WGS84 bounds, reported at ready and after moveend. */
  readonly onBoundsChange?: ((bounds: CopMapBounds) => void) | undefined;
  /** Drawer by default; explicit popup preserves the legacy direct-map mode. */
  readonly inspectionMode?: "popup" | "workspace" | undefined;
  /** Exact persisted dataset feature requested by an operational relationship. */
  readonly requestedFeature?: { readonly datasetId: string; readonly featureId: string } | null | undefined;
  /** A board record to show and inspect once its layer loads, as a record's "Show on map" asks. */
  readonly requestedRecord?: { readonly boardId: string; readonly recordId: string } | null | undefined;
  /** Opens a board record beside its list from the inspector. */
  readonly onOpenRecord?: ((boardId: string, recordId: string) => void) | undefined;
  /** Reports only persisted feed/dataset feature identity, never a rendered synthetic id. */
  readonly onInspectFeature?: ((feature: CopSelectedDatasetFeature | null) => void) | undefined;
  /** Vector tiles for a layer too large for one GeoJSON page (board items
   * with a `next` link, or a standard feed marked incomplete): its
   * {z}/{x}/{y} URL template, or undefined where no tiles are served. */
  readonly tileUrl?: ((kind: "board" | "feed", id: string) => string | undefined) | undefined;
  /** Headers (the bearer) for tile requests from tileUrl, read per request. */
  readonly tileHeaders?: (() => Record<string, string>) | undefined;
  /** Test/instrumentation hook: receives the live map instance. */
  readonly onMap?: ((map: maplibregl.Map) => void) | undefined;
  /** Stored incident context printed outside the map frame in PNG exports. */
  readonly exportContext?: MapExportContext | undefined;
  /** "card" shows the map alone, for a map inside an overview card; the layer panel stays on the Map screen. */
  readonly layout?: "workspace" | "card" | undefined;
  readonly incidentArea?: CopIncidentArea | null | undefined;
  /** The place search shown among the light card's map tools. */
  readonly cardSearch?: ReactNode;
  /** Panels the Map screen floats over the map itself: its tools, the impact panel, the record form. */
  readonly overlay?: ReactNode;
}

let pmtilesRegistered = false;

const LEGEND: readonly SymbolStatus[] = ["critical", "warning", "normal", "unknown"];

const EMPTY_FC = { type: "FeatureCollection", features: [] as unknown[] };
const DEFAULT_CENTER: [number, number] = [-119.3, 37.2];
const DEFAULT_ZOOM = 6;
const BOOKMARKS_KEY = "openeoc.cop.bookmarks";

type MeasureMode = "off" | "distance" | "area";
type Bounds = [number, number, number, number];

interface Bookmark {
  readonly name: string;
  readonly center: [number, number];
  readonly zoom: number;
}

/** One row in the find-on-map results: a record, a county, or a coordinate. */
interface FindResult {
  readonly key: string;
  readonly kind: "feature" | "county" | "coordinate";
  readonly title: string;
  readonly detail: string;
  readonly bounds: Bounds;
  readonly sourceId?: string | undefined;
  readonly featureId?: string | undefined;
  readonly properties?: Record<string, unknown> | undefined;
}

/** A rendered operational or jurisdiction feature (inspectable). */
function isCopLayerId(id: string): boolean {
  return id === "facility-label" || id === BUILDING_USE_LAYER_ID || id.startsWith(sourceId("")) || id.startsWith(feedSourceId("")) || id.startsWith("overlay-");
}

/** The id of the layer drawn just above the given one, if any. */
function nextLayerId(map: maplibregl.Map, id: string): string | null {
  const ids = map.getStyle().layers.map((layer) => layer.id);
  const index = ids.indexOf(id);
  return index >= 0 ? ids[index + 1] ?? null : null;
}

/** The record fields that say when its condition was observed, most specific first. */
const OBSERVED_FIELDS = ["observed_at", "occurred_at", "reported_at", "assessed_at"] as const;

/** "Sep 24, 10:42": a record time in the viewer's zone. */
function moment(value: string): string {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function visibleInspectionRows(properties: Record<string, unknown>) {
  return Object.entries(properties)
    .filter(([key, value]) => !key.startsWith("_") && value !== null && value !== undefined)
    .slice(0, 24)
    .map(([label, value]) => ({
      label,
      value: typeof value === "object" ? (JSON.stringify(value) ?? String(value)) : String(value),
    }));
}

function esc(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** A record's readable properties as a small table for the map popup. */
export function featureHtml(properties: Record<string, unknown>): string {
  const facility = facilitySymbol(facilityTypeFor(properties));
  const rawStatus = properties._symbolStatus;
  const status = typeof rawStatus === "string" && LEGEND.includes(rawStatus as SymbolStatus)
    ? rawStatus
    : "unknown";
  const facilityRows = facility
    ? [
        ["Facility type", facility.title],
        ["Operational status", status],
      ]
    : [];
  const rows = [...facilityRows, ...Object.entries(properties).filter(([key]) => !key.startsWith("_"))]
    .map(
      ([key, value]) =>
        `<tr><th style="text-align:left;padding-right:8px;vertical-align:top">${esc(key)}</th>` +
        `<td>${esc(String(value))}</td></tr>`,
    )
    .join("");
  return `<table style="font:12px system-ui,sans-serif;border-collapse:collapse">${rows}</table>`;
}

function loadBookmarks(): Bookmark[] {
  try {
    const raw = globalThis.localStorage?.getItem(BOOKMARKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function storeBookmarks(list: readonly Bookmark[]): void {
  try {
    globalThis.localStorage?.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (private mode, quota); the list still works
    // for the session.
  }
}

/**
 * The common operating picture (F6, F14). Every geo board is a togglable
 * layer; data refreshes on a poll (push riding the sync layer follows at
 * the app shell); the base canvas renders offline, with a PMTiles basemap
 * mounting underneath when the deployment provides one (INV-3).
 */
export function CopMap(props: CopMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pickingRef = useRef(false);
  const onPickRef = useRef<CopMapProps["onPickPoint"]>(props.onPickPoint);
  onPickRef.current = props.onPickPoint;
  const onBoundsChangeRef = useRef<CopMapProps["onBoundsChange"]>(props.onBoundsChange);
  onBoundsChangeRef.current = props.onBoundsChange;
  const card = props.layout === "card";
  // The card opens on the incident picture: boundary, closures, shelters and
  // facilities; the other boards wait under More layers. A board's template
  // can arrive after the map mounts, so the default is read, never stored.
  const boardDefault = (board: CopBoard) => !card || CARTOGRAPHY_TEMPLATES.has(board.templateKey ?? "");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [feedVisible, setFeedVisible] = useState<Record<string, boolean>>(
    Object.fromEntries((props.feeds ?? []).map((f) => [f.id, true])),
  );
  const [feedHealth, setFeedHealth] = useState<Record<string, FeedLayerHealth>>({});
  // The gallery: an external style carries its own basemap, so no rasters there.
  const rasters = props.basemapStyleUrl ? [] : (props.rasterBasemaps ?? []);
  const rasterBases = rasters.filter((r) => !r.overlay);
  const overlays = rasters.filter((r) => r.overlay);
  // Imagery is the dark theme's basemap when the deployment has it; light keeps the map with shaded terrain.
  const [basemapMode, setBasemapMode] = useState(
    props.theme === "dark" && rasterBases.some((r) => r.id === "imagery") ? "imagery" : "vector",
  );
  const [overlayOn, setOverlayOn] = useState<Record<string, boolean>>({});
  const terrain = props.basemapStyleUrl ? undefined : props.terrain;
  const buildings = props.basemapStyleUrl ? undefined : props.buildings;
  const vectors = props.jurisdictionOverlays;
  const [vectorOn, setVectorOn] = useState<Record<string, boolean>>({});
  const [coverage, setCoverage] = useState<Record<string, OverlayCoverage>>({});
  useEffect(() => {
    if (!vectors?.manifestUrl) return;
    const abort = new AbortController();
    void fetch(vectors.manifestUrl, { signal: abort.signal }).then((response) => {
      if (!response.ok) throw new Error("Coverage manifest unavailable");
      return response.json() as Promise<unknown>;
    }).then((value) => {
      const next = readOverlayCoverage(value);
      setCoverage(next);
      setVectorOn((current) => Object.fromEntries(Object.entries(current).map(([id, on]) =>
        [id, on && next[id]?.available !== false])));
    }).catch(() => { /* Unknown coverage remains explicit. */ });
    return () => abort.abort();
  }, [vectors?.manifestUrl]);
  const [hillshade, setHillshade] = useState(!!terrain);
  const [areaOn, setAreaOn] = useState(true);
  const [weatherOn, setWeatherOn] = useState(!card);
  const weatherRef = useRef(weatherOn);
  weatherRef.current = weatherOn;
  const [liveMap, setLiveMap] = useState<maplibregl.Map | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const areaOnRef = useRef(areaOn);
  areaOnRef.current = areaOn;
  // The layer the hillshade sits under in the vector style, so it can go back there.
  const reliefAnchorRef = useRef<string | null | undefined>(undefined);
  // The street style's own road colors, restored when the map returns from imagery.
  const roadInkRef = useRef<Record<string, unknown>>({});
  /** A board layer shows with its board; weather stations also follow their own toggle. */
  const layerShown = (layerId: string, boardOn: boolean) =>
    boardOn && (!layerId.endsWith(WEATHER_LAYER_SUFFIX) || weatherRef.current);
  // Basemap layer groups present in the active style (discovered on load),
  // each switchable like an operational layer.
  const [groups, setGroups] = useState<readonly (typeof BASEMAP_GROUPS)[number][]>([]);
  const [groupOn, setGroupOn] = useState<Record<string, boolean>>({});
  const readoutRef = useRef<HTMLDivElement>(null);
  // The viewer's units and coordinate format (Settings); the scale bar follows a change at once.
  const scaleRef = useRef<maplibregl.ScaleControl | null>(null);
  const distanceUnit = usePreferences().distanceUnit;
  useEffect(() => { scaleRef.current?.setUnit(distanceUnit); }, [distanceUnit]);
  const measureRef = useRef<MeasureMode>("off");
  const measureCoordsRef = useRef<[number, number][]>([]);
  const [measure, setMeasure] = useState<MeasureMode>("off");
  // The last fetched features per source, so zoom-to-extent and search cover
  // every feature, not just those in the current viewport (querySourceFeatures
  // is viewport-bound).
  const dataRef = useRef<Record<string, CopFeatureCollection>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FindResult[]>([]);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const requestedFeatureRef = useRef(props.requestedFeature);
  const requestedRecordRef = useRef(props.requestedRecord);
  const onInspectFeatureRef = useRef(props.onInspectFeature);
  const openedRequestedFeatureRef = useRef("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [bookmarkName, setBookmarkName] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  // The layer column folds away so the map takes the whole screen; the choice is kept on this computer.
  const [layersOpen, setLayersOpen] = useState(() => {
    try { return localStorage.getItem("openeoc.map.layersOpen") !== "0"; } catch { return true; }
  });
  const showLayers = (open: boolean) => {
    setLayersOpen(open);
    try { localStorage.setItem("openeoc.map.layersOpen", open ? "1" : "0"); } catch { /* not kept */ }
  };
  const [selection, setSelection] = useState<CopInspection | null>(null);
  // Operator opacity per operational source key, 0 to 1 (default 1).
  const [opacity, setOpacity] = useState<Record<string, number>>({});
  // The operational layers actually mounted per source key (GeoJSON or tile
  // mode), so visibility and opacity reach whichever form is live.
  const mountedRef = useRef<Record<string, { mode: string; specs: unknown[] }>>({});
  const visibleRef = useRef(visible);
  const feedVisibleRef = useRef(feedVisible);
  const opacityRef = useRef(opacity);
  const tileHeadersRef = useRef(props.tileHeaders);
  visibleRef.current = visible;
  feedVisibleRef.current = feedVisible;
  opacityRef.current = opacity;
  tileHeadersRef.current = props.tileHeaders;
  const feedHealthRef = useRef(feedHealth);
  const coverageRef = useRef(coverage);
  const boardsRef = useRef(props.boards);
  const feedsRef = useRef(props.feeds ?? []);
  feedHealthRef.current = feedHealth;
  coverageRef.current = coverage;
  boardsRef.current = props.boards;
  feedsRef.current = props.feeds ?? [];
  requestedFeatureRef.current = props.requestedFeature;
  requestedRecordRef.current = props.requestedRecord;
  onInspectFeatureRef.current = props.onInspectFeature;

  useEffect(() => {
    if (!props.picking) return;
    popupRef.current?.remove();
    setSelection(null);
  }, [props.picking]);

  const home = { center: props.center ?? DEFAULT_CENTER, zoom: props.zoom ?? DEFAULT_ZOOM };
  const assetBase = props.bundledBasemap?.assetBase ?? props.basemap?.assetBase;
  const publicAssetBase = (assetBase ?? "/").endsWith("/") ? (assetBase ?? "/") : `${assetBase}/`;
  const facilityAssetBase = `${publicAssetBase}napsg/`;
  // The label layers need the glyph stack of whichever basemap style is
  // active; an external style's fonts are unknown, so labels stay off there.
  const labelFont = props.basemapStyleUrl
    ? undefined
    : props.streetBasemap
      ? streetFontStack(props.streetBasemap)
      : assetBase
        ? BUNDLED_FONT_STACK
        : undefined;

  const openInspection = (
    properties: Record<string, unknown>,
    sourceKey: string,
    layerId: string,
    featureStatus?: unknown,
    featureId?: string | number,
  ) => {
    const board = boardsRef.current.find((candidate) => sourceKey === sourceId(candidate.id));
    const feed = feedsRef.current.find((candidate) => sourceKey === feedSourceId(candidate.id));
    const health = feed ? feedHealthRef.current[feed.id] : undefined;
    const facility = facilitySymbol(facilityTypeFor(properties));
    // Tile features arrive untagged; derive the frame as tagging would.
    const rawStatus = properties._symbolStatus ?? featureStatus
      ?? (board || feed ? (health?.stale ? "unknown" : symbolStatusFor(properties)) : undefined);
    const status = typeof rawStatus === "string" && LEGEND.includes(rawStatus as SymbolStatus)
      ? rawStatus as SymbolStatus
      : "unknown";
    const building = sourceKey === BUILDINGS_SOURCE_ID || layerId === BUILDING_USE_LAYER_ID;
    const overlay = layerId.startsWith("overlay-") ? layerId.slice("overlay-".length) : undefined;
    const overlayInfo = overlay ? coverageRef.current[overlay] : undefined;
    const freshness = health
      ? health.stale
        ? `Stale last-good data · ${formatAge(health.ageSeconds)}`
        : `Current · ${formatAge(health.ageSeconds)}`
      : undefined;
    const source = board?.title
      ?? health?.name
      ?? feed?.title
      ?? (building ? "OpenStreetMap building footprints" : undefined)
      ?? (layerId === "facility-label" ? "Basemap facility reference" : undefined)
      ?? VECTOR_OVERLAYS.find((candidate) => candidate.id === overlay)?.title
      ?? "Configured geographic reference";
    const kind = board
      ? (facility ? "Operational facility" : "Operational record")
      : feed?.kind === "fema-flood"
        ? "Static flood reference"
        : feed
          ? "Configured feed"
          : building
            ? "Building footprint"
            : "Geographic reference";
    const attribution = feed?.attribution
      ?? health?.attribution
      ?? (facility ? NAPSG_ATTRIBUTION : undefined)
      ?? (building
        ? buildings?.overtureRelease
          ? `Buildings: © OpenStreetMap contributors (ODbL); enrichment: © Overture Maps Foundation (ODbL, ${buildings.overtureRelease})`
          : "Buildings: © OpenStreetMap contributors (ODbL)"
        : overlayInfo?.attribution);
    const coverageLabel = feed?.coverage ?? health?.coverage ?? overlayInfo?.coverage;
    const title = labelFor(properties);
    // A board record says when it was observed and last changed, and by whom.
    const recordId = typeof properties._featureId === "string" ? properties._featureId : featureId === undefined ? undefined : String(featureId);
    const observedAt = board ? OBSERVED_FIELDS.map((key) => properties[key]).find((value) => typeof value === "string" && Number.isFinite(Date.parse(value))) as string | undefined : undefined;
    const updatedAt = board && typeof properties._updatedAt === "string" ? properties._updatedAt : undefined;
    const updatedBy = typeof properties._updatedBy === "string" ? properties._updatedBy : undefined;
    setSelection({
      ...(observedAt ? { observed: moment(observedAt) } : {}),
      ...(updatedAt ? { updated: `${moment(updatedAt)}${updatedBy ? ` by ${updatedBy}` : ""}` } : {}),
      ...(board && recordId ? { record: { boardId: board.id, recordId } } : {}),
      title,
      kind,
      source,
      status,
      ...(facility ? { facilityType: facility.title } : {}),
      ...(freshness ? { freshness } : {}),
      ...(coverageLabel ? { coverage: coverageLabel } : {}),
      ...(attribution ? { attribution } : {}),
      rows: visibleInspectionRows(properties),
    });
    onInspectFeatureRef.current?.(feed && featureId !== undefined
      ? { datasetId: feed.id, featureId: String(featureId), title }
      : null);
  };

  const inspectRequestedFeature = (
    source: string,
    feature: CopFeatureCollection["features"][number],
    reveal: () => void,
  ) => {
    const map = mapRef.current;
    const bounds = geometryBounds(feature.geometry);
    if (!map || !bounds) return;
    const center: [number, number] = [
      (bounds[0] + bounds[2]) / 2,
      (bounds[1] + bounds[3]) / 2,
    ];
    const isPoint = bounds[0] === bounds[2] && bounds[1] === bounds[3];
    reveal();
    if (isPoint) map.flyTo({ center, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    else map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 600 });
    popupRef.current?.remove();
    openInspection(feature.properties, source, source, feature.properties._symbolStatus, feature.id);
  };

  const closeInspection = () => {
    popupRef.current?.remove();
    setSelection(null);
    onInspectFeatureRef.current?.(null);
    requestAnimationFrame(() => mapRef.current?.getCanvas().focus());
  };

  /** Paint the corner readout: cursor position, zoom, and the measurement. */
  const paintReadout = (lng: number, lat: number, zoom: number) => {
    const el = readoutRef.current;
    if (!el) return;
    const coords = measureCoordsRef.current;
    const mode = measureRef.current;
    const prefs = preferences();
    const metric = prefs.distanceUnit === "metric";
    let tail = "";
    if (mode === "distance") {
      const miles = totalMiles(coords);
      tail = coords.length >= 2 ? ` · ${metric ? `${(miles * 1.609344).toFixed(2)} km` : `${miles.toFixed(2)} mi`}` : " · click to measure";
    } else if (mode === "area") {
      const squareMiles = polygonAreaSqMi(coords);
      const squareKm = squareMiles * 2.589988;
      tail =
        coords.length >= 3
          ? ` · ${metric ? (squareKm < 1 ? `${(squareKm * 100).toFixed(1)} ha` : `${squareKm.toFixed(2)} km²`) : formatArea(squareMiles)}`
          : " · click three or more points";
    }
    const usng = prefs.gridReference ? toUsng(lng, lat) : null;
    const grid = !prefs.gridReference ? "" : usng ? `\nUSNG ${usng} · MGRS ${toMgrs(lng, lat)}` : "\nUSNG/MGRS: outside UTM coverage";
    const position = prefs.coordinateFormat === "dms" ? `${toDms(lat, "lat")} ${toDms(lng, "lon")}` : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    el.textContent = `${position} · z${zoom.toFixed(1)}${tail}${grid}`;
  };

  useEffect(() => {
    if (!container.current) return;
    if (!pmtilesRegistered) {
      // MapLibre v6 loads its worker from a sibling file of the bundle URL;
      // a bundler inlines the library, so point it at the emitted asset or
      // the worker request 404s and the map never loads a single tile.
      maplibregl.setWorkerUrl(maplibreWorkerUrl);
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      pmtilesRegistered = true;
    }
    // Tile URL prefixes this map created; only those requests carry the
    // bearer, never a basemap or raster server.
    const tilePrefixes = new Set<string>();
    const tileTemplate = (kind: "board" | "feed", id: string): string | undefined => {
      const template = props.tileUrl?.(kind, id);
      if (!template) return undefined;
      // MapLibre fetches tiles in a worker, so the template must be absolute.
      const absolute = template.startsWith("/") ? `${globalThis.location.origin}${template}` : template;
      tilePrefixes.add(absolute.slice(0, absolute.indexOf("{z}")));
      return absolute;
    };
    const map = new maplibregl.Map({
      container: container.current,
      style: (props.basemapStyleUrl ??
        withJurisdictionOverlays(props.streetBasemap
          ? buildStreetStyle(props.streetBasemap, props.theme, rasters, terrain, buildings)
          : props.bundledBasemap
            ? buildBundledVectorStyle(props.bundledBasemap, props.theme, rasters, terrain, buildings)
            : buildCopStyle(props.theme, props.basemap, rasters, terrain), vectors, props.theme)) as never,
      center: home.center,
      zoom: home.zoom,
      ...(props.initialBounds ? { bounds: props.initialBounds, fitBoundsOptions: { padding: 24 } } : {}),
      attributionControl: false,
      // Keeps the drawn frame readable for the image export.
      canvasContextAttributes: { preserveDrawingBuffer: true },
      transformRequest: (url) => {
        const headers = tileHeadersRef.current;
        return headers && [...tilePrefixes].some((prefix) => url.startsWith(prefix))
          ? { url, headers: headers() }
          : undefined;
      },
    });
    mapRef.current = map;
    let styleReady = false;
    let active = true;
    let unbindBounds: (() => void) | undefined;
    // MapLibre resolves the external style and its relative asset URLs. Mount
    // jurisdiction layers after that style parses, before operational records.
    if (props.basemapStyleUrl && vectors) map.once("style.load", () => {
      const additions = withJurisdictionOverlays({ sources: {}, layers: [] }, vectors, props.theme);
      for (const [id, source] of Object.entries(additions.sources as Record<string, unknown>)) {
        map.addSource(id, source as never);
      }
      for (const layer of additions.layers as maplibregl.LayerSpecification[]) map.addLayer(layer);
    });
    props.onMap?.(map);
    setLiveMap(map);

    // The card draws its own controls over the map (CardOverlays).
    if (!card) {
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      "top-right",
    );
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-right",
    );
    }
    if (terrain && !card) {
      // MapLibre's own 3D terrain toggle, over the same DEM as the hillshade.
      map.addControl(
        new maplibregl.TerrainControl({ source: DEM_SOURCE_ID, exaggeration: 1.3 }),
        "top-right",
      );
    }
    if (!card) {
      scaleRef.current = new maplibregl.ScaleControl({ unit: preferences().distanceUnit });
      map.addControl(scaleRef.current, "bottom-left");
    }
    const basemapAttribution = props.basemapStyleUrl
      ? ""
      : props.streetBasemap
        ? OSM_ATTRIBUTION
        : props.bundledBasemap
          ? BUNDLED_BASEMAP_ATTRIBUTION
          : props.basemap?.kind === "natural-earth"
            ? NATURAL_EARTH_ATTRIBUTION
            : "";
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        // Gallery rasters carry their own source attribution. The licensed
        // facility symbols are available on every COP style and are credited
        // independently from whichever basemap is active.
        customAttribution: [basemapAttribution, NAPSG_ATTRIBUTION].filter(Boolean),
      }),
      "bottom-right",
    );

    // Push the current measure path into the measure source so the tool
    // draws as the operator clicks: vertices, the path, and for area the
    // closed ring with a fill.
    const updateMeasure = () => {
      const coords = measureCoordsRef.current;
      const src = map.getSource("measure") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const features: unknown[] = coords.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: {},
      }));
      const area = measureRef.current === "area" && coords.length >= 3;
      if (area) {
        const ring = [...coords, coords[0]!];
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: {},
        });
      } else if (coords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        });
      }
      src.setData({ type: "FeatureCollection", features } as never);
    };

    // Click any operational feature to inspect its record; a plain map click
    // dismisses. queryRenderedFeatures keeps this working as layers come and
    // go on the poll, with no per-layer handler churn.
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });
    popupRef.current = popup;
    map.on("click", (e) => {
      // Add-point mode: report the position for a new record, never inspect.
      if (pickingRef.current && onPickRef.current) {
        onPickRef.current([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      // Measure mode: each click extends the path; nothing is inspected.
      if (measureRef.current !== "off") {
        measureCoordsRef.current = [...measureCoordsRef.current, [e.lngLat.lng, e.lngLat.lat]];
        updateMeasure();
        paintReadout(e.lngLat.lng, e.lngLat.lat, map.getZoom());
        return;
      }
      const hit = map.queryRenderedFeatures(e.point).find((f) => isCopLayerId(f.layer.id));
      if (!hit) {
        popup.remove();
        setSelection(null);
        onInspectFeatureRef.current?.(null);
        return;
      }
      // A server-side cluster opens by zooming in toward its records.
      if (hit.sourceLayer === TILE_CLUSTERS_LAYER) {
        map.easeTo({ center: e.lngLat, zoom: map.getZoom() + 2 });
        return;
      }
      if (props.inspectionMode !== "popup") {
        popup.remove();
        openInspection(hit.properties ?? {}, hit.source, hit.layer.id, hit.state?.status, hit.id);
      } else {
        popup.setLngLat(e.lngLat).setHTML(featureHtml(hit.properties ?? {})).addTo(map);
      }
    });
    map.on("mousemove", (e) => {
      paintReadout(e.lngLat.lng, e.lngLat.lat, map.getZoom());
      if (pickingRef.current || measureRef.current !== "off") return; // tool cursors win
      const over = map.queryRenderedFeatures(e.point).some((f) => isCopLayerId(f.layer.id));
      map.getCanvas().style.cursor = over ? "pointer" : "";
    });

    // Color building footprints by the status of the point records inside
    // them: each visible point is hit-tested against the rendered footprints
    // and the hit gets the record's status as feature state.
    // ponytail: viewport-only, client-side join, one query per point record
    // per idle; a server-side PostGIS join if record counts outgrow it.
    const joinBuildings = () => {
      if (!buildings || !map.getLayer(BUILDING_USE_LAYER_ID)) return;
      const target = { source: BUILDINGS_SOURCE_ID, sourceLayer: "buildings" };
      map.removeFeatureState(target);
      for (const fc of Object.values(dataRef.current)) {
        for (const f of fc.features) {
          const g = f.geometry as { type?: string; coordinates?: [number, number] };
          if (g.type !== "Point" || !g.coordinates) continue;
          const hit = map
            .queryRenderedFeatures(map.project(g.coordinates), { layers: [BUILDING_USE_LAYER_ID] })
            .find((h) => h.id !== undefined);
          if (!hit) continue;
          map.setFeatureState({ ...target, id: hit.id as string | number }, {
            status: f.properties._symbolStatus,
          });
        }
      }
    };

    // One source per operational layer: GeoJSON while it fits one page,
    // vector tiles past that. A change of form (or of feed staleness on
    // tiles) remounts the source and its layers with the operator's current
    // visibility and opacity.
    // ponytail: tile sources reload on every poll to match the GeoJSON
    // freshness; the tiles' short private max-age absorbs most of the cost.
    const mount = (
      key: string,
      fc: CopFeatureCollection,
      specs: unknown[],
      tiles: string | undefined,
      stale: boolean,
      shown: boolean,
      // A board whose template arrives later is redrawn with its template's layers.
      variant = "",
    ) => {
      const mode = `${tiles ? `tiles:${stale}` : "geojson"}:${variant}`;
      const current = mountedRef.current[key];
      if (current?.mode === mode) {
        if (tiles) map.refreshTiles(key);
        else (map.getSource(key) as maplibregl.GeoJSONSource).setData(fc as never);
        return;
      }
      if (current) {
        for (const spec of current.specs) {
          const id = (spec as { id: string }).id;
          if (map.getLayer(id)) map.removeLayer(id);
        }
        map.removeSource(key);
      }
      map.addSource(key, tiles
        ? { type: "vector", tiles: [tiles], maxzoom: 14, promoteId: "_id" }
        : { type: "geojson", data: fc as never });
      const layers = tiles ? tileLayerSpecs(specs, key, props.theme, labelFont, stale) : specs;
      mountedRef.current[key] = { mode, specs: layers };
      for (const spec of layers) {
        const s = spec as { id: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> };
        map.addLayer({
          ...s,
          paint: { ...s.paint, ...opacityPaint(spec, opacityRef.current[key] ?? 1) },
          layout: { ...s.layout, visibility: layerShown(s.id, shown) ? "visible" : "none" },
        } as never);
      }
    };

    // Rejects only when every read failed, so the poll backs off while the
    // server is unreachable but keeps its pace when one source is down.
    const refresh = async () => {
      if (!styleReady) return;
      let reads = 0;
      let failed = 0;
      for (const board of boardsRef.current) {
        reads += 1;
        try {
          const raw = await props.fetchItems(board.id);
          const fc = tagFeatures(raw);
          dataRef.current[sourceId(board.id)] = fc;
          const pastPage = raw.links?.some((link) => link.rel === "next") ?? false;
          mount(sourceId(board.id), fc,
            cartographyLayerSpecs(board.id, board.templateKey, props.theme, labelFont) ?? boardLayerSpecs(board.id, props.theme, labelFont),
            pastPage ? tileTemplate("board", board.id) : undefined, false, visibleRef.current[board.id] ?? boardDefault(board),
            board.templateKey);
          const wanted = requestedRecordRef.current;
          const wantedKey = wanted ? `board/${wanted.boardId}/${wanted.recordId}` : "";
          if (wanted?.boardId === board.id && openedRequestedFeatureRef.current !== wantedKey) {
            const feature = fc.features.find((candidate) => candidate.id === wanted.recordId);
            if (feature) {
              openedRequestedFeatureRef.current = wantedKey;
              inspectRequestedFeature(sourceId(board.id), feature, () => setVisible((current) => ({ ...current, [board.id]: true })));
            }
          }
        } catch {
          // A failed refresh keeps the last good picture; never blank the COP.
          failed += 1;
        }
      }
      if (props.fetchFeedItems) {
        for (const feed of props.feeds ?? []) {
          reads += 1;
          try {
            const res = await props.fetchFeedItems(feed.id);
            const fc = feed.kind === "fema-flood"
              ? tagFloodFeatures(res, res.feed)
              : tagFeedFeatures(res, res.feed);
            dataRef.current[feedSourceId(feed.id)] = fc;
            // Flood styling classifies by pattern matching, which tile
            // expressions cannot do, so flood references stay GeoJSON.
            const tiles = feed.kind !== "fema-flood" && res.feed.incomplete ? tileTemplate("feed", feed.id) : undefined;
            mount(feedSourceId(feed.id), fc, feedLayerSpecs(feed.id, props.theme, labelFont, feed.kind),
              tiles, res.feed.stale, feedVisibleRef.current[feed.id] ?? true);
            setFeedHealth((current) => ({ ...current, [feed.id]: res.feed }));
            const requested = requestedFeatureRef.current;
            const requestKey = requested ? `${requested.datasetId}/${requested.featureId}` : "";
            if (requested?.datasetId === feed.id && openedRequestedFeatureRef.current !== requestKey) {
              const feature = fc.features.find((candidate) => candidate.id === requested.featureId);
              if (feature) {
                openedRequestedFeatureRef.current = requestKey;
                inspectRequestedFeature(feedSourceId(feed.id), feature, () => setFeedVisible((current) => ({ ...current, [feed.id]: true })));
              }
            }
          } catch {
            // A stale or failed feed keeps its last features; never blank the COP.
            failed += 1;
          }
        }
      }
      if (map.isStyleLoaded()) joinBuildings();
      if (reads > 0 && failed === reads) throw new Error("No map layer could be refreshed.");
    };

    map.on("load", async () => {
      ensureHazardPatterns(map, props.theme);
      try {
        await Promise.all([ensureFacilityImages(map, facilityAssetBase), ensureCartographyImages(map, props.theme)]);
      } catch {
        // A missing packaged icon must not prevent operational records loading.
      }
      if (!active) return;
      styleReady = true;
      // The card keeps its credits behind the attribution button rather than across its legend and scale.
      if (card) {
        for (const credits of container.current?.querySelectorAll(".maplibregl-ctrl-attrib") ?? []) {
          credits.classList.remove("maplibregl-compact-show");
          credits.removeAttribute("open");
        }
      }
      if (props.incidentArea && !map.getSource(INCIDENT_AREA_SOURCE)) {
        const area = incidentAreaSpecs(props.incidentArea.geometry, props.theme);
        map.addSource(INCIDENT_AREA_SOURCE, area.source as never);
        for (const layer of area.layers as maplibregl.LayerSpecification[]) {
          map.addLayer({ ...layer, layout: { ...layer.layout, visibility: areaOnRef.current ? "visible" : "none" } } as never);
        }
      }
      // The measure tool's own source and layers (a neutral color, not a
      // status color, so it never reads as an operational condition, INV-8).
      if (!map.getSource("measure")) {
        map.addSource("measure", { type: "geojson", data: EMPTY_FC as never });
        const ink = themes[props.theme].text;
        map.addLayer({
          id: "measure-fill",
          type: "fill",
          source: "measure",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": ink, "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "measure-line",
          type: "line",
          source: "measure",
          filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
          paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1] },
        });
        map.addLayer({
          id: "measure-points",
          type: "circle",
          source: "measure",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 4, "circle-color": ink },
        });
      }
      const present = new Set(map.getStyle().layers.map((l) => basemapGroupOf(l)));
      setGroups(BASEMAP_GROUPS.filter((g) => present.has(g.id)));
      const c = map.getCenter();
      paintReadout(c.lng, c.lat, map.getZoom());
      unbindBounds = bindCopMapBounds(map, () => onBoundsChangeRef.current);
      refresh().catch(() => undefined);
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      paintReadout(c.lng, c.lat, map.getZoom());
    });
    // Newly rendered footprints become hit-testable once the map is idle.
    map.on("idle", joinBuildings);
    // Marks a settled picture (every requested tile drawn) for captures and tests.
    map.on("idle", () => container.current?.setAttribute("data-map-idle", "true"));
    map.on("dataloading", () => container.current?.removeAttribute("data-map-idle"));
    const stopPolling = pollWhileVisible(refresh, props.pollMs ?? 2000);
    return () => {
      active = false;
      stopPolling();
      unbindBounds?.();
      styleReady = false;
      map.remove();
      mapRef.current = null;
    };
    // Board list and theme are stable for the life of a COP screen.
  }, []);

  /** The ids of the layers mounted for one operational source. */
  const mountedLayerIds = (key: string): string[] =>
    (mountedRef.current[key]?.specs ?? []).map((spec) => (spec as { id: string }).id);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const board of props.boards) {
      for (const layerId of mountedLayerIds(sourceId(board.id))) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(
            layerId,
            "visibility",
            layerShown(layerId, visible[board.id] ?? boardDefault(board)) ? "visible" : "none",
          );
        }
      }
    }
  }, [visible, weatherOn, props.boards]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const id of INCIDENT_AREA_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", areaOn ? "visible" : "none");
    }
  }, [areaOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [key, mounted] of Object.entries(mountedRef.current)) {
      for (const spec of mounted.specs) {
        const id = (spec as { id: string }).id;
        if (!map.getLayer(id)) continue;
        for (const [prop, value] of Object.entries(opacityPaint(spec, opacity[key] ?? 1))) {
          map.setPaintProperty(id, prop as "fill-opacity", value);
        }
      }
    }
  }, [opacity]);

  useEffect(() => {
    pickingRef.current = !!props.picking;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.picking ? "crosshair" : "";
  }, [props.picking]);

  useEffect(() => {
    measureRef.current = measure;
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = measure === "off" ? "" : "crosshair";
    // Switching mode or leaving the tool clears the path.
    measureCoordsRef.current = [];
    const src = map.getSource("measure") as maplibregl.GeoJSONSource | undefined;
    src?.setData(EMPTY_FC as never);
    const c = map.getCenter();
    paintReadout(c.lng, c.lat, map.getZoom());
  }, [measure]);

  /** Fit the viewport to every feature on the visible operational layers. */
  const fitToFeatures = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    let any = false;
    const consider = (id: string, on: boolean) => {
      if (!on) return;
      const fc = dataRef.current[id];
      for (const f of fc?.features ?? []) {
        const b = geometryBounds(f.geometry);
        if (!b) continue;
        bounds.extend([b[0], b[1]]).extend([b[2], b[3]]);
        any = true;
      }
    };
    for (const b of props.boards) consider(sourceId(b.id), visible[b.id] ?? boardDefault(b));
    for (const f of props.feeds ?? []) consider(feedSourceId(f.id), feedVisible[f.id] ?? true);
    if (any) map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 500 });
  };

  const goHome = () => {
    if (props.initialBounds) mapRef.current?.fitBounds(props.initialBounds, { padding: 24, bearing: 0, pitch: 0 });
    else mapRef.current?.flyTo({ center: home.center, zoom: home.zoom, bearing: 0, pitch: 0 });
  };

  /** Compose the current frame with identity, operational context and source receipt. */
  const exportImage = () => {
    const map = mapRef.current;
    if (!map) return;
    const operationalLayers: MapExportLayer[] = [
      ...props.boards.filter((board) => visible[board.id] ?? boardDefault(board))
        .map((board) => ({ title: board.title, detail: "Open Source EOC board records" })),
      ...(props.feeds ?? []).filter((feed) => feedVisible[feed.id] ?? true).map((feed) => {
        const health = feedHealth[feed.id];
        const freshness = health
          ? health.stale ? `stale last-good data, ${formatAge(health.ageSeconds)}` : `current, ${formatAge(health.ageSeconds)}`
          : "freshness unknown";
        return { title: feed.title, detail: `${freshness}${health?.incomplete ? ", display incomplete" : ""}` };
      }),
    ];
    const references: string[] = [];
    if (basemapMode !== "vector") {
      const raster = rasterBases.find((candidate) => candidate.id === basemapMode);
      if (raster) references.push(`${raster.title}: ${raster.attribution ?? "configured raster; attribution not supplied"}`);
    } else if (props.basemapStyleUrl) {
      const attributions = Object.values(map.getStyle().sources as Record<string, { attribution?: string }>)
        .flatMap((source) => source.attribution ? [source.attribution] : []);
      references.push(...(attributions.length > 0
        ? attributions
        : ["Deployment-configured basemap style; attribution not supplied to the exporter"]));
    } else if (props.streetBasemap) references.push(OSM_ATTRIBUTION);
    else if (props.bundledBasemap) references.push(BUNDLED_BASEMAP_ATTRIBUTION);
    else if (props.basemap) references.push(NATURAL_EARTH_ATTRIBUTION);
    else references.push("Plain geographic canvas; no basemap source configured");

    for (const overlay of overlays.filter((candidate) => overlayOn[candidate.id])) {
      references.push(`${overlay.title}: ${overlay.attribution ?? "configured overlay; attribution not supplied"}`);
    }
    for (const overlay of VECTOR_OVERLAYS.filter((candidate) => vectorOn[candidate.id])) {
      references.push(`${overlay.title}: ${coverage[overlay.id]?.attribution ?? "configured jurisdiction GIS; coverage attribution unavailable"}`);
    }
    if (hillshade && terrain) references.push(`Hillshade: ${terrain.attribution ?? "configured elevation source; attribution not supplied"}`);
    if (buildings) references.push(buildings.overtureRelease
      ? `Buildings: © OpenStreetMap contributors (ODbL); enrichment: © Overture Maps Foundation (ODbL, ${buildings.overtureRelease})`
      : "Buildings: © OpenStreetMap contributors (ODbL)");

    for (const board of props.boards.filter((candidate) => visible[candidate.id] ?? boardDefault(candidate)))
      references.push(`${board.title}: Open Source EOC board records`);
    for (const feed of (props.feeds ?? []).filter((candidate) => feedVisible[candidate.id] ?? true)) {
      const health = feedHealth[feed.id];
      references.push(`${feed.title}: ${feed.attribution ?? health?.attribution ?? "configured feed; attribution not supplied"}`);
    }

    const activeSourceKeys = [
      ...props.boards.filter((board) => visible[board.id] ?? boardDefault(board)).map((board) => sourceId(board.id)),
      ...(props.feeds ?? []).filter((feed) => feedVisible[feed.id] ?? true).map((feed) => feedSourceId(feed.id)),
    ];
    const hasFacilities = activeSourceKeys.some((key) => dataRef.current[key]?.features.some(
      (feature) => Boolean(feature.properties._facilityType),
    ));
    const legendLines: string[] = [];
    if ((props.feeds ?? []).some((feed) => feed.kind === "fema-flood" && (feedVisible[feed.id] ?? true)))
      legendLines.push(`FLOOD REFERENCE LEGEND: ${FLOOD_LEGEND.map((entry) => entry.title).join("; ")}`);
    if (buildings)
      legendLines.push(`BUILDING USE LEGEND: ${BUILDING_USE_LEGEND.map((entry) => entry.title).join("; ")}`);
    if (hasFacilities)
      legendLines.push(`FACILITY SYMBOLS (NAPSG): ${FACILITY_SYMBOLS.map((entry) => entry.title).join("; ")}`);
    if (Object.values(vectorOn).some(Boolean))
      legendLines.push(`REFERENCE LAYERS: ${VECTOR_OVERLAYS.filter((entry) => vectorOn[entry.id]).map((entry) => entry.title).join("; ")}`);

    downloadMapExport(renderMapExport(map.getCanvas(), {
      ...props.exportContext,
      operationalLayers,
      referenceSources: references,
      legendLines,
      exportedAt: new Date(),
    }));
  };

  const find = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const out: FindResult[] = [];
    const coord = parseCoordinate(q);
    if (coord) {
      out.push({
        key: "coord",
        kind: "coordinate",
        title: `Go to ${coord[1].toFixed(4)}, ${coord[0].toFixed(4)}`,
        detail: "coordinate",
        bounds: [coord[0], coord[1], coord[0], coord[1]],
      });
    }
    for (const h of searchFeatures(dataRef.current, q)) {
      out.push({
        key: `${h.sourceId}/${h.featureId}`,
        kind: "feature",
        title: h.title,
        detail: h.detail,
        bounds: h.bounds,
        sourceId: h.sourceId,
        featureId: h.featureId,
        properties: h.properties,
      });
    }
    const ql = q.toLowerCase();
    for (const [name, bounds] of Object.entries(COUNTY_BOUNDS)) {
      if (out.length >= 12) break;
      if (name.toLowerCase().includes(ql)) {
        out.push({ key: `county/${name}`, kind: "county", title: name, detail: "county", bounds });
      }
    }
    setResults(out);
  };

  const goTo = (r: FindResult) => {
    const map = mapRef.current;
    if (!map) return;
    const center: [number, number] = [(r.bounds[0] + r.bounds[2]) / 2, (r.bounds[1] + r.bounds[3]) / 2];
    const isPoint = r.bounds[0] === r.bounds[2] && r.bounds[1] === r.bounds[3];
    if (isPoint) map.flyTo({ center, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    else map.fitBounds(r.bounds, { padding: 64, maxZoom: 14, duration: 600 });
    markerRef.current?.remove();
    markerRef.current = null;
    if (r.kind === "coordinate") {
      const marker = new maplibregl.Marker({ color: themes[props.theme].text })
        .setLngLat(center)
        .addTo(map);
      // The marker is a DOM element over the canvas; it must not swallow the
      // next map click (an operator goes to a coordinate, then drops a point
      // there).
      marker.getElement().style.pointerEvents = "none";
      markerRef.current = marker;
    }
    if (r.kind === "feature" && r.properties && popupRef.current) {
      if (props.inspectionMode !== "popup") {
        popupRef.current.remove();
        openInspection(r.properties, r.sourceId ?? "", r.sourceId ?? "", undefined, r.featureId);
      } else {
        popupRef.current.setLngLat(center).setHTML(featureHtml(r.properties)).addTo(map);
      }
    }
  };

  const saveBookmark = (e: FormEvent) => {
    e.preventDefault();
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const name = bookmarkName.trim() || `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
    const mark: Bookmark = { name, center: [c.lng, c.lat], zoom: map.getZoom() };
    const next = [...bookmarks.filter((b) => b.name !== name), mark];
    setBookmarks(next);
    storeBookmarks(next);
    setBookmarkName("");
  };

  const removeBookmark = (name: string) => {
    const next = bookmarks.filter((b) => b.name !== name);
    setBookmarks(next);
    storeBookmarks(next);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || rasters.length === 0) return;
    const apply = () => {
      for (const r of rasters) {
        const id = rasterLayerId(r.id);
        if (!map.getLayer(id)) continue;
        const on = r.overlay ? !!overlayOn[r.id] : basemapMode === r.id;
        map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      }
      if (map.getLayer(IMAGERY_WATER_LAYER_ID)) {
        map.setLayoutProperty(IMAGERY_WATER_LAYER_ID, "visibility", basemapMode === "vector" ? "none" : "visible");
      }
      for (const [id, ink] of Object.entries(IMAGERY_ROAD_INK)) {
        if (!map.getLayer(id)) continue;
        roadInkRef.current[id] ??= map.getPaintProperty(id, "line-color");
        map.setPaintProperty(id, "line-color", (basemapMode === "vector" ? roadInkRef.current[id] : ink) as string);
      }
      // Relief shades the imagery from just above it, and the map from under its water and roads.
      if (!map.getLayer(HILLSHADE_LAYER_ID)) return;
      if (reliefAnchorRef.current === undefined) reliefAnchorRef.current = nextLayerId(map, HILLSHADE_LAYER_ID);
      const before = basemapMode === "vector" ? reliefAnchorRef.current : nextLayerId(map, rasterLayerId(basemapMode));
      if (before && before !== HILLSHADE_LAYER_ID) map.moveLayer(HILLSHADE_LAYER_ID, before);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [basemapMode, overlayOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !terrain) return;
    const apply = () => {
      if (map.getLayer(HILLSHADE_LAYER_ID)) {
        map.setLayoutProperty(HILLSHADE_LAYER_ID, "visibility", hillshade ? "visible" : "none");
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [hillshade]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vectors) return;
    const apply = () => {
      for (const layer of map.getStyle().layers) {
        const group = overlayGroupOf(layer);
        if (group) map.setLayoutProperty(layer.id, "visibility", vectorOn[group] ? "visible" : "none");
      }
    };
    // Tile loading can make isStyleLoaded false after the one-time load event.
    // Existing layers can still accept visibility changes during that work.
    if (map.getLayer("overlay-land_ownership")) apply();
    else map.once("load", apply);
    return () => { map.off("load", apply); };
  }, [vectorOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const layer of map.getStyle().layers) {
      const g = basemapGroupOf(layer);
      if (!g) continue;
      map.setLayoutProperty(layer.id, "visibility", (groupOn[g] ?? true) ? "visible" : "none");
    }
  }, [groupOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const feed of props.feeds ?? []) {
      for (const layerId of mountedLayerIds(feedSourceId(feed.id))) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(
            layerId,
            "visibility",
            (feedVisible[feed.id] ?? true) ? "visible" : "none",
          );
        }
      }
    }
  }, [feedVisible, props.feeds]);

  // The light card's callout names the incident beside its boundary.
  useEffect(() => {
    const area = props.incidentArea;
    const bounds = area ? geometryBounds(area.geometry) : null;
    if (!liveMap || !card || props.theme !== "light" || !area?.title || !bounds || !areaOn) return;
    const callout = document.createElement("div");
    callout.className = "eoc-cop-area-callout";
    const key = document.createElement("span");
    key.className = "eoc-cop-card-key is-boundary";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = area.title;
    text.append(title, ...(area.detail ?? []).map((line) => Object.assign(document.createElement("span"), { textContent: line })));
    callout.append(key, text);
    const marker = new maplibregl.Marker({ element: callout, anchor: "right", offset: [-10, 0] })
      .setLngLat([bounds[0], (bounds[1] + bounds[3]) / 2])
      .addTo(liveMap);
    return () => { marker.remove(); };
  }, [liveMap, props.theme, areaOn]);

  const templateBoards = (template: string) => props.boards.filter((board) => board.templateKey === template);
  const boardsToggle = (id: string, label: string, boards: readonly CopBoard[]): CardToggle[] => {
    if (boards.length === 0) return [];
    const on = boards.every((board) => visible[board.id] ?? boardDefault(board));
    return [{ id, label, checked: on, onChange: () => setVisible((current) => ({ ...current, ...Object.fromEntries(boards.map((board) => [board.id, !on])) })) }];
  };
  const areaToggle = (label: string): CardToggle[] => props.incidentArea
    ? [{ id: "area", label, checked: areaOn, onChange: () => setAreaOn((on) => !on) }]
    : [];
  const facilityBoards = templateBoards("incident_facilities");
  const weatherToggle = (label: string): CardToggle[] => facilityBoards.length > 0
    ? [{ id: "weather", label, checked: weatherOn, onChange: () => setWeatherOn((on) => !on) }]
    : [];
  const terrainToggle = (label: string): CardToggle[] => terrain
    ? [{ id: "terrain", label, checked: hillshade, onChange: () => setHillshade((on) => !on) }]
    : [];
  const cardToggles: CardToggle[] = props.theme === "dark"
    ? [
        ...boardsToggle("roads", "Roads", templateBoards("road_closures")),
        ...areaToggle("Incidents"),
        ...boardsToggle("facilities", "Facilities", facilityBoards),
        ...boardsToggle("shelters", "Shelters", templateBoards("shelters")),
        ...weatherToggle("Weather"),
        ...terrainToggle("Terrain"),
      ]
    : [
        ...areaToggle("Incident extent"),
        ...boardsToggle("closures", "Closures", templateBoards("road_closures")),
        ...boardsToggle("shelters", "Shelters", templateBoards("shelters")),
        ...boardsToggle("facilities", "Critical facilities", facilityBoards),
      ];
  const imagery = rasterBases.find((raster) => raster.id === "imagery");
  const moreToggles: CardToggle[] = [
    ...weatherToggle("Weather stations"),
    ...terrainToggle("Terrain"),
    ...(imagery ? [{ id: "imagery", label: imagery.title, checked: basemapMode === imagery.id,
      onChange: () => setBasemapMode((mode) => (mode === imagery.id ? "vector" : imagery.id)) }] : []),
    ...props.boards.filter((board) => !CARTOGRAPHY_TEMPLATES.has(board.templateKey ?? ""))
      .flatMap((board) => boardsToggle(board.id, board.title, [board])),
  ];

  const layerNeedle = layerQuery.trim().toLowerCase();
  const layerMatches = (label: string) => !layerNeedle || label.toLowerCase().includes(layerNeedle);
  const shownBoards = props.boards.filter((board) => layerMatches(board.title));
  const shownFeeds = (props.feeds ?? []).filter((feed) => layerMatches(feed.title));
  const shownVectors = VECTOR_OVERLAYS.filter((overlay) => layerMatches(overlay.title));
  const shownRasters = overlays.filter((overlay) => layerMatches(overlay.title));
  const shownGroups = groups.filter((group) => layerMatches(group.title));
  const shownBasemaps = [{ id: "vector", title: "Map" }, ...rasterBases]
    .filter((basemap) => layerMatches(basemap.title));
  const noLayerMatches = !!layerNeedle
    && shownBoards.length + shownFeeds.length + shownVectors.length + shownRasters.length
      + shownGroups.length + shownBasemaps.length === 0
    && !(terrain && layerMatches("Hillshade"));

  return (
    <div ref={frameRef} className="eoc-cop-container" data-layout={props.layout ?? "workspace"}>
    <div className="eoc-cop-workspace" data-inspecting={selection ? true : undefined} data-layers-closed={layersOpen ? undefined : true} data-testid="cop-workspace">
      <nav aria-label="Map layers" className="eoc-cop-layers" hidden={!layersOpen}>
        <header>
          <Icon name="map" size={20} decorative />
          <h2>Map layers</h2>
          <button type="button" className="eoc-cop-layers-hide" aria-label="Hide map layers" onClick={() => showLayers(false)}>
            <Icon name="chevronRight" size={16} decorative />
          </button>
        </header>
        <div className="eoc-cop-filter">
          <label htmlFor="cop-layer-filter">Filter layer groups</label>
          <div className="eoc-cop-search">
            <Icon name="search" size={16} decorative />
            <input
              id="cop-layer-filter"
              type="search"
              placeholder="Layer name"
              value={layerQuery}
              onChange={(event) => setLayerQuery(event.target.value)}
            />
          </div>
        </div>
        <EmptyLayerSearch visible={noLayerMatches} />
        <form onSubmit={(e) => void find(e)} className="eoc-cop-find">
          <label htmlFor="cop-feature-find">Find on map</label>
          <div className="eoc-cop-search">
            <Icon name="search" size={16} decorative />
            <input
              id="cop-feature-find"
              type="search"
              aria-label="Find on map"
              placeholder="Record, county, or lat, lng"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {results.length > 0 ? (
            <ul className="eoc-cop-results">
              {results.map((r) => (
                <li key={r.key}>
                  <button type="button" className="eoc-cop-tool" onClick={() => goTo(r)}>
                    <span>{r.title}</span>
                    <span>{r.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        <WorkspaceSection
          title="Reference layers"
          icon="feeds"
          className="is-reference"
          defaultOpen
          forceOpen={!!layerNeedle}
          testId="reference-layer-group"
        >
        {shownBasemaps.length > 0 ? (
          <div className="eoc-cop-above">
            <h3 className="eoc-cop-heading">Basemap</h3>
            <div className="eoc-cop-buttons">
              {shownBasemaps.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={basemapMode === b.id}
                  onClick={() => setBasemapMode(b.id)}
                  className="eoc-cop-tool is-grow"
                >
                  {b.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {shownRasters.length > 0 || (terrain && layerMatches("Hillshade")) || (vectors && shownVectors.length > 0) ? (
          <div className="eoc-cop-above">
            <h3 className="eoc-cop-heading">Overlays</h3>
            <ul className="eoc-cop-options">
              {vectors ? shownVectors.map((o) => (
                <li key={o.id}>
                  <label className="eoc-cop-check">
                    <input type="checkbox" disabled={coverage[o.id]?.available === false} checked={!!vectorOn[o.id]}
                      onChange={() => setVectorOn((v) => ({ ...v, [o.id]: !v[o.id] }))} />
                    {o.title}
                  </label>
                  <small className="eoc-cop-note">{coverage[o.id]?.coverage ?? "Coverage unverified: source manifest unavailable"}</small>
                  {vectorOn[o.id] && coverage[o.id]?.attribution ? <details className="eoc-cop-source"><summary>Source</summary>{coverage[o.id]?.attribution}</details> : null}
                </li>
              )) : null}
              {terrain && layerMatches("Hillshade") ? (
                <li>
                  <label className="eoc-cop-check">
                    <input
                      type="checkbox"
                      checked={hillshade}
                      onChange={() => setHillshade((h) => !h)}
                    />
                    Hillshade
                  </label>
                </li>
              ) : null}
              {shownRasters.map((o) => (
                <li key={o.id}>
                  <label className="eoc-cop-check">
                    <input
                      type="checkbox"
                      checked={!!overlayOn[o.id]}
                      onChange={() => setOverlayOn((v) => ({ ...v, [o.id]: !v[o.id] }))}
                    />
                    {o.title}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {vectors && Object.values(vectorOn).some(Boolean) ? (
          <div className="eoc-cop-above">
            <h3 className="eoc-cop-heading">Road jurisdiction and land ownership</h3>
            <ul className="eoc-cop-legend">
              {ROAD_OVERLAYS.filter((r) => vectorOn[r.id]).map((r) => (
                <li key={r.id}><span aria-hidden="true" className="eoc-cop-road-key" style={{ borderTopColor: r[props.theme] }} />{r.title}</li>
              ))}
              {vectorOn.land_ownership ? OWNERSHIP_LEVELS.map((level) => (
                <li key={level.id}><span aria-hidden="true" className="eoc-cop-land-key" style={{ backgroundColor: level[props.theme] }} />{level.id}</li>
              )) : null}
            </ul>
            <p className="eoc-cop-fine">Coverage follows the configured source. Unmapped land does not imply private ownership.</p>
          </div>
        ) : null}
        {buildings ? (
          <div className="eoc-cop-above">
            <h3 className="eoc-cop-heading">Building use</h3>
            <ul className="eoc-cop-options">
              {BUILDING_USE_LEGEND.map((u) => (
                <li key={u.id} className="eoc-cop-key">
                  <span
                    aria-hidden="true"
                    className="eoc-cop-swatch"
                    style={{ backgroundColor: BUILDING_USE_COLORS[props.theme][u.id] }}
                  />
                  {u.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {shownGroups.length > 0 ? (
          <div className="eoc-cop-above">
            <h3 className="eoc-cop-heading">Basemap layers</h3>
            <ul className="eoc-cop-options">
              {shownGroups.map((g) => (
                <li key={g.id}>
                  <label className="eoc-cop-check">
                    <input
                      type="checkbox"
                      checked={groupOn[g.id] ?? true}
                      onChange={() => setGroupOn((v) => ({ ...v, [g.id]: !(v[g.id] ?? true) }))}
                    />
                    {g.title}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        </WorkspaceSection>
        <WorkspaceSection
          title="Operational layers"
          icon="boards"
          className="is-operational"
          defaultOpen
          forceOpen={!!layerNeedle}
          testId="operational-layer-group"
        >
        <h3 className="eoc-cop-heading">Layers</h3>
        <ul className="eoc-cop-options">
          {props.incidentArea && layerMatches("Incident area") ? (
            <li>
              <label className="eoc-cop-check">
                <input type="checkbox" checked={areaOn} onChange={() => setAreaOn((on) => !on)} />
                Incident area
              </label>
            </li>
          ) : null}
          {shownBoards.map((b) => (
            <li key={b.id}>
              <label className="eoc-cop-check">
                <input
                  type="checkbox"
                  checked={visible[b.id] ?? boardDefault(b)}
                  onChange={() =>
                    setVisible((v) => ({ ...v, [b.id]: !(v[b.id] ?? boardDefault(b)) }))
                  }
                />
                {b.title}
              </label>
              <LayerOpacity value={opacity[sourceId(b.id)] ?? 1}
                onChange={(value) => setOpacity((o) => ({ ...o, [sourceId(b.id)]: value }))} />
            </li>
          ))}
        </ul>
        {shownBoards.length ? (
          <p className="eoc-cop-layer-meta">
            Source: application boards. If a record has no update time, its freshness remains unknown.
          </p>
        ) : null}
        {shownFeeds.length > 0 ? (
          <div className="eoc-cop-below">
            <h3 className="eoc-cop-heading">Feeds</h3>
            <ul className="eoc-cop-options">
              {shownFeeds.map((f) => (
                <li key={f.id}>
                  <label className="eoc-cop-check">
                    <input
                      type="checkbox"
                      checked={feedVisible[f.id] ?? true}
                      onChange={() =>
                        setFeedVisible((v) => ({ ...v, [f.id]: !(v[f.id] ?? true) }))
                      }
                    />
                    {f.title}
                  </label>
                  <LayerOpacity value={opacity[feedSourceId(f.id)] ?? 1}
                    onChange={(value) => setOpacity((o) => ({ ...o, [feedSourceId(f.id)]: value }))} />
                  <small className="eoc-cop-note">
                    {f.coverage ?? feedHealth[f.id]?.coverage ?? "Coverage unknown"}
                  </small>
                  {feedHealth[f.id] ? (
                    <small className="eoc-cop-note">
                      {feedHealth[f.id]!.stale ? "Stale last-good data" : `Freshness: ${formatAge(feedHealth[f.id]!.ageSeconds)}`}
                    </small>
                  ) : <small className="eoc-cop-layer-meta">Freshness unknown</small>}
                  {feedHealth[f.id]?.incomplete ? (
                    <small role="status" className="eoc-cop-note is-warning">
                      Display incomplete: bounded page limit reached.
                    </small>
                  ) : null}
                  {f.attribution || feedHealth[f.id]?.attribution ? (
                    <details className="eoc-cop-source">
                      <summary>Source</summary>{f.attribution ?? feedHealth[f.id]?.attribution}
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        </WorkspaceSection>
        <WorkspaceSection title="Legends" icon="source" className="is-legends" defaultOpen testId="map-legends">
        {(props.feeds ?? []).some((feed) => feed.kind === "fema-flood") ? (
          <div className="eoc-cop-below">
            <h3 className="eoc-cop-heading">Flood hazard (static reference)</h3>
            <ul className="eoc-cop-options">
              {FLOOD_LEGEND.map((entry) => (
                <li key={entry.id} className="eoc-cop-key">
                  <span aria-hidden="true" className="eoc-cop-swatch is-flood" style={{ backgroundColor: floodColor(entry.id, props.theme) }} />
                  {entry.title}
                </li>
              ))}
            </ul>
            <p className="eoc-cop-fine">
              Static FEMA reference, separate from current incident status. Unmapped or unclassified areas remain unknown.
            </p>
            <details className="eoc-cop-fine">
              <summary>Source</summary>{FEMA_NFHL_ATTRIBUTION}
            </details>
          </div>
        ) : null}
        <div className="eoc-cop-below">
          <details data-testid="facility-legend">
            <summary className="eoc-cop-heading">Facility types (NAPSG)</summary>
            <ul className="eoc-cop-facility-key">
              {FACILITY_SYMBOLS.map((entry) => (
                <li key={entry.type}>
                  <img src={`${facilityAssetBase}${entry.assetFile}`} alt="" width={24} height={24} />
                  {entry.title}
                </li>
              ))}
            </ul>
            <p className="eoc-cop-fine is-smaller">{NAPSG_ATTRIBUTION}</p>
          </details>
        </div>
        <div className="eoc-cop-below">
          <h3 className="eoc-cop-heading">Status</h3>
          <ul className="eoc-cop-options">
            {LEGEND.map((s) => (
              <li key={s} className="eoc-cop-key">
                <span aria-hidden="true" className="eoc-cop-swatch is-status" style={{ backgroundColor: statusColor(s, props.theme) }} />
                {s}
              </li>
            ))}
          </ul>
        </div>
        </WorkspaceSection>
        <WorkspaceSection title="Map tools and saved views" icon="settings" className="is-tools" testId="map-tools">
        <div className="eoc-cop-below">
          <h3 className="eoc-cop-heading">Tools</h3>
          <div className="eoc-cop-buttons">
            <button type="button" onClick={goHome} className="eoc-cop-tool">
              Home
            </button>
            <button type="button" onClick={fitToFeatures} className="eoc-cop-tool">
              Zoom to extent
            </button>
            <button
              type="button"
              aria-pressed={measure === "distance"}
              onClick={() => setMeasure((m) => (m === "distance" ? "off" : "distance"))}
              className="eoc-cop-tool"
            >
              {measure === "distance" ? "Measuring…" : "Measure"}
            </button>
            <button
              type="button"
              aria-pressed={measure === "area"}
              onClick={() => setMeasure((m) => (m === "area" ? "off" : "area"))}
              className="eoc-cop-tool"
            >
              {measure === "area" ? "Measuring area…" : "Measure area"}
            </button>
            <button type="button" onClick={exportImage} className="eoc-cop-tool">
              Export image
            </button>
          </div>
        </div>
        <div className="eoc-cop-below">
          <h3 className="eoc-cop-heading">Bookmarks</h3>
          <form onSubmit={saveBookmark} className="eoc-cop-bookmark">
            <input
              type="text"
              aria-label="Bookmark name"
              placeholder="Name this view"
              value={bookmarkName}
              onChange={(e) => setBookmarkName(e.target.value)}
            />
            <button type="submit" className="eoc-cop-tool">
              Save view
            </button>
          </form>
          {bookmarks.length > 0 ? (
            <ul className="eoc-cop-results">
              {bookmarks.map((b) => (
                <li key={b.name} className="eoc-cop-bookmark">
                  <button
                    type="button"
                    onClick={() =>
                      mapRef.current?.flyTo({ center: b.center, zoom: b.zoom, duration: 600 })
                    }
                    className="eoc-cop-tool is-grow is-start"
                  >
                    {b.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove bookmark ${b.name}`}
                    onClick={() => removeBookmark(b.name)}
                    className="eoc-cop-tool"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        </WorkspaceSection>
      </nav>
      <div className="eoc-cop-map-frame">
        <div
          ref={container}
          data-testid="cop-map"
          role="region"
          aria-label="Common operating picture map"
          className="eoc-cop-map"
        />
        <div ref={readoutRef} data-testid="cop-readout" className="eoc-cop-readout" />
        {!card && !layersOpen ? (
          <button type="button" className="eoc-cop-layers-show" onClick={() => showLayers(true)}>
            <Icon name="map" size={16} decorative />Map layers
          </button>
        ) : null}
        {props.overlay}
        {card ? (
          <CardOverlays theme={props.theme} map={liveMap} frame={frameRef} toggles={cardToggles} more={moreToggles} search={props.cardSearch} />
        ) : null}
      </div>
      {selection ? <CopFeatureInspector selection={selection} onClose={closeInspection} onOpenRecord={props.onOpenRecord} /> : null}
    </div>
    </div>
  );
}

/**
 * A layer's opacity slider, named "Opacity" alone; the layer's checkbox
 * directly above it carries the layer title.
 */
function LayerOpacity(props: { value: number; onChange: (value: number) => void }) {
  const percent = Math.round(props.value * 100);
  return (
    <label className="eoc-cop-opacity">
      Opacity
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-valuetext={`${percent}%`}
        onChange={(event) => props.onChange(Number(event.target.value) / 100)}
      />
    </label>
  );
}
