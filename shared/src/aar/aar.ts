import { CAPABILITY_ELEMENT_LABELS, CORE_CAPABILITY_LABELS } from "../dictionary/core-capabilities.js";

/**
 * After-action review composition (F16-adjacent, HSEEP-shaped). An
 * AAR is composed purely from observations captured during the incident, the
 * corrective actions, and the exported chronology used as evidence. Keeping
 * composition pure makes it golden-testable and lets the PDF writer render it.
 * Capabilities are stored as National Preparedness Goal core-capability ids;
 * the text projection maps them to their proper labels for the finished report.
 */

export interface AarObservation {
  readonly id: string;
  readonly capability: string;
  readonly capabilityElement: string;
  readonly kind: "strength" | "improvement";
  readonly observation: string;
  readonly recommendation: string | null;
  readonly operationalPeriodRevision: number | null;
  readonly createdAt: string;
}

/** Application workflow labels supplied explicitly by an operator; never derived from doctrine or a numeric score. */
export const AAR_ACTION_PRIORITIES = ["unspecified", "low", "medium", "high", "critical"] as const;
export type AarActionPriority = (typeof AAR_ACTION_PRIORITIES)[number];
export const AAR_ACTION_STATUSES = ["open", "in_progress", "complete"] as const;
export type AarActionStatus = (typeof AAR_ACTION_STATUSES)[number];

export interface AarActionAssignment {
  readonly kind: "position" | "incident_participant";
  readonly organizationId: string;
  readonly label: string;
  readonly positionId?: string | undefined;
  readonly participantId?: string | undefined;
  readonly personId?: string | undefined;
}

export interface AarCorrectiveAction {
  readonly id: string;
  readonly capability: string;
  readonly capabilityElement: string;
  readonly recommendation: string;
  readonly priority: AarActionPriority;
  readonly owner: string | null;
  readonly assignment: AarActionAssignment | null;
  readonly dueDate: string | null;
  readonly status: AarActionStatus;
  readonly revision: number;
  readonly operationalPeriodRevision: number | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  /** The plan, and the section of it, this action changes; absent in reports compiled before the link existed. */
  readonly plan?: AarActionPlanLink | null;
}

export interface AarActionPlanLink {
  readonly id: string;
  readonly title: string;
  readonly section: string | null;
}

export interface AarAnalyticsBucket {
  readonly key: string;
  readonly count: number;
  readonly observationIds: readonly string[];
  readonly correctiveActionIds: readonly string[];
}

export interface AarAnalytics {
  readonly totals: {
    readonly observations: number;
    readonly correctiveActions: number;
    readonly records: number;
  };
  readonly byPriority: readonly AarAnalyticsBucket[];
  readonly byStatus: readonly AarAnalyticsBucket[];
  readonly byCapability: readonly AarAnalyticsBucket[];
}

/** An incident in a reader's cross-incident rollup: one they may read, active at some time in the range. */
export interface AarRollupIncident {
  readonly id: string;
  readonly name: string;
  readonly jurisdictionId: string;
  readonly activatedAt: string;
  readonly closedAt: string | null;
}

/** A corrective action as the cross-incident rollup lists it. */
export interface AarRollupAction {
  readonly id: string;
  readonly incidentId: string;
  /** The organization that recorded the action. */
  readonly organizationId: string;
  readonly organizationName: string | null;
  readonly capability: string;
  readonly capabilityElement: string;
  readonly recommendation: string;
  readonly priority: AarActionPriority;
  readonly status: AarActionStatus;
  readonly dueDate: string | null;
  readonly owner: string | null;
  /** The responsible organization: the owner's. Null while no owner is assigned. */
  readonly ownerOrganization: { readonly id: string; readonly name: string } | null;
  readonly createdAt: string;
}

export interface AarRollup {
  readonly incidents: readonly AarRollupIncident[];
  readonly correctiveActions: readonly AarRollupAction[];
}

export interface AarOperationalPeriod {
  readonly revision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * Bracket tag for a capability: the capability's proper label (falling back to
 * the raw id for anything outside the dictionary), plus the POETE element label
 * when one is set.
 */
function capabilityTag(capability: string, element: string): string {
  const cap = CORE_CAPABILITY_LABELS[capability] ?? capability;
  if (!element || element === "none") return cap;
  return `${cap} / ${CAPABILITY_ELEMENT_LABELS[element] ?? element}`;
}

export interface AarComposeInput {
  readonly incidentName: string;
  readonly period: string;
  readonly operationalPeriod?: AarOperationalPeriod | null | undefined;
  readonly overview: string;
  readonly objectives: readonly string[];
  readonly observations: readonly AarObservation[];
  readonly correctiveActions: readonly AarCorrectiveAction[];
  readonly chronologyLines: readonly string[];
}

export interface AarDocument {
  readonly incidentName: string;
  readonly period: string;
  readonly operationalPeriod: AarOperationalPeriod | null;
  readonly overview: string;
  readonly objectives: readonly string[];
  readonly strengths: readonly AarObservation[];
  readonly improvements: readonly AarObservation[];
  readonly correctiveActions: readonly AarCorrectiveAction[];
  readonly analytics: AarAnalytics;
  readonly chronologyCount: number;
  readonly chronologyLines: readonly string[];
}

/** Compose an HSEEP-shaped AAR document from its inputs. */
export function composeAar(input: AarComposeInput): AarDocument {
  return {
    incidentName: input.incidentName,
    period: input.period,
    operationalPeriod: input.operationalPeriod ?? null,
    overview: input.overview,
    objectives: [...input.objectives],
    strengths: input.observations.filter((o) => o.kind === "strength"),
    improvements: input.observations.filter((o) => o.kind === "improvement"),
    correctiveActions: [...input.correctiveActions],
    analytics: summarizeAar(input.observations, input.correctiveActions),
    chronologyCount: input.chronologyLines.length,
    chronologyLines: [...input.chronologyLines],
  };
}

