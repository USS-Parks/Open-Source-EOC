import { z } from "zod";

/**
 * The condition language shared by board views, workflow guards and board
 * actions: a field, an operator and a value, gathered into a set that holds
 * when all or any of its conditions do, with at most one level of groups
 * (VC-18). It is a fixed set of operators, not an expression language
 * (ADR-0004). It sits apart from the field model so the workflow schema can
 * use it without importing the field model, which imports the workflow
 * schema.
 */

/**
 * Operators of a view condition. `eq`, `neq` and `in` mean what they mean in
 * the older `filter` list; the rest are pushed down to SQL the same way.
 */
export const VIEW_CONDITION_OPS = [
  "eq", "neq", "in", "not_in", "contains", "starts_with", "eq_ignore_case",
  "gt", "gte", "lt", "lte", "between", "before", "after", "on", "within_last", "within_next",
  "is_empty", "is_not_empty",
] as const;

/** A relative time: now, or now plus or minus whole minutes, hours or days. */
export const RELATIVE_TIME = /^now(?:[+-]\d{1,6}[mhd])?$/;

/** A relative day: today, or today plus or minus whole days, counted in the conditions' time zone. */
export const RELATIVE_DAY = /^today(?:[+-]\d{1,4}d)?$/;

/** The most days a `within_last` or `within_next` condition reaches: ten years. */
export const MAX_WITHIN_DAYS = 3650;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoWithOffset = z.iso.datetime({ offset: true });

/** Whether a condition value names a time: an ISO timestamp with offset or a relative time. */
export function isTimeValue(value: unknown): value is string {
  return typeof value === "string" && (RELATIVE_TIME.test(value) || isoWithOffset.safeParse(value).success);
}

/** Whether a string is a calendar date that exists, such as 2026-09-30; 2026-02-30 is not one. */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

/** Whether a condition value names a calendar day: today, today plus or minus days, or a date. */
export function isDayValue(value: unknown): value is string {
  return typeof value === "string" && (RELATIVE_DAY.test(value) || isCalendarDate(value));
}

/**
 * Whether a name is a time zone the platform knows, by its IANA name. An
 * offset such as `+05:30` is refused: days are counted by a zone's own rules.
 */
export function isTimeZoneName(name: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z.string().max(64).refine(isTimeZoneName, "not a time zone name");

const isWhen = (value: unknown) => isTimeValue(value) || isDayValue(value);

function conditionValueFits(op: (typeof VIEW_CONDITION_OPS)[number], value: unknown): boolean {
  switch (op) {
    case "eq": case "neq": return value !== undefined && !Array.isArray(value);
    case "in": case "not_in": return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "contains": case "starts_with": case "eq_ignore_case": return typeof value === "string" && value.length > 0;
    case "gt": case "gte": case "lt": case "lte": return typeof value === "number";
    case "before": case "after": return isWhen(value);
    case "on": return isDayValue(value);
    case "within_last": case "within_next":
      return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_WITHIN_DAYS;
    case "between":
      return Array.isArray(value) && value.length === 2 && (
        (typeof value[0] === "number" && typeof value[1] === "number" && value[0] <= value[1])
        || (isWhen(value[0]) && isWhen(value[1])));
    case "is_empty": case "is_not_empty": return value === undefined;
  }
}

export const ViewConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(VIEW_CONDITION_OPS),
  value: z.union([
    z.string().max(400), z.number().finite(), z.boolean(),
    z.array(z.union([z.string().max(400), z.number().finite()])).max(100),
  ]).optional(),
}).strict().superRefine((condition, ctx) => {
  if (!conditionValueFits(condition.op, condition.value))
    ctx.addIssue({ code: "custom", message: `condition ${condition.op} on ${condition.field} has an unusable value` });
});

export type ViewCondition = z.infer<typeof ViewConditionSchema>;

export const CONDITION_MATCHES = ["all", "any"] as const;
export type ConditionMatch = (typeof CONDITION_MATCHES)[number];

/**
 * Conditions that hold together when all or any of them do. A group without
 * a time zone counts days in the zone of the set it belongs to.
 */
export type ConditionGroup = {
  readonly match: ConditionMatch;
  readonly conditions: readonly ConditionItem[];
  readonly timeZone?: string | undefined;
};

/** One entry of a condition set: a condition, or a group of conditions. */
export type ConditionItem = ViewCondition | ConditionGroup;

/**
 * A group as a template stores it: conditions only, so a stored set nests one
 * level. Sets the server composes (a view under an operator's refinement)
 * may nest deeper, and evaluate the same way.
 */
export const ConditionGroupSchema = z.object({
  match: z.enum(CONDITION_MATCHES).default("all"),
  conditions: z.array(ViewConditionSchema).min(1).max(16),
  timeZone: TimeZoneSchema.optional(),
}).strict();

export const ConditionItemSchema: z.ZodType<ConditionItem> = z.union([ViewConditionSchema, ConditionGroupSchema]);

/** Whether a condition set entry is a group. */
export function isConditionGroup(item: ConditionItem): item is ConditionGroup {
  return "conditions" in item;
}

/** Every condition of a set, groups opened, in order. */
export function leafConditions(items: readonly ConditionItem[]): ViewCondition[] {
  return items.flatMap((item) => isConditionGroup(item) ? leafConditions(item.conditions) : [item]);
}

/** Whether any condition of a set counts calendar days, and so depends on a time zone. */
export function countsDays(items: readonly ConditionItem[]): boolean {
  return leafConditions(items).some((condition) =>
    Array.isArray(condition.value) ? condition.value.some(isDayValue) : isDayValue(condition.value));
}
