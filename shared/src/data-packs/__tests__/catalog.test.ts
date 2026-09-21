import { describe, expect, it } from "vitest";
import {
  CALIFORNIA_CATALOG,
  CALIFORNIA_BBOX,
  bboxIntersects,
  catalogCovers,
  catalogToDataset,
  type Bbox,
} from "../catalog.js";
import { DataPackDatasetSchema } from "../pack.js";

describe("California data catalog (VEOC-79F)", () => {
  const sanDiego: Bbox = [-117.6, 32.5, -116.1, 33.5];

  it("a statewide source covers any California area", () => {
    const statewide = CALIFORNIA_CATALOG.find((s) => s.coverage.statewide)!;
    expect(catalogCovers(statewide, sanDiego)).toBe(true);
  });

  it("a county source covers its own area but not elsewhere", () => {
    const humboldt = CALIFORNIA_CATALOG.find((s) => s.id === "humboldt-parcels")!;
    expect(catalogCovers(humboldt, [-124.2, 40.5, -123.9, 41.0])).toBe(true);
    expect(catalogCovers(humboldt, sanDiego)).toBe(false);
  });

  it("no sub-area source is labeled statewide, and every source sits within California", () => {
    for (const s of CALIFORNIA_CATALOG) {
      expect(bboxIntersects(s.coverage.bbox, CALIFORNIA_BBOX)).toBe(true);
      if (!s.coverage.statewide) {
        const [w, so, e, n] = s.coverage.bbox;
        const smaller =
          w > CALIFORNIA_BBOX[0] || so > CALIFORNIA_BBOX[1] || e < CALIFORNIA_BBOX[2] || n < CALIFORNIA_BBOX[3];
        expect(smaller).toBe(true);
      }
    }
  });

  it("every source maps to a schema-valid data-pack dataset", () => {
    for (const s of CALIFORNIA_CATALOG) {
      expect(() => DataPackDatasetSchema.parse(catalogToDataset(s))).not.toThrow();
    }
  });

  it("documents unavailable sources as named gaps rather than omitting them", () => {
    const gaps = CALIFORNIA_CATALOG.filter((s) => !s.available);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect((g.notes ?? "").length).toBeGreaterThan(0);
  });
});
