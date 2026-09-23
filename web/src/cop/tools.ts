import type { CopFeatureCollection } from "./layers.js";

/**
 * Operator map tools, pure and GPU-free: distance and area measurement on
 * the sphere, coordinate parsing, feature labels, and the search that backs
 * the COP's find-on-map box. CopMap owns the interaction; this owns the math.
 */

const EARTH_MI = 3958.8;
const ACRES_PER_SQ_MI = 640;

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lng/lat points, in statute miles. */
export function haversineMiles(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
}

/** Cumulative length of a measured path, in miles. */
export function totalMiles(coords: readonly [number, number][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineMiles(coords[i - 1]!, coords[i]!);
  return d;
}

/**
 * Area of a ring of lng/lat vertices on the sphere, in square miles
 * (Chamberlain and Duquette; the same formula the GIS libraries use). The
 * ring closes itself; fewer than three vertices is no area.
 */
export function polygonAreaSqMi(coords: readonly [number, number][]): number {
  const n = coords.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lower = coords[i]!;
    const middle = coords[(i + 1) % n]!;
    const upper = coords[(i + 2) % n]!;
    total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
  }
  return Math.abs((total * EARTH_MI * EARTH_MI) / 2);
}

/** Readable area: acres below a square mile, both above it. */
export function formatArea(sqMi: number): string {
  const acres = sqMi * ACRES_PER_SQ_MI;
  if (sqMi < 1) return `${acres.toFixed(1)} ac`;
  return `${sqMi.toFixed(2)} sq mi (${Math.round(acres).toLocaleString()} ac)`;
}

/**
 * "lat, lng" (or "lat lng") typed by an operator, as [lng, lat]. Latitude
 * first is the emergency-management convention; a pair that only fits the
 * other way round is accepted as lng, lat. Anything else is null.
 */
export function parseCoordinate(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return [a, b];
  return null;
}

const LABEL_KEYS = ["name", "title", "label", "road", "location", "facility", "summary"];

/** The record's display label for the map: the first naming field it has. */
export function labelFor(properties: Record<string, unknown>): string {
  for (const key of LABEL_KEYS) {
    const v = properties[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** labelFor as a MapLibre expression over raw record fields, for vector tiles. */
export function labelExpression(): unknown {
  return LABEL_KEYS.reduceRight<unknown>(
    (next, key) => [
      "case",
      ["all", ["==", ["typeof", ["get", key]], "string"], ["!=", ["get", key], ""]],
      ["to-string", ["get", key]],
      next,
    ],
    "",
  );
}

/** [minLng, minLat, maxLng, maxLat] of any GeoJSON geometry, or null if empty. */
export function geometryBounds(geometry: unknown): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c as [number, number];
      box = box
        ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
        : [x, y, x, y];
    } else if (Array.isArray(c)) {
      for (const inner of c) walk(inner);
    }
  };
  walk((geometry as { coordinates?: unknown } | null)?.coordinates);
  return box;
}

export interface SearchHit {
  readonly sourceId: string;
  readonly featureId: string;
  readonly title: string;
  readonly detail: string;
  readonly bounds: [number, number, number, number];
  readonly properties: Record<string, unknown>;
}

/**
 * Find operational features whose readable properties contain the query
 * (case-insensitive substring). Hidden properties (leading underscore) are
 * not searched. Results are capped; an EOC operator is looking for one
 * record, not paging through a table.
 */
export function searchFeatures(
  collections: Readonly<Record<string, CopFeatureCollection>>,
  query: string,
  limit = 8,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const [sourceId, fc] of Object.entries(collections)) {
    for (const f of fc.features) {
      const match = Object.entries(f.properties).find(
        ([key, value]) =>
          !key.startsWith("_") &&
          (typeof value === "string" || typeof value === "number") &&
          String(value).toLowerCase().includes(q),
      );
      if (!match) continue;
      const bounds = geometryBounds(f.geometry);
      if (!bounds) continue;
      hits.push({
        sourceId,
        featureId: f.id,
        title: labelFor(f.properties) || String(match[1]),
        detail: `${match[0]}: ${String(match[1])}`,
        bounds,
        properties: f.properties,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
