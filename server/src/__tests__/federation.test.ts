import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createJurisdiction } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Instance federation (F3). Two genuinely separate instances —
 * separate databases and app processes — share a board through an
 * agreement. A scripted partition strands edits in each instance's
 * outbox; on reconnect the batches deliver over HTTP and both boards
 * converge with attribution, and a peer cannot write beyond its scope.
 */

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  baseUrl: string;
  jurisdictionId: string;
  memberToken: string;
  adminToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let peerCountySide: string; // county's peer record for the state
let peerStateSide: string; // state's peer record for the county
let tokenIntoCounty: string; // the state presents this to push into the county
let tokenIntoState: string; // the county presents this to push into the state

async function standUp(slug: string): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const baseUrl = `127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const login = async (email: string, password: string): Promise<string> =>
    (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } })).json()
      .accessToken as string;
  const adminToken = await login("admin@example.org", "correct-horse-battery");
  const memberToken = await login("member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "activity_log" },
  });
  void slug;
  return {
    admin,
    runtime,
    app,
    baseUrl,
    jurisdictionId: seed.jurisdictionId,
    adminToken,
    memberToken,
    boardId: board.json().id as string,
  };
}

beforeAll(async () => {
  county = await standUp("county");
  state = await standUp("state");

  // The county registers the state as a peer and shares its board.
  const pc = await registerPeer(county, "state");
  peerCountySide = pc.id;
  tokenIntoCounty = pc.token;
  await makeAgreement(county, peerCountySide, county.boardId);
  // The state registers the county as a peer and shares its board.
  const ps = await registerPeer(state, "county");
  peerStateSide = ps.id;
  tokenIntoState = ps.token;
  await makeAgreement(state, peerStateSide, state.boardId);
}, 60000);

afterAll(async () => {
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
});

async function registerPeer(inst: Instance, name: string): Promise<{ id: string; token: string }> {
  const res = await inst.app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${inst.jurisdictionId}/peers`,
    headers: { authorization: `Bearer ${inst.adminToken}` },
    payload: { name },
  });
  return res.json();
}

async function makeAgreement(inst: Instance, peerId: string, boardId: string): Promise<void> {
  const res = await inst.app.inject({
    method: "POST",
    url: `/api/v1/peers/${peerId}/agreements`,
    headers: { authorization: `Bearer ${inst.adminToken}` },
    payload: { boardId, canRead: true, canWrite: true },
  });
  if (res.statusCode !== 201) throw new Error(`agreement failed: ${res.body}`);
}

