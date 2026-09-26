import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyView,
  BoardTemplateSchema,
  setHolds,
  zonedDay,
  type ConditionGroup,
  type FieldDef,
  type ViewDef,
  type ViewRecord,
} from "@openeoc/shared";
import { buildApp } from "../app.js";
import { conditionSetSql } from "../boards/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * All-or-any conditions with groups and the day and text operators (VC-18)
 * against a real database: the SQL a view pushes down keeps exactly the
 * records the shared evaluation keeps, operator by operator, for a fixed
 * clock; and a view, an operator's refinement, a workflow guard and a board
 * action each honor an any-of set with a day operator.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let boardId: string;
let memberToken: string;

const DAY = 86_400_000;
const now = Date.now();
const at = (ms: number) => new Date(ms).toISOString();

/**
 * A zone where it is between 06:00 and 18:00 now, so "today" there cannot
 * turn over while the file runs. Some zone in the list always is: their
 * clocks are at most five and a half hours apart around the day.
 */
const zone = ["Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Kolkata", "Asia/Tokyo"]
  .find((name) => {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: name, hour: "numeric", hourCycle: "h23" }).format(now));
    return hour >= 6 && hour < 18;
  })!;

const template = {
  key: "claims",
  version: 1,
  title: "Claims",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "priority", label: "Priority", type: "enum", values: ["low", "high"] },
    { key: "amount", label: "Amount", type: "number" },
    { key: "due", label: "Due", type: "datetime" },
    { key: "flag", label: "Flag", type: "text" },
  ],
  views: [
    { key: "all", title: "All", columns: ["summary", "due"] },
    {
      key: "attention", title: "Needs attention", columns: ["summary", "priority", "due"], match: "any", timeZone: zone,
      where: [
        { field: "due", op: "on", value: "today" },
        { match: "all", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "due", op: "before", value: "today-3d" }] },
      ],
      sorts: [{ field: "due", dir: "desc" }], groupBy: "priority",
    },
  ],
  workflow: {
    initialState: "open",
    states: [{ key: "open", label: "Open" }, { key: "closed", label: "Closed", terminal: true }],
    transitions: [{
      key: "close", label: "Close", from: "open", to: "closed", allowedActors: ["writer"],
      guard: { match: "any", timeZone: zone, conditions: [{ field: "due", op: "on", value: "today" }, { field: "amount", op: "gt", value: 100 }] },
    }],
  },
  actions: [{
    key: "flag_recent", label: "Flag recent or high", trigger: { kind: "record_created" },
    condition: { match: "any", timeZone: zone, conditions: [{ field: "due", op: "after", value: "today-1d" }, { field: "priority", op: "eq", value: "high" }] },
    step: { kind: "set_field", field: "flag", value: "look" },
  }],
};
const fields = BoardTemplateSchema.parse(template).fields as FieldDef[];

