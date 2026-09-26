import { choiceLabel, type FieldDef, type IncidentAreaRevision, type ViewRecord } from "@openeoc/shared";
import type { BoardRecordChange } from "../../app/api/client.js";
import { statusPalette, type ChartDatum } from "../../design/charts/index.js";
import { shelterColor } from "./palettes.js";

/**
 * The shelter dashboard's counts, from the Shelters board's records. A
 * shelter is operating when it is neither closed nor planned, the rule the
 * incident overview's active shelter count uses; occupancy and capacity add
 * up over operating shelters. Occupancy history replays each record's change
 * history to the end of every operational period. Status colors are the
 * shared shelter status table's, read through its aliases (normal is open,
 * compromised is alert, evacuating is closed).
 */

export type ShelterState = "normal" | "compromised" | "evacuating" | "closed" | "planned" | "unknown";

export interface Shelter {
  readonly id: string;
  readonly name: string;
  readonly state: ShelterState;
  readonly capacity: number;
  readonly occupancy: number;
  /** Yes and no fields other than "planned", as recorded; null when left blank. */
  readonly features: Readonly<Record<string, boolean | null>>;
  readonly createdAt: string | null;
}

export const STATE_CATEGORIES: readonly { readonly key: ShelterState; readonly label: string; readonly color: string }[] = ([
  ["normal", "Open"], ["compromised", "Compromised"], ["evacuating", "Evacuating"],
  ["closed", "Closed"], ["planned", "Planned"], ["unknown", "No status"],
] as const).map(([key, label]) => ({ key, label, color: shelterColor(key)! }));

const count = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

function stateOf(values: Readonly<Record<string, unknown>>): ShelterState {
  if (values["planned"] === true) return "planned";
  const status = values["status"];
  return STATE_CATEGORIES.some((item) => item.key === status) ? status as ShelterState : "unknown";
}

/** The board's yes and no fields a shelter can be counted by, "planned" aside. */
export function featureFields(fields: readonly FieldDef[]): FieldDef[] {
  return fields.filter((field) => field.type === "boolean" && field.key !== "planned");
}

export function shelterOf(record: ViewRecord, features: readonly FieldDef[]): Shelter {
  return {
    id: record.id,
    name: typeof record["name"] === "string" && record["name"] ? record["name"] : "Unnamed shelter",
    state: stateOf(record),
    capacity: count(record["capacity"]),
    occupancy: count(record["occupancy"]),
    features: Object.fromEntries(features.map((field) => {
      const value = record[field.key];
      return [field.key, typeof value === "boolean" ? value : null];
    })),
    createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : null,
  };
}

export const operating = (shelter: { readonly state: ShelterState }) => shelter.state !== "closed" && shelter.state !== "planned";

export function stateTiles(shelters: readonly Shelter[]): ChartDatum[] {
  return STATE_CATEGORIES
    .map((category) => ({ ...category, value: shelters.filter((shelter) => shelter.state === category.key).length }))
    .filter((tile) => tile.key !== "unknown" || tile.value > 0);
}

/** Occupants, beds and open spaces over operating shelters. */
export function occupancyTotals(shelters: readonly Shelter[]): { occupancy: number; capacity: number; open: number } {
  const active = shelters.filter(operating);
  const occupancy = active.reduce((sum, shelter) => sum + shelter.occupancy, 0);
  const capacity = active.reduce((sum, shelter) => sum + shelter.capacity, 0);
  return { occupancy, capacity, open: Math.max(0, capacity - occupancy) };
}

export type FeatureAnswer = "yes" | "no" | "blank";

export function featureAnswer(shelter: Shelter, field: string): FeatureAnswer {
  const value = shelter.features[field];
  return value === true ? "yes" : value === false ? "no" : "blank";
}

/** Operating shelters by their answer to one yes and no field. */
export function featureChart(shelters: readonly Shelter[], field: string): ChartDatum[] {
  const active = shelters.filter(operating);
  const tally = (answer: FeatureAnswer) => active.filter((shelter) => featureAnswer(shelter, field) === answer).length;
  return [
    { key: "yes", label: "Yes", value: tally("yes"), color: statusPalette.complete },
    { key: "no", label: "No", value: tally("no"), color: statusPalette.notStarted },
    { key: "blank", label: "Not recorded", value: tally("blank"), color: statusPalette.inApproval },
  ];
}

/** Whether the board records accessibility at all: a yes and no field that names it. */
export function recordsAccessibility(fields: readonly FieldDef[]): boolean {
  return featureFields(fields).some((field) => /access/i.test(`${field.key} ${field.label}`));
}

export interface PeriodOccupancy {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * The record's values as they stood at `at`, replayed from its change
 * history; null when it did not exist yet. With no history to read the
 * record's current values stand from its creation.
 */
export function valuesAt(
  history: readonly BoardRecordChange[] | null,
  current: ViewRecord,
  at: number,
): Readonly<Record<string, unknown>> | null {
  if (!history || history.length === 0) {
    const created = typeof current["createdAt"] === "string" ? Date.parse(current["createdAt"]) : Number.NaN;
    return Number.isNaN(created) || created <= at ? current : null;
  }
  const values: Record<string, unknown> = {};
  let seen = false;
  for (const entry of [...history].sort((a, b) => a.seq - b.seq)) {
    if (Date.parse(entry.at) > at) break;
    seen = true;
    for (const change of entry.changes) values[change.field] = change.after;
  }
  return seen ? values : null;
}

/**
 * Total occupancy of operating shelters at the end of each operational
 * period that has begun (at now for the current one), then now when every
 * period has ended.
 */
export function occupancyHistory(
  revisions: readonly IncidentAreaRevision[],
  records: readonly { readonly record: ViewRecord; readonly history: readonly BoardRecordChange[] | null }[],
  now: number,
): PeriodOccupancy[] {
  const periods = new Map<string, { label: string; startsAt: number; endsAt: number }>();
  for (const revision of revisions) {
    const period = revision.operationalPeriod;
    if (!period) continue;
    periods.set(`${period.label}|${period.startsAt}`, { label: period.label, startsAt: Date.parse(period.startsAt), endsAt: Date.parse(period.endsAt) });
  }
  const begun = [...periods.values()].filter((period) => period.startsAt <= now).sort((a, b) => a.startsAt - b.startsAt);
  const total = (at: number) => records.reduce((sum, { record, history }) => {
    const values = valuesAt(history, record, at);
    return values && operating({ state: stateOf(values) }) ? sum + count(values["occupancy"]) : sum;
  }, 0);
  const points = begun.map((period, index) => ({
    key: `period-${index}`,
    label: period.endsAt > now ? `${period.label} (now)` : period.label,
    value: total(Math.min(period.endsAt, now)),
  }));
  const last = begun.at(-1);
  if (last && last.endsAt <= now) points.push({ key: "now", label: "Now", value: total(now) });
  return points;
}

export const stateLabel = (state: ShelterState) => STATE_CATEGORIES.find((item) => item.key === state)?.label ?? choiceLabel(state);
