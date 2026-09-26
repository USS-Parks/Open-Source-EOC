import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardActionRun } from "@openeoc/shared";
import { principalForPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { BoardSyncHub, FEDERATION_ORIGIN } from "../sync/hub.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";

/**
 * Board actions set off through the sync hub (VC-17, AG-07), against a real
 * database: a record created or changed by a device, live or from its offline
 * queue, runs its board's actions as a REST write does, as the person whose
 * update it is. The actions' writes reach the row, every connected device of
 * the board, a later open and a fresh hydrate, after the update that set them
 * off; and they set nothing off again, in their chain, when a device sends
 * them back, or when a queued operation is replayed.
 */

interface Ack {
  readonly type: "synced";
  readonly operationId: string | null;
  readonly seq: number;
  readonly conflicts: number;
  readonly exact: boolean;
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let host: string;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let incidentId: string;
let reports: string;
let followUps: string;

const reportsTemplate = {
  key: "sync_reports",
  version: 1,
  title: "Sync reports",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["new", "confirmed"] },
    { key: "intake", label: "Intake", type: "text" },
    { key: "stamp", label: "Stamp", type: "text" },
    { key: "note", label: "Note", type: "text" },
    { key: "note_seen", label: "Note seen", type: "text" },
    { key: "flag", label: "Flag", type: "text" },
  ],
  views: [{ key: "all", title: "All", columns: ["summary"] }],
  actions: [
    { key: "log_intake", label: "Log the intake", trigger: { kind: "record_created" },
      step: { kind: "set_field", field: "intake", value: "logged" } },
    { key: "stamp", label: "Stamp the confirmation", trigger: { kind: "field_changed", field: "status" },
      condition: { conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
      step: { kind: "set_field", field: "stamp", value: "confirmed" } },
    { key: "follow_up", label: "Open a follow-up", trigger: { kind: "field_changed", field: "status" },
      condition: { conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
      step: { kind: "create_record", board: "sync_follow_ups", link: "report", mapping: [{ to: "task", from: "summary" }] } },
    { key: "see_note", label: "See the note", trigger: { kind: "field_changed", field: "note" },
      step: { kind: "set_field", field: "note_seen", value: "yes" } },
    // Sets the field that sets it off.
    { key: "mark", label: "Mark the flag", trigger: { kind: "field_changed", field: "flag" },
      step: { kind: "set_field", field: "flag", value: "marked" } },
  ],
};

const followUpsTemplate = {
  key: "sync_follow_ups",
  version: 1,
  title: "Sync follow-ups",
  fields: [
    { key: "task", label: "Task", type: "text" },
    { key: "done", label: "Done", type: "boolean" },
    { key: "report", label: "Report", type: "record_ref", targetBoardKey: "sync_reports", labelField: "summary" },
  ],
  views: [{ key: "all", title: "All", columns: ["task"] }],
  actions: [
    { key: "start_open", label: "Start open", trigger: { kind: "record_created" },
      step: { kind: "set_field", field: "done", value: false } },
  ],
};

async function call(method: "GET" | "POST", url: string, token: string, payload?: object) {
  const response = await app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}
const dataOf = async (id: string) => (await admin`select data from board_records where id = ${id}`)[0]!.data as Record<string, unknown>;
const runsOf = async (recordId: string) => (await admin`
  select person_id, payload from audit_events
  where category = 'board.action.run' and subject_id = ${recordId} order by seq`)
  .map((row) => {
    const run = row.payload as BoardActionRun;
    return [run.action.key, run.outcome, run.depth, row.person_id as string];
  });
const allRuns = async () => Number((await admin`
  select count(*) as n from audit_events where category = 'board.action.run'`)[0]!.n);
const followUpsOf = async (reportId: string) => admin`
  select id, data from board_records where board_id = ${followUps} and data->>'report' = ${reportId}`;

/** A scope's document as the log alone rebuilds it, with no row seeded in. */
async function logRecords(boardId: string, scope: string | null): Promise<Y.Map<unknown>> {
  const doc = new Y.Doc();
  for (const row of await admin`
    select update_data from sync_updates
    where board_id = ${boardId} and (${scope}::uuid is null or incident_id = ${scope}) order by seq`) {
    Y.applyUpdate(doc, new Uint8Array(row.update_data as Buffer));
  }
  return doc.getMap("records");
}

/** A device on the sync socket: it keeps what it is served and merges what it hears. */
class Device {
  readonly doc = new Y.Doc();
  readonly heard: Uint8Array[] = [];
  private socket: WebSocket | null = null;
  private waiting: { resolve: (ack: Ack) => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly boardId: string, private readonly incident: string | null) {}

  async connect(token: string): Promise<void> {
    const scope = this.incident ? `?incidentId=${this.incident}` : "";
    const socket = new WebSocket(`ws://${host}/api/v1/sync/boards/${this.boardId}${scope}`);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as { type: string; update?: string; code?: string; error?: string };
        const bytes = () => new Uint8Array(Buffer.from(message.update!, "base64"));
        if (message.type === "state") {
          Y.applyUpdate(this.doc, bytes());
          resolve();
        } else if (message.type === "update") {
          this.heard.push(bytes());
          Y.applyUpdate(this.doc, bytes());
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

  value(recordId: string, field: string): unknown {
    return this.doc.getMap<unknown>("records").get(`${recordId}/${field}`);
  }

  /** Edit the document and return all of it, as the field client queues an operation. */
  edit(recordId: string, fields: Record<string, unknown>): Uint8Array {
    const records = this.doc.getMap<unknown>("records");
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(fields)) records.set(`${recordId}/${key}`, value);
    });
    return Y.encodeStateAsUpdate(this.doc);
  }

  send(update: Uint8Array, operationId?: string, queuedAt?: string): Promise<Ack> {
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.socket!.send(JSON.stringify({
        type: "update", update: Buffer.from(update).toString("base64"),
        ...(this.incident ? { operationId: operationId ?? randomUUID(), incidentId: this.incident } : {}),
        ...(queuedAt ? { queuedAt } : {}),
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
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  for (const template of [reportsTemplate, followUpsTemplate]) await call("POST", "/api/v1/templates", adminToken, template);
  const board = async (templateKey: string) =>
    (await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken, { templateKey })).id as string;
  reports = await board("sync_reports");
  followUps = await board("sync_follow_ups");
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${seed.jurisdictionId}, 'daily_ops', 'Sync actions', 'incident', ${seed.adminId}) returning id`;
  incidentId = incident!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${reports}), (${incidentId}, ${followUps})`;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("board actions through the sync hub", () => {
  let reporter: Device;
  let watcher: Device;

  beforeAll(async () => {
    reporter = new Device(reports, incidentId);
    await reporter.connect(memberToken);
    watcher = new Device(reports, incidentId);
    await watcher.connect(adminToken);
  });

  afterAll(() => {
    reporter.close();
    watcher.close();
  });

  it("gives a record created through sync the field its action sets, in its row, the document and every device", async () => {
    const id = randomUUID();
    const heard = watcher.heard.length;
    expect(await reporter.send(reporter.edit(id, { summary: "Tree down", status: "new" })))
      .toMatchObject({ conflicts: 0, exact: true });
    expect(await dataOf(id)).toEqual({ summary: "Tree down", status: "new", intake: "logged" });
    expect(await runsOf(id)).toEqual([["log_intake", "done", 1, seed.memberId]]);

    // The other device hears the edit, then the action's write.
    await expect.poll(() => watcher.heard.length).toBe(heard + 2);
    const edit = new Y.Doc();
    Y.applyUpdate(edit, watcher.heard[heard]!);
    expect(edit.getMap("records").get(`${id}/summary`)).toBe("Tree down");
    expect(edit.getMap("records").has(`${id}/intake`)).toBe(false);
    expect(watcher.value(id, "intake")).toBe("logged");
    // So does the device that sent the edit, which holds only its own change.
    await expect.poll(() => reporter.value(id, "intake")).toBe("logged");

    // The log holds it, so a fresh hydrate does, and so does a later open.
    expect((await logRecords(reports, incidentId)).get(`${id}/intake`)).toBe("logged");
    const fresh = new BoardSyncHub(runtime);
    try {
      const opened = new Y.Doc();
      Y.applyUpdate(opened, (await fresh.open(await principalForPerson(runtime, seed.memberId), reports, incidentId)).state);
      expect(opened.getMap("records").get(`${id}/intake`)).toBe("logged");
    } finally {
      fresh.close();
    }
    const later = new Device(reports, incidentId);
    await later.connect(adminToken);
    expect(later.value(id, "intake")).toBe("logged");
    later.close();
  });

  it("runs the actions of the fields a sync edit changes and sends their linked record to the other board", async () => {
    const id = randomUUID();
    await reporter.send(reporter.edit(id, { summary: "Road washed out", status: "new", stamp: "not yet", note: "north lane" }));
    const followWatcher = new Device(followUps, incidentId);
    await followWatcher.connect(adminToken);

    // The device sends its whole document; only the status changed.
    expect((await reporter.send(reporter.edit(id, { status: "confirmed" }))).conflicts).toBe(0);
    expect(await dataOf(id)).toEqual({ summary: "Road washed out", status: "confirmed", stamp: "confirmed",
      note: "north lane", intake: "logged" });
    const [linked] = await followUpsOf(id);
    expect(linked!.data).toEqual({ report: id, task: "Road washed out", done: false });
    const linkedId = linked!.id as string;
    expect(await runsOf(id)).toEqual([
      ["log_intake", "done", 1, seed.memberId],
      ["stamp", "done", 1, seed.memberId],
      ["follow_up", "done", 1, seed.memberId],
    ]);
    // The linked record's own action ran one step deeper in the same chain.
    expect(await runsOf(linkedId)).toEqual([["start_open", "done", 2, seed.memberId]]);

    await expect.poll(() => watcher.value(id, "stamp")).toBe("confirmed");
    await expect.poll(() => reporter.value(id, "stamp")).toBe("confirmed");
    await expect.poll(() => followWatcher.value(linkedId, "done")).toBe(false);
    expect(followWatcher.value(linkedId, "task")).toBe("Road washed out");
    expect(followWatcher.value(linkedId, "report")).toBe(id);
    followWatcher.close();

    // The warm document holds the action's value over the one it replaced.
    const later = new Device(reports, incidentId);
    await later.connect(adminToken);
    expect(later.value(id, "stamp")).toBe("confirmed");
    later.close();
    expect((await logRecords(reports, incidentId)).get(`${id}/stamp`)).toBe("confirmed");
  });

  it("sets nothing off again with an action's own write, in its chain or sent back by a device", async () => {
    const id = randomUUID();
    await reporter.send(reporter.edit(id, { summary: "Flagged" }));
    await reporter.send(reporter.edit(id, { flag: "raised" }));
    expect((await dataOf(id)).flag).toBe("marked");
    expect(await runsOf(id)).toEqual([
      ["log_intake", "done", 1, seed.memberId],
      ["mark", "done", 1, seed.memberId],
      ["mark", "stopped", 2, seed.memberId],
    ]);
    await expect.poll(() => reporter.value(id, "flag")).toBe("marked");
    await expect.poll(() => watcher.value(id, "flag")).toBe("marked");

    // Both devices now hold every action's write and send their whole
    // documents back, as a queued operation does: nothing runs again.
    const runs = await allRuns();
    for (const device of [reporter, watcher]) {
      expect((await device.send(Y.encodeStateAsUpdate(device.doc))).conflicts).toBe(0);
    }
    expect(await allRuns()).toBe(runs);
    expect((await dataOf(id)).flag).toBe("marked");

    // A later edit carries the actions' writes and sets off only its own field's action.
    await watcher.send(watcher.edit(id, { note: "checked" }));
    expect(await runsOf(id)).toEqual([
      ["log_intake", "done", 1, seed.memberId],
      ["mark", "done", 1, seed.memberId],
      ["mark", "stopped", 2, seed.memberId],
      ["see_note", "done", 1, seed.adminId],
    ]);
    expect(await allRuns()).toBe(runs + 1);
  });

  it("runs an offline edit's actions once however often its queued operation is sent", async () => {
    const id = randomUUID();
    await reporter.send(reporter.edit(id, { summary: "Bridge closed", status: "new" }));
    reporter.close();

    // Made with no connection: the queue keeps one update under one operation id.
    const update = reporter.edit(id, { status: "confirmed" });
    const operationId = randomUUID();
    const queuedAt = new Date(Date.now() - 60_000).toISOString();
    await reporter.connect(memberToken);
    const first = await reporter.send(update, operationId, queuedAt);
    expect(first).toMatchObject({ operationId, conflicts: 0, exact: true });
    // Its answer was lost: the device sends it again, then again after reconnecting.
    expect(await reporter.send(update, operationId, queuedAt)).toEqual(first);
    reporter.close();
    await reporter.connect(memberToken);
    expect(await reporter.send(update, operationId, queuedAt)).toEqual(first);

    expect((await dataOf(id)).stamp).toBe("confirmed");
    expect(await followUpsOf(id)).toHaveLength(1);
    expect(await runsOf(id)).toEqual([
      ["log_intake", "done", 1, seed.memberId],
      ["stamp", "done", 1, seed.memberId],
      ["follow_up", "done", 1, seed.memberId],
    ]);
  });
});

describe("board actions through a jurisdiction-wide document", () => {
  it("runs them for a live edit and not for a federation peer's update", async () => {
    const wide = (await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken,
      { templateKey: "sync_reports" })).id as string;
    const editor = new Device(wide, null);
    await editor.connect(memberToken);
    const watcher = new Device(wide, null);
    await watcher.connect(adminToken);

    const id = randomUUID();
    expect((await editor.send(editor.edit(id, { summary: "Shelter opened" }))).conflicts).toBe(0);
    expect(await dataOf(id)).toEqual({ summary: "Shelter opened", intake: "logged" });
    expect(await runsOf(id)).toEqual([["log_intake", "done", 1, seed.memberId]]);
    await expect.poll(() => watcher.value(id, "intake")).toBe("logged");
    await expect.poll(() => editor.value(id, "intake")).toBe("logged");
    expect((await logRecords(wide, null)).get(`${id}/intake`)).toBe("logged");
    editor.close();
    watcher.close();

    // A peer's actions ran where the record was written; their writes come as updates of their own.
    const peer = new Y.Doc();
    const received = randomUUID();
    peer.getMap<unknown>("records").set(`${received}/summary`, "From the peer");
    const hub = new BoardSyncHub(runtime);
    try {
      await hub.apply(await principalForPerson(runtime, seed.adminId), wide, Y.encodeStateAsUpdate(peer),
        `${FEDERATION_ORIGIN}${randomUUID()}`);
    } finally {
      hub.close();
    }
    expect(await dataOf(received)).toEqual({ summary: "From the peer" });
    expect(await runsOf(received)).toEqual([]);
  });
});
