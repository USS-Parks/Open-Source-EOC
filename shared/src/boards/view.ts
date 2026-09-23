import { RELATIVE_TIME, type FieldDef, type ViewCondition, type ViewDef, type ViewSort } from "./fields.js";

export type ViewRecord = Record<string, unknown> & { id: string };

export interface ApplyViewOptions {
  /** Field types, so numbers and datetimes order as values rather than text. */
  readonly fields?: readonly FieldDef[];
  /** The instant relative times such as `now-7d` resolve against. */
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
  const conditions: readonly ViewCondition[] = [...view.filter, ...(view.where ?? [])];
  const out = records.filter((rec) => conditions.every((c) => conditionHolds(c, rec[c.field], now)));
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

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

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

/** Whether one stored value satisfies one condition. An unreadable value is absent. */
export function conditionHolds(condition: ViewCondition, v: unknown, now: Date): boolean {
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
    case "gt": return typeof v === "number" && typeof value === "number" && v > value;
    case "gte": return typeof v === "number" && typeof value === "number" && v >= value;
    case "lt": return typeof v === "number" && typeof value === "number" && v < value;
    case "lte": return typeof v === "number" && typeof value === "number" && v <= value;
    case "before": case "after": {
      const t = timeOf(v);
      const bound = resolveTime(value, now);
      if (t === null || bound === null) return false;
      return condition.op === "before" ? t < bound : t > bound;
    }
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const [lo, hi] = value;
      if (typeof lo === "number" && typeof hi === "number")
        return typeof v === "number" && v >= lo && v <= hi;
      const t = timeOf(v);
      const from = resolveTime(lo, now);
      const to = resolveTime(hi, now);
      return t !== null && from !== null && to !== null && t >= from && t <= to;
    }
    case "is_empty": return isEmpty(v);
    case "is_not_empty": return !isEmpty(v);
  }
}

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}
