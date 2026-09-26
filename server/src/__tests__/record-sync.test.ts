import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson } from "../auth/service.js";
import { appendRecordWrite } from "../boards/record-sync.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { withPerson } from "../db/context.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { BoardSyncHub } from "../sync/hub.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * Records written over REST reach the board sync log. Before this, a console
 * create, patch or import changed board rows only: a live sync socket did not
 * hear it until it reconnected, a rebuilt document kept the old values of
 * logged records, and a sharing agreement never forwarded it. Two instances,
 * a county and a state, share one board in both directions.
 */

const TEMPLATE = {
  key: "relay_log", version: 1, title: "Relay log",
  fields: [
    { key: "entry", label: "Entry", type: "text", required: true },
    { key: "notable", label: "Notable", type: "boolean" },
    { key: "secret", label: "Secret", type: "text", read: "admin", write: "admin" },
  ],
  views: [{ key: "all", title: "All", columns: ["entry", "notable"] }],
};

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  host: string;
  jurisdictionId: string;
  adminId: string;
  adminToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let priorKey: string | undefined;

async function standUp(): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`insert into board_templates (key, version, title, definition)
    values (${TEMPLATE.key}, 1, ${TEMPLATE.title}, ${admin.json(TEMPLATE)})`;
  const app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const host = `127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const inst = { admin, runtime, app, host, jurisdictionId: seed.jurisdictionId, adminId: seed.adminId, adminToken };
  return { ...inst, boardId: await newBoard(inst) };
}

async function newBoard(inst: Omit<Instance, "boardId">): Promise<string> {
  const res = await inst.app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${inst.jurisdictionId}/boards`,
    headers: auth(inst.adminToken),
    payload: { templateKey: TEMPLATE.key },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function rest(inst: Instance, method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) {
  const res = await inst.app.inject({ method, url, headers: auth(inst.adminToken), ...(payload ? { payload } : {}) });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res;
}

const create = async (inst: Instance, data: object, boardId = inst.boardId, query = ""): Promise<string> =>
  (await rest(inst, "POST", `/api/v1/boards/${boardId}/records${query}`, data)).json().id as string;

const patch = async (inst: Instance, recordId: string, data: object, boardId = inst.boardId): Promise<void> => {
  await rest(inst, "PATCH", `/api/v1/boards/${boardId}/records/${recordId}`, data);
};

/** Push each instance's federation outbox to the other. */
const drain = async (inst: Instance): Promise<number> =>
  (await new DeliveryWorker(inst.runtime, { baseDelayMs: 0 }).drain()).federated;

const pending = async (inst: Instance): Promise<number> =>
  (await inst.admin`select count(*)::int as count from federation_outbox where delivered_at is null`)[0]!.count as number;

async function row(inst: Instance, recordId: string): Promise<Record<string, unknown> | undefined> {
  const [found] = await inst.admin`select data from board_records where id = ${recordId}`;
  return found?.data as Record<string, unknown> | undefined;
}

async function rows(inst: Instance, boardId: string): Promise<Record<string, Record<string, unknown>>> {
  const found = await inst.admin`
    select id, data from board_records where board_id = ${boardId} and deleted_at is null`;
  return Object.fromEntries(found.map((r) => [r.id as string, r.data as Record<string, unknown>]));
}

function records(doc: Y.Doc): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of doc.getMap<unknown>("records").entries()) {
    const slash = key.indexOf("/");
    (out[key.slice(0, slash)] ??= {})[key.slice(slash + 1)] = value;
  }
  return out;
}

/** The board-wide document a fresh hub rebuilds from the log and the table. */
async function rebuilt(inst: Instance, boardId = inst.boardId, snapshotThreshold?: number) {
  const hub = new BoardSyncHub(inst.runtime, snapshotThreshold ? { snapshotThreshold } : {});
  try {
    const actor = await principalForPerson(inst.runtime, inst.adminId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await hub.open(actor, boardId)).state);
    return records(doc);
  } finally {
    hub.close();
  }
}

/** A field device holding a live sync socket. */
class LiveClient {
  readonly doc = new Y.Doc();
  private socket: WebSocket | null = null;
  private acked: (() => void) | null = null;

