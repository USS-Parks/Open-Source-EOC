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
  type CopFeatureCollection,
} from "./layers.js";

export interface CopBoard {
  readonly id: string;
  readonly title: string;
}

export interface CopMapProps {
  readonly theme: ThemeName;
  readonly boards: readonly CopBoard[];
  readonly fetchItems: (boardId: string) => Promise<CopFeatureCollection>;
  readonly basemapUrl?: string | undefined;
  readonly pollMs?: number | undefined;
  readonly center?: [number, number] | undefined;
  readonly zoom?: number | undefined;
  /** Test/instrumentation hook: receives the live map instance. */
  readonly onMap?: ((map: maplibregl.Map) => void) | undefined;
}

let pmtilesRegistered = false;

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
      style: buildCopStyle(props.theme, props.basemapUrl) as never,
      center: props.center ?? [-123.5, 41.3],
      zoom: props.zoom ?? 9,
      attributionControl: false,
    });
    mapRef.current = map;
    props.onMap?.(map);

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
      <nav aria-label="Map layers">
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
      </nav>
      <div
        ref={container}
        data-testid="cop-map"
        style={{ minHeight: 400, borderRadius: 6, overflow: "hidden" }}
      />
    </div>
  );
}
