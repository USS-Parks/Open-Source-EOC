import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardActionRun } from "@openeoc/shared";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { onRecordWritten } from "../boards/record-sync.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { onBoardEvent } from "../events/bus.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Board actions (Veoci and air gap VA25, VC-17) against a real database: each
 * step of the catalog (set a field, create a linked record with a mapping and
 * the reference back, request a transition, notify), each run recorded in the
 * record's history as the person whose write set it off, the chain stopped
 * before it loops, and the rule that an action holds that person's authority
 * and no more.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let holderToken: string;
let partnerToken: string;
let partnerId: string;
let incidentId: string;
let reports: string;
let followUps: string;
let loops: string;

const reportsTemplate = {
  key: "damage_reports",
  version: 1,
  title: "Damage reports",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["new", "confirmed"] },
    { key: "confirmed_at", label: "Confirmed at", type: "datetime" },
    { key: "priority", label: "Priority", type: "enum", values: ["low", "high"] },
    { key: "cost", label: "Cost", type: "number" },
    { key: "reviewer_note", label: "Reviewer note", type: "text", write: "admin" },
    { key: "secret_note", label: "Secret note", type: "text", read: "admin", write: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["summary", "status"] }],
  workflow: {
    initialState: "draft",
    states: [
      { key: "draft", label: "Draft" },
      { key: "review", label: "In review" },
      { key: "closed", label: "Closed", terminal: true, readOnlyFields: ["summary"] },
    ],
    transitions: [
      { key: "send_review", label: "Send for review", from: "draft", to: "review", allowedActors: ["writer"],
        guard: { conditions: [{ field: "cost", op: "gt", value: 0 }] } },
      { key: "close", label: "Close", from: "review", to: "closed", allowedActors: ["writer"] },
    ],
  },
  actions: [
    { key: "tell_creator", label: "Acknowledge the report", trigger: { kind: "record_created" },
      step: { kind: "notify", to: { kind: "creator" }, message: "Your report was received." } },
    { key: "stamp", label: "Stamp the confirmation", trigger: { kind: "field_changed", field: "status" },
      condition: { conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
      step: { kind: "set_field", field: "confirmed_at", value: "now" } },
    { key: "follow_up", label: "Open a follow-up", trigger: { kind: "field_changed", field: "status" },
      condition: { conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
      step: { kind: "create_record", board: "follow_ups", link: "report",
        mapping: [{ to: "task", from: "summary" }, { to: "note", from: "secret_note" }] } },
    { key: "escalate", label: "Note the escalation", trigger: { kind: "field_changed", field: "priority" },
      condition: { conditions: [{ field: "priority", op: "eq", value: "high" }] },
      step: { kind: "set_field", field: "reviewer_note", value: "Escalated" } },
    { key: "to_review", label: "Send costed reports for review", trigger: { kind: "field_changed", field: "cost" },
      condition: { conditions: [{ field: "cost", op: "is_not_empty" }] },
      step: { kind: "transition", transition: "send_review" } },
    { key: "tell_planning", label: "Tell planning", trigger: { kind: "state_entered", state: "review" },
      step: { kind: "notify", to: { kind: "position", positionKey: "planning" }, message: "A report is ready for review." } },
    { key: "rename_closed", label: "Rename when closed", trigger: { kind: "state_entered", state: "closed" },
      step: { kind: "set_field", field: "summary", value: "Closed report" } },
  ],
};

const followUpsTemplate = {
  key: "follow_ups",
  version: 1,
  title: "Follow-ups",
  fields: [
    { key: "task", label: "Task", type: "text" },
    { key: "note", label: "Note", type: "text" },
    { key: "done", label: "Done", type: "boolean" },
    { key: "report", label: "Report", type: "record_ref", targetBoardKey: "damage_reports", labelField: "summary" },
  ],
  views: [{ key: "all", title: "All", columns: ["task"] }],
  actions: [
    { key: "start_open", label: "Start open", trigger: { kind: "record_created" },
      step: { kind: "set_field", field: "done", value: false } },
  ],
};

const chainFields = ["a", "b", "f1", "f2", "f3", "f4", "f5", "f6", "f7"];
const loopsTemplate = {
  key: "chain_loops",
  version: 1,
  title: "Chain loops",
  fields: chainFields.map((key) => ({ key, label: key.toUpperCase(), type: "number" })),
  views: [{ key: "all", title: "All", columns: ["a"] }],
  actions: [
    { key: "ping", label: "Ping", trigger: { kind: "field_changed", field: "a" }, step: { kind: "set_field", field: "b", value: 1 } },
    { key: "pong", label: "Pong", trigger: { kind: "field_changed", field: "b" }, step: { kind: "set_field", field: "a", value: 2 } },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `d${n}`, label: `Step ${n}`,
      trigger: { kind: "field_changed", field: `f${n}` }, step: { kind: "set_field", field: `f${n + 1}`, value: n } })),
  ],
};

