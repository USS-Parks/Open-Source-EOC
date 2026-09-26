/**
 * The U.S. National Grid drawn over the map, computed on the client from the
 * view alone; no data ships for it. Grid zone lines at every zoom; 100 km
 * squares from zoom 6; 10 km, 1 km and 100 m lines from zooms 9, 12 and 15.
 * Each zone draws its own grid, clipped at the zone's meridians, so the grid
 * breaks at 120W between zones 10 and 11 across California as USNG does.
 *
 * The UTM series and the 100 km lettering are the ones mgrs.ts uses for the
 * cursor readout (Snyder, USGS PP 1395, chapter 8; MGRS AA lettering), so
 * the grid and the readout agree; the tests hold them to each other.
 */

// ponytail: the UTM constants and forward series repeat mgrs.ts, which this lane may not edit; fold together in part two.
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const E4 = E2 * E2;
const E6 = E4 * E2;
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const RAD = Math.PI / 180;
const BANDS = "CDEFGHJKLMNPQRSTUVWX";
const COLUMN_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
const ROWS = "ABCDEFGHJKLMNPQRSTUV";
const FALSE_NORTHING = 10_000_000;
const SQUARE = 100_000;
/** Vertices per grid line: bends stay under a pixel at the zoom each spacing starts. */
const SEGMENTS = 32;
/** More lines than this across the view falls back to the next coarser spacing. */
const MAX_LINES = 200;

export type UsngLevel = "gzd" | "100km" | "10km" | "1km" | "100m";

/** Each spacing and the MapLibre zoom it starts at, coarsest first. */
export const USNG_LEVELS: readonly { readonly level: Exclude<UsngLevel, "gzd">; readonly meters: number; readonly minzoom: number }[] = [
  { level: "100km", meters: 100_000, minzoom: 6 },
  { level: "10km", meters: 10_000, minzoom: 9 },
  { level: "1km", meters: 1_000, minzoom: 12 },
  { level: "100m", meters: 100, minzoom: 15 },
];

type Position = [number, number];

export interface UsngFeature {
  readonly type: "Feature";
  readonly geometry: { readonly type: "LineString"; readonly coordinates: Position[] } | { readonly type: "Point"; readonly coordinates: Position };
  /**
   * A line's `label` is its USNG digits at the finest spacing drawn ("45" is
   * the 1 km line 45 km into its square); a point's is a grid zone ("10T")
   * or a 100 km square ("10T DK").
   */
  readonly properties: { readonly level: UsngLevel; readonly label?: string; readonly axis?: "easting" | "northing" };
}

export interface UsngFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: UsngFeature[];
}

const centralMeridian = (zone: number) => (zone - 1) * 6 - 177;
const zoneWest = (zone: number) => (zone - 1) * 6 - 180;
const zoneOf = (lng: number) => Math.min(60, Math.floor((lng + 180) / 6) + 1);
const bandOf = (lat: number) => BANDS[Math.min(Math.floor((lat + 80) / 8), BANDS.length - 1)]!;

/** WGS84 to UTM easting and northing in the given zone; southern northings carry the false northing. */
export function toUtm(lng: number, lat: number, zone: number): Position {
  const phi = lat * RAD;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  const t = tan * tan;
  const c = EP2 * cos * cos;
  const a = cos * (lng - centralMeridian(zone)) * RAD;
  const m = A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * phi
    - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * phi)
    + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * phi)
    - ((35 * E6) / 3072) * Math.sin(6 * phi));
  const easting = K0 * n * (a + ((1 - t + c) * a ** 3) / 6
    + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  const northing = K0 * (m + n * tan * (a ** 2 / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720)) + (lat < 0 ? FALSE_NORTHING : 0);
  return [easting, northing];
}

