import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { themes, type ThemeName } from "../design/tokens.js";
import {
  boardLayerIds,
  boardLayerSpecs,
  buildCopStyle,
  sourceId,
  tagFeatures,
  type BasemapConfig,
  type CopFeatureCollection,
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
  tagFeedFeatures,
  type FeedLayerHealth,
} from "./feeds.js";
import {
  formatArea,
  geometryBounds,
  parseCoordinate,
  polygonAreaSqMi,
  searchFeatures,
  totalMiles,
} from "./tools.js";

export interface CopBoard {
  readonly id: string;
  readonly title: string;
}

export type FeedItemsData = CopFeatureCollection & { readonly feed: FeedLayerHealth };

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
  /** A raster imagery tile template offered as a switchable basemap. */
  readonly imageryUrl?: string | undefined;
  readonly imageryAttribution?: string | undefined;
  readonly pollMs?: number | undefined;
  readonly center?: [number, number] | undefined;
  readonly zoom?: number | undefined;
  /** When true, a map click reports its position instead of inspecting. */
  readonly picking?: boolean | undefined;
  readonly onPickPoint?: ((lngLat: [number, number]) => void) | undefined;
  /** Test/instrumentation hook: receives the live map instance. */
  readonly onMap?: ((map: maplibregl.Map) => void) | undefined;
}

let pmtilesRegistered = false;

const LEGEND: readonly SymbolStatus[] = ["critical", "warning", "normal", "unknown"];

const EMPTY_FC = { type: "FeatureCollection", features: [] as unknown[] };
const DEFAULT_CENTER: [number, number] = [-123.5, 41.3];
const DEFAULT_ZOOM = 9;
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
  readonly properties?: Record<string, unknown> | undefined;
}

/** A rendered feature belonging to a board or feed layer (inspectable). */
function isCopLayerId(id: string): boolean {
  return id.startsWith(sourceId("")) || id.startsWith(feedSourceId(""));
}

