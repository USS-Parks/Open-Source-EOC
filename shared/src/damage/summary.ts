import { DAMAGE_DEGREES, PA_CATEGORIES, PA_CATEGORY_LABELS } from "../dictionary/pda.js";

/**
 * Damage assessment aggregation and FEMA declaration-support output
 * (F8/F9). The Crisis Track lesson: the output is the paperwork.
 * These are pure functions over approved assessment rows, counted Public
 * Assistance line items and shelter reports, so the numbers that go on a
 * federal declaration request are golden-tested, and the rendered document
 * is derived from exactly those numbers.
 */

export type DamageDegree = (typeof DAMAGE_DEGREES.values)[number];

export interface AssessmentRow {
  readonly degree: DamageDegree;
  readonly estimatedLoss: number;
  readonly insured: boolean | null;
}

export type PaCategory = (typeof PA_CATEGORIES.values)[number];

/** Workflow state of a Public Assistance line item. Drafts are listed but never counted. */
export const PA_ITEM_STATUSES = ["draft", "submitted", "reviewed"] as const;
export type PaItemStatus = (typeof PA_ITEM_STATUSES)[number];

/**
 * Federal declaration indicators the summary is measured against. Every
 * figure is entered by the operator; the engine holds no population data and
 * no published indicator values.
 */
export interface DeclarationThresholds {
  /** County population, for the county PA per-capita impact indicator. */
  readonly population: number;
  /** County PA per-capita impact indicator in dollars (FEMA sets this annually). */
  readonly paPerCapitaIndicator: number;
  /** Count of destroyed-or-major residences that triggers an IA request. */
  readonly iaResidenceThreshold: number;
  /** State population, for the statewide indicator. Computed only with the statewide indicator. */
  readonly statePopulation?: number | undefined;
  /** Statewide PA per-capita impact indicator in dollars. */
  readonly statewidePerCapitaIndicator?: number | undefined;
}

/** Estimated Public Assistance cost of the counted line items, in dollars. */
export interface PublicAssistanceTotals {
  readonly byCategory: Readonly<Record<PaCategory, number>>;
  readonly totalCost: number;
  /** Counted line items: submitted or reviewed. */
  readonly items: number;
}

/** The latest shelter report from the facilities integration. */
export interface ShelterReport {
  readonly name: string;
  readonly capacity: number;
  readonly open: number;
  /** Null when the shelter has not reported yet. */
  readonly reportedAt: string | null;
}

export interface ShelterCensus {
  readonly shelters: readonly ShelterReport[];
  readonly capacity: number;
  readonly occupied: number;
  readonly open: number;
}

export interface DamageSummary {
  readonly byDegree: Readonly<Record<DamageDegree, number>>;
  readonly totalStructures: number;
  readonly totalEstimatedLoss: number;
  readonly uninsuredLoss: number;
  /** Destroyed + major: the IA "homes with major damage or destroyed" count. */
  readonly majorOrWorse: number;
  readonly publicAssistance: PublicAssistanceTotals;
  /** Null when the facilities integration is off: there is no census to report. */
  readonly shelterCensus: ShelterCensus | null;
  readonly declaration: {
    readonly population: number;
    /** PA cost when counted PA line items exist, otherwise the structure loss. */
    readonly perCapitaBasis: "pa_cost" | "structure_loss";
    /** The dollar amount the per-capita figures divide. */
    readonly perCapitaAmount: number;
    readonly perCapitaImpact: number;
    readonly paPerCapitaIndicator: number;
    readonly paThresholdMet: boolean;
    /** Null unless the operator entered both the state population and the statewide indicator. */
    readonly statewide: {
      readonly population: number;
      readonly perCapitaImpact: number;
      readonly indicator: number;
      readonly met: boolean;
    } | null;
    readonly iaResidenceThreshold: number;
    readonly iaThresholdMet: boolean;
  };
}

function emptyByDegree(): Record<DamageDegree, number> {
  const out = {} as Record<DamageDegree, number>;
  for (const d of DAMAGE_DEGREES.values) out[d] = 0;
  return out;
}

/**
 * PA totals from per-category sums in cents. Cents are summed as integers
 * and converted once, so the total matches the category lines to the cent.
 */
export function publicAssistanceTotals(
  groups: readonly { category: string; costCents: number; items: number }[],
): PublicAssistanceTotals {
  const cents: Record<string, number> = {};
  for (const c of PA_CATEGORIES.values) cents[c] = 0;
  let totalCents = 0;
  let items = 0;
  for (const g of groups) {
    cents[g.category] = (cents[g.category] ?? 0) + g.costCents;
    totalCents += g.costCents;
    items += g.items;
  }
  const byCategory: Record<PaCategory, number> = {};
  for (const [c, v] of Object.entries(cents)) byCategory[c] = v / 100;
  return { byCategory, totalCost: totalCents / 100, items };
}

