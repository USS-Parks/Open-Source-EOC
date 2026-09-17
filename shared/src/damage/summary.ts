import { DAMAGE_DEGREES } from "../dictionary/pda.js";

/**
 * Damage assessment aggregation and FEMA declaration-support output
 * (VEOC-23, F8/F9). The Crisis Track lesson: the output is the paperwork.
 * These are pure functions over approved assessment rows, so the numbers
 * that go on a federal declaration request are golden-tested, and the
 * rendered document is derived from exactly those numbers.
 */

export type DamageDegree = (typeof DAMAGE_DEGREES.values)[number];

export interface AssessmentRow {
  readonly degree: DamageDegree;
  readonly estimatedLoss: number;
  readonly insured: boolean | null;
}

/** Federal declaration indicators the summary is measured against. */
export interface DeclarationThresholds {
  /** County population, for the PA per-capita impact indicator. */
  readonly population: number;
  /** PA per-capita impact indicator in dollars (FEMA sets this annually). */
  readonly paPerCapitaIndicator: number;
  /** Count of destroyed-or-major residences that triggers an IA request. */
  readonly iaResidenceThreshold: number;
}

export interface DamageSummary {
  readonly byDegree: Readonly<Record<DamageDegree, number>>;
  readonly totalStructures: number;
  readonly totalEstimatedLoss: number;
  readonly uninsuredLoss: number;
  /** Destroyed + major: the IA "homes with major damage or destroyed" count. */
  readonly majorOrWorse: number;
  readonly declaration: {
    readonly population: number;
    readonly perCapitaImpact: number;
    readonly paPerCapitaIndicator: number;
    readonly paThresholdMet: boolean;
    readonly iaResidenceThreshold: number;
    readonly iaThresholdMet: boolean;
  };
}

function emptyByDegree(): Record<DamageDegree, number> {
  const out = {} as Record<DamageDegree, number>;
  for (const d of DAMAGE_DEGREES.values) out[d] = 0;
  return out;
}

export function summarizeAssessments(
  rows: readonly AssessmentRow[],
  thresholds: DeclarationThresholds,
): DamageSummary {
  const byDegree = emptyByDegree();
  let totalEstimatedLoss = 0;
  let uninsuredLoss = 0;
  for (const row of rows) {
    byDegree[row.degree] = (byDegree[row.degree] ?? 0) + 1;
    totalEstimatedLoss += row.estimatedLoss;
    if (row.insured === false) uninsuredLoss += row.estimatedLoss;
  }
  const majorOrWorse = (byDegree.major ?? 0) + (byDegree.destroyed ?? 0);
  const perCapitaImpact =
    thresholds.population > 0 ? totalEstimatedLoss / thresholds.population : 0;
  return {
    byDegree,
    totalStructures: rows.length,
    totalEstimatedLoss,
    uninsuredLoss,
    majorOrWorse,
    declaration: {
      population: thresholds.population,
      perCapitaImpact,
      paPerCapitaIndicator: thresholds.paPerCapitaIndicator,
      paThresholdMet: perCapitaImpact >= thresholds.paPerCapitaIndicator,
      iaResidenceThreshold: thresholds.iaResidenceThreshold,
      iaThresholdMet: majorOrWorse >= thresholds.iaResidenceThreshold,
    },
  };
}

function dollars(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface DeclarationMeta {
  readonly jurisdiction: string;
  readonly incident: string;
  readonly preparedAt: string;
}

/**
 * Render the declaration-support document from a summary. This is the
 * artifact an emergency manager submits: the shape follows FEMA's IA/PA
 * damage summary, and every figure comes straight from the summary so
 * the document can never disagree with the aggregation.
 */
export function renderDeclarationSupport(summary: DamageSummary, meta: DeclarationMeta): string {
  const d = summary.declaration;
  const lines = [
    `# Disaster Declaration Support Summary`,
    ``,
    `Jurisdiction: ${meta.jurisdiction}`,
    `Incident: ${meta.incident}`,
    `Prepared: ${meta.preparedAt}`,
    ``,
    `## Individual Assistance — residences by degree of damage`,
    `- Destroyed: ${summary.byDegree.destroyed}`,
    `- Major: ${summary.byDegree.major}`,
    `- Minor: ${summary.byDegree.minor}`,
    `- Affected: ${summary.byDegree.affected}`,
    `- Inaccessible: ${summary.byDegree.inaccessible}`,
    `- Destroyed or major (IA basis): ${summary.majorOrWorse}`,
    ``,
    `## Estimated losses`,
    `- Total assessed structures: ${summary.totalStructures}`,
    `- Total estimated loss: ${dollars(summary.totalEstimatedLoss)}`,
    `- Uninsured loss: ${dollars(summary.uninsuredLoss)}`,
    ``,
    `## Public Assistance — per-capita impact indicator`,
    `- County population: ${d.population.toLocaleString("en-US")}`,
    `- Per-capita impact: ${dollars(d.perCapitaImpact)}`,
    `- FEMA per-capita indicator: ${dollars(d.paPerCapitaIndicator)}`,
    `- PA threshold met: ${d.paThresholdMet ? "YES" : "no"}`,
    ``,
    `## Determination`,
    `- IA residence threshold (${d.iaResidenceThreshold}) met: ${d.iaThresholdMet ? "YES" : "no"}`,
    `- PA per-capita threshold met: ${d.paThresholdMet ? "YES" : "no"}`,
  ];
  return lines.join("\n");
}
