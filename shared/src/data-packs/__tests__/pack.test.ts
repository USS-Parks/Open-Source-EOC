import { describe, expect, it } from "vitest";
import {
  applyFieldMapping,
  datasetAvailability,
  DataPackSchema,
  resolvePath,
} from "../pack.js";

/**
 * The data-pack field mapping and availability logic (VEOC-79C): a partner's
 * heterogeneous source is normalized by a declared mapping, and a missing
 * source value is null, never a fabricated zero.
 */

describe("resolvePath", () => {
  it("reads nested dot-paths and returns undefined for a missing step", () => {
    const rec = { properties: { name: "Culvert washout", sev: 3 } };
    expect(resolvePath(rec, "properties.name")).toBe("Culvert washout");
    expect(resolvePath(rec, "properties.sev")).toBe(3);
    expect(resolvePath(rec, "properties.missing")).toBeUndefined();
    expect(resolvePath(rec, "nope.deeper")).toBeUndefined();
  });
});

describe("applyFieldMapping", () => {
  it("maps present fields and yields null (not zero) for absent source paths", () => {
    const rec = { properties: { title: "Road closed", when: "2026-09-20T10:00:00Z" } };
    const mapped = applyFieldMapping(rec, {
      title: "properties.title",
      occurredAt: "properties.when",
      severity: "properties.sev", // absent in the source
    });
    expect(mapped.title).toBe("Road closed");
    expect(mapped.occurredAt).toBe("2026-09-20T10:00:00Z");
    // The absent source path is null, never 0 or "" — missing is never a value.
    expect(mapped.severity).toBeNull();
    // An unmapped field is omitted entirely, not nulled.
    expect("category" in mapped).toBe(false);
  });
});

describe("datasetAvailability", () => {
  const staleAfterSeconds = 3600;
  it("never loaded and no error is awaiting, not unavailable or zero", () => {
    expect(datasetAvailability({ lastSuccessAt: null, lastError: null, staleAfterSeconds })).toBe(
      "awaiting",
    );
  });
  it("never loaded with an error is unavailable", () => {
    expect(
      datasetAvailability({ lastSuccessAt: null, lastError: "connection refused", staleAfterSeconds }),
    ).toBe("unavailable");
  });
  it("a fresh load is available and an old one is stale", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(
      datasetAvailability({ lastSuccessAt: new Date("2026-09-20T11:59:00Z"), lastError: null, staleAfterSeconds, now }),
    ).toBe("available");
    expect(
      datasetAvailability({ lastSuccessAt: new Date("2026-09-20T10:00:00Z"), lastError: null, staleAfterSeconds, now }),
    ).toBe("stale");
  });
});

describe("DataPackSchema", () => {
  it("accepts a valid pack and rejects duplicate dataset keys", () => {
    const base = {
      name: "Valley Mutual Aid feeds",
      organizationSlug: "valley-mutual-aid",
      datasets: [
        { key: "closures", name: "Road closures", kind: "geojson", url: "https://example.org/c.json", fieldMapping: { title: "properties.name" } },
      ],
    };
    expect(DataPackSchema.safeParse(base).success).toBe(true);
    const dup = { ...base, datasets: [base.datasets[0], base.datasets[0]] };
    expect(DataPackSchema.safeParse(dup).success).toBe(false);
    const noMapping = {
      ...base,
      datasets: [{ ...base.datasets[0], fieldMapping: {} }],
    };
    expect(DataPackSchema.safeParse(noMapping).success).toBe(false);
  });
});