/** Edit an instance's board over its sync WS; return the Yjs update bytes. */
async function pushEdit(inst: Instance, entry: string): Promise<string> {
  const doc = new Y.Doc();
  doc.transact(() => doc.getMap("records").set(`${randomUUID()}/entry`, entry));
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  const socket = new WebSocket(`ws://${inst.baseUrl}/api/v1/sync/boards/${inst.boardId}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sync timeout")), 10000);
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token: inst.memberToken })));
    socket.on("error", reject);
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; error?: string };
      if (msg.type === "state") socket.send(JSON.stringify({ type: "update", update }));
      else if (msg.type === "synced") {
        clearTimeout(timer);
        socket.close();
        resolve();
      } else if (msg.type === "error") {
        clearTimeout(timer);
        socket.close();
        reject(new Error(msg.error));
      }
    });
  });
  return update;
}

async function queue(inst: Instance, peerId: string, boardId: string, update: string): Promise<void> {
  const res = await inst.app.inject({
    method: "POST",
    url: `/api/v1/peers/${peerId}/queue`,
    headers: { authorization: `Bearer ${inst.adminToken}` },
    payload: { boardId, update },
  });
  if (res.statusCode !== 201) throw new Error(`queue failed: ${res.body}`);
}

async function pendingFor(inst: Instance, peerId: string): Promise<Array<{ updateBase64: string }>> {
  const res = await inst.app.inject({
    method: "GET",
    url: `/api/v1/peers/${peerId}/pending`,
    headers: { authorization: `Bearer ${inst.adminToken}` },
  });
  return res.json().pending;
}

async function entriesOn(inst: Instance): Promise<string[]> {
  const rows = await inst.admin`
    select data ->> 'entry' as entry from board_records where board_id = ${inst.boardId} order by 1`;
  return rows.map((r) => r.entry as string);
}

describe("county-to-state sharing survives a partition in both directions", () => {
  it("strands edits in both outboxes, then converges on reconnect with attribution", async () => {
    // Partition: each instance edits its own board and queues for the peer.
    const updCounty = await pushEdit(county, "county: levee overtopping");
    await queue(county, peerCountySide, county.boardId, updCounty);
    const updState = await pushEdit(state, "state: mobilizing task force");
    await queue(state, peerStateSide, state.boardId, updState);

    // During the partition nothing has crossed.
    expect(await entriesOn(county)).toEqual(["county: levee overtopping"]);
    expect(await entriesOn(state)).toEqual(["state: mobilizing task force"]);
    expect(await pendingFor(county, peerCountySide)).toHaveLength(1);
    expect(await pendingFor(state, peerStateSide)).toHaveLength(1);

    // Link returns. Deliver county → state.
    const toState = await pendingFor(county, peerCountySide);
    const r1 = await state.app.inject({
      method: "POST",
      url: "/api/v1/federation/receive",
      headers: { "x-peer-token": tokenIntoState },
      payload: { boardId: state.boardId, updates: toState.map((e) => e.updateBase64) },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().conflicts).toBe(0);

    // Deliver state → county.
    const toCounty = await pendingFor(state, peerStateSide);
    const r2 = await county.app.inject({
      method: "POST",
      url: "/api/v1/federation/receive",
      headers: { "x-peer-token": tokenIntoCounty },
      payload: { boardId: county.boardId, updates: toCounty.map((e) => e.updateBase64) },
    });
    expect(r2.statusCode).toBe(200);

    // Both instances have converged to the union; neither lost its own data.
    const both = ["county: levee overtopping", "state: mobilizing task force"].sort();
    expect((await entriesOn(county)).sort()).toEqual(both);
    expect((await entriesOn(state)).sort()).toEqual(both);

    // Convergence is attributable on each side.
    const [countyAudit] = await county.admin`
      select payload ->> 'peer' as peer from audit_events where category = 'federation.received'`;
    expect(countyAudit!.peer).toBe("state");
    const [stateAudit] = await state.admin`
      select payload ->> 'peer' as peer from audit_events where category = 'federation.received'`;
    expect(stateAudit!.peer).toBe("county");
  });
});

describe("agreement scope", () => {
  it("rejects an unknown peer token", async () => {
    const res = await state.app.inject({
      method: "POST",
      url: "/api/v1/federation/receive",
      headers: { "x-peer-token": "not-a-peer" },
      payload: { boardId: state.boardId, updates: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a peer writing a board it has no agreement for", async () => {
    // A second, unshared board on the state instance.
    const other = await state.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${state.jurisdictionId}/boards`,
      headers: { authorization: `Bearer ${state.adminToken}` },
      payload: { templateKey: "activity_log" },
    });
    const res = await state.app.inject({
      method: "POST",
      url: "/api/v1/federation/receive",
      headers: { "x-peer-token": tokenIntoState },
      payload: { boardId: other.json().id as string, updates: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("defaults a sharing agreement to read-only when canWrite is omitted", async () => {
    const board = await county.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${county.jurisdictionId}/boards`,
      headers: { authorization: `Bearer ${county.adminToken}` },
      payload: { templateKey: "activity_log" },
    });
    const boardId = board.json().id as string;
    const peer = await registerPeer(county, "read-only-neighbor");
    const agreement = await county.app.inject({
      method: "POST",
      url: `/api/v1/peers/${peer.id}/agreements`,
      headers: { authorization: `Bearer ${county.adminToken}` },
      payload: { boardId, canRead: true },
    });
    expect(agreement.statusCode).toBe(201);

    const res = await county.app.inject({
      method: "POST",
      url: "/api/v1/federation/receive",
      headers: { "x-peer-token": peer.token },
      payload: { boardId, updates: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("agreement does not permit writes to that board");
  });

  it("refuses an agreement that points at another jurisdiction's board", async () => {
    const [adminRow] = await county.admin`select id from persons where email = 'admin@example.org'`;
    const otherJur = await createJurisdiction(county.admin, "neighbor-oes", "Neighbor OES");
    await addMembership(county.admin, adminRow!.id as string, otherJur, "admin");
    const otherBoard = await county.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${otherJur}/boards`,
      headers: { authorization: `Bearer ${county.adminToken}` },
      payload: { templateKey: "activity_log" },
    });
    expect(otherBoard.statusCode).toBe(201);

    const res = await county.app.inject({
      method: "POST",
      url: `/api/v1/peers/${peerCountySide}/agreements`,
      headers: { authorization: `Bearer ${county.adminToken}` },
      payload: { boardId: otherBoard.json().id as string, canRead: true, canWrite: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("board is not in this jurisdiction");
  });
});

describe("federation status for administrators", () => {
  it("lists peers, shared boards with their outbox standing, and received batches, never a token", async () => {
    const prior = process.env.OPENEOC_SECRET_KEY;
    process.env.OPENEOC_SECRET_KEY = "test-only-federation-status-key";
    try {
      const link = await county.app.inject({
        method: "PUT",
        url: `/api/v1/peers/${peerCountySide}/link`,
        headers: { authorization: `Bearer ${county.adminToken}` },
        payload: { endpointUrl: "http://127.0.0.1:9", token: "push-token-never-shown" },
      });
      expect(link.statusCode).toBe(200);
    } finally {
      if (prior === undefined) delete process.env.OPENEOC_SECRET_KEY;
      else process.env.OPENEOC_SECRET_KEY = prior;
    }

    const res = await county.app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${county.jurisdictionId}/federation`,
      headers: { authorization: `Bearer ${county.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const [stored] = await county.admin`select token_hash, outbound_token from peers where id = ${peerCountySide}`;
    for (const secret of ["push-token-never-shown", tokenIntoCounty, stored!.token_hash, stored!.outbound_token]) {
      expect(res.body).not.toContain(secret as string);
    }
    const [board] = await county.admin`select title from boards where id = ${county.boardId}`;
    const body = res.json();
    const peer = body.peers.find((p: { name: string }) => p.name === "state");
    expect(peer).toMatchObject({ id: peerCountySide, endpointUrl: "http://127.0.0.1:9", tokenStored: true });
    expect(peer.boards).toEqual([
      expect.objectContaining({
        boardId: county.boardId, boardTitle: board!.title, canRead: true, canWrite: true, remoteBoardId: null,
        pending: 1, lastError: null, lastDeliveredAt: null,
      }),
    ]);
    expect(Date.parse(peer.boards[0].oldestPendingAt)).not.toBeNaN();
    expect(Date.parse(peer.boards[0].nextAttemptAt)).not.toBeNaN();
    expect(body.received).toEqual([
      expect.objectContaining({ peer: "state", boardId: county.boardId, boardTitle: board!.title, updates: 1, conflicts: 0 }),
    ]);
  });

  it("refuses a member", async () => {
    const res = await county.app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${county.jurisdictionId}/federation`,
      headers: { authorization: `Bearer ${county.memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