  constructor(private readonly inst: Instance, private readonly incidentId?: string) {}

  async connect(): Promise<void> {
    const query = this.incidentId ? `?incidentId=${this.incidentId}` : "";
    const socket = new WebSocket(`ws://${this.inst.host}/api/v1/sync/boards/${this.inst.boardId}${query}`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token: this.inst.adminToken })));
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString()) as { type: string; update?: string; error?: string };
        if (msg.type === "state" || msg.type === "update") {
          Y.applyUpdate(this.doc, new Uint8Array(Buffer.from(msg.update!, "base64")));
          if (msg.type === "state") resolve();
        } else if (msg.type === "synced") {
          this.acked?.();
        } else if (msg.type === "error") {
          reject(new Error(msg.error));
        }
      });
    });
  }

  record(recordId: string): Record<string, unknown> {
    return records(this.doc)[recordId] ?? {};
  }

  /** Wait for pushed updates; never reconnects. */
  async until(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("the live socket never received the write");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Edit locally and send only that edit, as a field client does. */
  async set(recordId: string, fields: Record<string, unknown>): Promise<void> {
    let update: Uint8Array | null = null;
    const capture = (u: Uint8Array) => { update = u; };
    this.doc.on("update", capture);
    const map = this.doc.getMap<unknown>("records");
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(fields)) map.set(`${recordId}/${key}`, value);
    });
    this.doc.off("update", capture);
    await new Promise<void>((resolve) => {
      this.acked = resolve;
      this.socket!.send(JSON.stringify({ type: "update", update: Buffer.from(update!).toString("base64") }));
    });
  }

  close(): void {
    this.socket?.close();
  }
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-record-sync-key";
  county = await standUp();
  state = await standUp();
  // One peer record per partner on each side carries both directions: its
  // token admits the partner's pushes, its link sends this side's outbox.
  const register = async (inst: Instance, name: string) => (await rest(inst, "POST",
    `/api/v1/jurisdictions/${inst.jurisdictionId}/peers`, { name })).json() as { id: string; token: string };
  const stateAtCounty = await register(county, "state");
  const countyAtState = await register(state, "county");
  await rest(county, "POST", `/api/v1/peers/${stateAtCounty.id}/agreements`,
    { boardId: county.boardId, canRead: true, canWrite: true, remoteBoardId: state.boardId });
  await rest(state, "POST", `/api/v1/peers/${countyAtState.id}/agreements`,
    { boardId: state.boardId, canRead: true, canWrite: true, remoteBoardId: county.boardId });
  // Each records the public key the other shows, and so accepts its signed pushes.
  const recordKey = async (inst: Instance, peerId: string, partner: Instance) => {
    const shown = await partner.app.inject({ method: "GET",
      url: `/api/v1/jurisdictions/${partner.jurisdictionId}/federation`, headers: auth(partner.adminToken) });
    await rest(inst, "PUT", `/api/v1/peers/${peerId}/key`, { publicKey: shown.json().identity.publicKey as string });
  };
  await recordKey(county, stateAtCounty.id, state);
  await recordKey(state, countyAtState.id, county);
  const link = (inst: Instance, peerId: string, partner: Instance, token: string) => rest(inst, "PUT",
    `/api/v1/peers/${peerId}/link`, { endpointUrl: `http://${partner.host}`, token });
  await link(county, stateAtCounty.id, state, countyAtState.token);
  await link(state, countyAtState.id, county, stateAtCounty.token);
}, 180_000);

afterAll(async () => {
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
});

