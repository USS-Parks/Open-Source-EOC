import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Field breadth (AG-07), against a real database: a writer a record rule
 * restricts syncs its own records, each through the record-level rules; board
 * work, messages, new tasks and task completions that reach a closed incident
 * are kept as late submissions for the owner's administrators, who accept
 * them after reopening or refuse them; and queued field operations run once.
 */

interface Ack {
  readonly type: "synced";
  readonly operationId: string | null;
  readonly seq: number;
  readonly conflicts: number;
  readonly exact: boolean;
  readonly late?: string;
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let host: string;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let otherToken: string;

const privateReports = BoardTemplateSchema.parse({
  key: "private_field_reports",
  version: 1,
  title: "Private field reports",
  fields: [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "name", label: "Name", type: "text" },
  ],
  views: [{ key: "all", title: "All", columns: ["code", "name"] }],
  recordAccess: { read: [{ kind: "creator" }], edit: [{ kind: "creator" }] },
});

const request = async (method: "GET" | "POST", url: string, token: string, payload?: object) =>
  app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });

async function ok(method: "GET" | "POST", url: string, token: string, payload?: object) {
  const response = await request(method, url, token, payload);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function incident(name: string): Promise<string> {
  return (await ok("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, adminToken,
    { templateKey: "daily_ops", name })).incidentId as string;
}

async function board(templateKey: string, incidentId: string): Promise<string> {
  const id = (await ok("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
    { templateKey })).id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${id})`;
  return id;
}

/** A field device's side of the sync socket: exact operations, with the state it is served. */
class Device {
  readonly doc = new Y.Doc();
  readonly heard: Uint8Array[] = [];
  private socket: WebSocket | null = null;
  private waiting: { resolve: (ack: Ack) => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly boardId: string, private readonly incidentId: string) {}

  async connect(token: string): Promise<Uint8Array> {
    const socket = new WebSocket(`ws://${host}/api/v1/sync/boards/${this.boardId}?incidentId=${this.incidentId}`);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as { type: string; update?: string; code?: string; error?: string };
        const bytes = () => new Uint8Array(Buffer.from(message.update!, "base64"));
        if (message.type === "state") {
          Y.applyUpdate(this.doc, bytes());
          resolve(bytes());
        } else if (message.type === "update") {
          this.heard.push(bytes());
        } else if (message.type === "synced") {
          this.waiting?.resolve(message as unknown as Ack);
          this.waiting = null;
        } else if (message.type === "error") {
          const error = new Error(`${message.code}:${message.error}`);
          this.waiting?.reject(error);
          this.waiting = null;
          reject(error);
        }
      });
    });
  }

  edit(recordId: string, fields: Record<string, unknown>): Uint8Array {
    const records = this.doc.getMap<unknown>("records");
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(fields)) records.set(`${recordId}/${key}`, value);
    });
    return Y.encodeStateAsUpdate(this.doc);
  }

  send(update: Uint8Array, operationId: string, queuedAt?: string): Promise<Ack> {
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.socket!.send(JSON.stringify({
        type: "update", operationId, incidentId: this.incidentId,
        update: Buffer.from(update).toString("base64"), ...(queuedAt ? { queuedAt } : {}),
      }));
    });
  }

  close(): void {
    this.socket?.close();
  }
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${privateReports.key}, 1, ${privateReports.title}, ${admin.json(privateReports as never)})`;
  const otherId = await createPerson(admin, { email: "other@example.org", displayName: "Other", password: "other-good-password" });
  await addMembership(admin, otherId, seed.jurisdictionId, "member");
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  otherToken = await tokenFor(app, "other@example.org", "other-good-password");
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("per-record sync for a writer a record rule restricts", () => {
  it("serves no records, applies the writer's own and refuses one it may not edit as a conflict", async () => {
    const incidentId = await incident("Per-record sync");
    const boardId = await board("private_field_reports", incidentId);
    const hidden = (await ok("POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, adminToken,
      { code: "A-1", name: "Admin's report" })).id as string;
    // A record written before REST writes reached the sync log: no document holds it.
    const unlogged = randomUUID();
    await admin`insert into board_records (id, board_id, incident_id, data, created_by)
      values (${unlogged}, ${boardId}, ${incidentId}, ${admin.json({ code: "L-1" })}, ${seed.adminId})`;

    const watcher = new Device(boardId, incidentId);
    await watcher.connect(adminToken);
    const device = new Device(boardId, incidentId);
    await device.connect(memberToken);
    expect(device.doc.getMap("records").size).toBe(0);

    const own = randomUUID();
    const first = await device.send(device.edit(own, { code: "M-1", name: "Member's report" }), randomUUID());
    expect(first).toMatchObject({ conflicts: 0, exact: true });
    const [created] = await admin`select data, created_by, incident_id from board_records where id = ${own}`;
    expect(created).toMatchObject({ data: { code: "M-1", name: "Member's report" }, created_by: seed.memberId, incident_id: incidentId });
    // A full reader following the document hears the new record.
    await expect.poll(() => watcher.heard.length).toBeGreaterThan(0);

    // Records another person wrote are beyond the rule. An edit to one the log
    // holds loses to it, as any crossing edit does (ADR-0003); one the log does
    // not hold reads as new, inserts nothing and is a visible conflict.
    expect((await device.send(device.edit(hidden, { name: "Taken over" }), randomUUID())).conflicts).toBe(0);
    expect((await admin`select data from board_records where id = ${hidden}`)[0]!.data)
      .toEqual({ code: "A-1", name: "Admin's report" });
    const refused = await device.send(device.edit(unlogged, { code: "L-1", name: "Taken over" }), randomUUID());
    expect(refused.conflicts).toBe(1);
    expect((await admin`select data from board_records where id = ${unlogged}`)[0]!.data).toEqual({ code: "L-1" });
    expect(await admin`select reason from sync_conflicts where record_id = ${unlogged}`)
      .toEqual([{ reason: "not permitted to edit this record" }]);

    // The writer's own record takes a later edit; nothing others wrote reaches the device.
    await ok("POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, adminToken, { code: "A-2" });
    const again = await device.send(device.edit(own, { name: "Member's report, revised" }), randomUUID());
    expect(again.conflicts).toBe(0);
    expect((await admin`select data from board_records where id = ${own}`)[0]!.data)
      .toEqual({ code: "M-1", name: "Member's report, revised" });
    expect(device.heard).toEqual([]);
    const keys = [...device.doc.getMap("records").keys()];
    expect(keys.every((key) => [own, hidden, unlogged].some((id) => key.startsWith(`${id}/`)))).toBe(true);
    device.close();
    watcher.close();
  });
});

describe("late submissions", () => {
  it("keeps board work that reaches a closed incident for its administrators, who accept it after reopening", async () => {
    const incidentId = await incident("Late board work");
    const boardId = await board("significant_events", incidentId);
    const device = new Device(boardId, incidentId);
    await device.connect(memberToken);
    const recordId = randomUUID();
    const update = device.edit(recordId, {
      summary: "Culvert washed out", occurred_at: "2026-09-25T10:00:00Z", severity: "warning",
    });
    await ok("POST", `/api/v1/incidents/${incidentId}/close`, adminToken);
    const operationId = randomUUID();
    const queuedAt = "2026-09-25T10:05:00.000Z";
    const ack = await device.send(update, operationId, queuedAt);
    expect(ack).toMatchObject({ operationId, seq: 0, conflicts: 0, exact: true, late: expect.any(String) });
    expect(await admin`select id from board_records where id = ${recordId}`).toHaveLength(0);
    // A retry is answered by the same submission; another payload under the operation id is refused.
    expect(await device.send(update, operationId, queuedAt)).toEqual(ack);
    await expect(device.send(device.edit(recordId, { details: "changed" }), operationId)).rejects.toThrow(/conflict:/);
    device.close();

    const listed = (await ok("GET", `/api/v1/incidents/${incidentId}/late-submissions`, adminToken)).lateSubmissions as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: ack.late, kind: "board", status: "pending", summary: "1 record on Significant Events",
      submittedBy: { personId: seed.memberId, displayName: "Member" }, capturedAt: queuedAt,
      detail: { boardId, records: [{ id: recordId, fields: expect.arrayContaining([
        { key: "summary", label: "Summary", value: "Culvert washed out" }]) }] },
    });
    expect(await admin`select title from notifications where channel = 'late_submission' and person_id = ${seed.adminId}`)
      .toEqual([{ title: "Late submission for Late board work" }]);
    // The sender sees their own; another member sees none, and may not decide it.
    expect(((await ok("GET", `/api/v1/incidents/${incidentId}/late-submissions`, memberToken)).lateSubmissions as unknown[])).toHaveLength(1);
    expect(((await ok("GET", `/api/v1/incidents/${incidentId}/late-submissions`, otherToken)).lateSubmissions as unknown[])).toHaveLength(0);
    expect((await request("POST", `/api/v1/late-submissions/${ack.late}/accept`, memberToken)).statusCode).toBe(403);
    expect((await request("POST", `/api/v1/late-submissions/${ack.late}/refuse`, otherToken, { reason: "no" })).statusCode).toBe(404);

    const closed = await request("POST", `/api/v1/late-submissions/${ack.late}/accept`, adminToken);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe("the incident is closed; reopen it to accept late work");
    await ok("POST", `/api/v1/incidents/${incidentId}/reopen`, adminToken, { reason: "A late field report" });
    const accepted = await ok("POST", `/api/v1/late-submissions/${ack.late}/accept`, adminToken);
    expect(accepted).toMatchObject({ conflicts: 0, lateSubmission: { status: "accepted", decidedBy: { personId: seed.adminId } } });
    expect((await admin`select data, created_by from board_records where id = ${recordId}`)[0])
      .toMatchObject({ data: { summary: "Culvert washed out" }, created_by: seed.memberId });
    expect((await request("POST", `/api/v1/late-submissions/${ack.late}/accept`, adminToken)).statusCode).toBe(409);
    expect(await admin`select category from audit_events where subject_id = ${ack.late!} order by created_at`)
      .toEqual([{ category: "late_submission.received" }, { category: "late_submission.accepted" }]);

    // The device that never heard its answer now hears the applied operation.
    const retry = new Device(boardId, incidentId);
    await retry.connect(memberToken);
    const replay = await retry.send(update, operationId, queuedAt);
    expect(replay).toMatchObject({ operationId, conflicts: 0, exact: true });
    expect(replay.late).toBeUndefined();
    retry.close();
  });
});

describe("queued field operations", () => {
  it("run once, and reaching a closed incident become late submissions to accept or refuse", async () => {
    const incidentId = await incident("Field operations");
    const thread = await ok("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`, memberToken,
      { kind: "group", title: "Division B", incidentId, audience: "incident", members: [] });
    const threadId = thread.id as string;
    const [position] = await admin`
      insert into positions (jurisdiction_id, key, title) values (${seed.jurisdictionId}, 'field_lead', 'Field Lead')
      returning id`;
    const positionId = position!.id as string;
    await admin`insert into position_assignments (position_id, person_id, assigned_by)
      values (${positionId}, ${seed.adminId}, ${seed.adminId})`;
    await admin`insert into incident_positions (incident_id, position_id) values (${incidentId}, ${positionId})`;
    await ok("POST", `/api/v1/positions/${positionId}/sign-in`, adminToken);
    // A device keeps the time it queued an operation and sends it with every retry.
    const run = (token: string, operation: object) =>
      request("POST", `/api/v1/incidents/${incidentId}/field-operations`, token,
        { queuedAt: "2026-09-25T11:00:00.000Z", ...operation });

    const message = { kind: "message", operationId: randomUUID(), threadId, body: "Road open to Weitchpec" };
    const posted = await run(memberToken, message);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json()).toMatchObject({ outcome: "applied", kind: "message", messageId: expect.any(String) });
    expect((await run(memberToken, message)).json()).toEqual(posted.json());
    expect(await admin`select body from messages where thread_id = ${threadId}`).toEqual([{ body: "Road open to Weitchpec" }]);

    const task = { kind: "task", operationId: randomUUID(),
      task: { item: "Check the river gauge", category: "general", assignment: { kind: "position", positionId } } };
    expect((await run(memberToken, task)).statusCode).toBe(403);
    const created = (await run(adminToken, task)).json() as { outcome: string; task: { id: string } };
    expect(created.outcome).toBe("applied");
    expect(((await run(adminToken, task)).json() as { task: { id: string } }).task.id).toBe(created.task.id);
    const completion = { kind: "task_completion", operationId: randomUUID(), taskId: created.task.id };
    expect((await run(adminToken, completion)).json()).toMatchObject({
      outcome: "applied", completion: { taskId: created.task.id, status: "completed" },
    });

    const second = (await run(adminToken, { ...task, operationId: randomUUID(), task: { ...task.task, item: "Stage sandbags" } }))
      .json() as { task: { id: string; number: number } };
    await ok("POST", `/api/v1/incidents/${incidentId}/close`, adminToken);
    const lateMessage = (await run(memberToken, { ...message, operationId: randomUUID(), body: "Slide at mile 12" })).json();
    const lateTask = { ...task, operationId: randomUUID(), task: { ...task.task, item: "Reopen the shelter" } };
    const lateTaskReceipt = (await run(adminToken, lateTask)).json();
    const lateCompletion = { kind: "task_completion", operationId: randomUUID(), taskId: second.task.id };
    const lateCompletionReceipt = (await run(adminToken, lateCompletion)).json();
    for (const receipt of [lateMessage, lateTaskReceipt, lateCompletionReceipt])
      expect(receipt).toMatchObject({ outcome: "late", lateSubmissionId: expect.any(String) });
    expect((await run(memberToken, { ...task, operationId: randomUUID() })).statusCode).toBe(403);

    const listed = (await ok("GET", `/api/v1/incidents/${incidentId}/late-submissions`, adminToken)).lateSubmissions as Array<{ id: string; summary: string }>;
    expect(listed.map((item) => item.summary).sort()).toEqual([
      `Completion of TASK-${second.task.number} Stage sandbags`, "Message in Division B", "New task: Reopen the shelter",
    ]);

    const refused = await ok("POST", `/api/v1/late-submissions/${lateMessage.lateSubmissionId as string}/refuse`, adminToken,
      { reason: "Superseded by the demobilization brief" });
    expect(refused.lateSubmission).toMatchObject({ status: "refused", reason: "Superseded by the demobilization brief" });
    expect((await request("POST", `/api/v1/late-submissions/${lateMessage.lateSubmissionId as string}/accept`, adminToken)).statusCode).toBe(409);
    expect((await request("POST", `/api/v1/late-submissions/${lateMessage.lateSubmissionId as string}/refuse`, adminToken,
      { reason: "again" })).statusCode).toBe(409);

    await ok("POST", `/api/v1/incidents/${incidentId}/reopen`, adminToken, { reason: "Late work to accept" });
    await ok("POST", `/api/v1/late-submissions/${lateTaskReceipt.lateSubmissionId as string}/accept`, adminToken);
    expect(await admin`select item from checklist_items where incident_id = ${incidentId} order by number`)
      .toEqual(["Review overnight significant events", "Check the river gauge", "Stage sandbags", "Reopen the shelter"]
        .map((item) => ({ item })));
    await ok("POST", `/api/v1/late-submissions/${lateCompletionReceipt.lateSubmissionId as string}/accept`, adminToken);
    expect((await admin`select status, completed_by from checklist_items where id = ${second.task.id}`)[0])
      .toEqual({ status: "completed", completed_by: seed.adminId });
    // A retry after acceptance hears the applied receipt, not the late one.
    expect((await run(adminToken, lateTask)).json()).toMatchObject({ outcome: "applied", task: { item: "Reopen the shelter" } });
    expect(await admin`select body from messages where thread_id = ${threadId}`).toEqual([{ body: "Road open to Weitchpec" }]);
  });
});
