import { createExpression, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { facilityTypeExpression, facilityTypeFor } from "../facilities.js";
import { boardLayerSpecs, opacityPaint, sourceId, tileLayerSpecs } from "../layers.js";
import { symbolStatusExpression, symbolStatusFor } from "../symbology.js";
import { labelExpression, labelFor } from "../tools.js";

function evaluate(expression: unknown, properties: Record<string, unknown>): unknown {
  const parsed = createExpression(expression, "layers[0].paint.circle-color");
  if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 12 } as never, { type: 1, properties, geometry: [] } as never);
}

const SAMPLES: Record<string, unknown>[] = [
  {},
  { severity: "critical" },
  { status: "closed" },
  { severity: "bogus", status: "one_lane" },
  { severity: 5, priority: "routine" },
  { status: "stable", priority: "immediate" },
  { facility_type: "Hospital", name: "County General" },
  { facilityType: "shelter", title: "", road: "SR-1" },
  { NAICS_DESC: "Fire Station", label: "Station 4" },
  { category: "Public Schools" },
  { subclass: "police" },
  { subclass: "clinic", summary: "Walk-in" },
];

describe("vector tile layers", () => {
  it("derive status, facility type and label from raw fields exactly as tagging does", () => {
    for (const properties of SAMPLES) {
      expect(evaluate(symbolStatusExpression(), properties)).toBe(symbolStatusFor(properties));
      expect(evaluate(facilityTypeExpression(), properties)).toBe(facilityTypeFor(properties) ?? "");
      expect(evaluate(labelExpression(), properties)).toBe(labelFor(properties));
    }
  });

  it("read the tile's features layer, draw clusters, and validate as a style", () => {
    const src = sourceId("b1");
    const layers = tileLayerSpecs(boardLayerSpecs("b1", "light", "Noto Sans Regular"), src, "light", "Noto Sans Regular");
    const text = JSON.stringify(layers);
    // Tiles carry no precomputed tags; only the raw-field lookups remain.
    expect(text).not.toMatch(/\["get","_(symbolStatus|label)"\]|\["has","_facilityType"\]/);
    const ids = layers.map((layer) => (layer as { id: string }).id);
    expect(ids).toContain(`${src}-cluster`);
    expect(ids).toContain(`${src}-cluster-count`);
    const style = {
      version: 8,
      glyphs: "https://example.invalid/{fontstack}/{range}.pbf",
      sources: { [src]: { type: "vector", tiles: ["https://example.invalid/{z}/{x}/{y}.mvt"] } },
      layers,
    };
    expect(validateStyleMin(style as never).map((error) => error.message)).toEqual([]);
  });

  it("keeps a stale feed in the unknown frame", () => {
    const layers = tileLayerSpecs(boardLayerSpecs("f1", "dark"), "board-f1", "dark", undefined, true);
    const point = layers.find((layer) => (layer as { id: string }).id === "board-f1-point") as {
      paint: Record<string, unknown>;
    };
    expect(evaluate(point.paint["circle-color"], { severity: "critical" })).toBe(
      evaluate(point.paint["circle-color"], {}),
    );
  });

  it("scales each layer's own opacity by the operator setting", () => {
    const [fill, line, point] = boardLayerSpecs("b1", "light");
    expect(opacityPaint(fill, 0.5)).toEqual({ "fill-opacity": 0.5 });
    expect(opacityPaint(line, 0.5)).toEqual({ "line-opacity": 0.5 });
    expect(opacityPaint(point, 0)).toEqual({ "circle-opacity": 0, "circle-stroke-opacity": 0 });
  });
});
