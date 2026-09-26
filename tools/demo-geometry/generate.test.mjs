import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeGrid, noise, ringsIntersect, signedArea, trace } from "./grid.mjs";
import { generate, SOURCES } from "./generate.mjs";

describe("demo geometry tracing", () => {
  it("traces a mask into a closed, valid polygon: outer ring counterclockwise, hole clockwise", () => {
    const grid = makeGrid([-124.2, 40.7, -124.1, 40.8], 50);
    const [cx, cy] = [grid.W / 2, grid.H / 2];
    const mask = new Uint8Array(grid.size);
    for (let i = 0; i < grid.size; i += 1) {
      const r = Math.hypot((i % grid.W) - cx, Math.floor(i / grid.W) - cy);
      if (r < 60 && r > 20) mask[i] = 1;
    }
    const polygon = trace(grid, mask, { minArea: 1000, minHole: 1000 });
    expect(polygon.type).toBe("Polygon");
    const [outer, hole] = polygon.coordinates;
    for (const ring of [outer, hole]) expect(ring[0]).toEqual(ring.at(-1));
    expect(signedArea(outer)).toBeGreaterThan(0);
    expect(signedArea(hole)).toBeLessThan(0);
    expect(outer.length - 1).toBeGreaterThanOrEqual(20);
    expect(ringsIntersect(polygon.coordinates)).toBe(false);
  });

  it("draws seeded noise the same way every time", () => {
    const grid = makeGrid([-124.2, 40.7, -124.1, 40.8], 200);
    expect(noise(grid, 7, 10)).toEqual(noise(grid, 7, 10));
    expect(noise(grid, 7, 10)).not.toEqual(noise(grid, 8, 10));
  });
});

// The basemap archives are not in the repository; this runs where they are installed.
describe.skipIf(!SOURCES.every((source) => existsSync(source)))("the committed scenario geometry", () => {
  it("is exactly what a fresh run of the generator writes", async () => {
    for (const [file, text] of await generate()) {
      expect(readFileSync(new URL(`../../server/src/demo/geometry/${file}`, import.meta.url), "utf8"), file).toBe(text);
    }
  }, 600_000);
});
