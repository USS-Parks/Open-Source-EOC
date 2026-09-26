import {
  CAPABILITY_ELEMENT_LABELS,
  CORE_CAPABILITIES,
  CORE_CAPABILITY_LABELS,
  type AarActionPriority,
  type AarActionStatus,
  type AarObservation,
} from "@openeoc/shared";
import { statusPalette, type ChartDatum } from "../design/charts/index.js";

/**
 * The after-action dashboard's counts. Every chart and the list under it read
 * one rule, `chartKey`, so a slice's count is always the length of the list
 * it filters. Rule-based only: each count reads recorded fields, nothing is
 * inferred or scored.
 */

export type AarChart = "priority" | "status" | "followThrough" | "capability" | "element" | "organization";

/** A corrective action as both scopes carry it: this incident's, or one from the cross-incident rollup. */
export interface DashboardAction {
  readonly id: string;
  readonly incidentId?: string | null;
  readonly capability: string;
  readonly capabilityElement: string;
  readonly recommendation: string;
  readonly owner: string | null;
  readonly priority: AarActionPriority;
  readonly status: AarActionStatus;
  readonly dueDate: string | null;
  /** The owner's organization; the rollup carries it, null while no owner is assigned. */
  readonly ownerOrganization?: { readonly id: string; readonly name: string } | null;
}

export type DashboardRecord = AarObservation | DashboardAction;

export interface DashboardRecords {
  readonly observations: readonly AarObservation[];
  readonly actions: readonly DashboardAction[];
}

export type FollowThrough = "complete" | "on_schedule" | "past_due" | "no_due_date";

const isAction = (record: DashboardRecord): record is DashboardAction => "priority" in record;

/** The local calendar date, YYYY-MM-DD, that due dates are read against. */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Where an action stands on the improvement plan: done, due later or today, past its due date, or undated. */
export function followThrough(action: DashboardAction, today: string): FollowThrough {
  if (action.status === "complete") return "complete";
  if (!action.dueDate) return "no_due_date";
  return action.dueDate < today ? "past_due" : "on_schedule";
}

/** The category a record falls in on a chart, or null when the chart does not count it. */
export function chartKey(chart: AarChart, record: DashboardRecord, today: string): string | null {
  if (chart === "capability") return record.capability;
  if (chart === "element") return record.capabilityElement || "none";
  if (!isAction(record)) return null;
  if (chart === "priority") return record.priority;
  if (chart === "status") return record.status;
  if (chart === "followThrough") return followThrough(record, today);
  return record.ownerOrganization?.id ?? "unassigned";
}

interface Category {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

export const PRIORITY_CATEGORIES: readonly Category[] = [
  { key: "critical", label: "Critical", color: statusPalette.closed },
  { key: "high", label: "High", color: statusPalette.pastDue },
  { key: "medium", label: "Medium", color: statusPalette.inProgress },
  { key: "low", label: "Low", color: statusPalette.approved },
  { key: "unspecified", label: "Unspecified", color: statusPalette.notStarted },
];

export const STATUS_CATEGORIES: readonly Category[] = [
  { key: "open", label: "Open", color: statusPalette.approved },
  { key: "in_progress", label: "In progress", color: statusPalette.inProgress },
  { key: "complete", label: "Complete", color: statusPalette.complete },
];

export const FOLLOW_THROUGH_CATEGORIES: readonly Category[] = [
  { key: "complete", label: "Complete", color: statusPalette.complete },
  { key: "on_schedule", label: "On schedule", color: statusPalette.approved },
  { key: "past_due", label: "Past due", color: statusPalette.pastDue },
  { key: "no_due_date", label: "No due date", color: statusPalette.notStarted },
];

// HSEEP's POETE order, as WebEOC lists the elements, with "none" last.
const ELEMENT_ORDER = ["planning", "organization", "equipment", "training", "exercises", "none"];
const ELEMENT_COLORS = [
  statusPalette.approved, statusPalette.complete, statusPalette.inProgress,
  statusPalette.pastDue, statusPalette.inApproval, statusPalette.notStarted,
];

function tally(chart: AarChart, records: readonly DashboardRecord[], today: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = chartKey(chart, record, today);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const fixed = (categories: readonly Category[], counts: Map<string, number>): ChartDatum[] =>
  categories.map((category) => ({ ...category, value: counts.get(category.key) ?? 0 }));

/** Every chart's categories and counts, from the same records the list shows. */
export function dashboardCharts(records: DashboardRecords, today: string): Readonly<Record<AarChart, ChartDatum[]>> {
  const all: readonly DashboardRecord[] = [...records.observations, ...records.actions];
  const count = (chart: AarChart) => tally(chart, chart === "capability" || chart === "element" ? all : records.actions, today);
  const capabilities = count("capability");
  // All 32 core capabilities, as WebEOC lists them, plus any recorded before the dictionary.
  const capabilityKeys = [...new Set([...CORE_CAPABILITIES.values, ...capabilities.keys()])];
  const elements = count("element");
  const elementKeys = [...new Set([...ELEMENT_ORDER, ...elements.keys()])];
  const organizations = count("organization");
  const names = new Map(records.actions.flatMap((action) =>
    action.ownerOrganization ? [[action.ownerOrganization.id, action.ownerOrganization.name] as const] : []));
  return {
    priority: fixed(PRIORITY_CATEGORIES, count("priority")),
    status: fixed(STATUS_CATEGORIES, count("status")),
    followThrough: fixed(FOLLOW_THROUGH_CATEGORIES, count("followThrough")),
    capability: capabilityKeys
      .map((key) => ({ key, label: CORE_CAPABILITY_LABELS[key] ?? key, value: capabilities.get(key) ?? 0, color: statusPalette.approved }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    element: elementKeys.map((key, index) => ({
      key, label: CAPABILITY_ELEMENT_LABELS[key] ?? key, value: elements.get(key) ?? 0,
      color: ELEMENT_COLORS[index % ELEMENT_COLORS.length]!,
    })),
    organization: [...organizations]
      .map(([key, value]) => key === "unassigned"
        ? { key, label: "No owner assigned", value, color: statusPalette.notStarted }
        : { key, label: names.get(key) ?? key, value, color: statusPalette.inApproval })
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
  };
}

/** The records a chart category holds: exactly those its count counted. */
export function filterRecords(records: DashboardRecords, chart: AarChart, key: string, today: string): DashboardRecords {
  const keep = (record: DashboardRecord) => chartKey(chart, record, today) === key;
  return { observations: records.observations.filter(keep), actions: records.actions.filter(keep) };
}

/** The local calendar day as the instants a range query sends: its start, or the start of the next day for an end. */
export function dayBoundary(date: string, end = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return undefined;
  if (end) day.setDate(day.getDate() + 1);
  return day.toISOString();
}
