import { describe, expect, it } from "vitest";
import {
  summarizeAssessments,
  renderDeclarationSupport,
  type AssessmentRow,
  type DeclarationThresholds,
} from "../summary.js";

const thresholds: DeclarationThresholds = {
  population: 5000,
  paPerCapitaIndicator: 4.6,
  iaResidenceThreshold: 3,
};

const rows: AssessmentRow[] = [
  { degree: "destroyed", estimatedLoss: 200000, insured: false },
  { degree: "destroyed", estimatedLoss: 180000, insured: true },
  { degree: "major", estimatedLoss: 90000, insured: false },
  { degree: "minor", estimatedLoss: 15000, insured: null },
  { degree: "affected", estimatedLoss: 3000, insured: false },
];

describe("damage aggregation (golden)", () => {
  it("counts by degree, totals losses, and separates uninsured", () => {
    const s = summarizeAssessments(rows, thresholds);
    expect(s.byDegree).toEqual({
      destroyed: 2,
      major: 1,
      minor: 1,
      affected: 1,
      inaccessible: 0,
    });
    expect(s.totalStructures).toBe(5);
    expect(s.totalEstimatedLoss).toBe(488000);
    expect(s.uninsuredLoss).toBe(200000 + 90000 + 3000);
    expect(s.majorOrWorse).toBe(3);
  });

  it("computes the declaration indicators", () => {
    const s = summarizeAssessments(rows, thresholds);
    // 488000 / 5000 = 97.6 per capita, well over the 4.6 indicator.
    expect(s.declaration.perCapitaImpact).toBeCloseTo(97.6, 5);
    expect(s.declaration.paThresholdMet).toBe(true);
    // 3 destroyed-or-major meets the residence threshold of 3.
    expect(s.declaration.iaThresholdMet).toBe(true);
  });

  it("reports thresholds unmet when the damage is small", () => {
    const s = summarizeAssessments(
      [{ degree: "minor", estimatedLoss: 1000, insured: true }],
      thresholds,
    );
    expect(s.declaration.paThresholdMet).toBe(false);
    expect(s.declaration.iaThresholdMet).toBe(false);
    expect(s.majorOrWorse).toBe(0);
  });

  it("renders the declaration document from exactly those numbers", () => {
    const s = summarizeAssessments(rows, thresholds);
    const doc = renderDeclarationSupport(s, {
      jurisdiction: "Yurok Tribe",
      incident: "Winter Storms 2026",
      preparedAt: "2026-09-17T12:00:00Z",
    });
    expect(doc).toContain("Destroyed or major (IA basis): 3");
    expect(doc).toContain("Total estimated loss: $488,000.00");
    expect(doc).toContain("Uninsured loss: $293,000.00");
    expect(doc).toContain("PA threshold met: YES");
    expect(doc).toContain("Yurok Tribe");
  });
});
