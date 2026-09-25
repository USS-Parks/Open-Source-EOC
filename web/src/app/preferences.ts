import { useSyncExternalStore } from "react";

/** A viewer's own settings, kept on this computer. */
export interface ViewerPreferences {
  /** The map's scale bar and measurements. */
  readonly distanceUnit: "imperial" | "metric";
  /** How the map's corner readout writes latitude and longitude. */
  readonly coordinateFormat: "decimal" | "dms";
  /** Whether the readout adds the USNG and MGRS grid references. */
  readonly gridReference: boolean;
  /** A system notification when something new is addressed to this person. */
  readonly desktopAlerts: boolean;
  /** A short tone when something new is addressed to this person. */
  readonly alertSound: boolean;
}

export const DEFAULT_PREFERENCES: ViewerPreferences = {
  distanceUnit: "imperial",
  coordinateFormat: "decimal",
  gridReference: true,
  desktopAlerts: false,
  alertSound: false,
};

const KEY = "openeoc.preferences";
const listeners = new Set<() => void>();

function read(): ViewerPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof ViewerPreferences, unknown>>;
    return {
      distanceUnit: stored.distanceUnit === "metric" ? "metric" : "imperial",
      coordinateFormat: stored.coordinateFormat === "dms" ? "dms" : "decimal",
      gridReference: stored.gridReference !== false,
      desktopAlerts: stored.desktopAlerts === true,
      alertSound: stored.alertSound === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

let current: ViewerPreferences = read();

export function preferences(): ViewerPreferences {
  return current;
}

export function setPreferences(change: Partial<ViewerPreferences>): void {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Kept for this page only when the browser keeps nothing.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): ViewerPreferences {
  return useSyncExternalStore(subscribe, preferences, preferences);
}

/** Latitude or longitude as degrees, minutes and seconds with a hemisphere letter. */
export function toDms(value: number, axis: "lat" | "lon"): string {
  const hemisphere = axis === "lat" ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  const total = Math.abs(value) * 3600;
  const degrees = Math.floor(total / 3600);
  const minutes = Math.floor((total - degrees * 3600) / 60);
  const seconds = total - degrees * 3600 - minutes * 60;
  return `${degrees}°${String(minutes).padStart(2, "0")}'${seconds.toFixed(1).padStart(4, "0")}"${hemisphere}`;
}
