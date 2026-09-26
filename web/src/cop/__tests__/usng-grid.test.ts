import { describe, expect, it } from "vitest";
import { toUsng } from "../mgrs.js";
import { fromUtm, toUtm, usngGrid, type UsngFeature } from "../usng-grid.js";

/**
 * References are UTM positions projected to WGS84 by PROJ (PostGIS
 * ST_Transform from EPSG 32610 and 32611), each read back as USNG by the
 * cursor readout, which is itself held to PROJ and NGA in mgrs.test.ts.
 */
const REFERENCES: readonly [string, number, number, number, number, number, string][] = [
  ["Eureka, zone 10", 10, 400500.5, 4520500.5, -124.1800399787, 40.8295028208, "10T DL 00500 20500"],
  ["West of 120W, zone 10", 10, 755000.5, 4100000.5, -120.1339515727, 37.0116015187, "10S GG 55000 00000"],
  ["East of 120W, zone 11", 11, 240000.5, 4100000.5, -119.9221682428, 37.0102318914, "11S KB 40000 00000"],
  ["Los Angeles County, zone 11", 11, 389123.5, 3812345.5, -118.2069619644, 34.4466808567, "11S LU 89123 12345"],
];

const lines = (features: readonly UsngFeature[]) =>
  features.filter((f): f is UsngFeature & { geometry: { type: "LineString"; coordinates: [number, number][] } } => f.geometry.type === "LineString");
const points = (features: readonly UsngFeature[]) =>
  features.filter((f): f is UsngFeature & { geometry: { type: "Point"; coordinates: [number, number] } } => f.geometry.type === "Point");

describe("UTM conversion", () => {
  it.each(REFERENCES)("%s", (_name, zone, easting, northing, lng, lat, usng) => {
    expect(toUsng(lng, lat)).toBe(usng);
    const [x, y] = fromUtm(easting, northing, zone, false);
    expect(x).toBeCloseTo(lng, 7);
    expect(y).toBeCloseTo(lat, 7);
    const [e, n] = toUtm(lng, lat, zone);
    expect(e).toBeCloseTo(easting, 2);
    expect(n).toBeCloseTo(northing, 2);
  });

  it("reads the southern hemisphere with its false northing (Sydney, 56H LH 34786 52080)", () => {
    const [x, y] = fromUtm(334786.5, 6252080.5, 56, true);
    expect(x).toBeCloseTo(151.2140283575, 7);
    expect(y).toBeCloseTo(-33.8586594875, 7);
  });
});

describe("the USNG grid", () => {
  const eureka = [-124.25, 40.75, -124.1, 40.85] as const;

  it("draws only grid zones when zoomed out, then 100 km squares, then finer lines", () => {
    const wide = usngGrid([-126, 36, -114, 42], 5).features;
    expect(new Set(wide.map((f) => f.properties.level))).toEqual(new Set(["gzd"]));
    expect(points(wide).map((f) => f.properties.label).sort()).toEqual(["10S", "10T", "11S", "11T"]);
    const regional = usngGrid([-125, 39.5, -122, 41.5], 7).features;
    expect(new Set(regional.map((f) => f.properties.level))).toEqual(new Set(["gzd", "100km"]));
    expect(lines(regional).every((f) => f.properties.label === undefined)).toBe(true);
    const city = usngGrid(eureka, 13).features;
    expect(new Set(lines(city).map((f) => f.properties.level))).toEqual(new Set(["1km", "10km", "100km"]));
    const street = usngGrid([-124.17, 40.8, -124.16, 40.805], 16).features;
    expect(lines(street).some((f) => f.properties.level === "100m" && /^\d{3}$/.test(f.properties.label!))).toBe(true);
  });

  it("puts each 1 km line on its grid value and labels it with the USNG digits", () => {
    const grid = lines(usngGrid(eureka, 13).features);
    expect(grid.length).toBeGreaterThan(20);
    for (const f of grid) {
      const [lng, lat] = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]!;
      // Half a metre inside the line's cell, read back by the cursor readout.
      const [, , easting, northing] = toUsng(lng + (f.properties.axis === "easting" ? 5e-6 : 0), lat + (f.properties.axis === "northing" ? 5e-6 : 0))!.split(" ");
      const digits = f.properties.axis === "easting" ? easting! : northing!;
      expect(digits.slice(0, 2)).toBe(f.properties.label);
      expect(digits.slice(2)).toBe("000");
    }
  });

  it("names each 100 km square as the readout does at the label", () => {
    const labels = points(usngGrid([-126, 36, -114, 42], 6.5).features);
    expect(labels.length).toBeGreaterThan(40);
    for (const f of labels) {
      const [lng, lat] = f.geometry.coordinates;
      expect(toUsng(lng, lat)!.split(" ").slice(0, 2).join(" ")).toBe(f.properties.label);
    }
  });

  it("breaks the grid at 120W between zones 10 and 11", () => {
    const features = usngGrid([-120.6, 36.8, -119.4, 37.3], 10).features;
    const grid = lines(features).filter((f) => f.properties.level !== "gzd");
    const west = grid.filter((f) => f.geometry.coordinates.every(([lng]) => lng <= -120 + 1e-9));
    const east = grid.filter((f) => f.geometry.coordinates.every(([lng]) => lng >= -120 - 1e-9));
    expect(west.length + east.length).toBe(grid.length);
    expect(west.length).toBeGreaterThan(5);
    expect(east.length).toBeGreaterThan(5);
    // Northing lines run up to the zone edge on both sides.
    expect(west.some((f) => f.geometry.coordinates.at(-1)![0] === -120)).toBe(true);
    expect(east.some((f) => f.geometry.coordinates[0]![0] === -120)).toBe(true);
    expect(lines(features).some((f) => f.properties.level === "gzd" && f.geometry.coordinates[0]![0] === -120)).toBe(true);
    // A 10 km line either side reads as its own zone.
    const [wLng, wLat] = west.find((f) => f.properties.axis === "easting")!.geometry.coordinates[5]!;
    const [eLng, eLat] = east.find((f) => f.properties.axis === "easting")!.geometry.coordinates[5]!;
    expect(toUsng(wLng + 1e-5, wLat)).toMatch(/^10S /);
    expect(toUsng(eLng + 1e-5, eLat)).toMatch(/^11S /);
  });

  it("returns nothing for an empty view", () => {
    expect(usngGrid([-120, 37, -120, 37], 12).features).toEqual([]);
  });
});
