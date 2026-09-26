import type { GeoJsonGeometry } from "@openeoc/shared";
import { AuthError } from "../auth/service.js";

/**
 * Esri JSON (VC-26): geometry to and from the GeoJSON a board stores, and an
 * Esri feature set read as the rows of a board import. Only WGS 84 (4326) and
 * Web Mercator (3857, which Esri also writes as 102100) are understood; any
 * other spatial reference is refused rather than guessed at.
 */

type Position = [number, number];
export interface EsriSpatialReference { readonly wkid?: unknown; readonly latestWkid?: unknown; readonly wkt?: unknown }
type EsriGeometry = Record<string, unknown> & { spatialReference?: EsriSpatialReference };

const EARTH_RADIUS = 6_378_137;
const WEB_MERCATOR_IDS = new Set([3857, 102100]);

/** The PostGIS SRID for a supported Esri wkid, or null. */
export function supportedSrid(wkid: number): 4326 | 3857 | null {
  if (wkid === 4326) return 4326;
  return WEB_MERCATOR_IDS.has(wkid) ? 3857 : null;
}

/** The wkid an Esri spatial reference names; `latestWkid` wins, as Esri clients read it. */
export function wkidOf(sr: EsriSpatialReference | undefined): number | null {
  const id = sr?.latestWkid ?? sr?.wkid;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

export function unsupportedReference(sr: EsriSpatialReference | number | null | undefined): string {
  const named = typeof sr === "number" ? sr : sr ? wkidOf(sr) ?? (sr.wkt ? "given only as WKT" : null) : null;
  return named === null
    ? "no spatial reference is given: use 4326 (WGS 84) or 3857 (Web Mercator)"
    : `spatial reference ${named} is not supported: use 4326 (WGS 84) or 3857 (Web Mercator)`;
}

function position(value: unknown, mercator: boolean): Position {
  if (!Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number"
    || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) throw new Error("a coordinate is not a pair of numbers");
  const [x, y] = value as [number, number];
  // Web Mercator to degrees, kept to nine decimals (about a millimetre).
  const round = (n: number) => Math.round(n * 1e9) / 1e9;
  const point: Position = mercator
    ? [round((x / EARTH_RADIUS) * (180 / Math.PI)), round((2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI))]
    : [x, y];
  // Refused rather than wrapped: a shape past the edge of the world is a mistake in the file.
  if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) {
    throw new Error(mercator ? "a Web Mercator x lies beyond the edge of the world (20,037,508 m)"
      : "a coordinate lies outside longitude -180 to 180 or latitude -90 to 90");
  }
  return point;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`the geometry has no ${what}`);
  return value;
}

/** Twice the signed area; positive for a clockwise ring with y up, as Esri draws an outer ring. */
function clockwise(ring: readonly Position[]): boolean {
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) sum += (ring[i]![0] - ring[i - 1]![0]) * (ring[i]![1] + ring[i - 1]![1]);
  return sum > 0;
}

function area(ring: readonly Position[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) sum += ring[i - 1]![0] * ring[i]![1] - ring[i]![0] * ring[i - 1]![1];
  return Math.abs(sum) / 2;
}

