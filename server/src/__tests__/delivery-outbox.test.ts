import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The outbound delivery queue. A board write queues its webhooks inside its
 * own transaction and returns; the worker delivers, retries with backoff,
 * dead-letters, and opens a circuit on a target that keeps failing. The same
 * worker pushes the federation outbox to a linked peer.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  baseUrl: string;
  jurisdictionId: string;
  adminToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let receiver: FastifyInstance;
let receiverUrl: string;
let release: () => void = () => {};
const held = new Promise<void>((resolve) => {
  release = resolve;
});
let hits = 0;
let priorKey: string | undefined;

async function standUp(): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "activity_log" },
  });
  return {
    admin,
    runtime,
    app,
    baseUrl,
    jurisdictionId: seed.jurisdictionId,
    adminToken,
    boardId: board.json().id as string,
  };
}

async function rule(inst: Instance, url: string): Promise<void> {
  const res = await inst.app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${inst.jurisdictionId}/notification-rules`,
    headers: auth(inst.adminToken),
    payload: { boardId: inst.boardId, event: "record.created", channels: [{ kind: "webhook", url }] },
  });
  expect(res.statusCode).toBe(201);
}

async function write(inst: Instance, entry: string): Promise<number> {
  const started = performance.now();
  const res = await inst.app.inject({
    method: "POST",
    url: `/api/v1/boards/${inst.boardId}/records`,
    headers: auth(inst.adminToken),
    payload: { entry },
  });
  expect(res.statusCode).toBe(201);
  return performance.now() - started;
}

async function clearRules(inst: Instance): Promise<void> {
  await inst.admin`update notification_rules set enabled = false`;
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-delivery-key";
  county = await standUp();
  state = await standUp();
  receiver = Fastify({ logger: false });
  receiver.post("/slow", async () => {
    await held;
    return "late";
  });
  receiver.post("/fail", async (_req, reply) => {
    hits += 1;
    return reply.status(500).send("down");
  });
  await receiver.listen({ port: 0, host: "127.0.0.1" });
  const addr = receiver.server.address();
  receiverUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const allow = await county.app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${county.jurisdictionId}/notification-allowlist`,
    headers: auth(county.adminToken),
    payload: { entries: [receiverUrl] },
  });
  expect(allow.statusCode).toBe(200);
}, 60000);

afterAll(async () => {
  release();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  await receiver?.close();
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
});

describe("board writes never wait on a delivery target", () => {
  it("a target that sleeps 30 seconds does not change write latency", async () => {
    const baseline = await write(county, "before any rule");
    await rule(county, `${receiverUrl}/slow`);
    const withSlowTarget = await write(county, "with a sleeping webhook");
    // The write returns before the target is ever contacted.
    expect(withSlowTarget).toBeLessThan(Math.max(1500, baseline * 5));
    const [queued] = await county.admin`
      select d.status, d.attempts, n.status as notification
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(queued).toMatchObject({ status: "pending", attempts: 0, notification: "pending" });

    // The worker gives up on the slow target at its timeout and schedules a retry.
    const worker = new DeliveryWorker(county.runtime, { timeoutMs: 200 });
    const pass = await worker.drain();
    expect(pass.retried).toBe(1);
    const [after] = await county.admin`
      select status, attempts, last_error, next_attempt_at > now() as later from delivery_outbox`;
    expect(after).toMatchObject({ status: "pending", attempts: 1, later: true });
    expect(after!.last_error).toBeTruthy();
    await clearRules(county);
    await county.admin`delete from delivery_outbox`;
  });
});

describe("retry, dead letter and circuit breaker", () => {
  it("retries a failing target, then dead-letters it and fails the notification", async () => {
    await rule(county, `${receiverUrl}/fail`);
    await write(county, "to a failing target");
    const worker = new DeliveryWorker(county.runtime, { maxAttempts: 2, baseDelayMs: 0 });
    expect((await worker.drain()).retried).toBe(1);
    expect((await worker.drain()).dead).toBe(1);
    const [row] = await county.admin`
      select d.status, d.attempts, n.status as notification, n.detail ->> 'error' as error
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(row).toMatchObject({ status: "dead", attempts: 2, notification: "failed" });
    expect(row!.error).toContain("500");
    // A dead delivery is never claimed again.
    expect((await worker.drain()).dead).toBe(0);
    await clearRules(county);
    await county.admin`delete from delivery_outbox`;
  });

  it("opens a circuit on a target that keeps failing and defers without spending attempts", async () => {
    await rule(county, `${receiverUrl}/fail`);
    await write(county, "one");
    await write(county, "two");
    await write(county, "three");
    hits = 0;
    const worker = new DeliveryWorker(county.runtime, {
      batch: 2,
      baseDelayMs: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 60_000,
    });
    expect((await worker.drain()).retried).toBe(2);
    expect(hits).toBe(2);
    // The circuit is open: nothing reaches the target, and attempts are refunded.
    const pass = await worker.drain();
    expect(pass.deferred).toBe(2);
    expect(hits).toBe(2);
    const rows = await county.admin`
      select attempts, next_attempt_at > now() + interval '30 seconds' as cooled
      from delivery_outbox order by created_at`;
    expect(rows.every((r) => r.cooled === true || Number(r.attempts) <= 1)).toBe(true);
    expect(rows.filter((r) => r.cooled === true).length).toBeGreaterThanOrEqual(2);
    await clearRules(county);
    await county.admin`delete from delivery_outbox`;
  });
});

