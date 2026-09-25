import { z } from "zod";

/**
 * The condition language shared by board views and workflow guards: a field,
 * an operator and a value. It sits apart from the field model so the
 * workflow schema can use it without importing the field model, which
 * imports the workflow schema.
 */

/**
 * Operators of a view condition. `eq`, `neq` and `in` mean what they mean in
 * the older `filter` list; the rest are pushed down to SQL the same way.
 */
export const VIEW_CONDITION_OPS = [
  "eq", "neq", "in", "not_in", "contains", "starts_with",
  "gt", "gte", "lt", "lte", "between", "before", "after", "is_empty", "is_not_empty",
] as const;

/** A relative time: now, or now plus or minus whole minutes, hours or days. */
export const RELATIVE_TIME = /^now(?:[+-]\d{1,6}[mhd])?$/;

const isoWithOffset = z.iso.datetime({ offset: true });

/** Whether a condition value names a time: an ISO timestamp with offset or a relative time. */
export function isTimeValue(value: unknown): value is string {
  return typeof value === "string" && (RELATIVE_TIME.test(value) || isoWithOffset.safeParse(value).success);
}

function conditionValueFits(op: (typeof VIEW_CONDITION_OPS)[number], value: unknown): boolean {
  switch (op) {
    case "eq": case "neq": return value !== undefined && !Array.isArray(value);
    case "in": case "not_in": return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "contains": case "starts_with": return typeof value === "string" && value.length > 0;
    case "gt": case "gte": case "lt": case "lte": return typeof value === "number";
    case "before": case "after": return isTimeValue(value);
    case "between":
      return Array.isArray(value) && value.length === 2 && (
        (typeof value[0] === "number" && typeof value[1] === "number" && value[0] <= value[1])
        || (isTimeValue(value[0]) && isTimeValue(value[1])));
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