/** UTM to WGS84 longitude and latitude (Snyder's footpoint latitude series). */
export function fromUtm(easting: number, northing: number, zone: number, south: boolean): Position {
  const x = easting - 500000;
  const mu = (northing - (south ? FALSE_NORTHING : 0)) / K0 / (A * (1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const tan = Math.tan(phi1);
  const c = EP2 * cos * cos;
  const t = tan * tan;
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  const r = (A * (1 - E2)) / (1 - E2 * sin * sin) ** 1.5;
  const d = x / (n * K0);
  const lat = phi1 - ((n * tan) / r) * (d ** 2 / 2
    - ((5 + 3 * t + 10 * c - 4 * c * c - 9 * EP2) * d ** 4) / 24
    + ((61 + 90 * t + 298 * c + 45 * t * t - 252 * EP2 - 3 * c * c) * d ** 6) / 720);
  const lng = (d - ((1 + 2 * t + c) * d ** 3) / 6
    + ((5 - 2 * c + 28 * t - 3 * c * c + 8 * EP2 + 24 * t * t) * d ** 5) / 120) / cos;
  return [centralMeridian(zone) + lng / RAD, lat / RAD];
}

/** The 100 km square letters of the square whose southwest corner is (easting, northing). */
function squareId(zone: number, easting: number, northing: number): string | undefined {
  const column = COLUMN_SETS[(zone - 1) % 3]![Math.floor(easting / SQUARE) - 1];
  const row = ROWS[(Math.floor(northing / SQUARE) + (zone % 2 === 0 ? 5 : 0)) % 20];
  return column && row ? `${column}${row}` : undefined;
}

/** Splits a line where it leaves [lo, hi] in longitude, ending each run on the boundary. */
function clipToZone(points: readonly Position[], lo: number, hi: number): Position[][] {
  const runs: Position[][] = [];
  let run: Position[] = [];
  const inside = (p: Position) => p[0] >= lo && p[0] <= hi;
  const cross = (a: Position, b: Position): Position => {
    const edge = (a[0] < lo) !== (b[0] < lo) ? lo : hi;
    const k = (edge - a[0]) / (b[0] - a[0]);
    return [edge, a[1] + k * (b[1] - a[1])];
  };
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (inside(p)) {
      if (prev && !inside(prev)) run.push(cross(prev, p));
      run.push(p);
    } else if (prev && inside(prev)) {
      run.push(cross(prev, p));
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

const line = (coordinates: Position[], properties: UsngFeature["properties"]): UsngFeature =>
  ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties });
const point = (coordinates: Position, properties: UsngFeature["properties"]): UsngFeature =>
  ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });

/** Grid zone boundaries and, below zoom 6, their labels. */
function zoneFeatures(west: number, south: number, east: number, north: number, zoom: number): UsngFeature[] {
  const out: UsngFeature[] = [];
  for (let lng = Math.ceil((west + 180) / 6) * 6 - 180; lng <= east; lng += 6) {
    out.push(line([[lng, south], [lng, north]], { level: "gzd" }));
  }
  const parallels = [...Array.from({ length: 20 }, (_, i) => i * 8 - 80), 84];
  for (const lat of parallels) if (lat >= south && lat <= north) out.push(line([[west, lat], [east, lat]], { level: "gzd" }));
  if (zoom >= USNG_LEVELS[0]!.minzoom) return out;
  for (let zone = zoneOf(west); zone <= zoneOf(east); zone += 1) {
    const w = Math.max(west, zoneWest(zone));
    const e = Math.min(east, zoneWest(zone) + 6);
    parallels.slice(0, -1).forEach((bandSouth, i) => {
      const s = Math.max(south, bandSouth);
      const n = Math.min(north, parallels[i + 1]!);
      if (w < e && s < n) out.push(point([(w + e) / 2, (s + n) / 2], { level: "gzd", label: `${zone}${BANDS[i]}` }));
    });
  }
  return out;
}

