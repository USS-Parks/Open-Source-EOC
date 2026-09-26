import { describe, expect, it } from "vitest";
import {
  applyView,
  BoardTemplateSchema,
  ConditionItemSchema,
  countsDays,
  describeCondition,
  guardRefusal,
  setHolds,
  startOfDay,
  unmetGuardConditions,
  ViewConditionSchema,
  ViewDefSchema,
  withConditions,
  WorkflowGuardSchema,
  type ConditionGroup,
  type FieldDef,
  type ViewDef,
} from "../../index.js";

/**
 * All-or-any condition sets, one level of groups, and the day and text
 * operators (VC-18). Every "today" here reads the injected clock.
 */

const fields = [
  { key: "name", label: "Name", type: "text" },
  { key: "priority", label: "Priority", type: "enum", values: ["low", "high"] },
  { key: "amount", label: "Amount", type: "number" },
  { key: "due", label: "Due", type: "datetime" },
] as FieldDef[];

// 06:30 UTC on 25 September is 23:30 on the 24th in Los Angeles.
const now = new Date("2026-09-25T06:30:00Z");
const LA = "America/Los_Angeles";
const records = [
  { id: "a", name: "Alpha", priority: "high", amount: 5, due: "2026-09-24T23:00:00Z" }, // LA 24th 16:00, UTC 24th
  { id: "b", name: "beta", priority: "low", amount: 0, due: "2026-09-25T06:00:00Z" }, // LA 24th 23:00, UTC 25th
  { id: "c", name: "ALPHA", priority: "low", amount: 9, due: "2026-09-25T07:00:00Z" }, // LA 25th 00:00, UTC 25th
  { id: "d", name: "", priority: "high", amount: 2, due: "2026-09-21T12:00:00Z" },
  { id: "e", name: "Gamma", priority: "low", amount: 1 },
];

const view = (extra: Partial<ViewDef>): ViewDef =>
  ({ key: "v", title: "V", kind: "list", columns: ["name"], filter: [], ...extra }) as ViewDef;
const ids = (v: ViewDef) => applyView(v, records, { fields, now }).map((r) => r.id);
const one = (condition: object, timeZone?: string) =>
  ids(view({ where: [ViewConditionSchema.parse(condition)], ...(timeZone ? { timeZone } : {}) }));