function esc(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** A record's readable properties as a small table for the map popup. */
function featureHtml(properties: Record<string, unknown>): string {
  const rows = Object.entries(properties)
    .filter(([key]) => !key.startsWith("_"))
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
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(props.boards.map((b) => [b.id, true])),
  );
  const [feedVisible, setFeedVisible] = useState<Record<string, boolean>>(
    Object.fromEntries((props.feeds ?? []).map((f) => [f.id, true])),
  );
  const [basemapMode, setBasemapMode] = useState<"vector" | "imagery">("vector");
  const imageryAvailable = !!props.imageryUrl && !props.basemapStyleUrl;
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
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [bookmarkName, setBookmarkName] = useState("");

  const home = { center: props.center ?? DEFAULT_CENTER, zoom: props.zoom ?? DEFAULT_ZOOM };
  const assetBase = props.bundledBasemap?.assetBase ?? props.basemap?.assetBase;
  // The label layers need the glyph stack of whichever basemap style is
  // active; an external style's fonts are unknown, so labels stay off there.
  const labelFont = props.basemapStyleUrl
    ? undefined
    : props.streetBasemap
      ? streetFontStack(props.streetBasemap)
      : assetBase
        ? BUNDLED_FONT_STACK
        : undefined;

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
        (props.streetBasemap
          ? buildStreetStyle(props.streetBasemap, props.theme)
          : props.bundledBasemap
            ? buildBundledVectorStyle(props.bundledBasemap, props.theme, props.imageryUrl)
            : buildCopStyle(props.theme, props.basemap, props.imageryUrl))) as never,
      center: home.center,
      zoom: home.zoom,
      attributionControl: false,
      // Keeps the drawn frame readable for the image export.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
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
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          // The active basemap's attribution: an external style carries its
          // own; the street PMTiles is OSM/ODbL; otherwise the bundled basemap.
          props.basemapStyleUrl
            ? ""
            : props.streetBasemap
              ? OSM_ATTRIBUTION
              : props.bundledBasemap
                ? BUNDLED_BASEMAP_ATTRIBUTION
                : props.basemap?.kind === "natural-earth"
                  ? NATURAL_EARTH_ATTRIBUTION
                  : "",
          props.imageryAttribution ?? "",
        ]
          .filter(Boolean)
          .join(" · "),
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
      if (!hit) return;
      popup.setLngLat(e.lngLat).setHTML(featureHtml(hit.properties ?? {})).addTo(map);
    });
    map.on("mousemove", (e) => {
      paintReadout(e.lngLat.lng, e.lngLat.lat, map.getZoom());
      if (pickingRef.current || measureRef.current !== "off") return; // tool cursors win
      const over = map.queryRenderedFeatures(e.point).some((f) => isCopLayerId(f.layer.id));
      map.getCanvas().style.cursor = over ? "pointer" : "";
    });

    const refresh = async () => {
      for (const board of props.boards) {
        try {
          const fc = tagFeatures(await props.fetchItems(board.id));
          dataRef.current[sourceId(board.id)] = fc;
          const source = map.getSource(sourceId(board.id)) as maplibregl.GeoJSONSource | undefined;
          if (source) source.setData(fc as never);
          else if (map.isStyleLoaded() || map.loaded()) {
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
            const fc = tagFeedFeatures(res, res.feed);
            dataRef.current[feedSourceId(feed.id)] = fc;
            const source = map.getSource(feedSourceId(feed.id)) as maplibregl.GeoJSONSource | undefined;
            if (source) source.setData(fc as never);
            else if (map.isStyleLoaded() || map.loaded()) {
              map.addSource(feedSourceId(feed.id), { type: "geojson", data: fc as never });
              for (const spec of feedLayerSpecs(feed.id, props.theme, labelFont)) {
                map.addLayer(spec as never);
              }
            }
          } catch {
            // A stale or failed feed keeps its last features; never blank the COP.
          }
        }
      }
    };

    map.on("load", () => {
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
      const c = map.getCenter();
      paintReadout(c.lng, c.lat, map.getZoom());
      void refresh();
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      paintReadout(c.lng, c.lat, map.getZoom());
    });
    const timer = setInterval(() => void refresh(), props.pollMs ?? 2000);
    return () => {
      clearInterval(timer);
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
    mapRef.current?.flyTo({ center: home.center, zoom: home.zoom, bearing: 0, pitch: 0 });
  };

  /** Save the current frame as a PNG (the print/export gesture). */
  const exportImage = () => {
    const map = mapRef.current;
    if (!map) return;
    const a = document.createElement("a");
    a.href = map.getCanvas().toDataURL("image/png");
    a.download = `cop-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    a.click();
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
      popupRef.current.setLngLat(center).setHTML(featureHtml(r.properties)).addTo(map);
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
    if (!map || !imageryAvailable) return;
    const apply = () => {
      if (map.getLayer("imagery")) {
        map.setLayoutProperty("imagery", "visibility", basemapMode === "imagery" ? "visible" : "none");
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [basemapMode, imageryAvailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const feed of props.feeds ?? []) {
      for (const layerId of feedLayerIds(feed.id)) {
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, height: "100%" }}>
      <nav aria-label="Map layers" className="eoc-map-panel">
        <form onSubmit={(e) => void find(e)} style={{ marginBottom: 12 }}>
          <h3 style={headingStyle}>Find</h3>
          <input
            type="search"
            aria-label="Find on map"
            placeholder="Record, county, or lat, lng"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={inputStyle}
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
        {imageryAvailable ? (
          <div style={{ marginBottom: 12 }}>
            <h3 style={headingStyle}>Basemap</h3>
            <div style={{ display: "flex", gap: 4 }}>
              {(["vector", "imagery"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={basemapMode === mode}
                  onClick={() => setBasemapMode(mode)}
                  style={{ ...toolButtonStyle(basemapMode === mode), flex: 1, textTransform: "capitalize" }}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <h3 style={headingStyle}>Layers</h3>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {props.boards.map((b) => (
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
        {(props.feeds ?? []).length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <h3 style={headingStyle}>Feeds</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {(props.feeds ?? []).map((f) => (
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
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
                    display: "inline-block",
                  }}
                />
                {s}
              </li>
            ))}
          </ul>
        </div>
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
      </nav>
      <div style={{ position: "relative", minHeight: 400, height: "100%" }}>
        <div
          ref={container}
          data-testid="cop-map"
          style={{ position: "absolute", inset: 0, borderRadius: 6, overflow: "hidden" }}
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
