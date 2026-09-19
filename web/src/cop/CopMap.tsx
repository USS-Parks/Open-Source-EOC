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

export interface CopBoard {
  readonly id: string;
  readonly title: string;
}

export interface CopMapProps {
  readonly theme: ThemeName;
  readonly boards: readonly CopBoard[];
  readonly fetchItems: (boardId: string) => Promise<CopFeatureCollection>;
  /** The bundled basemap, when one should render under the layers. */
  readonly basemap?: BasemapConfig | undefined;
  /** A deployment's own MapLibre style URL, which replaces the basemap. */
  readonly basemapStyleUrl?: string | undefined;
  readonly pollMs?: number | undefined;
  readonly center?: [number, number] | undefined;
  readonly zoom?: number | undefined;
  /** Test/instrumentation hook: receives the live map instance. */
  readonly onMap?: ((map: maplibregl.Map) => void) | undefined;
}

let pmtilesRegistered = false;

const LEGEND: readonly SymbolStatus[] = ["critical", "warning", "normal", "unknown"];

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
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(props.boards.map((b) => [b.id, true])),
  );

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
      style: (props.basemapStyleUrl ?? buildCopStyle(props.theme, props.basemap)) as never,
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
        customAttribution: props.basemap?.kind === "natural-earth" ? NATURAL_EARTH_ATTRIBUTION : "",
      }),
      "bottom-right",
    );

    // Click any operational feature to inspect its record; a plain map click
    // dismisses. queryRenderedFeatures keeps this working as layers come and
    // go on the poll, with no per-layer handler churn.
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });
    map.on("click", (e) => {
      const hit = map
        .queryRenderedFeatures(e.point)
        .find((f) => f.layer.id.startsWith(sourceId("")));
      if (!hit) return;
      popup.setLngLat(e.lngLat).setHTML(featureHtml(hit.properties ?? {})).addTo(map);
    });
    map.on("mousemove", (e) => {
      const over = map
        .queryRenderedFeatures(e.point)
        .some((f) => f.layer.id.startsWith(sourceId("")));
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
            visible[board.id] ? "visible" : "none",
          );
        }
      }
    }
  }, [visible, props.boards]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, height: "100%" }}>
      <nav aria-label="Map layers" className="eoc-map-panel">
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