async function call(method: string, url: string, token: string, payload?: unknown) {
  return app.inject({ method: method as "GET", url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });
}
async function create(boardId: string, token: string, data: Record<string, unknown>, incident?: string): Promise<string> {
  const res = await call("POST", `/api/v1/boards/${boardId}/records${incident ? `?incidentId=${incident}` : ""}`, token, data);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}
async function patch(boardId: string, recordId: string, token: string, data: Record<string, unknown>, incident?: string) {
  const res = await call("PATCH", `/api/v1/boards/${boardId}/records/${recordId}${incident ? `?incidentId=${incident}` : ""}`, token, data);
  expect(res.statusCode, res.body).toBe(200);
}
const dataOf = async (id: string) => (await admin`select data from board_records where id = ${id}`)[0]!.data as Record<string, unknown>;
const runsOf = async (recordId: string) => (await admin`
  select person_id, payload from audit_events
  where category = 'board.action.run' and subject_id = ${recordId} order by seq`)
  .map((row) => ({ personId: row.person_id as string, ...(row.payload as BoardActionRun) }));

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const holderId = await createPerson(admin, { email: "holder@example.org", displayName: "Planning Holder", password: "holder-good-password" });
  await addMembership(admin, holderId, seed.jurisdictionId, "member");
  holderToken = await tokenFor(app, "holder@example.org", "holder-good-password");
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'planning', 'Planning Chief') returning id`;
  await admin`insert into position_assignments (position_id, person_id, assigned_by) values (${position!.id}, ${holderId}, ${seed.adminId})`;
  for (const template of [reportsTemplate, followUpsTemplate, loopsTemplate]) {
    const res = await call("POST", "/api/v1/templates", adminToken, template);
    expect(res.statusCode, res.body).toBe(201);
  }
  const board = async (templateKey: string) => (await call("POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken, { templateKey })).json().id as string;
  reports = await board("damage_reports");
  followUps = await board("follow_ups");
  loops = await board("chain_loops");
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${seed.jurisdictionId}, 'daily_ops', 'Klamath flood', 'incident', ${seed.adminId}) returning id`;
  incidentId = incident!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${reports}), (${incidentId}, ${followUps})`;
  // A partner organization's person contributes to the incident without a membership here.
  await createJurisdiction(admin, "river-mutual-aid", "River Mutual Aid");
  partnerId = await createPerson(admin, { email: "partner@example.org", displayName: "Partner Liaison", password: "partner-good-password" });
  const [partnerOrg] = await admin`select id from jurisdictions where slug = 'river-mutual-aid'`;
  await addMembership(admin, partnerId, partnerOrg!.id as string, "member");
  partnerToken = await tokenFor(app, "partner@example.org", "partner-good-password");
  const granted = await call("POST", `/api/v1/incidents/${incidentId}/participants`, adminToken, {
    organizationSlug: "river-mutual-aid", personEmail: "partner@example.org", incidentPositionTitle: "Mutual Aid Liaison",
    role: "contributor", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "Joint response",
  });
  expect(granted.statusCode, granted.body).toBe(201);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("board actions", () => {
  it("refuses a template whose actions name what it lacks or set a value a field cannot hold", async () => {
    type Loose = { version: number; actions: Array<Record<string, unknown>> };
    const variants: Array<(t: Loose) => void> = [
      (t) => { t.actions[1]!.trigger = { kind: "field_changed", field: "missing" }; },
      (t) => { t.actions[5]!.trigger = { kind: "state_entered", state: "archived" }; },
      (t) => { t.actions[1]!.step = { kind: "set_field", field: "status", value: "maybe" }; },
      (t) => { t.actions[1]!.step = { kind: "set_field", field: "confirmed_at", value: "tomorrow" }; },
      (t) => { t.actions[4]!.step = { kind: "transition", transition: "reopen" }; },
      (t) => { t.actions[2]!.step = { kind: "create_record", board: "follow_ups", link: "report", mapping: [{ to: "task", from: "nowhere" }] }; },
      (t) => { t.actions[1]!.condition = { conditions: [{ field: "summary", op: "gt", value: 3 }] }; },
      (t) => { t.actions.push(structuredClone(t.actions[0]!)); },
    ];
    for (const change of variants) {
      const bad = structuredClone(reportsTemplate) as unknown as Loose;
      bad.version = 2;
      change(bad);
      const res = await call("POST", "/api/v1/templates", adminToken, bad);
      expect(res.statusCode, JSON.stringify(bad.actions)).toBe(400);
    }
  });

  it("sets a field and opens a linked record as the person whose change set them off", async () => {
    const report = await create(reports, memberToken, { summary: "Culvert washed out on Bald Hills Road", status: "new" }, incidentId);
    await patch(reports, report, adminToken, { secret_note: "Owner asked not to be named" }, incidentId);
    // Live views and open sync documents hear an action's writes once the transaction commits.
    const announced: string[] = [];
    const logged: string[] = [];
    const offEvents = onBoardEvent((event) => announced.push(`${event.event} ${event.boardId}`));
    const offWrites = onRecordWritten((write) => logged.push(write.boardId));
    await patch(reports, report, memberToken, { status: "confirmed" }, incidentId);
    offEvents();
    offWrites();
    // The actions' writes, as they committed, then the member's own.
    expect(announced).toEqual([`record.updated ${reports}`, `record.created ${followUps}`,
      `record.updated ${followUps}`, `record.updated ${reports}`]);
    expect(new Set(logged)).toEqual(new Set([reports, followUps]));

    const data = await dataOf(report);
    expect(Date.now() - Date.parse(data.confirmed_at as string)).toBeLessThan(60_000);
    const [followUp] = await admin`select id, data, created_by, incident_id from board_records where board_id = ${followUps}`;
    // The mapping copies the summary; the secret note is admin-read, so the member's action leaves it behind.
    expect(followUp!.data).toEqual({ report, task: "Culvert washed out on Bald Hills Road", done: false });
    expect(followUp!.created_by).toBe(seed.memberId);
    expect(followUp!.incident_id).toBe(incidentId);

    const runs = await runsOf(report);
    expect(runs.map((run) => [run.action.key, run.outcome, run.personId])).toEqual([
      ["tell_creator", "done", seed.memberId],
      ["stamp", "done", seed.memberId],
      ["follow_up", "done", seed.memberId],
    ]);
    const [, stamp, follow] = runs;
    expect(stamp!.trigger).toEqual({ kind: "field_changed", field: "status", state: null, byAction: null });
    expect(follow!.result).toEqual({ recordId: followUp!.id, boardId: followUps, board: "Follow-ups" });
    expect(follow!.chain).toBe(stamp!.chain);
    // The follow-up's own action ran one step deeper in the same chain.
    const [started] = await runsOf(followUp!.id as string);
    expect(started).toMatchObject({ action: { key: "start_open" }, outcome: "done", depth: 2, chain: stamp!.chain,
      trigger: { kind: "record_created", byAction: "Open a follow-up" } });

    // The record's history names the action on its write and shows each run.
    const history = await call("GET", `/api/v1/boards/${reports}/records/${report}/history?incidentId=${incidentId}`, memberToken);
    expect(history.statusCode, history.body).toBe(200);
    const entries = history.json().entries as Array<{ category: string; action: { key: string } | null; run: BoardActionRun | null;
      changes: Array<{ field: string }>; actor: { personId: string } }>;
    const stamped = entries.find((entry) => entry.action?.key === "stamp")!;
    expect(stamped).toMatchObject({ category: "board.record.updated", actor: { personId: seed.memberId } });
    expect(stamped.changes.map((change) => change.field)).toEqual(["confirmed_at"]);
    expect(entries.filter((entry) => entry.run).map((entry) => [entry.run!.action.key, entry.action]))
      .toEqual([["tell_creator", null], ["stamp", null], ["follow_up", null]]);
    const created = await call("GET", `/api/v1/boards/${followUps}/records/${followUp!.id as string}/history?incidentId=${incidentId}`, memberToken);
    expect(created.json().entries[0]).toMatchObject({ category: "board.record.created", action: { key: "follow_up", label: "Open a follow-up" } });

    // The creator was told, in the app.
    const [notice] = await admin`select person_id, channel, title, body, incident_id from notifications
      where channel = 'action' and person_id = ${seed.memberId}`;
    expect(notice).toMatchObject({ title: "Damage reports: Acknowledge the report", body: "Your report was received.", incident_id: incidentId });
  });

  it("requests a transition, holds to its guard, and notifies a position on entering the state", async () => {
    const report = await create(reports, memberToken, { summary: "Slide on Highway 169" }, incidentId);
    await patch(reports, report, memberToken, { cost: 0 }, incidentId);
    let runs = await runsOf(report);
    expect(runs.at(-1)).toMatchObject({ action: { key: "to_review" }, outcome: "refused",
      reason: "Send for review cannot be taken: Cost is more than 0." });
    // The refused step rolled back alone, workflow row and all; the cost the member wrote stands.
    expect(await admin`select 1 from board_workflow_instances where record_id = ${report}`).toHaveLength(0);
    expect(await dataOf(report)).toMatchObject({ cost: 0 });

    await patch(reports, report, memberToken, { cost: 48000 }, incidentId);
    runs = await runsOf(report);
    expect(runs.slice(-2).map((run) => [run.action.key, run.outcome, run.depth])).toEqual([["to_review", "done", 1], ["tell_planning", "done", 2]]);
    expect(runs.at(-2)!.result).toEqual({ state: "In review" });
    expect(runs.at(-1)!.trigger).toMatchObject({ kind: "state_entered", state: "In review", byAction: "Send costed reports for review" });
    const [instance] = await admin`select state_key from board_workflow_instances where record_id = ${report}`;
    expect(instance!.state_key).toBe("review");

    const notices = await call("GET", "/api/v1/notifications", holderToken);
    const notice = (notices.json().notifications as Array<Record<string, unknown>>)
      .find((item) => item.title === "Damage reports: Tell planning")!;
    expect(notice).toMatchObject({ body: "A report is ready for review.", assigned_to_current_actor: true, channel: "action" });
  });

  it("holds an action to the authority of the person who set it off, and no more", async () => {
    const report = await create(reports, memberToken, { summary: "Bridge approach settled", cost: 12 }, incidentId);
    // A member's change sets off a write to an admin-only field: refused, and the member's own change stands.
    await patch(reports, report, memberToken, { priority: "high" }, incidentId);
    expect(await dataOf(report)).toMatchObject({ priority: "high" });
    expect(await dataOf(report)).not.toHaveProperty("reviewer_note");
    expect((await runsOf(report)).at(-1)).toMatchObject({ action: { key: "escalate" }, outcome: "refused",
      reason: "field reviewer_note is admin-writable only" });
    // The same change by an administrator writes it.
    await patch(reports, report, adminToken, { priority: "low" }, incidentId);
    await patch(reports, report, adminToken, { priority: "high" }, incidentId);
    expect(await dataOf(report)).toMatchObject({ reviewer_note: "Escalated" });
    expect((await runsOf(report)).at(-1)).toMatchObject({ action: { key: "escalate" }, outcome: "done", personId: seed.adminId });

    // A state's read-only fields hold against an action as against a person.
    const review = { transitionKey: "send_review", idempotencyKey: randomUUID() };
    const sent = await call("POST", `/api/v1/boards/${reports}/records/${report}/workflow/transitions`, memberToken, review);
    expect(sent.statusCode, sent.body).toBe(200);
    expect((await runsOf(report)).at(-1)).toMatchObject({ action: { key: "tell_planning" }, outcome: "done" });
    // A replayed request enters no state, so it sets nothing off again.
    const runCount = (await runsOf(report)).length;
    expect((await call("POST", `/api/v1/boards/${reports}/records/${report}/workflow/transitions`, memberToken, review)).statusCode).toBe(200);
    expect(await runsOf(report)).toHaveLength(runCount);
    const close = await call("POST", `/api/v1/boards/${reports}/records/${report}/workflow/transitions`, memberToken,
      { transitionKey: "close", idempotencyKey: randomUUID() });
    expect(close.statusCode, close.body).toBe(200);
    expect((await runsOf(report)).at(-1)).toMatchObject({ action: { key: "rename_closed" }, outcome: "refused",
      reason: "Summary cannot change while the record is Closed", trigger: { kind: "state_entered", state: "Closed", byAction: null } });
    expect(await dataOf(report)).toMatchObject({ summary: "Bridge approach settled" });

    // A partner contributor writes the record; the notice to its creator needs a membership they lack.
    const partnerReport = await create(reports, partnerToken, { summary: "Mutual aid crew staged at Weitchpec" }, incidentId);
    const [partnerRun] = await runsOf(partnerReport);
    expect(partnerRun).toMatchObject({ personId: partnerId, action: { key: "tell_creator" }, outcome: "refused",
      reason: "Only members of the board's jurisdiction send its notices." });
    const history = await call("GET", `/api/v1/boards/${reports}/records/${partnerReport}/history?incidentId=${incidentId}`, partnerToken);
    expect(history.statusCode, history.body).toBe(200);
    expect((history.json().entries as Array<{ run: BoardActionRun | null }>).some((entry) => entry.run?.outcome === "refused")).toBe(true);

    // A linked record needs an incident; a jurisdiction record has none.
    const local = await create(reports, memberToken, { summary: "Office generator test", status: "new" });
    await patch(reports, local, memberToken, { status: "confirmed" });
    expect((await runsOf(local)).find((run) => run.action.key === "follow_up")).toMatchObject({ outcome: "refused",
      reason: "A linked record needs an incident, and this record is not part of one." });
  });

  it("stops a chain before it loops, and at its depth limit, and says why", async () => {
    const record = await create(loops, memberToken, { a: 0 });
    await patch(loops, record, memberToken, { a: 5 });
    expect(await dataOf(record)).toMatchObject({ a: 2, b: 1 });
    let runs = await runsOf(record);
    expect(runs.map((run) => [run.action.key, run.outcome, run.depth])).toEqual([
      ["ping", "done", 1], ["pong", "done", 2], ["ping", "stopped", 3],
    ]);
    expect(runs[2]!.reason).toBe("Ping already ran in this chain; running it again would loop.");
    expect(new Set(runs.map((run) => run.chain)).size).toBe(1);

    await patch(loops, record, memberToken, { f1: 1 });
    runs = (await runsOf(record)).slice(3);
    expect(runs.map((run) => [run.action.key, run.outcome, run.depth])).toEqual([
      ["d1", "done", 1], ["d2", "done", 2], ["d3", "done", 3], ["d4", "done", 4], ["d5", "done", 5], ["d6", "stopped", 6],
    ]);
    expect(runs[5]!.reason).toBe("The chain reached its limit of 5 actions, each set off by the one before.");
    const data = await dataOf(record);
    expect(data).toMatchObject({ f6: 5 });
    expect(data).not.toHaveProperty("f7");
  });
});