function inside(point: Position, ring: readonly Position[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

function onEdge(point: Position, ring: readonly Position[]): boolean {
  for (let i = 1; i < ring.length; i += 1) {
    const [a, b] = [ring[i - 1]!, ring[i]!];
    if ((b[0] - a[0]) * (point[1] - a[1]) === (b[1] - a[1]) * (point[0] - a[0])
      && Math.min(a[0], b[0]) <= point[0] && point[0] <= Math.max(a[0], b[0])
      && Math.min(a[1], b[1]) <= point[1] && point[1] <= Math.max(a[1], b[1])) return true;
  }
  return false;
}

/** Whether every vertex of a hole lies inside a ring or on it. */
const encloses = (ring: readonly Position[], hole: readonly Position[]) =>
  hole.every((point) => inside(point, ring) || onEdge(point, ring));

/**
 * Esri rings as GeoJSON polygons: a clockwise ring is an outer ring and a
 * counter-clockwise one a hole, which belongs to the smallest outer ring
 * that encloses all of it. With no clockwise ring at all, every ring is taken
 * as an outer one. Rings come out as RFC 7946 orders them, outer rings
 * counter-clockwise. The result is not repaired: the import checks it is a
 * valid shape and reports the row when it is not.
 */
function polygons(rings: Position[][]): Position[][][] {
  const closed = rings.map((ring) => {
    const [first, last] = [ring[0]!, ring[ring.length - 1]!];
    const whole = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
    if (whole.length < 4) throw new Error("a polygon ring needs at least three points");
    return whole;
  });
  const outer = closed.filter(clockwise);
  const holes = outer.length ? closed.filter((ring) => !clockwise(ring)) : [];
  const shapes = (outer.length ? outer : closed).map((ring) => ({ ring, holes: [] as Position[][] }));
  for (const hole of holes) {
    const around = shapes.filter((shape) => encloses(shape.ring, hole))
      .sort((a, b) => area(a.ring) - area(b.ring))[0];
    if (around) around.holes.push(hole);
    else shapes.push({ ring: [...hole].reverse(), holes: [] });
  }
  const ccw = (ring: Position[]) => clockwise(ring) ? [...ring].reverse() : ring;
  return shapes.map((shape) => [ccw(shape.ring), ...shape.holes.map((hole) => clockwise(hole) ? hole : [...hole].reverse())]);
}

/**
 * An Esri JSON geometry as GeoJSON in WGS 84: a point, a multipoint, a
 * polyline of one path or several, or a polygon of rings with its holes and
 * parts. Z and M values are dropped. Throws an Error naming what is wrong.
 */
export function esriToGeoJson(geometry: EsriGeometry, fallback?: EsriSpatialReference): GeoJsonGeometry {
  const wkid = wkidOf(geometry.spatialReference ?? fallback);
  const srid = wkid === null ? null : supportedSrid(wkid);
  if (srid === null) throw new Error(unsupportedReference(geometry.spatialReference ?? fallback));
  const mercator = srid === 3857;
  if ("curvePaths" in geometry || "curveRings" in geometry)
    throw new Error("curved geometry is not supported: densify it before export");
  if ("x" in geometry) {
    if (geometry.x === null || geometry.y === null || geometry.x === "NaN") throw new Error("the point is empty");
    return { type: "Point", coordinates: position([geometry.x, geometry.y], mercator) };
  }
  if ("points" in geometry) {
    const points = list(geometry.points, "points").map((p) => position(p, mercator));
    return points.length === 1 ? { type: "Point", coordinates: points[0]! } : { type: "MultiPoint", coordinates: points };
  }
  if ("paths" in geometry) {
    const paths = list(geometry.paths, "paths").map((path) => {
      const line = list(path, "points").map((p) => position(p, mercator));
      if (line.length < 2) throw new Error("a line needs at least two points");
      return line;
    });
    return paths.length === 1 ? { type: "LineString", coordinates: paths[0]! } : { type: "MultiLineString", coordinates: paths };
  }
  if ("rings" in geometry) {
    const parts = polygons(list(geometry.rings, "rings").map((ring) => list(ring, "points").map((p) => position(p, mercator))));
    return parts.length === 1 ? { type: "Polygon", coordinates: parts[0]! } : { type: "MultiPolygon", coordinates: parts };
  }
  throw new Error("not an Esri point, multipoint, polyline or polygon");
}

/**
 * GeoJSON (with outer rings already clockwise, as PostGIS's
 * ST_ForcePolygonCW leaves them) as Esri JSON geometry; null when empty.
 */
export function geoJsonToEsri(geometry: { type: string; coordinates: unknown }): Record<string, unknown> | null {
  const c = geometry.coordinates as never[];
  if (!Array.isArray(c) || c.length === 0) return null;
  switch (geometry.type) {
    case "Point": return { x: c[0], y: c[1] };
    case "MultiPoint": return { points: c };
    case "LineString": return { paths: [c] };
    case "MultiLineString": return { paths: c };
    case "Polygon": return { rings: c };
    case "MultiPolygon": return { rings: (c as unknown[][]).flat() };
    default: return null;
  }
}

/** The header an Esri file's geometry arrives under in an import table. */
export const ESRI_GEOMETRY_HEADER = "geometry";

interface EsriField { readonly name?: unknown; readonly type?: unknown }
interface EsriFeatureSet {
  readonly spatialReference?: EsriSpatialReference | undefined;
  readonly fields?: unknown;
  readonly features?: unknown;
}

/** The furthest an Esri feature nests: feature, geometry, curve rings, ring, arc, its list, a point, and one to spare. */
const FEATURE_DEPTH = 8;
/** The span of a JavaScript date, in milliseconds either side of 1970. */
const MAX_TIME = 8.64e15;

/** Whether a parsed value nests objects or lists deeper than `limit`, looking no deeper than that. */
function nestsDeeper(value: unknown, limit: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (limit === 0) return true;
  return Object.values(value).some((inner) => nestsDeeper(inner, limit - 1));
}

/**
 * An Esri JSON file as the rows of a board import: a feature set (what an
 * ArcGIS layer's `query?f=json` returns) or a feature collection with one
 * layer. Each attribute is a column, date fields as ISO times; the geometry
 * is the `geometry` column, still Esri JSON with its spatial reference, and
 * becomes GeoJSON when the row is read into the board's geometry field, so a
 * feature whose geometry cannot be converted is reported on its own row.
 */
export function readEsriFeatureSet(buffer: Buffer): {
  headers: string[]; rows: Array<Record<string, string>>; geometryHeader: string; firstRow: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new AuthError(400, "the file is not valid JSON");
  }
  const root = (parsed ?? {}) as Record<string, unknown>;
  let set = root as EsriFeatureSet;
  let layerReference: EsriSpatialReference | undefined;
  if (Array.isArray(root.layers)) {
    if (root.layers.length !== 1) throw new AuthError(400, `the feature collection holds ${root.layers.length} layers; import one layer at a time`);
    const layer = (root.layers[0] ?? {}) as { layerDefinition?: EsriFeatureSet & { extent?: { spatialReference?: EsriSpatialReference } }; featureSet?: EsriFeatureSet };
    set = { fields: layer.layerDefinition?.fields, ...layer.featureSet };
    layerReference = layer.featureSet?.spatialReference ?? layer.layerDefinition?.spatialReference
      ?? layer.layerDefinition?.extent?.spatialReference;
  }
  if (!Array.isArray(set.features)) throw new AuthError(400, "the file is not an Esri JSON feature set: it has no features list");
  const reference = set.spatialReference ?? layerReference;
  if (reference) {
    const wkid = wkidOf(reference);
    if (wkid === null || supportedSrid(wkid) === null) throw new AuthError(400, `the file's ${unsupportedReference(reference)}`);
  }
  const unplaced = (set.features as unknown[]).some((item) => {
    const geometry = (item as { geometry?: EsriGeometry | null } | null)?.geometry;
    return geometry && typeof geometry === "object" && !geometry.spatialReference;
  });
  if (unplaced && !reference) throw new AuthError(400, "the file names no spatial reference: use 4326 (WGS 84) or 3857 (Web Mercator)");
  const fields = set.fields ?? [];
  if (!Array.isArray(fields) || !fields.every((field) => typeof field === "object" && field !== null))
    throw new AuthError(400, "the file's fields are not a list of fields");
  const named = fields as EsriField[];
  const dates = new Set(named.filter((field) => field.type === "esriFieldTypeDate").map((field) => String(field.name)));
  const headers = new Set<string>(named.map((field) => String(field.name)));
  const rows = (set.features as unknown[]).map((item, index) => {
    if (nestsDeeper(item, FEATURE_DEPTH)) throw new AuthError(400, `feature ${index + 1} nests deeper than Esri JSON does`);
    const feature = (item ?? {}) as { attributes?: unknown; geometry?: EsriGeometry | null };
    const attributes = feature.attributes ?? {};
    if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes))
      throw new AuthError(400, `feature ${index + 1} has attributes that are not named values`);
    const row: Record<string, string> = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name === ESRI_GEOMETRY_HEADER) continue;
      headers.add(name);
      if (value === null || value === undefined) continue;
      // A date outside what a date can hold stays a number, and the row then says it is not a date.
      const time = dates.has(name) && typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_TIME
        ? new Date(value).toISOString() : null;
      row[name] = time ?? (typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    if (feature.geometry && typeof feature.geometry === "object") {
      row[ESRI_GEOMETRY_HEADER] = JSON.stringify({
        ...feature.geometry,
        ...(feature.geometry.spatialReference || !reference ? {} : { spatialReference: reference }),
      });
    }
    return row;
  });
  headers.delete(ESRI_GEOMETRY_HEADER);
  return { headers: [...headers, ESRI_GEOMETRY_HEADER], rows, geometryHeader: ESRI_GEOMETRY_HEADER, firstRow: 1 };
}

/** Whether a parsed cell is Esri JSON geometry rather than GeoJSON. */
export function isEsriGeometry(value: unknown): value is EsriGeometry {
  return typeof value === "object" && value !== null && !("type" in value)
    && ["x", "points", "paths", "rings", "curvePaths", "curveRings"].some((key) => key in value);
}
