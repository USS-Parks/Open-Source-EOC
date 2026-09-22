import { describe, expect, it } from "vitest";
import { renderMapExport } from "../map-export.js";

interface TextCall { readonly text: string; readonly x: number; readonly y: number }

function exportHarness(sourceWidth = 600, sourceHeight = 400) {
  const text: TextCall[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    arc: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    drawImage: () => undefined,
    measureText: (value: string) => ({ width: value.length * 7 }),
    fillText: (value: string, x: number, y: number) => text.push({ text: value, x, y }),
  } as unknown as CanvasRenderingContext2D;
  const output = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => "data:image/png;base64,composed",
  } as unknown as HTMLCanvasElement;
  const source = { width: sourceWidth, height: sourceHeight } as HTMLCanvasElement;
  return { source, output, text };
}

describe("D30 map PNG export", () => {
  it("keeps the map unobscured and adds identity, period, legend and provenance", () => {
    const harness = exportHarness();
    const exportedAt = new Date("2026-09-21T19:23:45.000Z");
    const result = renderMapExport(harness.source, {
      incidentName: "North Coast Storm",
      operationalPeriod: "OP 3 · 1800-0600",
      handling: "FOUO",
      operationalLayers: [
        { title: "Road Closures", detail: "board records" },
        { title: "Field Positions", detail: "stale last-good data" },
      ],
      referenceSources: [
        "Natural Earth 10m + US Census counties (public domain)",
        "Road Closures: Open Source EOC board records",
        "Field Positions: County CAD feed",
      ],
      legendLines: ["FLOOD REFERENCE LEGEND: High; Moderate; Unknown"],
      exportedAt,
    }, () => harness.output);

    expect(result.width).toBe(960);
    expect(result.height).toBeGreaterThan(92 + 640);
    expect(result.filename).toBe("cop-north-coast-storm-2026-09-21T19-23-45-000Z.png");
    expect(result.dataUrl).toBe("data:image/png;base64,composed");
    const receipt = harness.text.map((call) => call.text).join("\n");
    expect(receipt).toContain("OPEN SOURCE EOC");
    expect(receipt).toContain("North Coast Storm");
    expect(receipt).toContain("OP 3 · 1800-0600");
    expect(receipt).toContain("HANDLING: FOUO");
    expect(receipt).toContain("◆ Critical");
    expect(receipt).toContain("Road Closures (board records)");
    expect(receipt).toContain("Field Positions (stale last-good data)");
    expect(receipt).toContain("Natural Earth 10m + US Census counties");
    expect(receipt).toContain("2026-09-21T19:23:45.000Z");
    expect(receipt).toContain("not a live feed");
  });

  it("states unknown context rather than inventing incident or source provenance", () => {
    const harness = exportHarness(1200, 600);
    const result = renderMapExport(harness.source, {
      operationalLayers: [],
      referenceSources: [],
      exportedAt: new Date("2026-09-21T20:00:00.000Z"),
    }, () => harness.output);
    const receipt = harness.text.map((call) => call.text).join("\n");
    expect(result.width).toBe(1200);
    expect(receipt).toContain("No incident selected");
    expect(receipt).toContain("Operational period not selected");
    expect(receipt).toContain("VISIBLE OPERATIONAL LAYERS: None visible");
    expect(receipt).toContain("SOURCE PROVENANCE: No source attribution supplied");
    expect(receipt).not.toContain("HANDLING:");
  });
});
