import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { Icon } from "../design/icons/index.js";
import "./cop-workspace.css";
import { withJurisdictionOverlays, readOverlayCoverage, type OverlayCoverage, VECTOR_OVERLAYS, ROAD_OVERLAYS, OWNERSHIP_LEVELS, overlayGroupOf, type JurisdictionOverlays } from "./overlays.js";
import { themes, type ThemeName } from "../design/tokens.js";
import {
  boardLayerIds,
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
  rasterLayerId,
  sourceId,
  tagFeatures,
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
  OSM_ATTRIBUTION,
  streetFontStack,
  type StreetBasemapConfig,
} from "./streetstyle.js";
import { statusColor, type SymbolStatus } from "./symbology.js";
import {
  feedLayerIds,
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
  /** Final D11 drawer by default; explicit popup preserves the legacy direct-map mode. */
  readonly inspectionMode?: "popup" | "workspace" | undefined;
  /** Exact persisted dataset feature requested by an operational relationship. */
  readonly requestedFeature?: { readonly datasetId: string; readonly featureId: string } | null | undefined;
  /** Reports only persisted feed/dataset feature identity, never a rendered synthetic id. */
  readonly onInspectFeature?: ((feature: CopSelectedDatasetFeature | null) => void) | undefined;
  /** Test/instrumentation hook: receives the live map instance. */
  readonly onMap?: ((map: maplibregl.Map) => void) | undefined;
  /** Stored incident context printed outside the map frame in PNG exports. */
  readonly exportContext?: MapExportContext | undefined;
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
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(props.boards.map((b) => [b.id, true])),
  );
  const [feedVisible, setFeedVisible] = useState<Record<string, boolean>>(
    Object.fromEntries((props.feeds ?? []).map((f) => [f.id, true])),
  );
  const [feedHealth, setFeedHealth] = useState<Record<string, FeedLayerHealth>>({});
  // The gallery: an external style carries its own basemap, so no rasters there.
  const rasters = props.basemapStyleUrl ? [] : (props.rasterBasemaps ?? []);
  const rasterBases = rasters.filter((r) => !r.overlay);
  const overlays = rasters.filter((r) => r.overlay);
  const [basemapMode, setBasemapMode] = useState("vector");
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
  const [hillshade, setHillshade] = useState(false);
  // Basemap layer groups present in the active style (discovered on load),
  // each switchable like an operational layer.
  const [groups, setGroups] = useState<readonly (typeof BASEMAP_GROUPS)[number][]>([]);
  const [groupOn, setGroupOn] = useState<Record<string, boolean>>({});
  const readoutRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<MeasureMode>("off");
  const measureCoordsRef = useRef<[number, number][]>([]);
  const [measure, setMeasure] = useState<MeasureMode>("off");
  // The last fetched features per source, so zoom-to-extent and search cover
  // every feature, not just those in the current viewport (querySourceFeatures
  // is viewport-bound).
  const dataRef = useRef<Record<string, CopFeatureCollection>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FindResult[]>([]);
  const countiesRef = useRef<Record<string, Bounds> | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const requestedFeatureRef = useRef(props.requestedFeature);
  const onInspectFeatureRef = useRef(props.onInspectFeature);
  const openedRequestedFeatureRef = useRef("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [bookmarkName, setBookmarkName] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  const [selection, setSelection] = useState<CopInspection | null>(null);
  const feedHealthRef = useRef(feedHealth);
  const coverageRef = useRef(coverage);
  const boardsRef = useRef(props.boards);
  const feedsRef = useRef(props.feeds ?? []);
  feedHealthRef.current = feedHealth;
  coverageRef.current = coverage;
  boardsRef.current = props.boards;
  feedsRef.current = props.feeds ?? [];
  requestedFeatureRef.current = props.requestedFeature;
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
    const rawStatus = properties._symbolStatus ?? featureStatus;
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
    setSelection({
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
    datasetId: string,
    feature: CopFeatureCollection["features"][number],
  ) => {
    const map = mapRef.current;
    const bounds = geometryBounds(feature.geometry);
    if (!map || !bounds) return;
    const center: [number, number] = [
      (bounds[0] + bounds[2]) / 2,
      (bounds[1] + bounds[3]) / 2,
    ];
    const isPoint = bounds[0] === bounds[2] && bounds[1] === bounds[3];
    setFeedVisible((current) => ({ ...current, [datasetId]: true }));
    if (isPoint) map.flyTo({ center, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    else map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 600 });
    popupRef.current?.remove();
    openInspection(
      feature.properties,
      feedSourceId(datasetId),
      feedSourceId(datasetId),
      feature.properties._symbolStatus,
      feature.id,
    );
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
    let tail = "";
    if (mode === "distance") {
      tail = coords.length >= 2 ? ` · ${totalMiles(coords).toFixed(2)} mi` : " · click to measure";
    } else if (mode === "area") {
      tail =
        coords.length >= 3
          ? ` · ${formatArea(polygonAreaSqMi(coords))}`
          : " · click three or more points";
    }
    el.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)} · z${zoom.toFixed(1)}${tail}`;
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
    if (terrain) {
      // MapLibre's own 3D terrain toggle, over the same DEM as the hillshade.
      map.addControl(
        new maplibregl.TerrainControl({ source: DEM_SOURCE_ID, exaggeration: 1.3 }),
        "top-right",
      );
    }
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
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

    const refresh = async () => {
      if (!styleReady) return;
      for (const board of props.boards) {
        try {
          const fc = tagFeatures(await props.fetchItems(board.id));
          dataRef.current[sourceId(board.id)] = fc;
          const source = map.getSource(sourceId(board.id)) as maplibregl.GeoJSONSource | undefined;
          if (source) source.setData(fc as never);
          else {
            map.addSource(sourceId(board.id), { type: "geojson", data: fc as never });
            for (const spec of boardLayerSpecs(board.id, props.theme, labelFont)) {
              map.addLayer(spec as never);
            }
          }
        } catch {
          // A failed refresh keeps the last good picture; never blank the COP.
        }
      }
      if (props.fetchFeedItems) {
        for (const feed of props.feeds ?? []) {
          try {
            const res = await props.fetchFeedItems(feed.id);
            const fc = feed.kind === "fema-flood"
              ? tagFloodFeatures(res, res.feed)
              : tagFeedFeatures(res, res.feed);
            dataRef.current[feedSourceId(feed.id)] = fc;
            const source = map.getSource(feedSourceId(feed.id)) as maplibregl.GeoJSONSource | undefined;
            if (source) source.setData(fc as never);
            else {
              map.addSource(feedSourceId(feed.id), { type: "geojson", data: fc as never });
              for (const spec of feedLayerSpecs(feed.id, props.theme, labelFont, feed.kind)) {
                map.addLayer(spec as never);
              }
            }
            setFeedHealth((current) => ({ ...current, [feed.id]: res.feed }));
            const requested = requestedFeatureRef.current;
            const requestKey = requested ? `${requested.datasetId}/${requested.featureId}` : "";
            if (requested?.datasetId === feed.id && openedRequestedFeatureRef.current !== requestKey) {
              const feature = fc.features.find((candidate) => candidate.id === requested.featureId);
              if (feature) {
                openedRequestedFeatureRef.current = requestKey;
                inspectRequestedFeature(feed.id, feature);
              }
            }
          } catch {
            // A stale or failed feed keeps its last features; never blank the COP.
          }
        }
      }
      if (map.isStyleLoaded()) joinBuildings();
    };

    map.on("load", async () => {
      ensureHazardPatterns(map, props.theme);
      try {
        await ensureFacilityImages(map, facilityAssetBase);
      } catch {
        // A missing packaged icon must not prevent operational records loading.
      }
      if (!active) return;
      styleReady = true;
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
      void refresh();
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      paintReadout(c.lng, c.lat, map.getZoom());
    });
    // Newly rendered footprints become hit-testable once the map is idle.
    map.on("idle", joinBuildings);
    const timer = setInterval(() => void refresh(), props.pollMs ?? 2000);
    return () => {
      active = false;
      clearInterval(timer);
      unbindBounds?.();
      styleReady = false;
      map.remove();
      mapRef.current = null;
    };
    // Board list and theme are stable for the life of a COP screen.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const board of props.boards) {
      for (const layerId of boardLayerIds(board.id)) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(
            layerId,
            "visibility",
            (visible[board.id] ?? true) ? "visible" : "none",
          );
        }
      }
    }
  }, [visible, props.boards]);

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
    for (const b of props.boards) consider(sourceId(b.id), visible[b.id] ?? true);
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
      ...props.boards.filter((board) => visible[board.id] ?? true)
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

    for (const board of props.boards.filter((candidate) => visible[candidate.id] ?? true))
      references.push(`${board.title}: Open Source EOC board records`);
    for (const feed of (props.feeds ?? []).filter((candidate) => feedVisible[candidate.id] ?? true)) {
      const health = feedHealth[feed.id];
      references.push(`${feed.title}: ${feed.attribution ?? health?.attribution ?? "configured feed; attribution not supplied"}`);
    }

    const activeSourceKeys = [
      ...props.boards.filter((board) => visible[board.id] ?? true).map((board) => sourceId(board.id)),
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

  /** County bounds for the find box, read once from the bundled boundaries. */
  const loadCounties = async (): Promise<Record<string, Bounds>> => {
    if (countiesRef.current) return countiesRef.current;
    const out: Record<string, Bounds> = {};
    if (assetBase) {
      try {
        const res = await fetch(`${assetBase}basemap/ca_counties.geojson`);
        const fc = (await res.json()) as {
          features?: Array<{ properties?: { name?: string }; geometry?: unknown }>;
        };
        for (const f of fc.features ?? []) {
          const b = geometryBounds(f.geometry);
          if (f.properties?.name && b) out[f.properties.name] = b;
        }
      } catch {
        // Without the boundaries the find box still covers records and coordinates.
      }
    }
    countiesRef.current = out;
    return out;
  };

  const find = async (e: FormEvent) => {
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
    const counties = await loadCounties();
    const ql = q.toLowerCase();
    for (const [name, bounds] of Object.entries(counties)) {
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
      for (const layerId of feedLayerIds(feed.id, feed.kind)) {
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
    <div className="eoc-cop-container">
    <div className="eoc-cop-workspace" data-inspecting={selection ? true : undefined} data-testid="cop-workspace">
      <nav aria-label="Map layers" className="eoc-cop-layers">
        <header>
          <Icon name="map" size={20} decorative />
          <h2>Map layers</h2>
        </header>
        <div className="eoc-cop-filter">
          <label htmlFor="cop-layer-filter">Filter layer groups</label>
          <Icon name="search" size={16} decorative />
          <input
            id="cop-layer-filter"
            type="search"
            placeholder="Layer name"
            value={layerQuery}
            onChange={(event) => setLayerQuery(event.target.value)}
          />
        </div>
        <EmptyLayerSearch visible={noLayerMatches} />
        <form onSubmit={(e) => void find(e)} className="eoc-cop-find">
          <label htmlFor="cop-feature-find">Find on map</label>
          <Icon name="search" size={16} decorative />
          <input
            id="cop-feature-find"
            type="search"
            aria-label="Find on map"
            placeholder="Record, county, or lat, lng"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 ? (
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 2 }}>
              {results.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => goTo(r)}
                    style={{ ...toolButtonStyle(false), width: "100%", textAlign: "left" }}
                  >
                    <span style={{ display: "block" }}>{r.title}</span>
                    <span style={{ display: "block", fontSize: "0.8em", color: "var(--eoc-text-muted)" }}>
                      {r.detail}
                    </span>
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
          <div style={{ marginBottom: 12 }}>
            <h3 style={headingStyle}>Basemap</h3>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {shownBasemaps.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={basemapMode === b.id}
                  onClick={() => setBasemapMode(b.id)}
                  style={{ ...toolButtonStyle(basemapMode === b.id), flex: 1 }}
                >
                  {b.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {shownRasters.length > 0 || (terrain && layerMatches("Hillshade")) || (vectors && shownVectors.length > 0) ? (
          <div style={{ marginBottom: 12 }}>
            <h3 style={headingStyle}>Overlays</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {vectors ? shownVectors.map((o) => (
                <li key={o.id}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" disabled={coverage[o.id]?.available === false} checked={!!vectorOn[o.id]}
                      onChange={() => setVectorOn((v) => ({ ...v, [o.id]: !v[o.id] }))} />
                    {o.title}
                  </label>
                  <small style={{ display: "block", marginLeft: 24, color: "var(--eoc-text-muted)" }}>{coverage[o.id]?.coverage ?? "Coverage unverified: source manifest unavailable"}</small>
                  {vectorOn[o.id] && coverage[o.id]?.attribution ? <details style={{ marginLeft: 24, fontSize: "0.8em", color: "var(--eoc-text-muted)" }}><summary>Source</summary>{coverage[o.id]?.attribution}</details> : null}
                </li>
              )) : null}
              {terrain && layerMatches("Hillshade") ? (
                <li>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          <div style={{ marginBottom: 12 }}>
            <h3 style={headingStyle}>Road jurisdiction and land ownership</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {ROAD_OVERLAYS.filter((r) => vectorOn[r.id]).map((r) => (
                <li key={r.id}><span aria-hidden="true" style={{ display: "inline-block", width: 14, marginRight: 8, borderTop: "3px solid " + r[props.theme] }} />{r.title}</li>
              ))}
              {vectorOn.land_ownership ? OWNERSHIP_LEVELS.map((level) => (
                <li key={level.id}><span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, marginRight: 8, background: level[props.theme] }} />{level.id}</li>
              )) : null}
            </ul>
            <p style={{ fontSize: "0.8em", color: "var(--eoc-text-muted)" }}>Coverage follows the configured source. Unmapped land does not imply private ownership.</p>
          </div>
        ) : null}
        {buildings ? (
          <div style={{ marginBottom: 12 }}>
            <h3 style={headingStyle}>Building use</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {BUILDING_USE_LEGEND.map((u) => (
                <li key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85em" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: BUILDING_USE_COLORS[props.theme][u.id],
                      display: "inline-block",
                    }}
                  />
                  {u.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {shownGroups.length > 0 ? (
          <div style={{ marginBottom: 12 }}>
            <h3 style={headingStyle}>Basemap layers</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {shownGroups.map((g) => (
                <li key={g.id}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
        <h3 style={headingStyle}>Layers</h3>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {shownBoards.map((b) => (
            <li key={b.id}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={visible[b.id] ?? true}
                  onChange={() =>
                    setVisible((v) => ({ ...v, [b.id]: !(v[b.id] ?? true) }))
                  }
                />
                {b.title}
              </label>
            </li>
          ))}
        </ul>
        {shownBoards.length ? (
          <p className="eoc-cop-layer-meta">
            Source: application boards. If a record has no update time, its freshness remains unknown.
          </p>
        ) : null}
        {shownFeeds.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <h3 style={headingStyle}>Feeds</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {shownFeeds.map((f) => (
                <li key={f.id}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={feedVisible[f.id] ?? true}
                      onChange={() =>
                        setFeedVisible((v) => ({ ...v, [f.id]: !(v[f.id] ?? true) }))
                      }
                    />
                    {f.title}
                  </label>
                  <small style={{ display: "block", marginLeft: 24, color: "var(--eoc-text-muted)" }}>
                    {f.coverage ?? feedHealth[f.id]?.coverage ?? "Coverage unknown"}
                  </small>
                  {feedHealth[f.id] ? (
                    <small style={{ display: "block", marginLeft: 24, color: "var(--eoc-text-muted)" }}>
                      {feedHealth[f.id]!.stale ? "Stale last-good data" : `Freshness: ${formatAge(feedHealth[f.id]!.ageSeconds)}`}
                    </small>
                  ) : <small className="eoc-cop-layer-meta">Freshness unknown</small>}
                  {feedHealth[f.id]?.incomplete ? (
                    <small role="status" style={{ display: "block", marginLeft: 24, color: "var(--eoc-status-warning)" }}>
                      Display incomplete: bounded page limit reached.
                    </small>
                  ) : null}
                  {f.attribution || feedHealth[f.id]?.attribution ? (
                    <details style={{ marginLeft: 24, fontSize: "0.8em", color: "var(--eoc-text-muted)" }}>
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
          <div style={{ marginTop: 12 }}>
            <h3 style={headingStyle}>Flood hazard (static reference)</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {FLOOD_LEGEND.map((entry) => (
                <li key={entry.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85em" }}>
                  <span aria-hidden="true" style={{
                    width: 16, height: 12, display: "inline-block",
                    backgroundColor: floodColor(entry.id, props.theme),
                    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, currentColor 3px 4px)",
                  }} />
                  {entry.title}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: "0.8em", color: "var(--eoc-text-muted)" }}>
              Static FEMA reference, separate from current incident status. Unmapped or unclassified areas remain unknown.
            </p>
            <details style={{ fontSize: "0.8em", color: "var(--eoc-text-muted)" }}>
              <summary>Source</summary>{FEMA_NFHL_ATTRIBUTION}
            </details>
          </div>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <details data-testid="facility-legend">
            <summary style={headingStyle}>Facility types (NAPSG)</summary>
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
              {FACILITY_SYMBOLS.map((entry) => (
                <li key={entry.type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8em" }}>
                  <img src={`${facilityAssetBase}${entry.assetFile}`} alt="" width={24} height={24} style={{ objectFit: "contain" }} />
                  {entry.title}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: "0.75em", color: "var(--eoc-text-muted)" }}>{NAPSG_ATTRIBUTION}</p>
          </details>
        </div>
        <div style={{ marginTop: 12 }}>
          <h3 style={headingStyle}>Status</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {LEGEND.map((s) => (
              <li key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85em" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: statusColor(s, props.theme),
                    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, currentColor 3px 4px)",
                    display: "inline-block",
                  }}
                />
                {s}
              </li>
            ))}
          </ul>
        </div>
        </WorkspaceSection>
        <WorkspaceSection title="Map tools and saved views" icon="settings" className="is-tools" testId="map-tools">
        <div style={{ marginTop: 12 }}>
          <h3 style={headingStyle}>Tools</h3>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button type="button" onClick={goHome} style={toolButtonStyle(false)}>
              Home
            </button>
            <button type="button" onClick={fitToFeatures} style={toolButtonStyle(false)}>
              Zoom to extent
            </button>
            <button
              type="button"
              aria-pressed={measure === "distance"}
              onClick={() => setMeasure((m) => (m === "distance" ? "off" : "distance"))}
              style={toolButtonStyle(measure === "distance")}
            >
              {measure === "distance" ? "Measuring…" : "Measure"}
            </button>
            <button
              type="button"
              aria-pressed={measure === "area"}
              onClick={() => setMeasure((m) => (m === "area" ? "off" : "area"))}
              style={toolButtonStyle(measure === "area")}
            >
              {measure === "area" ? "Measuring area…" : "Measure area"}
            </button>
            <button type="button" onClick={exportImage} style={toolButtonStyle(false)}>
              Export image
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <h3 style={headingStyle}>Bookmarks</h3>
          <form onSubmit={saveBookmark} style={{ display: "flex", gap: 4 }}>
            <input
              type="text"
              aria-label="Bookmark name"
              placeholder="Name this view"
              value={bookmarkName}
              onChange={(e) => setBookmarkName(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <button type="submit" style={toolButtonStyle(false)}>
              Save view
            </button>
          </form>
          {bookmarks.length > 0 ? (
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 2 }}>
              {bookmarks.map((b) => (
                <li key={b.name} style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() =>
                      mapRef.current?.flyTo({ center: b.center, zoom: b.zoom, duration: 600 })
                    }
                    style={{ ...toolButtonStyle(false), flex: 1, textAlign: "left", minWidth: 0 }}
                  >
                    {b.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove bookmark ${b.name}`}
                    onClick={() => removeBookmark(b.name)}
                    style={toolButtonStyle(false)}
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
          style={{ position: "absolute", inset: 0, overflow: "hidden" }}
        />
        <div
          ref={readoutRef}
          data-testid="cop-readout"
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "2px 8px",
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            color: "var(--eoc-text)",
            background: "color-mix(in srgb, var(--eoc-surface) 85%, transparent)",
            border: "1px solid var(--eoc-border)",
            borderRadius: 4,
            pointerEvents: "none",
          }}
        />
      </div>
      {selection ? <CopFeatureInspector selection={selection} onClose={closeInspection} /> : null}
    </div>
    </div>
  );
}

const headingStyle: CSSProperties = {
  margin: "0 0 6px",
  fontSize: "0.85em",
  color: "var(--eoc-text-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: "0.9em",
  padding: "4px 8px",
  minHeight: 32,
  borderRadius: 4,
  border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  color: "var(--eoc-text)",
};

/** Shared style for the map's tool buttons (pressed state is a filled chip). */
function toolButtonStyle(pressed: boolean): CSSProperties {
  return {
    padding: "4px 8px",
    minHeight: 32,
    borderRadius: 4,
    cursor: "pointer",
    border: "1px solid var(--eoc-border)",
    background: pressed ? "var(--eoc-text)" : "var(--eoc-surface)",
    color: pressed ? "var(--eoc-surface)" : "var(--eoc-text)",
  };
}