async function create(data: Record<string, unknown>): Promise<string> {
  const res = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records`, headers: auth(memberToken), payload: data });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}
async function view(key: string, where?: unknown): Promise<{ records: ViewRecord[]; groups?: Array<{ value: unknown; count: number }> }> {
  const query = where === undefined ? "" : `?where=${encodeURIComponent(JSON.stringify(where))}`;
  const res = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/views/${key}${query}`, headers: auth(memberToken) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
const summaries = (records: readonly ViewRecord[]) => records.map((record) => record.summary as string);

const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const registered = await app.inject({ method: "POST", url: "/api/v1/templates", headers: auth(adminToken), payload: template });
  expect(registered.statusCode, registered.body).toBeLessThan(300);
  const board = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "claims" } });
  expect(board.statusCode, board.body).toBeLessThan(300);
  boardId = board.json().id as string;
  ids.today = await create({ summary: "Due today", priority: "low", amount: 5, due: at(now) });
  ids.overdue = await create({ summary: "Overdue and high", priority: "high", amount: 5, due: at(now - 10 * DAY) });
  ids.old = await create({ summary: "Old and low", priority: "low", amount: 5, due: at(now - 10 * DAY) });
  ids.later = await create({ summary: "Later and HIGH", priority: "high", amount: 5, due: at(now + 10 * DAY) });
  ids.undated = await create({ summary: "No date", priority: "low", amount: 250 });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("condition sets against the database", () => {
  it("pushes every operator down to SQL that keeps exactly what the shared evaluation keeps", async () => {
    // Fixed instants and a fixed clock: 06:30 UTC on 25 September is 23:30 the day before in Los Angeles.
    const fixed = new Date("2026-09-25T06:30:00Z");
    const extra = [
      { summary: "Alpha", priority: "high", amount: 10, due: "2026-09-24T23:00:00Z" },
      { summary: "beta", priority: "low", amount: 0, due: "2026-09-25T06:00:00.0005Z" },
      { summary: "ALPHA", priority: "low", amount: 9, due: "2026-09-25T07:00:00+00:00" },
      { summary: "", priority: "high", amount: 2, due: "2026-09-21T12:00:00Z" },
      { summary: "Chile", priority: "low", amount: 1, due: "2026-09-06T04:30:00Z" },
      // Case folds as the browser folds it whatever the database's collation; the test cluster's is C.
      { summary: "École Road", priority: "low", amount: 4 },
    ];
    for (const data of extra) await admin`
      insert into board_records (id, board_id, data, created_by)
      select ${randomUUID()}, ${boardId}, ${admin.json(data)}, created_by from board_records where board_id = ${boardId} limit 1`;
    const rows = await admin`select id, data from board_records where board_id = ${boardId}`;
    const records: ViewRecord[] = rows.map((row) => ({ ...(row.data as Record<string, unknown>), id: row.id as string }));
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const readable = new Set(byKey.keys());
    const LA = "America/Los_Angeles";
    const sets: Array<[string, ConditionGroup]> = [
      ...([
        { field: "summary", op: "eq", value: "Alpha" }, { field: "summary", op: "neq", value: "Alpha" },
        { field: "priority", op: "in", value: ["high"] }, { field: "priority", op: "not_in", value: ["high"] },
        { field: "summary", op: "contains", value: "ALP" }, { field: "summary", op: "starts_with", value: "b" },
        { field: "summary", op: "eq_ignore_case", value: "alpha" },
        { field: "summary", op: "eq_ignore_case", value: "école road" }, { field: "summary", op: "contains", value: "COLE" },
        { field: "summary", op: "starts_with", value: "ÉC" },
        { field: "amount", op: "gt", value: 5 }, { field: "amount", op: "gte", value: 5 },
        { field: "amount", op: "lt", value: 2 }, { field: "amount", op: "lte", value: 2 }, { field: "amount", op: "between", value: [1, 9] },
        { field: "due", op: "before", value: "now" }, { field: "due", op: "after", value: "2026-09-25T06:00:00Z" },
        { field: "due", op: "on", value: "today" }, { field: "due", op: "on", value: "today+1d" },
        { field: "due", op: "before", value: "today" }, { field: "due", op: "after", value: "today-1d" },
        { field: "due", op: "between", value: ["today-4d", "today"] }, { field: "due", op: "between", value: ["2026-09-24", "now"] },
        { field: "due", op: "within_last", value: 1 }, { field: "due", op: "within_next", value: 1 },
        { field: "due", op: "is_empty" }, { field: "summary", op: "is_not_empty" },
      ] as const).map((condition) => [JSON.stringify(condition), { match: "all", timeZone: LA, conditions: [condition] }] as [string, ConditionGroup]),
      ["on today in UTC", { match: "all", conditions: [{ field: "due", op: "on", value: "today" }] }],
      ["on the day Chile skipped midnight", { match: "all", timeZone: "America/Santiago", conditions: [{ field: "due", op: "on", value: "2026-09-06" }] }],
      ["any with a group", { match: "any", timeZone: LA, conditions: [
        { field: "due", op: "on", value: "today" },
        { match: "all", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "amount", op: "lt", value: 3 }] },
      ] }],
      ["all with an any group in its own zone", { match: "all", timeZone: LA, conditions: [
        { field: "amount", op: "gte", value: 1 },
        { match: "any", timeZone: "Asia/Kolkata", conditions: [{ field: "due", op: "on", value: "today" }, { field: "summary", op: "is_empty" }] },
      ] }],
    ];
    for (const [name, set] of sets) {
      const found = await admin`
        select id from board_records where board_id = ${boardId} and ${conditionSetSql(admin, set, byKey, readable, fixed)}`;
      const inSql = found.map((row) => row.id as string).sort();
      const shared = records.filter((record) => setHolds(set, record, fixed)).map((record) => record.id).sort();
      expect(inSql, name).toEqual(shared);
    }
    // Accented text folds as the browser folds it, which the cluster's own lower() would not do.
    expect(records.filter((record) => setHolds({ match: "all", conditions: [{ field: "summary", op: "eq_ignore_case", value: "école road" }] }, record, fixed))).toHaveLength(1);
    // The records the battery reads include ones a day operator keeps and ones it leaves.
    expect(records.filter((record) => setHolds(sets.find(([name]) => name === "any with a group")![1], record, fixed)).length).toBeGreaterThan(1);
    await admin`delete from board_records where board_id = ${boardId} and not (id = any(${Object.values(ids)}))`;
  });

  it("shows a view's any-of records with a day operator, grouped and sorted, as the browser reads them", async () => {
    const result = await view("attention");
    // Grouped by priority first, high before low, then by due date, latest first.
    expect(summaries(result.records)).toEqual(["Overdue and high", "Due today"]);
    expect(result.groups).toEqual([{ value: "high", count: 1 }, { value: "low", count: 1 }]);
    // The browser applies the same view to every record it holds and keeps the same ones.
    const every = (await view("all")).records;
    expect(every).toHaveLength(5);
    const declared = BoardTemplateSchema.parse(template).views[1] as ViewDef;
    expect(applyView(declared, every, { fields }).map((record) => record.summary)).toEqual(summaries(result.records));
  });

  it("honors an operator's any-of refinement with a day operator on top of the view's own conditions", async () => {
    const refinement = [{ match: "any", timeZone: zone, conditions: [
      { field: "due", op: "within_next", value: 11 }, { field: "summary", op: "eq_ignore_case", value: "OLD AND LOW" }] }];
    expect(summaries((await view("all", refinement)).records).sort()).toEqual(["Later and HIGH", "Old and low"]);
    // On the any-of view, the refinement must hold as well as the view's own set.
    const narrow = [{ match: "any", conditions: [{ field: "summary", op: "starts_with", value: "overdue" }] }];
    expect(summaries((await view("attention", narrow)).records)).toEqual(["Overdue and high"]);
    const nested = await app.inject({ method: "GET", headers: auth(memberToken),
      url: `/api/v1/boards/${boardId}/views/all?where=${encodeURIComponent(JSON.stringify([{ match: "any", conditions: refinement }]))}` });
    expect(nested.statusCode).toBe(400);
  });

  it("holds a transition to an any-of guard with a day operator", async () => {
    const take = (id: string) => app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records/${id}/workflow/transitions`,
      headers: auth(memberToken), payload: { transitionKey: "close", idempotencyKey: randomUUID() } });
    const refused = await take(ids.old!);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("Close cannot be taken: Due falls on today or Amount is more than 100.");
    expect((await take(ids.today!)).statusCode).toBe(200);
    expect((await take(ids.undated!)).statusCode).toBe(200);
    const patched = await app.inject({ method: "PATCH", url: `/api/v1/boards/${boardId}/records/${ids.old}`,
      headers: auth(memberToken), payload: { amount: 101 } });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((await take(ids.old!)).statusCode).toBe(200);
  });

  it("runs an action only for records that meet its any-of condition with a day operator", async () => {
    const flags = await admin`select data ->> 'summary' as summary, data ->> 'flag' as flag from board_records
      where id = any(${Object.values(ids)}) order by data ->> 'summary'`;
    expect(flags.map((row) => [row.summary, row.flag])).toEqual([
      ["Due today", "look"], ["Later and HIGH", "look"], ["No date", null], ["Old and low", null], ["Overdue and high", "look"],
    ]);
    expect(zonedDay(now, zone)).toBe(zonedDay(Date.now(), zone));
  });
});
