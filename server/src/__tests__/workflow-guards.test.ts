import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { principalForPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { BoardSyncHub } from "../sync/hub.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Workflow guards and per-state field permissions (Veoci and air gap VA15,
 * VC-11). A transition is refused while the record does not meet its guard,
 * when requested and again when its approval would complete it; a field a
 * state makes read-only keeps its value through the REST edit and through
 * sync, where the refusal is a durable conflict.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let hub: BoardSyncHub;
let seed: SeedResult;
let boardId: string;
let adminToken: string;
let memberToken: string;

const template = {
  key: "damage_claims",
  version: 1,
  title: "Damage claims",
  description: "Guards and read-only fields",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "amount", label: "Amount", type: "number" },
    { key: "priority", label: "Priority", type: "enum", values: ["low", "high"] },
    { key: "reviewer_note", label: "Reviewer note", type: "text" },
  ],
  views: [{ key: "all", title: "All", columns: ["summary", "amount"] }],
  workflow: {
    initialState: "draft",
    states: [
      { key: "draft", label: "Draft" },
      { key: "submitted", label: "Submitted", readOnlyFields: ["summary", "amount"] },
      { key: "approved", label: "Approved", terminal: true, readOnlyFields: ["summary", "amount", "reviewer_note"] },
    ],
    transitions: [
      {
        key: "submit", label: "Submit", from: "draft", to: "submitted", allowedActors: ["writer"],
        guard: { match: "all", conditions: [{ field: "amount", op: "gt", value: 0 }, { field: "summary", op: "is_not_empty" }] },
      },
      {
        key: "approve", label: "Approve", from: "submitted", to: "approved", allowedActors: ["writer"],
        approvals: [{ key: "finance", label: "Finance", approver: { kind: "jurisdiction_admin" } }],
        guard: {
          match: "any",
          conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "reviewer_note", op: "is_not_empty" }],
          message: "Add a reviewer note or mark it high priority.",
        },
      },
      { key: "reopen", label: "Reopen", from: "submitted", to: "draft", allowedActors: ["writer"] },
    ],
  },
};

let recordId: string;

async function create(data: Record<string, unknown>): Promise<string> {
  const res = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records`, headers: auth(memberToken), payload: data });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}
const patch = (token: string, id: string, data: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/v1/boards/${boardId}/records/${id}`, headers: auth(token), payload: data });
const transition = (token: string, id: string, transitionKey: string) =>
  app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records/${id}/workflow/transitions`, headers: auth(token),
    payload: { transitionKey, idempotencyKey: randomUUID() } });
const approve = (token: string, id: string) =>
  app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records/${id}/workflow/approvals`, headers: auth(token),
    payload: { transitionKey: "approve", ruleKey: "finance", idempotencyKey: randomUUID() } });
const stateOf = async (id: string) =>
  (await admin`select state_key from board_workflow_instances where record_id = ${id}`)[0]?.state_key ?? "draft";

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  hub = new BoardSyncHub(runtime);
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const registered = await app.inject({ method: "POST", url: "/api/v1/templates", headers: auth(adminToken), payload: template });
  expect(registered.statusCode, registered.body).toBeLessThan(300);
  const board = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "damage_claims" } });
  expect(board.statusCode, board.body).toBeLessThan(300);
  boardId = board.json().id as string;
}, 60_000);

