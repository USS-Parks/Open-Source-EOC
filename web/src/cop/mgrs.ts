/**
 * WGS84 longitude/latitude to an MGRS or USNG grid reference at 1 m. The UTM
 * projection follows the NGA/USGS series (Snyder, Map Projections: A Working
 * Manual, USGS PP 1395, chapter 8), with the Norway and Svalbard zone
 * exceptions; the 100 km square letters follow the MGRS AA lettering used
 * with WGS84. Digits are truncated, never rounded, as the standard requires.
 * Outside 80S to 84N (the polar UPS areas) there is no UTM reference.
 */

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const E4 = E2 * E2;
const E6 = E4 * E2;
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const BANDS = "CDEFGHJKLMNPQRSTUVWX";
const COLUMN_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
const ROWS = "ABCDEFGHJKLMNPQRSTUV";

interface GridParts {
  readonly zone: string;
  readonly square: string;
  readonly easting: string;
  readonly northing: string;
}

function utmZone(lng: number, lat: number): number {
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) return 32;
  if (lat >= 72 && lng >= 0 && lng < 42) return lng < 9 ? 31 : lng < 21 ? 33 : lng < 33 ? 35 : 37;
  return Math.floor((lng + 180) / 6) + 1;
}

function gridParts(lngIn: number, lat: number): GridParts | null {
  if (!Number.isFinite(lngIn) || !Number.isFinite(lat) || lat < -80 || lat > 84) return null;
  const lng = ((((lngIn + 180) % 360) + 360) % 360) - 180;
  const zone = utmZone(lng, lat);
  const phi = (lat * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  const t = tan * tan;
  const c = EP2 * cos * cos;
  const a = cos * (((lng - ((zone - 1) * 6 - 180 + 3)) * Math.PI) / 180);
  const m = A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * phi
    - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * phi)
    + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * phi)
    - ((35 * E6) / 3072) * Math.sin(6 * phi));
  const easting = K0 * n * (a + ((1 - t + c) * a ** 3) / 6
    + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  const northing = K0 * (m + n * tan * (a ** 2 / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720)) + (lat < 0 ? 10000000 : 0);
  const column = COLUMN_SETS[(zone - 1) % 3]![Math.floor(easting / 100000) - 1];
  const row = ROWS[(Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  if (!column || !row) return null;
  const band = BANDS[Math.min(Math.floor((lat + 80) / 8), BANDS.length - 1)]!;
  const digits = (v: number) => String(Math.floor(v % 100000)).padStart(5, "0");
  return { zone: `${zone}${band}`, square: `${column}${row}`, easting: digits(easting), northing: digits(northing) };
}

/** MGRS reference, for example 18SUJ2348706483; null outside UTM coverage. */
export function toMgrs(lng: number, lat: number): string | null {
  const p = gridParts(lng, lat);
  return p ? `${p.zone}${p.square}${p.easting}${p.northing}` : null;
}

/** USNG reference, the same grid written with spaces: 18S UJ 23487 06483. */
export function toUsng(lng: number, lat: number): string | null {
  const p = gridParts(lng, lat);
  return p ? `${p.zone} ${p.square} ${p.easting} ${p.northing}` : null;
}
