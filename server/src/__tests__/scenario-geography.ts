import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Every vertex of a GeoJSON Point, LineString or Polygon. */
export function verticesOf(geometry: { type: string; coordinates: unknown }): (readonly [number, number])[] {
  if (geometry.type === "Point") return [geometry.coordinates as [number, number]];
  if (geometry.type === "LineString") return geometry.coordinates as [number, number][];
  if (geometry.type === "Polygon") return (geometry.coordinates as [number, number][][]).flat();
  throw new Error(`unexpected geometry ${geometry.type}`);
}
