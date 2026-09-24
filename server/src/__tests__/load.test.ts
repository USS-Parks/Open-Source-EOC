import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { addMembership, createPerson } from "../auth/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Load and scale benchmarks (R1). These are the committed floor as a
 * regression guard: a board holding 50,000 records serves the first page of
 * a view in under 300 ms, and a 150-operation concurrent burst (mixed reads
 * and writes, the shape of a 150-user activation) completes within budget.
 * The burst budgets are generous so CI variance never flakes; the measured
 * numbers are printed and published in the capacity receipt under docs/process.
 * Live sync fan-out holds its bound with one subscriber stalled: the others
 * are served within 100 ms and the stalled one is shed past its queue ceiling.
 */

// The first-page budget is the acceptance bound for paged board views. The
// burst budgets are loose ceilings that only a pathological regression (an
// unindexed scan, an accidental N+1, a lock storm) would breach.
const FIRST_PAGE_BUDGET_MS = 300;
const BURST_WALL_BUDGET_MS = 30000;
const BURST_P95_BUDGET_MS = 6000;
const CONCURRENCY = 150;
// Delivery bound for a live board update to each of 149 socket readers while
// a 150th subscriber has stopped reading.
const SOCKET_FANOUT_BUDGET_MS = 100;
const VOLUME = 50000;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let adminToken: string;
let boardId: string;

function auth(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
  boardId = (await auth("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey: "activity_log" })).json()
    .id as string;
}, 120000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

describe("board record volume", () => {
  it(`lists the first page of a view over ${VOLUME} records within budget`, async () => {
    await admin`
      insert into board_records (board_id, data, created_by, created_at)
      select ${boardId}, jsonb_build_object('entry', 'Log line ' || g, 'notable', g % 10 = 0), ${adminId},
             now() - make_interval(secs => g)
      from generate_series(1, ${VOLUME}) g`;
    await admin`analyze board_records`;
    for (const view of ["all", "notable"]) {
      await auth("GET", `/api/v1/boards/${boardId}/views/${view}`); // warm the connection and plan
      const t0 = performance.now();
      const res = await auth("GET", `/api/v1/boards/${boardId}/views/${view}`);
      const ms = performance.now() - t0;
      expect(res.statusCode).toBe(200);
      expect(res.json().records).toHaveLength(100);
      expect(res.json().nextCursor).toEqual(expect.any(String));
      // eslint-disable-next-line no-console
      console.log(`[load] first page of view ${view} over ${VOLUME} records: ${ms.toFixed(0)}ms`);
      expect(ms).toBeLessThan(FIRST_PAGE_BUDGET_MS);
    }
  }, 120000);
});

describe("150-concurrent activation profile", () => {
  it(`serves ${CONCURRENCY} mixed operations within budget`, async () => {
    const durations: number[] = [];
    const task = (fn: () => Promise<{ statusCode: number }>) => async () => {
      const t0 = performance.now();
      const res = await fn();
      durations.push(performance.now() - t0);
      return res.statusCode;
    };
    const tasks: Array<() => Promise<number>> = [];
    for (let i = 0; i < CONCURRENCY; i += 1) {
      const kind = i % 3;
      if (kind === 0) tasks.push(task(() => auth("GET", "/api/v1/me")));
      else if (kind === 1) tasks.push(task(() => auth("GET", `/api/v1/boards/${boardId}/views/all`)));
      else tasks.push(task(() => auth("POST", `/api/v1/boards/${boardId}/records`, { entry: `burst ${i}` })));
    }
    const t0 = performance.now();
    const codes = await Promise.all(tasks.map((t) => t()));
    const wall = performance.now() - t0;
    const p95 = percentile(durations, 95);

    // Every operation succeeded (2xx).
    expect(codes.every((c) => c >= 200 && c < 300)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `[load] ${CONCURRENCY} concurrent ops: wall=${wall.toFixed(0)}ms p95=${p95.toFixed(0)}ms ` +
        `max=${Math.max(...durations).toFixed(0)}ms`,
    );
    expect(wall).toBeLessThan(BURST_WALL_BUDGET_MS);
    expect(p95).toBeLessThan(BURST_P95_BUDGET_MS);
  }, 60000);
});

describe("150 distinct concurrent users (the release gate)", () => {
  it(`logs in ${CONCURRENCY} separate users and serves a request from each within budget`, async () => {
    // Provision the members directly (this is setup, not the measured path).
    const emails: string[] = [];
    for (let i = 0; i < CONCURRENCY; i += 1) {
      const email = `loaduser${i}@example.org`;
      const pid = await createPerson(admin, {
        email,
        displayName: `Load User ${i}`,
        password: "another-good-password",
      });
      await addMembership(admin, pid, jurisdictionId, "member");
      emails.push(email);
    }

    // Each user opens its own session: CONCURRENCY distinct authenticated tokens.
    const tokens = await Promise.all(
      emails.map(async (email) => {
        const r = await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password: "another-good-password" },
        });
        return r.json().accessToken as string;
      }),
    );
    expect(tokens.every((t) => typeof t === "string" && t.length > 0)).toBe(true);

    // One concurrent request per distinct user, each under its own RLS context,
    // a mix of a read and a write, the shape of a real 150-user activation.
    const durations: number[] = [];
    const codes = await Promise.all(
      tokens.map((token, i) =>
        (async () => {
          const t0 = performance.now();
          const res =
            i % 2 === 0
              ? await app.inject({
                  method: "GET",
                  url: "/api/v1/me",
                  headers: { authorization: `Bearer ${token}` },
                })
              : await app.inject({
                  method: "POST",
                  url: `/api/v1/boards/${boardId}/records`,
                  headers: { authorization: `Bearer ${token}` },
                  payload: { entry: `user ${i} entry` },
                });
          durations.push(performance.now() - t0);
          return res.statusCode;
        })(),
      ),
    );
    const p95 = percentile(durations, 95);
    // eslint-disable-next-line no-console
    console.log(
      `[load] ${CONCURRENCY} distinct users: p95=${p95.toFixed(0)}ms max=${Math.max(...durations).toFixed(0)}ms`,
    );
    expect(codes.every((c) => c >= 200 && c < 300)).toBe(true);
    expect(p95).toBeLessThan(BURST_P95_BUDGET_MS);
  }, 180000);
});

