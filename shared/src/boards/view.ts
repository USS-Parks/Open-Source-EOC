import {
  RELATIVE_TIME,
  isCalendarDate,
  isConditionGroup,
  type ConditionGroup,
  type ConditionItem,
} from "./conditions.js";
import type { FieldDef, ViewCondition, ViewDef, ViewSort } from "./fields.js";

export type ViewRecord = Record<string, unknown> & { id: string };

export interface ApplyViewOptions {
  /** Field types, so numbers and datetimes order as values rather than text. */
  readonly fields?: readonly FieldDef[];
  /** The instant relative times such as `now-7d` and `today` resolve against. */
  readonly now?: Date;
}

/**
 * Apply a display view's filters and sort. One implementation serves the
 * server and the browser so a view can never mean two different things.
 */
export function applyView(
  view: ViewDef,
  records: readonly ViewRecord[],
  options: ApplyViewOptions = {},
): ViewRecord[] {
  const now = options.now ?? new Date();
  const conditions = viewConditionSet(view);
  const out = records.filter((rec) => setHolds(conditions, rec, now));
  const order = viewOrder(view);
  if (order.length === 0) return out;
  const types = new Map((options.fields ?? []).map((field) => [field.key, field.type]));
  // Array sort is stable, so rows tied on every key keep their input order.
  return out.sort((a, b) => {
    for (const { field, dir } of order) {
      const c = compareValues(a[field], b[field], types.get(field));
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return 0;
  });
}

/**
 * A view's conditions as one set: every rule of the older `filter` list, and
 * `where`, which holds by the view's `match` (all when absent). Days count
 * in the view's time zone.
 */
export function viewConditionSet(view: Pick<ViewDef, "filter" | "where" | "match" | "timeZone">): ConditionGroup {
  const where = view.where ?? [];
  return {
    match: "all",
    timeZone: view.timeZone,
    conditions: [...view.filter, ...(view.match === "any" && where.length ? [{ match: "any" as const, conditions: where }] : where)],
  };
}

/**
 * A view with more conditions that must hold as well, such as an operator's
 * refinement. The view's own conditions become one group that keeps their
 * match and time zone.
 */
export function withConditions(view: ViewDef, extra: readonly ConditionItem[]): ViewDef {
  if (extra.length === 0) return view;
  const { where, match, timeZone, ...rest } = view;
  const own: ConditionItem[] = where?.length
    ? [{ match: match ?? "all", conditions: where, ...(timeZone ? { timeZone } : {}) }] : [];
  return { ...rest, where: [...own, ...extra] };
}

/** The effective sort keys of a view: the group field first, then `sorts` or `sort`. */
export function viewOrder(view: Pick<ViewDef, "sort" | "sorts" | "groupBy">): ViewSort[] {
  const sorts = view.sorts ?? (view.sort ? [view.sort] : []);
  if (!view.groupBy) return sorts;
  const dir = sorts.find((sort) => sort.field === view.groupBy)?.dir ?? "asc";
  return [{ field: view.groupBy, dir }, ...sorts.filter((sort) => sort.field !== view.groupBy)];
}

/**
 * Order two stored values of one field. Numbers compare numerically and
 * datetimes by instant, with an absent value first; anything else compares
 * as text, as the server's SQL order does.
 */
export function compareValues(a: unknown, b: unknown, type?: FieldDef["type"]): number {
  if (type === "number" || (type === undefined && typeof a === "number" && typeof b === "number")) {
    return order(numberKey(a), numberKey(b));
  }
  if (type === "datetime") return order(timeOf(a) ?? -Infinity, timeOf(b) ?? -Infinity);
  return String(a ?? "").localeCompare(String(b ?? ""));
}

const order = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
const numberKey = (v: unknown) => (typeof v === "number" ? v : -Infinity);
const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

function timeOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const UNIT_MS = { m: MINUTE_MS, h: 3_600_000, d: DAY_MS } as const;

/** Milliseconds for an ISO timestamp or a relative time such as `now-7d`, else null. */
export function resolveTime(value: unknown, now: Date): number | null {
  if (typeof value !== "string") return null;
  if (RELATIVE_TIME.test(value)) {
    const offset = /^now([+-])(\d+)([mhd])$/.exec(value);
    if (!offset) return now.getTime();
    const ms = Number(offset[2]) * UNIT_MS[offset[3] as keyof typeof UNIT_MS];
    return now.getTime() + (offset[1] === "+" ? ms : -ms);
  }
  return timeOf(value);
}

const clocks = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock reading of an instant in a time zone, as milliseconds of a UTC date with the same reading. */
function wallClock(at: number, timeZone: string): number {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    clocks.set(timeZone, clock);
  }
  const parts = clock.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/** The calendar day an instant falls on in a time zone, as YYYY-MM-DD. */
export function zonedDay(at: number, timeZone: string): string {
  return new Date(wallClock(at, timeZone)).toISOString().slice(0, 10);
}

/** A calendar day moved by whole days. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The first instant of a calendar day in a time zone. Where a clock change
 * skips midnight the day starts when the clock resumes, and where it repeats
 * midnight, at the first one.
 */
export function startOfDay(day: string, timeZone: string): number {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const offset = (at: number) => wallClock(at, timeZone) - Math.floor(at / 1000) * 1000;
  let at = wall - offset(wall - offset(wall));
  while (zonedDay(at, timeZone) < day) at += MINUTE_MS;
  while (zonedDay(at - MINUTE_MS, timeZone) >= day) at -= MINUTE_MS;
  return at;
}

/** The day a day value names, as YYYY-MM-DD: a date as written, or today moved by whole days in the time zone. */
function dayOf(value: string, now: Date, timeZone: string): string | null {
  if (isCalendarDate(value)) return value;
  const relative = /^today(?:([+-])(\d{1,4})d)?$/.exec(value);
  if (!relative) return null;
  const days = relative[2] ? Number(relative[2]) * (relative[1] === "-" ? -1 : 1) : 0;
  return addDays(zonedDay(now.getTime(), timeZone), days);
}

/**
 * The instants a time or day value covers, from (inclusive) to until
 * (exclusive): one millisecond for an instant, the whole day in the time
 * zone for a day.
 */
function resolveSpan(value: unknown, now: Date, timeZone: string): readonly [number, number] | null {
  if (typeof value !== "string") return null;
  const day = dayOf(value, now, timeZone);
  if (day) return [startOfDay(day, timeZone), startOfDay(addDays(day, 1), timeZone)];
  const ms = resolveTime(value, now);
  return ms === null ? null : [ms, ms + 1];
}

/**
 * The instants a time condition admits, from (inclusive) to until
 * (exclusive), either end open; null when its value names no time. Before a
 * day means before it starts and after a day, after it ends. Within the last
 * or next N days is a rolling window of N times 24 hours from now. The
 * server's SQL reads the same bounds.
 */
export function timeBounds(condition: ViewCondition, now: Date, timeZone: string): { from?: number; until?: number } | null {
  const value = condition.value;
  const span = (bound: unknown) => resolveSpan(bound, now, timeZone);
  switch (condition.op) {
    case "before": { const s = span(value); return s && { until: s[0] }; }
    case "after": { const s = span(value); return s && { from: s[1] }; }
    case "on": { const s = span(value); return s && { from: s[0], until: s[1] }; }
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return null;
      const [lo, hi] = [span(value[0]), span(value[1])];
      return lo && hi && { from: lo[0], until: hi[1] };
    }
    case "within_last":
      return typeof value === "number" ? { from: now.getTime() - value * DAY_MS, until: now.getTime() + 1 } : null;
    case "within_next":
      return typeof value === "number" ? { from: now.getTime(), until: now.getTime() + value * DAY_MS + 1 } : null;
    default: return null;
  }
}

