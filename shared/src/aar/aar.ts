/**
 * After-action review composition (VEOC-36, F16-adjacent, HSEEP-shaped). An
 * AAR is composed purely from observations captured during the incident, the
 * corrective actions, and the exported chronology used as evidence. Keeping
 * composition pure makes it golden-testable and lets the PDF writer render it.
 */

export interface AarObservation {
  readonly capability: string;
  readonly kind: "strength" | "improvement";
  readonly observation: string;
  readonly recommendation: string | null;
}

export interface AarCorrectiveAction {
  readonly capability: string;
  readonly recommendation: string;
  readonly owner: string | null;
  readonly dueDate: string | null;
  readonly status: string;
}

export interface AarComposeInput {
  readonly incidentName: string;
  readonly period: string;
  readonly overview: string;
  readonly objectives: readonly string[];
  readonly observations: readonly AarObservation[];
  readonly correctiveActions: readonly AarCorrectiveAction[];
  readonly chronologyLines: readonly string[];
}

export interface AarDocument {
  readonly incidentName: string;
  readonly period: string;
  readonly overview: string;
  readonly objectives: readonly string[];
  readonly strengths: readonly AarObservation[];
  readonly improvements: readonly AarObservation[];
  readonly correctiveActions: readonly AarCorrectiveAction[];
  readonly chronologyCount: number;
  readonly chronologyLines: readonly string[];
}

/** Compose an HSEEP-shaped AAR document from its inputs. */
export function composeAar(input: AarComposeInput): AarDocument {
  return {
    incidentName: input.incidentName,
    period: input.period,
    overview: input.overview,
    objectives: [...input.objectives],
    strengths: input.observations.filter((o) => o.kind === "strength"),
    improvements: input.observations.filter((o) => o.kind === "improvement"),
    correctiveActions: [...input.correctiveActions],
    chronologyCount: input.chronologyLines.length,
    chronologyLines: [...input.chronologyLines],
  };
}

/** A deterministic HSEEP-ordered text projection for rendering and snapshots. */
export function aarToTextLines(doc: AarDocument): string[] {
  const lines: string[] = [];
  lines.push("AFTER-ACTION REPORT / IMPROVEMENT PLAN");
  lines.push(`Incident: ${doc.incidentName}`);
  lines.push(`Period: ${doc.period}`);
  lines.push("");
  lines.push("1. Incident Overview");
  lines.push(`  ${doc.overview}`);
  lines.push("");
  lines.push("2. Objectives");
  for (const o of doc.objectives) lines.push(`  - ${o}`);
  lines.push("");
  lines.push("3. Strengths");
  for (const s of doc.strengths) lines.push(`  [${s.capability}] ${s.observation}`);
  lines.push("");
  lines.push("4. Areas for Improvement");
  for (const i of doc.improvements) {
    lines.push(`  [${i.capability}] ${i.observation}`);
    if (i.recommendation) lines.push(`    Recommendation: ${i.recommendation}`);
  }
  lines.push("");
  lines.push("5. Improvement Plan (Corrective Actions)");
  for (const c of doc.correctiveActions) {
    lines.push(
      `  [${c.capability}] ${c.recommendation} ` +
        `(owner: ${c.owner ?? "unassigned"}; due: ${c.dueDate ?? "TBD"}; status: ${c.status})`,
    );
  }
  lines.push("");
  lines.push(`6. Evidence: chronology (${doc.chronologyCount} events)`);
  for (const l of doc.chronologyLines) lines.push(`  ${l}`);
  return lines;
}
