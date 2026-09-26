import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Sql } from "./helpers.js";

/**
 * The California county outlines the map ships, for checking that a seeded
 * scenario puts each place in the county it belongs to. The outlines are
 * simplified, so a coastal point is checked against the county it names
 * rather than against the exact shoreline.
 */

type Ring = readonly (readonly [number, number])[];

const COUNTIES = join(dirname(fileURLToPath(import.meta.url)), "../../../web/public/basemap/ca_counties.geojson");
const outlines = new Map<string, Ring[]>(
  (JSON.parse(readFileSync(COUNTIES, "utf8")) as { features: { properties: { name: string }; geometry: { type: string; coordinates: unknown } }[] })
    .features.map((feature) => [
      feature.properties.name,
      feature.geometry.type === "Polygon"
        ? [(feature.geometry.coordinates as Ring[])[0]!]
        : (feature.geometry.coordinates as Ring[][]).map((polygon) => polygon[0]!),
    ]),
);

function inRing(ring: Ring, [x, y]: readonly [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The name of the county a point lies in, or null outside every county. */
export function countyOf(point: readonly [number, number]): string | null {
  for (const [name, rings] of outlines) if (rings.some((ring) => inRing(ring, point))) return name;
  return null;
}

/** Every vertex of a GeoJSON Point, LineString, Polygon or MultiPolygon. */
export function verticesOf(geometry: { type: string; coordinates: unknown }): (readonly [number, number])[] {
  if (geometry.type === "Point") return [geometry.coordinates as [number, number]];
  if (geometry.type === "LineString") return geometry.coordinates as [number, number][];
  if (geometry.type === "Polygon") return (geometry.coordinates as [number, number][][]).flat();
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as [number, number][][][]).flat(2);
  throw new Error(`unexpected geometry ${geometry.type}`);
}

/**
 * The hazard vocabulary the map's incident cartography keys on: the
 * category every exercise layer feature carries.
 */
export const HAZARD_CATEGORIES = {
  area: [
    "Fire perimeter", "Evacuation order", "Evacuation warning", "Shelter in place", "Flood extent",
    "Tsunami inundation", "Liquefaction", "Power outage", "Damage area", "Road disruption",
  ],
  point: ["Spot fire", "Slide", "Structure fire", "Gas leak", "Bridge damage", "Hazardous materials", "Road block"],
};

/** Twice a ring's signed area: positive when it runs counterclockwise. */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  return sum;
}

/**
 * What is wrong with a hazard area's rings, if anything: each ring closed,
 * each outer ring counterclockwise and each hole clockwise (RFC 7946), and
 * each outer ring drawn with at least 20 vertices.
 */
export function ringProblems(geometry: { type: string; coordinates: unknown }): string[] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates as Ring[]] : geometry.coordinates as Ring[][];
  const problems: string[] = [];
  polygons.forEach((rings, p) => rings.forEach((ring, r) => {
    const [first, last] = [ring[0]!, ring[ring.length - 1]!];
    if (first[0] !== last[0] || first[1] !== last[1]) problems.push(`part ${p} ring ${r} is not closed`);
    if ((signedArea(ring) > 0) !== (r === 0)) problems.push(`part ${p} ring ${r} winds the wrong way`);
    if (r === 0 && ring.length - 1 < 20) problems.push(`part ${p} has ${ring.length - 1} vertices`);
  }));
  return problems;
}

/**
 * Checks an exercise's data pack layers as the map reads them: every feature
 * titled SYNTHETIC with a category from the hazard vocabulary; every area
 * valid to PostGIS, wound per RFC 7946 and drawn in detail; every vertex in
 * `county`. Returns the items by source id.
 */
export async function expectExerciseLayers(sql: Sql, incidentId: string, county: string) {
  const items = await sql`
    select i.source_id, i.data, ST_AsGeoJSON(i.geom) as geometry, ST_IsValidReason(i.geom) as validity
    from data_pack_items i where i.incident_id = ${incidentId} order by i.source_id`;
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    const id = item.source_id as string;
    const geometry = JSON.parse(item.geometry as string) as { type: string; coordinates: unknown };
    expect(String(item.data.title), id).toMatch(/^SYNTHETIC /);
    const area = geometry.type === "Polygon" || geometry.type === "MultiPolygon";
    expect(HAZARD_CATEGORIES[area ? "area" : "point"], id).toContain(item.data.category);
    expect(item.validity, id).toBe("Valid Geometry");
    if (area) expect(ringProblems(geometry), id).toEqual([]);
    for (const vertex of verticesOf(geometry)) expect(countyOf(vertex), `${id} ${vertex.join(",")}`).toBe(county);
  }
  return new Map(items.map((item) => [item.source_id as string, item]));
}

/**
 * The names of an exercise's board records of `templateKey` (planned ones
 * aside) whose point lies inside an exercise area of one of `categories`.
 */
export async function recordsInside(sql: Sql, incidentId: string, templateKey: string, categories: string[]): Promise<string[]> {
  const rows = await sql`
    select distinct r.data->>'name' as name from board_records r
    join boards b on b.id = r.board_id
    join data_pack_items i on i.incident_id = r.incident_id
    where r.incident_id = ${incidentId} and b.template_key = ${templateKey}
      and coalesce((r.data->>'planned')::boolean, false) = false
      and i.data->>'category' = any(${categories})
      and ST_Contains(i.geom, ST_SetSRID(ST_GeomFromGeoJSON((r.data->'location')::text), 4326))`;
  return rows.map((row) => row.name as string);
}
