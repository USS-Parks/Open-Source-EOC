import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { COUNTY_BOUNDS } from "../county-bounds.js";
import { geometryBounds } from "../tools.js";

const counties = JSON.parse(
  readFileSync(new URL("../../../public/basemap/ca_counties.geojson", import.meta.url), "utf8"),
) as { features: Array<{ properties: { name: string }; geometry: unknown }> };

it("bundles a box for exactly the counties in the county file, each the true bounds rounded outward to four decimals", () => {
  expect(Object.keys(COUNTY_BOUNDS).sort()).toEqual(counties.features.map((f) => f.properties.name).sort());
  for (const f of counties.features) {
    const [w, s, e, n] = geometryBounds(f.geometry)!;
    const [bw, bs, be, bn] = COUNTY_BOUNDS[f.properties.name]!;
    // Each bundled edge lies outside the true edge by less than 0.0001 degree.
    for (const gap of [w - bw, s - bs, be - e, bn - n]) {
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(1.0001e-4);
    }
  }
});