describe("day and text operators", () => {
  it("compares a date to today, in the conditions' time zone", () => {
    expect(one({ field: "due", op: "on", value: "today" }, LA)).toEqual(["a", "b"]);
    expect(one({ field: "due", op: "on", value: "today" })).toEqual(["b", "c"]);
    expect(one({ field: "due", op: "on", value: "today+1d" }, LA)).toEqual(["c"]);
    expect(one({ field: "due", op: "before", value: "today" }, LA)).toEqual(["d"]);
    expect(one({ field: "due", op: "after", value: "today" }, LA)).toEqual(["c"]);
    expect(one({ field: "due", op: "after", value: "today-1d" }, LA)).toEqual(["a", "b", "c"]);
    expect(one({ field: "due", op: "before", value: "today-2d" }, LA)).toEqual(["d"]);
    expect(one({ field: "due", op: "between", value: ["today-3d", "today"] }, LA)).toEqual(["a", "b", "d"]);
    expect(one({ field: "due", op: "on", value: "2026-09-21" }, LA)).toEqual(["d"]);
    expect(one({ field: "due", op: "between", value: ["2026-09-24", "now"] }, LA)).toEqual(["a", "b"]);
  });

  it("reads within the last or next N days as a rolling window from now", () => {
    expect(one({ field: "due", op: "within_last", value: 1 })).toEqual(["a", "b"]);
    expect(one({ field: "due", op: "within_last", value: 4 })).toEqual(["a", "b", "d"]);
    expect(one({ field: "due", op: "within_next", value: 1 })).toEqual(["c"]);
  });

  it("compares text ignoring case, and still has contains, starts with and empty", () => {
    expect(one({ field: "name", op: "eq_ignore_case", value: "alpha" })).toEqual(["a", "c"]);
    expect(one({ field: "name", op: "contains", value: "ALP" })).toEqual(["a", "c"]);
    expect(one({ field: "name", op: "starts_with", value: "g" })).toEqual(["e"]);
    expect(one({ field: "name", op: "is_empty" })).toEqual(["d"]);
    expect(one({ field: "name", op: "is_not_empty" })).toEqual(["a", "b", "c", "e"]);
  });

  it("starts a day at its first instant across clock changes", () => {
    expect(new Date(startOfDay("2026-09-25", LA)).toISOString()).toBe("2026-09-25T07:00:00.000Z");
    expect(new Date(startOfDay("2026-03-08", LA)).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(new Date(startOfDay("2026-03-09", LA)).toISOString()).toBe("2026-03-09T07:00:00.000Z");
    // Chile skips midnight on 6 September 2026: the day starts at 01:00, 04:00 UTC.
    expect(new Date(startOfDay("2026-09-06", "America/Santiago")).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(new Date(startOfDay("2026-09-25", "Asia/Kolkata")).toISOString()).toBe("2026-09-24T18:30:00.000Z");
    // A 23-hour day: 23:30 on 8 March in Los Angeles is on the 8th.
    const short = view({ where: [{ field: "due", op: "on", value: "2026-03-08" }], timeZone: LA });
    expect(applyView(short, [{ id: "x", due: "2026-03-09T06:30:00Z" }, { id: "y", due: "2026-03-09T07:00:00Z" }], { now })
      .map((r) => r.id)).toEqual(["x"]);
  });

  it("refuses values an operator cannot use, dates that do not exist and zones that are offsets", () => {
    for (const bad of [
      { field: "due", op: "on", value: "now" },
      { field: "due", op: "on", value: "2026-02-30" },
      { field: "due", op: "before", value: "2026-13-01" },
      { field: "due", op: "after", value: "tomorrow" },
      { field: "due", op: "within_last", value: 0 },
      { field: "due", op: "within_last", value: 1.5 },
      { field: "due", op: "within_next", value: 3651 },
      { field: "due", op: "within_next", value: "7" },
      { field: "name", op: "eq_ignore_case", value: "" },
    ]) expect(ViewConditionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(ViewConditionSchema.safeParse({ field: "due", op: "on", value: "2028-02-29" }).success).toBe(true);
    const zoned = (timeZone: string) => ViewDefSchema.safeParse({ key: "v", title: "V", columns: ["name"], timeZone }).success;
    expect(zoned("America/Los_Angeles")).toBe(true);
    expect(zoned("UTC")).toBe(true);
    expect(zoned("+05:30")).toBe(false);
    expect(zoned("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("all or any, with groups", () => {
  it("keeps a plain list all-of, and holds any-of when one condition does", () => {
    const where = [{ field: "priority", op: "eq", value: "high" }, { field: "amount", op: "gte", value: 5 }] as ViewDef["where"];
    expect(ids(view({ where }))).toEqual(["a"]);
    expect(ids(view({ where, match: "any" }))).toEqual(["a", "c", "d"]);
    // The older filter list still holds with an any-of where.
    expect(ids(view({ where, match: "any", filter: [{ field: "name", op: "neq", value: "" }] }))).toEqual(["a", "c"]);
  });

  it("holds a group by its own match, one level down", () => {
    const set: ConditionGroup = {
      match: "any", timeZone: LA,
      conditions: [
        { field: "due", op: "on", value: "today" },
        { match: "all", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "amount", op: "lt", value: 3 }] },
      ],
    };
    expect(records.filter((record) => setHolds(set, record, now)).map((r) => r.id)).toEqual(["a", "b", "d"]);
    expect(ids(view({ where: [...set.conditions], match: "any", timeZone: LA }))).toEqual(["a", "b", "d"]);
    // A group's own zone wins over its set's.
    const utc: ConditionGroup = { match: "all", timeZone: LA, conditions: [{ match: "any", timeZone: "UTC", conditions: [{ field: "due", op: "on", value: "today" }] }] };
    expect(records.filter((record) => setHolds(utc, record, now)).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("adds a refinement to a view without changing what the view's own conditions mean", () => {
    const own = view({ where: [{ field: "priority", op: "eq", value: "high" }, { field: "due", op: "on", value: "today" }], match: "any", timeZone: LA });
    expect(ids(own)).toEqual(["a", "b", "d"]);
    const refined = withConditions(own, [{ match: "any", conditions: [{ field: "amount", op: "gte", value: 5 }, { field: "name", op: "is_empty" }] }]);
    expect(refined.match).toBeUndefined();
    expect(ids(refined)).toEqual(["a", "d"]);
    expect(withConditions(own, [])).toBe(own);
  });

  it("stores one level of groups and refuses deeper ones, unknown fields and unfitting operators inside them", () => {
    const group = { match: "any", conditions: [{ field: "due", op: "within_next", value: 2 }] };
    expect(ConditionItemSchema.safeParse(group).success).toBe(true);
    expect(ConditionItemSchema.safeParse({ match: "any", conditions: [group] }).success).toBe(false);
    expect(ConditionItemSchema.safeParse({ match: "any", conditions: [] }).success).toBe(false);
    expect(countsDays([group as ConditionGroup])).toBe(false);
    expect(countsDays([{ match: "all", conditions: [{ field: "due", op: "before", value: "today+2d" }] }])).toBe(true);
    const base = { key: "t", version: 1, title: "T", fields, views: [{ key: "all", title: "All", columns: ["name"] }] };
    const template = (where: unknown[]) => BoardTemplateSchema.safeParse({ ...base, views: [{ key: "all", title: "All", columns: ["name"], match: "any", where }] });
    expect(template([group, { field: "name", op: "eq_ignore_case", value: "x" }]).success).toBe(true);
    expect(template([{ match: "all", conditions: [{ field: "missing", op: "is_empty" }] }]).error?.issues[0]?.message)
      .toBe("view all filters unknown field missing");
    expect(template([{ match: "all", conditions: [{ field: "amount", op: "on", value: "today" }] }]).error?.issues[0]?.message)
      .toBe("view all cannot apply on to number field amount");
    const guarded = BoardTemplateSchema.safeParse({ ...base, workflow: {
      initialState: "open", states: [{ key: "open", label: "Open" }, { key: "done", label: "Done" }],
      transitions: [{ key: "close", label: "Close", from: "open", to: "done", allowedActors: ["writer"],
        guard: { match: "any", timeZone: LA, conditions: [group, { field: "name", op: "contains", value: "a" }] } }],
    }, actions: [{ key: "flag", label: "Flag", trigger: { kind: "record_created" },
      condition: { match: "all", conditions: [{ match: "any", conditions: [{ field: "due", op: "gt", value: 1 }] }] },
      step: { kind: "set_field", field: "name", value: "x" } }] });
    expect(guarded.error?.issues.map((issue) => issue.message)).toEqual(["action flag cannot apply gt to datetime field due"]);
  });
});

describe("guards with groups and days", () => {
  it("names unmet groups and day values in words", () => {
    const guard = WorkflowGuardSchema.parse({
      timeZone: LA,
      conditions: [
        { field: "due", op: "before", value: "today+3d" },
        { match: "any", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "name", op: "eq_ignore_case", value: "alpha" }] },
        { field: "due", op: "within_last", value: 1 },
      ],
    });
    expect(unmetGuardConditions(guard, records[0]!, now)).toEqual([]);
    const unmet = unmetGuardConditions(guard, records[4]!, now);
    expect(guardRefusal(guard, unmet, fields))
      .toBe("Due is before today plus 3 days and (Priority is high or Name is, ignoring case, alpha) and Due is within the last 1 day");
    expect(describeCondition({ field: "due", op: "on", value: "today-2d" }, fields)).toBe("Due falls on today minus 2 days");
    expect(describeCondition({ field: "due", op: "between", value: ["today", "2026-10-01"] }, fields)).toBe("Due is between today and 2026-10-01");
    expect(describeCondition({ field: "due", op: "within_next", value: 7 }, fields)).toBe("Due is within the next 7 days");
  });
});