/**
 * Whether one stored value satisfies one condition. An unreadable value is
 * absent. Days count in the time zone given, UTC when none is.
 */
export function conditionHolds(condition: ViewCondition, v: unknown, now: Date, timeZone = "UTC"): boolean {
  const value = condition.value;
  switch (condition.op) {
    case "eq": return v === value;
    case "neq": return v !== value;
    case "in": return Array.isArray(value) && (value as unknown[]).includes(String(v));
    case "not_in": return Array.isArray(value) && !(value as unknown[]).includes(String(v));
    case "contains":
      return isScalar(v) && String(v).toLowerCase().includes(String(value).toLowerCase());
    case "starts_with":
      return isScalar(v) && String(v).toLowerCase().startsWith(String(value).toLowerCase());
    case "eq_ignore_case":
      return isScalar(v) && String(v).toLowerCase() === String(value).toLowerCase();
    case "gt": return typeof v === "number" && typeof value === "number" && v > value;
    case "gte": return typeof v === "number" && typeof value === "number" && v >= value;
    case "lt": return typeof v === "number" && typeof value === "number" && v < value;
    case "lte": return typeof v === "number" && typeof value === "number" && v <= value;
    case "between": {
      if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number")
        return typeof v === "number" && v >= value[0] && v <= value[1];
      return withinBounds(v, condition, now, timeZone);
    }
    case "before": case "after": case "on": case "within_last": case "within_next":
      return withinBounds(v, condition, now, timeZone);
    case "is_empty": return isEmpty(v);
    case "is_not_empty": return !isEmpty(v);
  }
}

