import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import type { ThemeName } from "../design/tokens.js";
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
        buildCopStyle(props.theme, props.basemap, props.imageryUrl)) as never,
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
          props.basemap?.kind === "natural-earth" ? NATURAL_EARTH_ATTRIBUTION : "",
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
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });
    map.on("click", (e) => {
      // Add-point mode: report the position for a new record, never inspect.
      if (pickingRef.current && onPickRef.current) {
        onPickRef.current([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const hit = map.queryRenderedFeatures(e.point).find((f) => isCopLayerId(f.layer.id));
      if (!hit) return;
      popup.setLngLat(e.lngLat).setHTML(featureHtml(hit.properties ?? {})).addTo(map);
    });
    map.on("mousemove", (e) => {
      if (pickingRef.current) return; // crosshair stays while placing a point
      const over = map.queryRenderedFeatures(e.point).some((f) => isCopLayerId(f.layer.id));
      map.getCanvas().style.cursor = over ? "pointer" : "";
    });

    const refresh = async () => {
      for (const board of props.boards) {
        try {
          const fc = tagFeatures(await props.fetchItems(board.id));
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
      void refresh();
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
      </nav>
      <div
        ref={container}
        data-testid="cop-map"
        style={{ minHeight: 400, borderRadius: 6, overflow: "hidden" }}
      />
    </div>
  );
}
