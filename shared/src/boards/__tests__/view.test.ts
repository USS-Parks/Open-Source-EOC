import { describe, expect, it } from "vitest";
import {
  applyView,
  BoardTemplateSchema,
  referenceLabelKeys,
  roleReadsEveryRecord,
  viewOrder,
  ViewConditionSchema,
  type FieldDef,
  type ViewDef,
} from "../../index.js";

const fields = [
  { key: "name", label: "Name", type: "text" },
  { key: "rank", label: "Rank", type: "number" },
  { key: "due", label: "Due", type: "datetime" },
] as FieldDef[];

const view = (extra: Partial<ViewDef>): ViewDef =>
  ({ key: "v", title: "V", kind: "list", columns: ["name"], filter: [], ...extra }) as ViewDef;

const now = new Date("2026-09-23T12:00:00Z");
const records = [
  { id: "a", name: "Alpha", rank: 10, due: "2026-09-20T12:00:00Z" },
  { id: "b", name: "beta", rank: 9, due: "2026-09-24T12:00:00+02:00" },
  { id: "c", name: "Gamma", rank: 9 },
  { id: "d", name: "", rank: -1, due: "2026-10-30T00:00:00Z" },
];
const names = (v: ViewDef) => applyView(v, records, { fields, now }).map((r) => r.id);

describe("view conditions", () => {
  it("applies every operator", () => {
    const where = (condition: object) => names(view({ where: [ViewConditionSchema.parse(condition)] }));
    expect(where({ field: "name", op: "contains", value: "MM" })).toEqual(["c"]);
    expect(where({ field: "name", op: "starts_with", value: "b" })).toEqual(["b"]);
    expect(where({ field: "name", op: "not_in", value: ["Alpha", "beta"] })).toEqual(["c", "d"]);
    expect(where({ field: "rank", op: "gte", value: 9 })).toEqual(["a", "b", "c"]);
    expect(where({ field: "rank", op: "between", value: [0, 9] })).toEqual(["b", "c"]);
    expect(where({ field: "due", op: "before", value: "now" })).toEqual(["a"]);
    expect(where({ field: "due", op: "after", value: "now+7d" })).toEqual(["d"]);
    expect(where({ field: "due", op: "between", value: ["now-1d", "2026-09-25T00:00:00Z"] })).toEqual(["b"]);
    expect(where({ field: "due", op: "is_empty" })).toEqual(["c"]);
    expect(where({ field: "name", op: "is_not_empty" })).toEqual(["a", "b", "c"]);
  });

  it("refuses a value that does not fit its operator", () => {
    for (const bad of [
      { field: "rank", op: "gt", value: "9" },
      { field: "rank", op: "between", value: [5, 1] },
      { field: "due", op: "before", value: "yesterday" },
      { field: "name", op: "is_empty", value: "" },
      { field: "name", op: "in", value: "Alpha" },
    ]) expect(ViewConditionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("view order", () => {
  it("sorts by several keys, numbers by value, the group field first", () => {
    expect(names(view({ sorts: [{ field: "rank", dir: "desc" }, { field: "name", dir: "asc" }] })))
      .toEqual(["a", "b", "c", "d"]);
    expect(names(view({ sort: { field: "due", dir: "asc" } }))).toEqual(["c", "a", "b", "d"]);
    expect(viewOrder(view({ groupBy: "rank", sorts: [{ field: "name", dir: "asc" }] })))
      .toEqual([{ field: "rank", dir: "asc" }, { field: "name", dir: "asc" }]);
  });
});

describe("template extensions", () => {
  const base = {
    key: "t", version: 1, title: "T",
    fields: [...fields, { key: "ref", label: "Ref", type: "record_ref", targetBoardKey: "other", labelFields: ["a", "b"] }],
    views: [{ key: "all", title: "All", columns: ["name"] }],
  };

  it("accepts label fields, record access, conditions, sorts and a group", () => {
    const parsed = BoardTemplateSchema.parse({
      ...base,
      views: [{ key: "all", title: "All", columns: ["name"], groupBy: "rank",
        sorts: [{ field: "due", dir: "desc" }], where: [{ field: "rank", op: "lt", value: 3 }] }],
      recordAccess: { read: [{ kind: "creator" }, { kind: "role", roles: ["viewer"] }], edit: [{ kind: "creator" }] },
    });
    expect(referenceLabelKeys(parsed.fields[3]!)).toEqual(["a", "b"]);
    expect(referenceLabelKeys({ labelField: "a" })).toEqual(["a"]);
    expect(roleReadsEveryRecord(parsed.recordAccess, "viewer")).toBe(true);
    expect(roleReadsEveryRecord(parsed.recordAccess, "member")).toBe(false);
    expect(roleReadsEveryRecord(parsed.recordAccess, "admin")).toBe(true);
    expect(roleReadsEveryRecord(undefined, "guest")).toBe(true);
  });

  it("rejects what the engine cannot honor", () => {
    const refuses = (patch: object) => expect(BoardTemplateSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    refuses({ fields: [{ key: "ref", label: "Ref", type: "record_ref", targetBoardKey: "other" }] });
    refuses({ views: [{ key: "all", title: "All", columns: ["name"], groupBy: "missing" }] });
    refuses({ views: [{ key: "all", title: "All", columns: ["name"], where: [{ field: "name", op: "gt", value: 1 }] }] });
    refuses({ views: [{ key: "all", title: "All", columns: ["name"], sort: { field: "name", dir: "asc" },
      sorts: [{ field: "rank", dir: "asc" }] }] });
    refuses({ recordAccess: { read: [{ kind: "creator" }], edit: [{ kind: "role", roles: ["viewer"] }] } });
    refuses({ recordAccess: { read: [{ kind: "assigned_position" }], edit: [{ kind: "creator" }] } });
  });
});