// A day takes several time zone readings to place; each condition's bounds are read once per clock and zone.
const boundsRead = new WeakMap<ViewCondition, { at: number; zone: string; bounds: ReturnType<typeof timeBounds> }>();

function withinBounds(v: unknown, condition: ViewCondition, now: Date, timeZone: string): boolean {
  const t = timeOf(v);
  let read = boundsRead.get(condition);
  if (!read || read.at !== now.getTime() || read.zone !== timeZone) {
    read = { at: now.getTime(), zone: timeZone, bounds: timeBounds(condition, now, timeZone) };
    boundsRead.set(condition, read);
  }
  const bounds = read.bounds;
  if (t === null || bounds === null) return false;
  return (bounds.from === undefined || t >= bounds.from) && (bounds.until === undefined || t < bounds.until);
}

/**
 * Whether a record meets a condition set: all or any of its entries, a group
 * by its own match. Days count in the set's time zone, else the one given,
 * else UTC.
 */
export function setHolds(set: ConditionGroup, record: Readonly<Record<string, unknown>>, now: Date, timeZone = "UTC"): boolean {
  const zone = set.timeZone ?? timeZone;
  const holds = (item: ConditionItem) => itemHolds(item, record, now, zone);
  return set.match === "any" ? set.conditions.some(holds) : set.conditions.every(holds);
}

function itemHolds(item: ConditionItem, record: Readonly<Record<string, unknown>>, now: Date, timeZone: string): boolean {
  return isConditionGroup(item) ? setHolds(item, record, now, timeZone) : conditionHolds(item, record[item.field], now, timeZone);
}

/** A workflow guard or an action's conditions, as far as evaluating and describing them goes. */
export type GuardLike = ConditionGroup & { readonly message?: string | undefined };

/** The guard's entries a record does not meet; empty when the guard holds. */
export function unmetGuardConditions(guard: GuardLike, record: Readonly<Record<string, unknown>>, now: Date): ConditionItem[] {
  const zone = guard.timeZone ?? "UTC";
  const unmet = guard.conditions.filter((item) => !itemHolds(item, record, now, zone));
  if (guard.match === "any" && unmet.length < guard.conditions.length) return [];
  return unmet;
}

const OP_WORDS: Readonly<Record<ViewCondition["op"], string>> = {
  eq: "is", neq: "is not", in: "is one of", not_in: "is not one of", contains: "contains", starts_with: "starts with",
  eq_ignore_case: "is, ignoring case,", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most",
  between: "is between", before: "is before", after: "is after", on: "falls on", within_last: "is within the last",
  within_next: "is within the next", is_empty: "is empty", is_not_empty: "is filled in",
};

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** A condition value in words: "today plus 3 days" for `today+3d`; other values as written. */
function describeValue(value: unknown): string {
  const relative = typeof value === "string" ? /^today(?:([+-])(\d{1,4})d)?$/.exec(value) : null;
  if (!relative) return String(value);
  return relative[2] ? `today ${relative[1] === "+" ? "plus" : "minus"} ${days(Number(relative[2]))}` : "today";
}

/** A condition in words, by the field's label: "Priority is one of high, critical". A group is its conditions joined by "and" or "or". */
export function describeCondition(item: ConditionItem, fields: readonly FieldDef[] = []): string {
  if (isConditionGroup(item)) {
    const text = item.conditions.map((entry) => describeCondition(entry, fields)).join(item.match === "any" ? " or " : " and ");
    return item.conditions.length > 1 ? `(${text})` : text;
  }
  const label = fields.find((field) => field.key === item.field)?.label ?? item.field;
  const value = item.value;
  const shown = Array.isArray(value)
    ? item.op === "between" ? `${describeValue(value[0])} and ${describeValue(value[1])}` : value.map(String).join(", ")
    : value === undefined ? ""
    : (item.op === "within_last" || item.op === "within_next") && typeof value === "number" ? days(value)
    : describeValue(value);
  return `${label} ${OP_WORDS[item.op]}${shown ? ` ${shown}` : ""}`;
}

/** Why a guard refuses: its own message, or the entries not met, joined by "and" or "or" as the guard matches. */
export function guardRefusal(guard: GuardLike, unmet: readonly ConditionItem[], fields: readonly FieldDef[] = []): string {
  if (guard.message) return guard.message;
  return unmet.map((item) => describeCondition(item, fields)).join(guard.match === "any" ? " or " : " and ");
}

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}
