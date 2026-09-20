import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  type BundledBasemapConfig,
} from "./bundledbasemap.js";
import { buildStreetStyle, OSM_ATTRIBUTION, type StreetBasemapConfig } from "./streetstyle.js";
import { statusColor, type SymbolStatus } from "./symbology.js";
import {
  feedLayerIds,
  feedLayerSpecs,
  feedSourceId,
  tagFeedFeatures,
  type FeedLayerHealth,
} from "./feeds.js";

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
const EARTH_MI = 3958.8;

/** Great-circle distance between two lng/lat points, in statute miles. */
function haversineMiles(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
}

/** Cumulative length of a measured path, in miles. */
function totalMiles(coords: readonly [number, number][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineMiles(coords[i - 1]!, coords[i]!);
  return d;
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
  const measuringRef = useRef(false);
  const measureCoordsRef = useRef<[number, number][]>([]);
  const [measuring, setMeasuring] = useState(false);
  // The last fetched features per source, so zoom-to-extent fits every feature,
  // not just those in the current viewport (querySourceFeatures is viewport-bound).
  const dataRef = useRef<Record<string, CopFeatureCollection>>({});

  /** Paint the corner readout: cursor position, zoom, and measured distance. */
  const paintReadout = (lng: number, lat: number, zoom: number) => {
    const el = readoutRef.current;
    if (!el) return;
    const coords = measureCoordsRef.current;
    const dist =
      measuringRef.current && coords.length >= 2 ? ` · ${totalMiles(coords).toFixed(2)} mi` : "";
    const hint = measuringRef.current && coords.length < 2 ? " · click to measure" : "";
    el.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)} · z${zoom.toFixed(1)}${dist}${hint}`;
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
      center: props.center ?? [-123.5, 41.3],
      zoom: props.zoom ?? 9,
      attributionControl: false,
    });
    mapRef.current = map;
    props.onMap?.(map);

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
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

    // Click any operational feature to inspect its record; a plain map click
    // dismisses. queryRenderedFeatures keeps this working as layers come and
    // go on the poll, with no per-layer handler churn.
    // Push the current measure path (a line plus a vertex marker per click)
    // into the measure source so the tool draws as the operator clicks.
    const updateMeasure = () => {
      const coords = measureCoordsRef.current;
      const src = map.getSource("measure") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const features: unknown[] = coords.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: {},
      }));
      if (coords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        });
      }
      src.setData({ type: "FeatureCollection", features } as never);
    };

    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });
    map.on("click", (e) => {
      // Add-point mode: report the position for a new record, never inspect.
      if (pickingRef.current && onPickRef.current) {
        onPickRef.current([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      // Measure mode: each click extends the path; nothing is inspected.
      if (measuringRef.current) {
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
      if (pickingRef.current || measuringRef.current) return; // tool cursors win
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
            for (const spec of boardLayerSpecs(board.id, props.theme)) {
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
              for (const spec of feedLayerSpecs(feed.id, props.theme)) {
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
          id: "measure-line",
          type: "line",
          source: "measure",
          filter: ["==", ["geometry-type"], "LineString"],
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
    measuringRef.current = measuring;
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = measuring ? "crosshair" : "";
    if (!measuring) {
      // Leaving measure mode clears the path.
      measureCoordsRef.current = [];
      const src = map.getSource("measure") as maplibregl.GeoJSONSource | undefined;
      src?.setData(EMPTY_FC as never);
    }
  }, [measuring]);

  /** Fit the viewport to every feature on the visible operational layers. */
  const fitToFeatures = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    let any = false;
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
        bounds.extend(c as [number, number]);
        any = true;
      } else if (Array.isArray(c)) {
        for (const inner of c) walk(inner);
      }
    };
    const consider = (id: string, on: boolean) => {
      if (!on) return;
      const fc = dataRef.current[id];
      for (const f of fc?.features ?? []) walk((f.geometry as { coordinates?: unknown }).coordinates);
    };
    for (const b of props.boards) consider(sourceId(b.id), visible[b.id] ?? true);
    for (const f of props.feeds ?? []) consider(feedSourceId(f.id), feedVisible[f.id] ?? true);
    if (any) map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 500 });
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
        {imageryAvailable ? (
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.85em", color: "var(--eoc-text-muted)" }}>
              Basemap
            </h3>
            <div style={{ display: "flex", gap: 4 }}>
              {(["vector", "imagery"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={basemapMode === mode}
                  onClick={() => setBasemapMode(mode)}
                  style={{
                    flex: 1,
                    textTransform: "capitalize",
                    padding: "4px 8px",
                    minHeight: 32,
                    borderRadius: 4,
                    cursor: "pointer",
                    border: "1px solid var(--eoc-border)",
                    background: basemapMode === mode ? "var(--eoc-text)" : "var(--eoc-surface)",
                    color: basemapMode === mode ? "var(--eoc-surface)" : "var(--eoc-text)",
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <h3 style={{ margin: "0 0 6px", fontSize: "0.85em", color: "var(--eoc-text-muted)" }}>
          Layers
        </h3>
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
            <h3 style={{ margin: "0 0 6px", fontSize: "0.85em", color: "var(--eoc-text-muted)" }}>
              Feeds
            </h3>
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
          <h3 style={{ margin: "0 0 6px", fontSize: "0.85em", color: "var(--eoc-text-muted)" }}>
            Status
          </h3>
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
          <h3 style={{ margin: "0 0 6px", fontSize: "0.85em", color: "var(--eoc-text-muted)" }}>
            Tools
          </h3>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button type="button" onClick={fitToFeatures} style={toolButtonStyle(false)}>
              Zoom to extent
            </button>
            <button
              type="button"
              aria-pressed={measuring}
              onClick={() => setMeasuring((m) => !m)}
              style={toolButtonStyle(measuring)}
            >
              {measuring ? "Measuring…" : "Measure"}
            </button>
          </div>
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