describe("the worker pushes the federation outbox to a linked peer", () => {
  it("holds entries through a partition and delivers them when the link returns", async () => {
    // Each side registers the other; the state's token lets the county push in.
    const intoState = await state.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${state.jurisdictionId}/peers`,
      headers: auth(state.adminToken),
      payload: { name: "county" },
    });
    await state.app.inject({
      method: "POST",
      url: `/api/v1/peers/${intoState.json().id as string}/agreements`,
      headers: auth(state.adminToken),
      payload: { boardId: state.boardId, canRead: true, canWrite: true },
    });
    const peer = await county.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${county.jurisdictionId}/peers`,
      headers: auth(county.adminToken),
      payload: { name: "state" },
    });
    const peerId = peer.json().id as string;
    await county.app.inject({
      method: "POST",
      url: `/api/v1/peers/${peerId}/agreements`,
      headers: auth(county.adminToken),
      payload: { boardId: county.boardId, canRead: true, remoteBoardId: state.boardId },
    });

    // Partition: the link points at a port nothing listens on.
    const down = await county.app.inject({
      method: "PUT",
      url: `/api/v1/peers/${peerId}/link`,
      headers: auth(county.adminToken),
      payload: { endpointUrl: "http://127.0.0.1:9", token: intoState.json().token as string },
    });
    expect(down.statusCode).toBe(200);
    const [stored] = await county.admin`select outbound_token from peers where id = ${peerId}`;
    expect(stored!.outbound_token).not.toBe(intoState.json().token);

    const doc = new Y.Doc();
    doc.transact(() => doc.getMap("records").set(`${randomUUID()}/entry`, "county: bridge closed"));
    const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    await county.app.inject({
      method: "POST",
      url: `/api/v1/peers/${peerId}/queue`,
      headers: auth(county.adminToken),
      payload: { boardId: county.boardId, update },
    });

    const worker = new DeliveryWorker(county.runtime, { baseDelayMs: 0 });
    expect((await worker.drain()).federated).toBe(0);
    const [stranded] = await county.admin`
      select delivered_at, attempts, last_error from federation_outbox`;
    expect(stranded).toMatchObject({ delivered_at: null, attempts: 1 });
    expect(stranded!.last_error).toBeTruthy();

    // The link returns.
    await county.app.inject({
      method: "PUT",
      url: `/api/v1/peers/${peerId}/link`,
      headers: auth(county.adminToken),
      payload: { endpointUrl: state.baseUrl, token: intoState.json().token as string },
    });
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(1);
    const [delivered] = await county.admin`select delivered_at from federation_outbox`;
    expect(delivered!.delivered_at).not.toBeNull();
    const entries = await state.admin`
      select data ->> 'entry' as entry from board_records where board_id = ${state.boardId}`;
    expect(entries.map((r) => r.entry)).toContain("county: bridge closed");
  });

  it("refuses a link from a non-admin", async () => {
    const peer = await county.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${county.jurisdictionId}/peers`,
      headers: auth(county.adminToken),
      payload: { name: "someone" },
    });
    const memberToken = await tokenFor(county.app, "member@example.org", "another-good-password");
    const res = await county.app.inject({
      method: "PUT",
      url: `/api/v1/peers/${peer.json().id as string}/link`,
      headers: auth(memberToken),
      payload: { endpointUrl: "http://127.0.0.1:9", token: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});