describe("REST record writes in the sync log", () => {
  it("reach a live socket without a reconnect, and a rebuilt document matches the rows", async () => {
    // A record that predates this path: in the table, never in the log.
    const older = randomUUID();
    await county.admin`insert into board_records (id, board_id, data, created_by)
      values (${older}, ${county.boardId}, ${county.admin.json({ entry: "older entry", notable: false })},
              ${county.adminId})`;
    const live = new LiveClient(county);
    await live.connect();
    expect(live.record(older)).toEqual({ entry: "older entry", notable: false });

    const id = await create(county, { entry: "levee watch" });
    await live.until(() => live.record(id).entry === "levee watch");
    // The patch follows the create within the same second and still wins.
    await patch(county, id, { entry: "levee overtopping", notable: true });
    await patch(county, older, { notable: true });
    await live.until(() => live.record(id).entry === "levee overtopping" && live.record(older).notable === true);
    expect(live.record(id)).toEqual({ entry: "levee overtopping", notable: true });
    expect(live.record(older)).toEqual({ entry: "older entry", notable: true });

    const logged = async () => (await county.admin`select count(*)::int as count from sync_updates
      where board_id = ${county.boardId}`)[0]!.count as number;
    expect(await logged()).toBe(3);
    // A sync edit is logged once; the checkpoint it drives adds no update of its own.
    await live.set(id, { notable: false });
    expect(await logged()).toBe(4);
    expect(await row(county, id)).toEqual({ entry: "levee overtopping", notable: false });
    live.close();

    expect(await rebuilt(county)).toEqual(await rows(county, county.boardId));
  });

  it("logs an incident record's member-readable fields under its incident, the rest board-wide, never federated", async () => {
    const incidentId = (await rest(county, "POST", `/api/v1/jurisdictions/${county.jurisdictionId}/incidents`,
      { templateKey: "daily_ops", name: "Relay incident" })).json().incidentId as string;
    await county.admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${county.boardId})`;
    const scoped = new LiveClient(county, incidentId);
    await scoped.connect();
    const boardWide = new LiveClient(county);
    await boardWide.connect();
    const queued = await pending(county);

    const id = await create(county, { entry: "incident note", secret: "admins only" },
      county.boardId, `?incidentId=${incidentId}`);
    await patch(county, id, { secret: "still admins only" });
    await boardWide.until(() => boardWide.record(id).secret === "still admins only");
    await scoped.until(() => scoped.record(id).entry === "incident note");
    expect(scoped.record(id)).toEqual({ entry: "incident note" });
    expect(boardWide.record(id)).toEqual({ entry: "incident note", secret: "still admins only" });

    // The incident's log holds what its members read; the rest is board-wide only.
    // An incident record's updates continue their writer's clock, so each
    // scope's document is built from its whole log, as every copy is.
    const logged = await county.admin`
      select incident_id, operation_id, update_data from sync_updates
      where board_id = ${county.boardId} order by seq`;
    const scopes = new Map<string, Y.Doc>();
    const written = logged.map((entry) => {
      const scope = (entry.incident_id as string | null) ?? "board";
      if (!scopes.has(scope)) scopes.set(scope, new Y.Doc());
      const doc = scopes.get(scope)!;
      Y.applyUpdate(doc, new Uint8Array(entry.update_data as Buffer));
      return { incidentId: entry.incident_id, receipt: entry.operation_id !== null, data: { ...records(doc)[id] } };
    }).slice(-3);
    expect(written).toEqual([
      { incidentId, receipt: true, data: { entry: "incident note" } },
      { incidentId: null, receipt: false, data: { secret: "admins only" } },
      { incidentId: null, receipt: false, data: { secret: "still admins only" } },
    ]);
    expect(await pending(county)).toBe(queued);
    expect((await rebuilt(county))[id]).toEqual(await row(county, id));
    scoped.close();
    boardWide.close();
  });

  it("writes an incident record's REST edits from one writer, and a write that rolled back strands none after it", async () => {
    const incidentId = (await rest(county, "POST", `/api/v1/jurisdictions/${county.jurisdictionId}/incidents`,
      { templateKey: "daily_ops", name: "Writer incident" })).json().incidentId as string;
    await county.admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${county.boardId})`;
    const id = await create(county, { entry: "writer 0" }, county.boardId, `?incidentId=${incidentId}`);
    for (let i = 1; i <= 20; i += 1) await patch(county, id, { entry: `writer ${i}` });
    // A write inside a transaction that rolls back takes its writer with it.
    await expect(withPerson(county.runtime, county.adminId, async (tx) => {
      await appendRecordWrite(tx, county.boardId, id, incidentId, { entry: "rolled back" }, new Set(["entry"]));
      throw new Error("roll back");
    })).rejects.toThrow("roll back");
    await patch(county, id, { entry: "after the rollback" });

    const logged = await county.admin`
      select update_data from sync_updates where board_id = ${county.boardId} and incident_id = ${incidentId} order by seq`;
    const doc = new Y.Doc();
    for (const entry of logged) Y.applyUpdate(doc, new Uint8Array(entry.update_data as Buffer));
    expect(doc.store.pendingStructs).toBeNull();
    expect(records(doc)[id]).toEqual({ entry: "after the rollback" });
    // Twenty-two writes: one writer before the rollback, a new one after it.
    expect(Y.decodeStateVector(Y.encodeStateVector(doc)).size).toBe(2);
    expect((await rebuilt(county))[id]).toMatchObject({ entry: "after the rollback" });
  });

  it("shows imported rows on a live socket", async () => {
    const live = new LiveClient(county);
    await live.connect();
    const body = await multipartUpload({}, "Entry,Notable\r\nimported one,true\r\nimported two,false\r\n", "text/csv");
    const res = await county.app.inject({
      method: "POST",
      url: `/api/v1/boards/${county.boardId}/import`,
      headers: { ...auth(county.adminToken), ...body.headers },
      payload: body.payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    const entries = () => Object.values(records(live.doc)).map((r) => r.entry);
    await live.until(() => entries().includes("imported one") && entries().includes("imported two"));
    live.close();
  });

  it("still removes a deleted record, its REST edits included, from live and rebuilt documents", async () => {
    const live = new LiveClient(county);
    await live.connect();
    const id = await create(county, { entry: "to be withdrawn" });
    await patch(county, id, { notable: true });
    await live.until(() => live.record(id).notable === true);
    await rest(county, "DELETE", `/api/v1/boards/${county.boardId}/records/${id}`);
    await live.until(() => Object.keys(live.record(id)).length === 0);
    expect((await rebuilt(county))[id]).toBeUndefined();
    live.close();
  });

  it("compacts a log grown only by REST writes and rebuilds the same document from the snapshot", async () => {
    const boardId = await newBoard(county);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await create(county, { entry: `bulk ${i}` }, boardId));
    for (const id of ids) await patch(county, id, { notable: true }, boardId);
    expect(await rebuilt(county, boardId, 5)).toEqual(await rows(county, boardId));
    const [snapshot] = await county.admin`
      select through_seq from sync_snapshots where board_id = ${boardId} and incident_id is null`;
    const [last] = await county.admin`select max(seq) as seq from sync_updates where board_id = ${boardId}`;
    expect(Number(snapshot!.through_seq)).toBe(Number(last!.seq));
    await patch(county, ids[0]!, { entry: "after the snapshot" }, boardId);
    expect(await rebuilt(county, boardId, 5)).toEqual(await rows(county, boardId));
  });
});