afterAll(async () => {
  hub?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("workflow guards and per-state field permissions", () => {
  it("refuses a template whose guard or read-only list names a field it lacks", async () => {
    const guarded = structuredClone(template) as typeof template & { version: number };
    guarded.version = 2;
    (guarded.workflow.transitions[0]!.guard!.conditions as unknown[]).push({ field: "missing", op: "is_empty" });
    const bad = await app.inject({ method: "POST", url: "/api/v1/templates", headers: auth(adminToken), payload: guarded });
    expect(bad.statusCode).toBe(400);
    const locked = structuredClone(template) as typeof template & { version: number };
    locked.version = 2;
    (locked.workflow.states[1]!.readOnlyFields as string[]).push("nowhere");
    expect((await app.inject({ method: "POST", url: "/api/v1/templates", headers: auth(adminToken), payload: locked })).statusCode).toBe(400);
    const wrongType = structuredClone(template) as typeof template & { version: number };
    wrongType.version = 2;
    (wrongType.workflow.transitions[0]!.guard!.conditions as unknown[]).push({ field: "summary", op: "gt", value: 3 });
    expect((await app.inject({ method: "POST", url: "/api/v1/templates", headers: auth(adminToken), payload: wrongType })).statusCode).toBe(400);
  });

  it("refuses a transition until the record meets its guard", async () => {
    recordId = await create({ summary: "Culvert washed out on Bald Hills Road", amount: 0, priority: "low" });
    const refused = await transition(memberToken, recordId, "submit");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("Submit cannot be taken: Amount is more than 0.");
    expect(await stateOf(recordId)).toBe("draft");
    expect((await patch(memberToken, recordId, { amount: 48000 })).statusCode).toBe(200);
    const submitted = await transition(memberToken, recordId, "submit");
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(await stateOf(recordId)).toBe("submitted");
  });

  it("keeps a state's read-only fields through a REST edit, and says so on the record", async () => {
    const changed = await patch(memberToken, recordId, { amount: 52000 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe("Amount cannot change while the record is Submitted");
    expect((await patch(adminToken, recordId, { summary: "Rewritten" })).statusCode).toBe(409);
    // Sending a locked field unchanged, with an editable one, is an edit of the editable one.
    const note = await patch(memberToken, recordId, { amount: 48000, reviewer_note: "Photos attached" });
    expect(note.statusCode, note.body).toBe(200);
    const [row] = await admin`select data from board_records where id = ${recordId}`;
    expect(row!.data).toMatchObject({ amount: 48000, reviewer_note: "Photos attached", summary: "Culvert washed out on Bald Hills Road" });
    const detail = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/records/${recordId}/detail`, headers: auth(memberToken) });
    expect(detail.json().readOnly).toEqual({ state: "Submitted", fields: ["summary", "amount"] });
    const fresh = await create({ summary: "New", amount: 5 });
    const draft = await app.inject({ method: "GET", url: `/api/v1/boards/${boardId}/records/${fresh}/detail`, headers: auth(memberToken) });
    expect(draft.json().readOnly).toBeNull();
  });

  it("turns a sync edit of a read-only field into a durable conflict", async () => {
    const member = await principalForPerson(runtime, seed.memberId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await hub.open(member, boardId)).state);
    doc.getMap("records").set(`${recordId}/amount`, 1);
    expect((await hub.apply(member, boardId, Y.encodeStateAsUpdate(doc), "member")).conflicts).toBe(1);
    const [row] = await admin`select data from board_records where id = ${recordId}`;
    expect((row!.data as { amount: number }).amount).toBe(48000);
    const [conflict] = await admin`select reason from sync_conflicts where record_id = ${recordId}`;
    expect(conflict!.reason).toBe("Amount cannot change while the record is Submitted");
  });

  it("checks the guard again when the last approval would complete the transition", async () => {
    const second = await create({ summary: "Bridge approach settled", amount: 12000, priority: "low" });
    expect((await transition(memberToken, second, "submit")).statusCode).toBe(200);
    const refused = await transition(memberToken, second, "approve");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("Approve cannot be taken: Add a reviewer note or mark it high priority.");
    expect((await patch(memberToken, second, { priority: "high" })).statusCode).toBe(200);
    expect((await transition(memberToken, second, "approve")).statusCode).toBe(200);
    // While it waits for Finance, the record stops meeting the guard.
    expect((await patch(memberToken, second, { priority: "low" })).statusCode).toBe(200);
    const late = await approve(adminToken, second);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe("Approve can no longer be taken: Add a reviewer note or mark it high priority.");
    expect(await admin`select 1 from board_workflow_approvals where record_id = ${second}`).toHaveLength(0);
    expect((await patch(memberToken, second, { reviewer_note: "Engineer inspected" })).statusCode).toBe(200);
    const approved = await approve(adminToken, second);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(await stateOf(second)).toBe("approved");
    expect((await patch(adminToken, second, { reviewer_note: "Changed after approval" })).statusCode).toBe(409);
  });
});
