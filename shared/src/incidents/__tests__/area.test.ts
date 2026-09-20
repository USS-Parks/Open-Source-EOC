import { describe, expect, it } from "vitest";
import { IncidentAreaGeometrySchema, IncidentAreaUpdateSchema, OperationalPeriodSchema } from "../area.js";

const coordinates = [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]]];
const geometry = { type: "Polygon", coordinates };
const period = { label: "OP 1", startsAt: "2026-09-20T08:00:00-07:00", endsAt: "2026-09-20T20:00:00-07:00" };

describe("incident area contracts", () => {
  it("accepts polygon and multipolygon areas without jurisdiction fields", () => {
    expect(IncidentAreaGeometrySchema.parse(geometry).type).toBe("Polygon");
    expect(IncidentAreaGeometrySchema.parse({ type: "MultiPolygon", coordinates: [coordinates] }).type).toBe("MultiPolygon");
  });
  it("rejects out-of-range and unclosed coordinates", () => {
    expect(IncidentAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [[[181, 38], [-121, 38], [-121, 39], [181, 38]]] }).success).toBe(false);
    expect(IncidentAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }).success).toBe(false);
  });
  it("rejects degenerate rings and point locations masquerading as areas", () => {
    expect(IncidentAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] }).success).toBe(false);
    expect(IncidentAreaGeometrySchema.safeParse({ type: "Point", coordinates: [-121, 38] }).success).toBe(false);
  });
  it("bounds total vertices across rings", () => {
    expect(IncidentAreaGeometrySchema.safeParse({ type: "MultiPolygon", coordinates: Array.from({ length: 251 }, () => Array.from({ length: 10 }, () => coordinates[0])) }).success).toBe(false);
  });
  it("keeps an undefined area distinct from an empty polygon", () => {
    expect(IncidentAreaUpdateSchema.parse({ expectedRevision: 0, geometry: null, operationalPeriod: null, reason: "Area not yet confirmed" }).geometry).toBeNull();
    expect(IncidentAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [] }).success).toBe(false);
  });
  it("requires an ordered timezone-aware operational period", () => {
    expect(OperationalPeriodSchema.parse(period).label).toBe("OP 1");
    expect(OperationalPeriodSchema.safeParse({ ...period, endsAt: period.startsAt }).success).toBe(false);
    expect(OperationalPeriodSchema.safeParse({ ...period, startsAt: "2026-09-20T08:00:00" }).success).toBe(false);
  });
  it("rejects forged attribution, negative revisions and blank reasons", () => {
    const update = { expectedRevision: 0, geometry, operationalPeriod: period, reason: "Initial boundary" };
    expect(IncidentAreaUpdateSchema.safeParse({ ...update, createdBy: "another-operator" }).success).toBe(false);
    expect(IncidentAreaUpdateSchema.safeParse({ ...update, expectedRevision: -1 }).success).toBe(false);
    expect(IncidentAreaUpdateSchema.safeParse({ ...update, reason: "  " }).success).toBe(false);
  });
});
