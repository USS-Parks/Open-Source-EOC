import { describe, expect, it } from "vitest";
import {
  publicAssistanceTotals,
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
    expect(doc).toContain("PA county per-capita threshold met: YES");
    expect(doc).toContain("Yurok Tribe");
  });
});

const meta = { jurisdiction: "Yurok Tribe", incident: "Winter Storms 2026", preparedAt: "2026-09-17T12:00:00Z" };

describe("Public Assistance cost and shelter census", () => {
  const pa = publicAssistanceTotals([
    { category: "a_debris_removal", costCents: 1_250_000_05, items: 2 },
    { category: "c_roads_and_bridges", costCents: 30_000_00, items: 1 },
    { category: "a_debris_removal", costCents: 10, items: 1 },
  ]);

  it("totals cents by category and converts once", () => {
    expect(pa.byCategory.a_debris_removal).toBe(1_250_000.15);
    expect(pa.byCategory.c_roads_and_bridges).toBe(30_000);
    expect(pa.byCategory.g_parks_recreational_other).toBe(0);
    expect(Object.keys(pa.byCategory)).toHaveLength(7);
    expect(pa.totalCost).toBe(1_280_000.15);
    expect(pa.items).toBe(4);
  });

  it("divides structure loss until PA line items are counted, then PA cost", () => {
    const loss = summarizeAssessments(rows, thresholds);
    expect(loss.declaration.perCapitaBasis).toBe("structure_loss");
    expect(loss.declaration.perCapitaAmount).toBe(488000);
    const withPa = summarizeAssessments(rows, thresholds, pa);
    expect(withPa.declaration.perCapitaBasis).toBe("pa_cost");
    expect(withPa.declaration.perCapitaAmount).toBe(1_280_000.15);
    expect(withPa.declaration.perCapitaImpact).toBeCloseTo(256.00003, 5);
    // The structure loss still stands on its own line.
    expect(withPa.totalEstimatedLoss).toBe(488000);
  });

  it("computes the statewide indicator only from both operator-entered figures", () => {
    expect(summarizeAssessments(rows, thresholds, pa).declaration.statewide).toBeNull();
    expect(summarizeAssessments(rows, { ...thresholds, statePopulation: 1_000_000 }, pa).declaration.statewide).toBeNull();
    const state = summarizeAssessments(rows, { ...thresholds, statePopulation: 1_000_000, statewidePerCapitaIndicator: 1.5 }, pa)
      .declaration.statewide!;
    expect(state.perCapitaImpact).toBeCloseTo(1.28, 5);
    expect(state.met).toBe(false);
  });

  it("renders PA by category, the basis, statewide and the shelter census", () => {
    const s = summarizeAssessments(
      rows,
      { ...thresholds, statePopulation: 1_000_000, statewidePerCapitaIndicator: 1.5 },
      pa,
      [
        { name: "Klamath Gym", capacity: 120, open: 40, reportedAt: "2026-09-17T11:00:00.000Z" },
        { name: "Weitchpec School", capacity: 60, open: 70, reportedAt: "2026-09-17T10:00:00.000Z" },
        { name: "Pecwan Hall", capacity: 0, open: 0, reportedAt: null },
      ],
    );
    expect(s.shelterCensus).toMatchObject({ capacity: 180, open: 110, occupied: 80 });
    const doc = renderDeclarationSupport(s, meta).split("\n");
    for (const line of [
      "- Category A: Debris removal: $1,250,000.15",
      "- Category C: Roads and bridges: $30,000.00",
      "- Category G: Parks, recreational and other facilities: $0.00",
      "- Total, categories A to G: $1,280,000.15",
      "- Counted line items: 4",
      "- Basis: Public Assistance cost, categories A to G",
      "- County population (operator-entered): 5,000",
      "- County per-capita indicator (operator-entered): $4.60",
      "- State population (operator-entered): 1,000,000",
      "- Statewide threshold met: no",
      "- Shelters: 3, 2 reporting",
      "- Occupied: 80",
      "- Klamath Gym: 80 occupied of 120, 40 open, reported 2026-09-17T11:00:00.000Z",
      "- Pecwan Hall: no report yet",
      "- PA statewide per-capita threshold met: no",
    ]) expect(doc).toContain(line);
  });

  it("says the census is not available and names the structure-loss basis without PA items", () => {
    const doc = renderDeclarationSupport(summarizeAssessments(rows, thresholds), meta).split("\n");
    for (const line of [
      "- No Public Assistance line items are counted.",
      "- Basis: structure loss of counted structures; no Public Assistance cost is counted",
      "- Statewide indicator: not computed; no state population and statewide indicator were entered",
      "- Shelter census not available: the facilities integration is not enabled on this server.",
      "- PA statewide per-capita threshold met: not computed",
    ]) expect(doc).toContain(line);
  });
});
