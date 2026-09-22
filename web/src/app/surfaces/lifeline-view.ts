import type {
  LifelineAssessmentReport,
  LifelineCurrentState,
  OperationalPeriod,
} from "@openeoc/shared";
import type { LifelineKey } from "../../design/icons/index.js";
import type { OperationalState } from "../../design/tokens.js";

export const LIFELINE_KEYS = [
  "safety_security",
  "food_hydration_shelter",
  "health_medical",
  "energy",
  "communications",
  "transportation",
  "hazardous_materials",
  "water_systems",
] as const satisfies readonly LifelineKey[];

export const LIFELINE_LABELS: Readonly<Record<LifelineKey, string>> = {
  safety_security: "Safety & Security",
  food_hydration_shelter: "Food, Hydration, Shelter",
  health_medical: "Health & Medical",
  energy: "Energy",
  communications: "Communications",
  transportation: "Transportation",
  hazardous_materials: "Hazardous Materials",
  water_systems: "Water Systems",
};

const CONDITIONS = new Set(["stable", "stabilizing", "unstable", "unknown"]);
const CONFIDENCE = new Set(["confirmed", "estimated", "unknown"]);

export type LifelineCondition = "stable" | "stabilizing" | "unstable" | "unknown";
export type LifelineFreshness = "current" | "stale" | "unknown";

export interface LifelineCardView {
  readonly key: LifelineKey;
  readonly label: string;
  readonly condition: LifelineCondition;
  readonly conditionState: OperationalState;
  readonly conflict: boolean;
  readonly conflictResolved: boolean;
  readonly report: LifelineAssessmentReport | null;
  readonly impact: string;
  readonly components: string;
  readonly geography: string;
  readonly source: string;
  readonly assessedAt: string | null;
  readonly assessedLabel: string;
  readonly freshness: LifelineFreshness;
  readonly freshnessLabel: string;
  readonly confidence: string;
  readonly evidence: string;
  readonly outlook: string;
  readonly unresolvedActions: number | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function selectedReport(state: LifelineCurrentState): LifelineAssessmentReport | null {
  if (state.conflict && !state.decision) return null;
  if (state.decision) {
    return state.reports.find((report) => report.id === state.decision!.selectedAssessmentId) ?? null;
  }
  return state.condition === null ? null : state.reports[0] ?? null;
}

function conditionFor(state: LifelineCurrentState, report: LifelineAssessmentReport | null): LifelineCondition {
  if (state.conflict && !state.decision) return "unknown";
  const candidate = state.condition ?? report?.condition;
  return candidate && CONDITIONS.has(candidate) ? candidate as LifelineCondition : "unknown";
}

export function conditionState(condition: LifelineCondition): OperationalState {
  if (condition === "stable") return "normal";
  if (condition === "stabilizing") return "watch";
  if (condition === "unstable") return "critical";
  return "unknown";
}

function componentFields(payload: Record<string, unknown>): {
  components: string;
  geography: string;
} {
  const components = list(payload.components).flatMap((value) => {
    const item = object(value);
    const label = text(item?.label);
    return label ? [{ label, geography: text(item?.affectedGeography) }] : [];
  });
  const labels = components.map((item) => item.label);
  const componentSummary = labels.length === 0
    ? "Not reported"
    : `${labels.slice(0, 3).join(" · ")}${labels.length > 3 ? ` · +${labels.length - 3} more` : ""}`;
  const geographies = [...new Set(components.flatMap((item) => item.geography ? [item.geography] : []))];
  return {
    components: componentSummary,
    geography: geographies.length > 0 ? geographies.join(" · ") : "Not reported",
  };
}

function unresolvedActions(payload: Record<string, unknown>): number | null {
  if (!Array.isArray(payload.actions)) return null;
  return payload.actions.reduce((count, value) => {
    const item = object(value);
    return item && item.status !== "complete" ? count + 1 : count;
  }, 0);
}

function freshnessFor(
  report: LifelineAssessmentReport | null,
  payload: Record<string, unknown>,
  period: OperationalPeriod | null,
  now: Date,
  forceStale: boolean,
): { freshness: LifelineFreshness; label: string } {
  if (!report) return { freshness: "unknown", label: "No current assessment" };
  if (forceStale) return { freshness: "stale", label: "Update failed · last received assessment" };
  if (!period) return { freshness: "unknown", label: "No current operational period" };
  const assessed = Date.parse(report.assessedAt);
  const starts = Date.parse(period.startsAt);
  const ends = Date.parse(period.endsAt);
  if (![assessed, starts, ends].every(Number.isFinite)) {
    return { freshness: "unknown", label: "Assessment time unavailable" };
  }
  const reportedPeriod = text(payload.operationalPeriod);
  const stale = now.getTime() > ends || assessed < starts || assessed > ends ||
    (reportedPeriod !== null && reportedPeriod !== period.label);
  return stale
    ? { freshness: "stale", label: `Outside ${period.label}` }
    : { freshness: "current", label: `Current · ${period.label}` };
}

export function formatAssessmentTime(value: string | null): string {
  if (!value) return "Not assessed";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Assessment time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

export function projectLifeline(
  state: LifelineCurrentState | undefined,
  key: LifelineKey,
  period: OperationalPeriod | null,
  now = new Date(),
  forceStale = false,
): LifelineCardView {
  const fallback: LifelineCurrentState = {
    lifeline: key,
    condition: null,
    conflict: false,
    reports: [],
    decision: null,
  };
  const current = state ?? fallback;
  const report = selectedReport(current);
  const payload = object(report?.payload) ?? {};
  const condition = conditionFor(current, report);
  const component = componentFields(payload);
  const confidenceValue = text(payload.confidence);
  const confidence = confidenceValue && CONFIDENCE.has(confidenceValue)
    ? confidenceValue[0]!.toUpperCase() + confidenceValue.slice(1)
    : "Unknown";
  const evidenceCount = list(payload.evidence).length;
  const freshness = freshnessFor(report, payload, period, now, forceStale);
  return {
    key,
    label: LIFELINE_LABELS[key],
    condition,
    conditionState: conditionState(condition),
    conflict: current.conflict,
    conflictResolved: current.conflict && current.decision !== null,
    report,
    impact: report
      ? text(payload.impactStatement) ?? "Impact not reported"
      : current.conflict ? "Conflicting assessments require a decision" : "No current assessment",
    components: report ? component.components : "Not reported",
    geography: report ? component.geography : "Not reported",
    source: report?.attribution.homeOrganizationName ?? "Source not reported",
    assessedAt: report?.assessedAt ?? null,
    assessedLabel: formatAssessmentTime(report?.assessedAt ?? null),
    freshness: freshness.freshness,
    freshnessLabel: freshness.label,
    confidence,
    evidence: evidenceCount === 0 ? `${confidence} · no evidence listed` : `${confidence} · ${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"}`,
    outlook: report ? text(payload.stabilizationOutlook) ?? "Outlook not reported" : "Outlook not reported",
    unresolvedActions: report ? unresolvedActions(payload) : null,
  };
}