/** The lines and 100 km square labels of one zone over one hemisphere's part of the view. */
function zoneGrid(zone: number, west: number, south: number, east: number, north: number, zoom: number): UsngFeature[] {
  const levels = USNG_LEVELS.filter((l) => zoom >= l.minzoom);
  if (levels.length === 0) return [];
  const hemisphereSouth = north <= 0;
  // The view's extent in this zone's grid: its edges, sampled, and the central meridian where parallels turn.
  const edge: Position[] = [];
  for (let k = 0; k <= 16; k += 1) {
    const lng = west + ((east - west) * k) / 16;
    const lat = south + ((north - south) * k) / 16;
    edge.push([lng, south], [lng, north], [west, lat], [east, lat]);
  }
  const cm = centralMeridian(zone);
  if (cm > west && cm < east) edge.push([cm, south], [cm, north]);
  const utm = edge.map(([lng, lat]) => toUtm(lng, lat, zone));
  const minE = Math.min(...utm.map((p) => p[0]));
  const maxE = Math.max(...utm.map((p) => p[0]));
  const minN = Math.min(...utm.map((p) => p[1]));
  const maxN = Math.max(...utm.map((p) => p[1]));

  const lo = zoneWest(zone);
  const hi = lo + 6;
  const out: UsngFeature[] = [];
  let finest = levels.length - 1;
  while (finest > 0 && Math.max(maxE - minE, maxN - minN) / levels[finest]!.meters > MAX_LINES) finest -= 1;
  const spacing = levels[finest]!.meters;
  const digits = finest === 0 ? 0 : Math.round(Math.log10(SQUARE / spacing));
  const levelOf = (value: number) => levels.find((l) => value % l.meters === 0)!.level;
  const labelOf = (value: number) =>
    (digits ? { label: String(Math.floor((value % SQUARE) / spacing)).padStart(digits, "0") } : {});

  for (let i = Math.ceil(minE / spacing); i * spacing <= maxE; i += 1) {
    const e = i * spacing;
    const points = Array.from({ length: SEGMENTS + 1 }, (_, k) => fromUtm(e, minN + ((maxN - minN) * k) / SEGMENTS, zone, hemisphereSouth));
    for (const run of clipToZone(points, lo, hi)) out.push(line(run, { level: levelOf(e), axis: "easting", ...labelOf(e) }));
  }
  for (let i = Math.ceil(minN / spacing); i * spacing <= maxN; i += 1) {
    const n = i * spacing;
    const points = Array.from({ length: SEGMENTS + 1 }, (_, k) => fromUtm(minE + ((maxE - minE) * k) / SEGMENTS, n, zone, hemisphereSouth));
    for (const run of clipToZone(points, lo, hi)) out.push(line(run, { level: levelOf(n), axis: "northing", ...labelOf(n) }));
  }

  // Each 100 km square named at the middle of its part in view, pulled back inside the zone at its edges.
  for (let i = Math.floor(minE / SQUARE); i * SQUARE <= maxE; i += 1) {
    for (let j = Math.floor(minN / SQUARE); j * SQUARE <= maxN; j += 1) {
      const e0 = Math.max(i * SQUARE, minE);
      const e1 = Math.min((i + 1) * SQUARE, maxE);
      const n = (Math.max(j * SQUARE, minN) + Math.min((j + 1) * SQUARE, maxN)) / 2;
      const [middle, lat] = fromUtm((e0 + e1) / 2, n, zone, hemisphereSouth);
      let lng = middle;
      if (lng > hi) lng = (fromUtm(e0, n, zone, hemisphereSouth)[0] + hi) / 2;
      if (lng < lo) lng = (lo + fromUtm(e1, n, zone, hemisphereSouth)[0]) / 2;
      const square = squareId(zone, i * SQUARE, j * SQUARE);
      if (!square || lng < lo || lng > hi || lat < south || lat > north) continue;
      out.push(point([lng, lat], { level: "100km", label: `${zone}${bandOf(lat)} ${square}` }));
    }
  }
  return out;
}

/**
 * The grid for a map view, as GeoJSON for a MapLibre source: call it with
 * `map.getBounds()` and `map.getZoom()` on moveend. Lines carry `level`
 * (style widths by it) and `axis`; points are labels.
 */
// ponytail: USNG covers the United States only, so Norway's and Svalbard's odd zones are not drawn and a view is clipped at the antimeridian.
export function usngGrid(bounds: readonly [number, number, number, number], zoom: number): UsngFeatureCollection {
  const west = Math.max(-180, bounds[0]);
  const south = Math.max(-80, bounds[1]);
  const east = Math.min(180, bounds[2]);
  const north = Math.min(84, bounds[3]);
  if (!(west < east && south < north)) return { type: "FeatureCollection", features: [] };
  const features = zoneFeatures(west, south, east, north, zoom);
  const hemispheres: Position[] = [[south, Math.min(north, 0)], [Math.max(south, 0), north]];
  for (const [s, n] of hemispheres) {
    if (s >= n) continue;
    for (let zone = zoneOf(west); zone <= zoneOf(east); zone += 1) {
      const w = Math.max(west, zoneWest(zone));
      const e = Math.min(east, zoneWest(zone) + 6);
      if (w < e) features.push(...zoneGrid(zone, w, s, e, n, zoom));
    }
  }
  return { type: "FeatureCollection", features };
}