describe("150 WebSocket subscribers with one stalled reader", () => {
  interface Peer {
    readonly ws: WebSocket;
    /** Resolved with the arrival time of the next pushed peer update. */
    readonly updates: Array<(at: number) => void>;
    readonly acks: Array<() => void>;
  }

  /** A valid Yjs update carrying `bytes` of payload outside the records map. */
  function yUpdate(bytes: number): string {
    const doc = new Y.Doc();
    doc.getMap("scratch").set(randomUUID(), "x".repeat(bytes));
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  }

  it("delivers each update to the other 149 in under 100 ms and sheds the stalled one", async () => {
    // A listening app with a small queue ceiling, so the stalled reader is shed
    // after a few bulk updates; the heartbeat is kept out of the way.
    const wsApp = buildApp(runtime, {
      oidc: null,
      socketLimits: { maxBufferedBytes: 64 * 1024, heartbeatMs: 600_000 },
    });
    await wsApp.listen({ port: 0, host: "127.0.0.1" });
    try {
      const address = wsApp.server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const syncBoard = (await auth("POST", `/api/v1/jurisdictions/${jurisdictionId}/boards`, {
        templateKey: "significant_events",
      })).json().id as string;

      const open = async (): Promise<Peer> => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/sync/boards/${syncBoard}`);
        const peer: Peer = { ws, updates: [], acks: [] };
        await new Promise<void>((resolve, reject) => {
          ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: adminToken })));
          ws.on("error", reject);
          ws.on("message", (raw: Buffer) => {
            const at = performance.now();
            // Classify by prefix so a large frame costs the harness no parse.
            const head = raw.toString("utf8", 0, 20);
            if (head.startsWith('{"type":"state"')) resolve();
            else if (head.startsWith('{"type":"update"')) peer.updates.shift()?.(at);
            else if (head.startsWith('{"type":"synced"')) peer.acks.shift()?.();
            else reject(new Error(raw.toString()));
          });
        });
        return peer;
      };

      // 150 subscribers on one board: 149 readers and one that stops reading.
      // The writer is a separate socket, so every subscriber is a receiver.
      const readers: Peer[] = [];
      while (readers.length < 149) {
        readers.push(...(await Promise.all(Array.from({ length: Math.min(10, 149 - readers.length) }, open))));
      }
      const stalled = await open();
      const writer = await open();
      const stalledSocket = (stalled.ws as unknown as { _socket: Socket })._socket;
      stalledSocket.pause();
      const stalledClosed = new Promise<number>((resolve) => stalled.ws.once("close", resolve));

      const send = async (update: string): Promise<number[]> => {
        const arrivals = readers.map((peer) => new Promise<number>((resolve) => peer.updates.push(resolve)));
        const ack = new Promise<void>((resolve) => writer.acks.push(resolve));
        const t0 = performance.now();
        writer.ws.send(JSON.stringify({ type: "update", update }));
        const times = await Promise.all(arrivals);
        await ack;
        return times.map((at) => at - t0);
      };

      // Ordinary edits of a few hundred bytes, interleaved with 32 KiB bulk
      // updates that back the stalled reader's queue up past the ceiling. The
      // kernel's socket buffers absorb the first part: a few hundred KiB on
      // Windows, one to two MiB on Linux loopback, so the rounds run until
      // the reader is shed rather than for a count tuned to one platform.
      const edits: number[] = [];
      const bulk: number[] = [];
      let shed = false;
      for (let round = 0; round < 200 && !shed; round += 1) {
        bulk.push(...(await send(yUpdate(32 * 1024))));
        edits.push(...(await send(yUpdate(256))));
        shed = [...wsApp.websocketServer.clients].some((socket) => socket.readyState === WebSocket.CLOSING);
      }
      expect(shed).toBe(true);
      // The others go on being served once the stalled reader is shed.
      for (let round = 0; round < 10; round += 1) edits.push(...(await send(yUpdate(256))));

      const all = [...edits, ...bulk];
      // eslint-disable-next-line no-console
      console.log(
        `[load] 149 socket readers, ${edits.length / 149} edits: p95=${percentile(edits, 95).toFixed(1)}ms ` +
          `max=${Math.max(...edits).toFixed(1)}ms; ${bulk.length / 149} bulk updates of 32 KiB: ` +
          `p95=${percentile(bulk, 95).toFixed(1)}ms max=${Math.max(...bulk).toFixed(1)}ms`,
      );
      // Every update, bulk included, reaches every reader within the bound.
      expect(Math.max(...all)).toBeLessThan(SOCKET_FANOUT_BUDGET_MS);

      // Reading again, it drains its backlog and then finds the close reason.
      stalledSocket.resume();
      expect(await stalledClosed).toBe(1013);
      for (const peer of [...readers, writer]) peer.ws.close();
    } finally {
      await wsApp.close();
    }
  }, 120000);
});