describe("REST record writes across federation", () => {
  it("forward to a peer, which applies them and sends nothing back", async () => {
    const id = await create(county, { entry: "bridge closed" });
    await patch(county, id, { notable: true });
    expect(await drain(county)).toBeGreaterThan(0);
    expect(await row(state, id)).toEqual({ entry: "bridge closed", notable: true });
    // What arrived from the county is not queued back to it.
    expect(await pending(state)).toBe(0);
  });

  it("settle a concurrent console write and field edit to one value on both instances", async () => {
    const id = await create(county, { entry: "road open" });
    await drain(county);
    const field = new LiveClient(state);
    await field.connect();
    expect(field.record(id).entry).toBe("road open");

    // The county console changes the entry while a state field device, not
    // having seen that change, changes it too.
    await patch(county, id, { entry: "road closed by console" });
    await field.set(id, { entry: "road washed out" });
    expect((await row(state, id))!.entry).toBe("road washed out");
    await drain(county);
    await drain(state);

    // The rule: a REST write wins over every edit made without seeing it.
    for (const inst of [county, state]) expect((await row(inst, id))!.entry).toBe("road closed by console");
    await field.until(() => field.record(id).entry === "road closed by console");

    // An edit made after seeing the console's value wins over it.
    await field.set(id, { entry: "road reopened" });
    await drain(state);
    for (const inst of [county, state]) {
      expect((await row(inst, id))!.entry).toBe("road reopened");
      expect((await rebuilt(inst))[id]).toEqual(await row(inst, id));
    }
    field.close();
  });
});
