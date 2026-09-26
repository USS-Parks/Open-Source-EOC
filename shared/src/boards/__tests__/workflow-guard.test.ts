import { describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "../fields.js";
import { describeCondition, guardRefusal, unmetGuardConditions } from "../view.js";
import { WorkflowGuardSchema } from "../workflow.js";

const fields = [
  { key: "amount", label: "Amount", type: "number" as const, required: false, read: "any" as const, write: "member" as const },
  { key: "priority", label: "Priority", type: "enum" as const, values: ["low", "high"], required: false, read: "any" as const, write: "member" as const },
  { key: "note", label: "Reviewer note", type: "text" as const, required: false, read: "any" as const, write: "member" as const },
];
const now = new Date("2026-09-25T12:00:00Z");

describe("workflow guards", () => {
  it("holds when every condition, or any one, holds", () => {
    const all = WorkflowGuardSchema.parse({ conditions: [{ field: "amount", op: "gt", value: 0 }, { field: "note", op: "is_not_empty" }] });
    expect(all.match).toBe("all");
    expect(unmetGuardConditions(all, { amount: 5, note: "ok" }, now)).toEqual([]);
    expect(unmetGuardConditions(all, { amount: 0, note: "" }, now).map((c) => "field" in c ? c.field : null)).toEqual(["amount", "note"]);
    const any = WorkflowGuardSchema.parse({ match: "any", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "note", op: "is_not_empty" }] });
    expect(unmetGuardConditions(any, { priority: "low", note: "seen" }, now)).toEqual([]);
    expect(unmetGuardConditions(any, { priority: "low" }, now)).toHaveLength(2);
  });

  it("says why in the fields' own words, or in the guard's", () => {
    expect(describeCondition({ field: "amount", op: "between", value: [1, 10] }, fields)).toBe("Amount is between 1 and 10");
    expect(describeCondition({ field: "priority", op: "in", value: ["high", "low"] }, fields)).toBe("Priority is one of high, low");
    expect(describeCondition({ field: "note", op: "is_not_empty" }, fields)).toBe("Reviewer note is filled in");
    const all = WorkflowGuardSchema.parse({ conditions: [{ field: "amount", op: "gt", value: 0 }, { field: "note", op: "is_not_empty" }] });
    expect(guardRefusal(all, unmetGuardConditions(all, {}, now), fields)).toBe("Amount is more than 0 and Reviewer note is filled in");
    const any = WorkflowGuardSchema.parse({ match: "any", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "note", op: "is_not_empty" }] });
    expect(guardRefusal(any, unmetGuardConditions(any, {}, now), fields)).toBe("Priority is high or Reviewer note is filled in");
    expect(guardRefusal({ ...any, message: "Add a note." }, [], fields)).toBe("Add a note.");
  });

  it("keeps a template's guards and read-only fields to its own fields", () => {
    const base = {
      key: "claims", version: 1, title: "Claims", fields, views: [{ key: "all", title: "All", columns: ["amount"] }],
      workflow: {
        initialState: "open",
        states: [{ key: "open", label: "Open" }, { key: "closed", label: "Closed", readOnlyFields: ["amount"] }],
        transitions: [{ key: "close", label: "Close", from: "open", to: "closed", allowedActors: ["writer"],
          guard: { conditions: [{ field: "amount", op: "gte", value: 1 }] } }],
      },
    };
    expect(BoardTemplateSchema.safeParse(base).success).toBe(true);
    const issues = (value: unknown) => BoardTemplateSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
    expect(issues({ ...base, workflow: { ...base.workflow, states: [base.workflow.states[0], { key: "closed", label: "Closed", readOnlyFields: ["gone"] }] } }))
      .toContain("state closed makes unknown field gone read-only");
    expect(issues({ ...base, workflow: { ...base.workflow, transitions: [{ ...base.workflow.transitions[0], guard: { conditions: [{ field: "note", op: "gt", value: 1 }] } }] } }))
      .toContain("transition close cannot apply gt to text field note");
  });
});