function bucket(key: string, observations: readonly AarObservation[], actions: readonly AarCorrectiveAction[]): AarAnalyticsBucket {
  return {
    key,
    count: observations.length + actions.length,
    observationIds: observations.map((item) => item.id),
    correctiveActionIds: actions.map((item) => item.id),
  };
}

/** Aggregate only the supplied records; every count retains its drilldown IDs. */
export function summarizeAar(
  observations: readonly AarObservation[],
  correctiveActions: readonly AarCorrectiveAction[],
): AarAnalytics {
  const byPriority = AAR_ACTION_PRIORITIES.map((priority) =>
    bucket(priority, [], correctiveActions.filter((item) => item.priority === priority)));
  const byStatus = AAR_ACTION_STATUSES.map((status) =>
    bucket(status, [], correctiveActions.filter((item) => item.status === status)));
  const capabilities = [...new Set([
    ...observations.map((item) => item.capability),
    ...correctiveActions.map((item) => item.capability),
  ])].sort();
  const byCapability = capabilities.map((capability) => bucket(
    capability,
    observations.filter((item) => item.capability === capability),
    correctiveActions.filter((item) => item.capability === capability),
  ));
  return {
    totals: {
      observations: observations.length,
      correctiveActions: correctiveActions.length,
      records: observations.length + correctiveActions.length,
    },
    byPriority,
    byStatus,
    byCapability,
  };
}

/** A deterministic HSEEP-ordered text projection for rendering and snapshots. */
export function aarToTextLines(doc: AarDocument): string[] {
  const lines: string[] = [];
  // Reports composed before accountability fields existed remain exportable; missing accountability
  // fields receive explicit neutral values rather than inferred classifications.
  const legacyObservations = [...doc.strengths, ...doc.improvements].map((item, index) => ({
    ...item,
    id: item.id ?? `legacy-observation-${index + 1}`,
    operationalPeriodRevision: item.operationalPeriodRevision ?? null,
    createdAt: item.createdAt ?? "",
  }));
  const legacyActions = doc.correctiveActions.map((item, index) => ({
    ...item,
    id: item.id ?? `legacy-action-${index + 1}`,
    priority: item.priority ?? "unspecified" as const,
    assignment: item.assignment ?? null,
    revision: item.revision ?? 0,
    operationalPeriodRevision: item.operationalPeriodRevision ?? null,
    completedAt: item.completedAt ?? null,
    completedBy: item.completedBy ?? null,
  }));
  const analytics = doc.analytics ?? summarizeAar(legacyObservations, legacyActions);
  lines.push("AFTER-ACTION REPORT / IMPROVEMENT PLAN");
  lines.push(`Incident: ${doc.incidentName}`);
  lines.push(`Period: ${doc.period}`);
  if (doc.operationalPeriod) {
    lines.push(`Operational Period Revision: ${doc.operationalPeriod.revision}`);
    lines.push(`Operational Period Window: ${doc.operationalPeriod.startsAt} to ${doc.operationalPeriod.endsAt}`);
  }
  lines.push("");
  lines.push("1. Incident Overview");
  lines.push(`  ${doc.overview}`);
  lines.push("");
  lines.push("2. Objectives");
  for (const o of doc.objectives) lines.push(`  - ${o}`);
  lines.push("");
  lines.push("Analytics (reconciled to included records)");
  lines.push(`  Observations: ${analytics.totals.observations}`);
  lines.push(`  Corrective actions: ${analytics.totals.correctiveActions}`);
  lines.push(`  Total records: ${analytics.totals.records}`);
  lines.push(`  Priority: ${analytics.byPriority.map((item) => `${item.key}=${item.count}`).join("; ")}`);
  lines.push(`  Status: ${analytics.byStatus.map((item) => `${item.key}=${item.count}`).join("; ")}`);
  lines.push("");
  lines.push("3. Strengths");
  for (const s of doc.strengths)
    lines.push(`  [${capabilityTag(s.capability, s.capabilityElement)}] ${s.observation}`);
  lines.push("");
  lines.push("4. Areas for Improvement");
  for (const i of doc.improvements) {
    lines.push(`  [${capabilityTag(i.capability, i.capabilityElement)}] ${i.observation}`);
    if (i.recommendation) lines.push(`    Recommendation: ${i.recommendation}`);
  }
  lines.push("");
  lines.push("5. Improvement Plan (Corrective Actions)");
  for (const c of doc.correctiveActions) {
    lines.push(
      `  [${capabilityTag(c.capability, c.capabilityElement)}] ${c.recommendation} ` +
        `(priority: ${c.priority ?? "unspecified"}; owner: ${c.owner ?? "unassigned"}; ` +
        `due: ${c.dueDate ?? "TBD"}; status: ${c.status}; revision: ${c.revision ?? 0})`,
    );
    if (c.completedAt) lines.push(`    First completed: ${c.completedAt} by ${c.completedBy ?? "unknown"}`);
    if (c.plan) lines.push(`    Plan to update: ${c.plan.title}${c.plan.section ? `, section ${c.plan.section}` : ""}`);
  }
  lines.push("");
  lines.push(`6. Evidence: chronology (${doc.chronologyCount} events)`);
  for (const l of doc.chronologyLines) lines.push(`  ${l}`);
  return lines;
}
