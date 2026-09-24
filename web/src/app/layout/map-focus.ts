import * as maplibregl from "maplibre-gl";
import { useEffect, useState, useSyncExternalStore } from "react";

/** A place chosen in the command bar search, for the COP map to show. */
export interface MapFocus {
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
}

let latest: MapFocus | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the COP map to fly to a place; a map mounted later still goes there. */
export function requestMapFocus(focus: MapFocus): void {
  latest = { lon: focus.lon, lat: focus.lat, zoom: focus.zoom };
  for (const listener of listeners) listener();
}

/**
 * The COP map's onMap callback: flies each live map to the latest chosen
 * place and marks it. The place holds across map remounts (theme, layers)
 * and is forgotten when the map surface closes.
 */
export function useMapFocus(): (map: maplibregl.Map) => void {
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const focus = useSyncExternalStore(subscribe, () => latest);
  useEffect(() => () => {
    latest = null;
  }, []);
  useEffect(() => {
    if (!map || !focus) return;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom, duration: 600 });
    const marker = new maplibregl.Marker().setLngLat([focus.lon, focus.lat]).addTo(map);
    // The marker must not swallow the next map click (dropping a point there).
    marker.getElement().style.pointerEvents = "none";
    return () => {
      marker.remove();
    };
  }, [map, focus]);
  return setMap;
}
