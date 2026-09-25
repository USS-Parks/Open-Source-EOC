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

/** What each lifeline covers, in the words the overview shows under its name. */
export const LIFELINE_SCOPES: Readonly<Record<LifelineKey, string>> = {
  safety_security: "Law enforcement, fire, search & rescue",
  food_hydration_shelter: "Food access, shelters, mass care",
  health_medical: "Hospitals, EMS, medical care",
  energy: "Power generation, transmission, fuel",
  communications: "Voice, data, internet, public alerts",
  transportation: "Roads, bridges, ports, airports",
  hazardous_materials: "Facilities, spills, environmental",
  water_systems: "Drinking water, wastewater, stormwater",
};

/** The condition as operators say it: an unstable lifeline is disrupted. */
const CONDITION_LABELS: Readonly<Record<LifelineCondition, string>> = {
  stable: "Stable", stabilizing: "Stabilizing", unstable: "Disrupted", unknown: "Unknown",
};

export function conditionLabel(condition: LifelineCondition): string {
  return CONDITION_LABELS[condition];
}

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
  /** When the server received the standing report, apart from when its condition was observed. */
  readonly receivedLabel: string;
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
    receivedLabel: report ? formatAssessmentTime(report.attribution.recordedAt) : "Not received",
    freshness: freshness.freshness,
    freshnessLabel: freshness.label,
    confidence,
    evidence: evidenceCount === 0 ? `${confidence} · no evidence listed` : `${confidence} · ${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"}`,
    outlook: report ? text(payload.stabilizationOutlook) ?? "Outlook not reported" : "Outlook not reported",
    unresolvedActions: report ? unresolvedActions(payload) : null,
  };
}

/** The card's one line: the impact statement's first sentence. */
export function shortImpact(impact: string): string {
  const first = /^(.+?[.!?])(\s|$)/.exec(impact.trim())?.[1] ?? impact.trim();
  return first.replace(/\.$/, "");
}

/** "09:35 PDT": a time of day in the viewer's zone. */
export function timeOfDay(value: string | null): string {
  if (!value) return "Not reported";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Not reported";
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
    .format(new Date(timestamp));
}

export interface PeriodWindow {
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** The report that stood for a lifeline in a period: its latest report naming that period, or assessed inside it. */
export function reportInPeriod(
  reports: readonly LifelineAssessmentReport[],
  period: PeriodWindow,
): LifelineAssessmentReport | null {
  const starts = Date.parse(period.startsAt);
  const ends = Date.parse(period.endsAt);
  const inPeriod = reports.filter((report) => {
    const named = text(object(report.payload)?.operationalPeriod);
    if (named) return named === period.label;
    const assessed = Date.parse(report.assessedAt);
    return assessed >= starts && assessed <= ends;
  });
  return [...inPeriod].sort((a, b) => Date.parse(b.assessedAt) - Date.parse(a.assessedAt))[0] ?? null;
}

/** A single report as a lifeline's state, for a period that has closed. */
export function stateOf(lifeline: string, report: LifelineAssessmentReport | null): LifelineCurrentState {
  return { lifeline, condition: report?.condition ?? null, conflict: false, reports: report ? [report] : [], decision: null };
}

export interface ComponentItem {
  readonly label: string;
  readonly condition: string | null;
  readonly geography: string | null;
  readonly dependencies: readonly string[];
  readonly causes: readonly string[];
}

export function componentItems(report: LifelineAssessmentReport | null): readonly ComponentItem[] {
  return list(object(report?.payload)?.components).flatMap((value) => {
    const item = object(value);
    const label = text(item?.label);
    const strings = (key: string) => list(item?.[key]).flatMap((entry) => text(entry) ? [text(entry)!] : []);
    return label ? [{
      label,
      condition: text(item?.condition),
      geography: text(item?.affectedGeography),
      dependencies: strings("dependencies"),
      causes: strings("causes"),
    }] : [];
  });
}

export interface LinkedAction {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly owner: string;
  readonly resourceRequestId: string | null;
  readonly boardRecordId: string | null;
}

const ACTION_STATUS: Readonly<Record<string, string>> = {
  planned: "Planned", in_progress: "In progress", blocked: "Blocked", complete: "Complete",
};

/** A stabilization action's owner: its assignee, else its responsible organization. */
export function linkedActions(
  report: LifelineAssessmentReport | null,
  organizationNames: ReadonlyMap<string, string>,
): readonly LinkedAction[] {
  return list(object(report?.payload)?.actions).flatMap((value, index) => {
    const item = object(value);
    const title = text(item?.title);
    if (!item || !title) return [];
    const assignment = object(item.assignment);
    const status = text(item.status) ?? "planned";
    const assignee = text(assignment?.positionTitle) ?? text(assignment?.incidentPositionTitle);
    const organization = text(item.responsibleOrganizationId);
    return [{
      key: text(item.key) ?? `action-${index}`,
      title,
      status,
      // A planned action someone has taken on reads as assigned.
      statusLabel: status === "planned" && assignee ? "Assigned" : ACTION_STATUS[status] ?? status,
      owner: assignee ?? (organization ? organizationNames.get(organization) ?? "Responsible organization" : "No owner named"),
      resourceRequestId: text(item.linkedResourceRequestId),
      boardRecordId: text(item.linkedBoardRecordId),
    }];
  });
}

/** Whether a report's committed next update has passed. */
export function updateOverdue(report: LifelineAssessmentReport | null, now: Date): boolean {
  return Boolean(report?.nextUpdateAt && Date.parse(report.nextUpdateAt) < now.getTime());
}

const SEVERITY: Readonly<Record<LifelineCondition, number>> = { stable: 0, stabilizing: 1, unstable: 2, unknown: -1 };

/** How a lifeline moved between two periods. */
export function conditionTrend(before: LifelineCondition | null, after: LifelineCondition): "worse" | "better" | "same" | "unknown" {
  if (!before || before === "unknown" || after === "unknown") return before === after ? "same" : "unknown";
  const change = SEVERITY[after] - SEVERITY[before];
  return change > 0 ? "worse" : change < 0 ? "better" : "same";
}