export function summarizeAssessments(
  rows: readonly AssessmentRow[],
  thresholds: DeclarationThresholds,
  publicAssistance: PublicAssistanceTotals = publicAssistanceTotals([]),
  shelters: readonly ShelterReport[] | null = null,
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
  const perCapitaBasis = publicAssistance.items > 0 ? "pa_cost" : "structure_loss";
  const perCapitaAmount = perCapitaBasis === "pa_cost" ? publicAssistance.totalCost : totalEstimatedLoss;
  const perCapita = (population: number) => (population > 0 ? perCapitaAmount / population : 0);
  const perCapitaImpact = perCapita(thresholds.population);
  const { statePopulation, statewidePerCapitaIndicator } = thresholds;
  const statewide = statePopulation !== undefined && statewidePerCapitaIndicator !== undefined
    ? {
        population: statePopulation,
        perCapitaImpact: perCapita(statePopulation),
        indicator: statewidePerCapitaIndicator,
        met: perCapita(statePopulation) >= statewidePerCapitaIndicator,
      }
    : null;
  let shelterCensus: ShelterCensus | null = null;
  if (shelters) {
    let capacity = 0;
    let open = 0;
    let occupied = 0;
    for (const s of shelters) {
      capacity += s.capacity;
      open += s.open;
      occupied += Math.max(0, s.capacity - s.open);
    }
    shelterCensus = { shelters, capacity, occupied, open };
  }
  return {
    byDegree,
    totalStructures: rows.length,
    totalEstimatedLoss,
    uninsuredLoss,
    majorOrWorse,
    publicAssistance,
    shelterCensus,
    declaration: {
      population: thresholds.population,
      perCapitaBasis,
      perCapitaAmount,
      perCapitaImpact,
      paPerCapitaIndicator: thresholds.paPerCapitaIndicator,
      paThresholdMet: perCapitaImpact >= thresholds.paPerCapitaIndicator,
      statewide,
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
  const pa = summary.publicAssistance;
  const census = summary.shelterCensus;
  const yes = (met: boolean) => (met ? "YES" : "no");
  const count = (n: number) => n.toLocaleString("en-US");
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
    `## Public Assistance: estimated cost by work category`,
    ...(pa.items === 0
      ? [`- No Public Assistance line items are counted.`]
      : [
          ...PA_CATEGORIES.values.map((c) => `- ${PA_CATEGORY_LABELS[c] ?? c}: ${dollars(pa.byCategory[c] ?? 0)}`),
          `- Total, categories A to G: ${dollars(pa.totalCost)}`,
          `- Counted line items: ${count(pa.items)}`,
        ]),
    `- Draft line items are not counted.`,
    ``,
    `## Public Assistance: per-capita impact indicators`,
    d.perCapitaBasis === "pa_cost"
      ? `- Basis: Public Assistance cost, categories A to G`
      : `- Basis: structure loss of counted structures; no Public Assistance cost is counted`,
    `- Amount divided: ${dollars(d.perCapitaAmount)}`,
    `- County population (operator-entered): ${count(d.population)}`,
    `- County per-capita impact: ${dollars(d.perCapitaImpact)}`,
    `- County per-capita indicator (operator-entered): ${dollars(d.paPerCapitaIndicator)}`,
    `- County threshold met: ${yes(d.paThresholdMet)}`,
    ...(d.statewide
      ? [
          `- State population (operator-entered): ${count(d.statewide.population)}`,
          `- Statewide per-capita impact: ${dollars(d.statewide.perCapitaImpact)}`,
          `- Statewide per-capita indicator (operator-entered): ${dollars(d.statewide.indicator)}`,
          `- Statewide threshold met: ${yes(d.statewide.met)}`,
        ]
      : [`- Statewide indicator: not computed; no state population and statewide indicator were entered`]),
    ``,
    `## Shelter census`,
    ...(census
      ? [
          `- Source: the latest report from each shelter in the facilities integration`,
          `- Shelters: ${count(census.shelters.length)}, ${count(census.shelters.filter((s) => s.reportedAt).length)} reporting`,
          `- Capacity: ${count(census.capacity)}`,
          `- Occupied: ${count(census.occupied)}`,
          `- Open spaces: ${count(census.open)}`,
          ...census.shelters.map((s) =>
            s.reportedAt
              ? `- ${s.name}: ${count(Math.max(0, s.capacity - s.open))} occupied of ${count(s.capacity)}, ${count(s.open)} open, reported ${s.reportedAt}`
              : `- ${s.name}: no report yet`),
        ]
      : [`- Shelter census not available: the facilities integration is not enabled on this server.`]),
    ``,
    `## Determination`,
    `- IA residence threshold (${d.iaResidenceThreshold}, operator-entered) met: ${yes(d.iaThresholdMet)}`,
    `- PA county per-capita threshold met: ${yes(d.paThresholdMet)}`,
    `- PA statewide per-capita threshold met: ${d.statewide ? yes(d.statewide.met) : "not computed"}`,
  ];
  return lines.join("\n");
}
