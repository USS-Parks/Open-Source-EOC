import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { FEDERATION_BATCH_BYTES, FEDERATION_BODY_LIMIT } from "../federation/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Federation batches sized to what a receiver accepts. Two instances on
 * separate databases: a board's first copy, over 3 MiB, goes to a new peer in
 * parts with every push under the batch size; a backlog of edits and
 * deletions stranded by a 24-hour partition is held, then drains in queue
 * order when the link returns; and the receive route reads a body only from a
 * known peer, up to its own limit.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  baseUrl: string;
  jurisdictionId: string;
  adminId: string;
  adminToken: string;
}

interface Shared {
  peerId: string;
  stateBoard: string;
  token: string;
}

let county: Instance;
let state: Instance;
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
  return { admin, runtime, app, baseUrl, jurisdictionId: seed.jurisdictionId, adminId: seed.adminId, adminToken };
}

async function post(inst: Instance, url: string, payload: unknown): Promise<Record<string, string>> {
  const res = await inst.app.inject({ method: "POST", url, headers: auth(inst.adminToken), payload: payload as object });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function newBoard(inst: Instance): Promise<string> {
  return (await post(inst, `/api/v1/jurisdictions/${inst.jurisdictionId}/boards`, { templateKey: "activity_log" })).id!;
}

/**
 * The state takes the county's pushes into a new board of its own; the county
 * shares its board with the state, which queues the board's records as they
 * stand. The link is set afterward.
 */
async function share(countyBoard: string, name: string): Promise<Shared> {
  const stateBoard = await newBoard(state);
  const intoState = await post(state, `/api/v1/jurisdictions/${state.jurisdictionId}/peers`, { name: `county for ${name}` });
  await post(state, `/api/v1/peers/${intoState.id!}/agreements`, { boardId: stateBoard, canRead: false, canWrite: true });
  const peer = await post(county, `/api/v1/jurisdictions/${county.jurisdictionId}/peers`, { name });
  await post(county, `/api/v1/peers/${peer.id!}/agreements`, { boardId: countyBoard, canRead: true, remoteBoardId: stateBoard });
  return { peerId: peer.id!, stateBoard, token: intoState.token! };
}

async function link(peerId: string, endpointUrl: string, token: string): Promise<void> {
  const res = await county.app.inject({
    method: "PUT", url: `/api/v1/peers/${peerId}/link`, headers: auth(county.adminToken), payload: { endpointUrl, token },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** The county's pushes to a peer, one row per batch: every entry of a batch is marked delivered in one statement. */
async function batchesTo(peerId: string): Promise<Array<{ entries: number; wire: number; first: Date; last: Date }>> {
  const rows = await county.admin`
    select count(*)::integer as entries,
           sum(case when update_data is null then 39 else 4 * ((octet_length(update_data) + 2) / 3) + 3 end)::integer as wire,
           min(created_at) as first, max(created_at) as last
    from federation_outbox where peer_id = ${peerId} and delivered_at is not null
    group by delivered_at order by delivered_at`;
  return rows as unknown as Array<{ entries: number; wire: number; first: Date; last: Date }>;
}

async function liveEntries(boardId: string): Promise<string[]> {
  const rows = await state.admin`
    select data ->> 'entry' as entry from board_records where board_id = ${boardId} and deleted_at is null order by 1`;
  return rows.map((r) => r.entry as string);
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-federation-batch-key";
  county = await standUp();
  state = await standUp();
}, 120_000);

afterAll(async () => {
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("federation batches sized to what a receiver accepts", () => {
  it("sends a board's first copy over 3 MiB in parts, each push under the batch size", async () => {
    const board = await newBoard(county);
    // 900 records of about 3,900 characters: 3.4 MiB of record data.
    await county.admin`
      insert into board_records (board_id, data, created_by)
      select ${board}, jsonb_build_object('entry', 'record ' || lpad(g::text, 3, '0') || ' ' || repeat('x', 3900)), ${county.adminId}
      from generate_series(1, 900) g`;
    const shared = await share(board, "state backfill");

    const parts = await county.admin`
      select octet_length(update_data) as bytes from federation_outbox where peer_id = ${shared.peerId} order by created_at, id`;
    const total = parts.reduce((sum, p) => sum + (p.bytes as number), 0);
    expect(total).toBeGreaterThan(3 * 1024 * 1024);
    expect(parts.length).toBeGreaterThanOrEqual(8);
    // Each part fits one push once base64-encoded.
    for (const p of parts) expect(4 * Math.ceil((p.bytes as number) / 3)).toBeLessThan(FEDERATION_BATCH_BYTES);
    const [audit] = await county.admin`
      select payload from audit_events where category = 'federation.backfilled' and subject_id = ${board}`;
    expect(audit!.payload).toEqual({ peer: "state backfill", records: 900, parts: parts.length });

    await link(shared.peerId, state.baseUrl, shared.token);
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(parts.length);
    const batches = await batchesTo(shared.peerId);
    expect(batches.length).toBeGreaterThanOrEqual(5);
    for (const b of batches) expect(b.wire).toBeLessThanOrEqual(FEDERATION_BATCH_BYTES);
    const [arrived] = await state.admin`
      select count(*)::integer as n, min(data ->> 'entry') as first, max(data ->> 'entry') as last
      from board_records where board_id = ${shared.stateBoard} and deleted_at is null`;
    expect(arrived!.n).toBe(900);
    expect(String(arrived!.first)).toMatch(/^record 001 x{3900}$/);
    expect(String(arrived!.last)).toMatch(/^record 900 x{3900}$/);
    const received = await state.admin`
      select payload from audit_events where category = 'federation.received' and subject_id = ${shared.stateBoard}`;
    expect(received).toHaveLength(batches.length);
  }, 180_000);

  it("holds a backlog through a 24-hour partition and drains it in queue order when the link returns", async () => {
    const board = await newBoard(county);
    const shared = await share(board, "state partition");
    await link(shared.peerId, "http://127.0.0.1:9", shared.token); // nothing listens here

    // A day of work in the partition: 300 entries, then ten of them deleted.
    const ids: string[] = [];
    const entries: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const entry = `entry ${String(i).padStart(3, "0")} ${"y".repeat(3800)}`;
      ids.push((await post(county, `/api/v1/boards/${board}/records`, { entry })).id!);
      entries.push(entry);
    }
    const deleted = new Set(ids.filter((_, i) => i % 30 === 7));
    for (const id of deleted) {
      const res = await county.app.inject({ method: "DELETE", url: `/api/v1/boards/${board}/records/${id}`, headers: auth(county.adminToken) });
      expect(res.statusCode, res.body).toBe(200);
    }
    const [queued] = await county.admin`
      select count(*)::integer as n, count(deleted_record)::integer as deletes,
             sum(case when update_data is null then 39 else 4 * ((octet_length(update_data) + 2) / 3) + 3 end)::integer as wire
      from federation_outbox where peer_id = ${shared.peerId} and delivered_at is null`;
    expect(queued!.deletes).toBe(10);
    expect(queued!.wire).toBeGreaterThan(FEDERATION_BATCH_BYTES);

    // Every attempt in the partition fails; nothing is dropped.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await new DeliveryWorker(county.runtime, { baseDelayMs: 0 }).drain()).federated).toBe(0);
    }
    // A day passes with the queue standing.
    await county.admin`
      update federation_outbox set created_at = created_at - interval '24 hours', next_attempt_at = next_attempt_at - interval '24 hours'
      where peer_id = ${shared.peerId} and delivered_at is null`;
    const stranded = await county.admin`
      select attempts, last_error from federation_outbox
      where peer_id = ${shared.peerId} and delivered_at is null order by created_at, id`;
    expect(stranded).toHaveLength(queued!.n);
    // The first batch was tried on every pass and backs off; the entries behind it wait their turn untried.
    expect(stranded[0]).toMatchObject({ attempts: 3, last_error: expect.stringMatching(/fetch failed|ECONNREFUSED/) });
    expect(stranded.at(-1)).toMatchObject({ attempts: 0, last_error: null });

    // The link returns: one pass drains the whole backlog, batch after batch, in queue order.
    await link(shared.peerId, state.baseUrl, shared.token);
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(queued!.n);
    const batches = await batchesTo(shared.peerId);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    for (const b of batches) expect(b.wire).toBeLessThanOrEqual(FEDERATION_BATCH_BYTES);
    for (let i = 1; i < batches.length; i += 1) {
      expect(batches[i]!.first.getTime()).toBeGreaterThan(batches[i - 1]!.last.getTime());
    }
    expect(await liveEntries(shared.stateBoard)).toEqual(entries.filter((_, i) => !deleted.has(ids[i]!)).sort());
    const [received] = await state.admin`
      select sum((payload ->> 'deletes')::integer)::integer as deletes from audit_events
      where category = 'federation.received' and subject_id = ${shared.stateBoard}`;
    expect(received!.deletes).toBe(10);
  }, 180_000);

  it("reads a receive body only from a known peer, up to the federation limit", async () => {
    const board = await newBoard(county);
    const shared = await share(board, "state limits");

    // An unknown sender is refused before its body is read.
    const unknown = await state.app.inject({
      method: "POST", url: "/api/v1/federation/receive",
      headers: { "x-peer-token": "not-a-peer", "content-type": "application/json" },
      payload: JSON.stringify({ boardId: shared.stateBoard, updates: ["A".repeat(FEDERATION_BODY_LIMIT + 1024)] }),
    });
    expect(unknown.statusCode).toBe(401);
    const missing = await state.app.inject({
      method: "POST", url: "/api/v1/federation/receive", payload: { boardId: shared.stateBoard, updates: [] },
    });
    expect(missing.statusCode).toBe(401);

    // A known peer's body over the default 1 MiB request limit is read.
    const doc = new Y.Doc();
    doc.transact(() => {
      for (let i = 0; i < 500; i += 1) doc.getMap("records").set(`${randomUUID()}/entry`, `bulk ${i} ${"z".repeat(3900)}`);
    });
    const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    expect(update.length).toBeGreaterThan(2 * 1024 * 1024);
    const big = await state.app.inject({
      method: "POST", url: "/api/v1/federation/receive", headers: { "x-peer-token": shared.token },
      payload: { boardId: shared.stateBoard, updates: [update] },
    });
    expect(big.statusCode, big.body).toBe(200);
    expect((await liveEntries(shared.stateBoard)).length).toBe(500);

    // A body over the federation limit is refused.
    const over = await state.app.inject({
      method: "POST", url: "/api/v1/federation/receive",
      headers: { "x-peer-token": shared.token, "content-type": "application/json" },
      payload: JSON.stringify({ boardId: shared.stateBoard, updates: ["A".repeat(FEDERATION_BODY_LIMIT)] }),
    });
    expect(over.statusCode).toBe(413);
  }, 120_000);
});
