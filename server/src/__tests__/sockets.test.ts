import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { buildApp, type BuildAppOptions } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { MAX_UPDATE_CHARS } from "../sync/routes.js";
import { MAX_PAYLOAD_BYTES } from "../sync/sockets.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

const AUTH_DEADLINE_MS = 300;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let host: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let boardId: string;

async function start(options: BuildAppOptions): Promise<{ app: FastifyInstance; host: string }> {
  const built = buildApp(runtime, { oidc: null, ...options });
  await built.listen({ port: 0, host: "127.0.0.1" });
  const address = built.server.address();
  return { app: built, host: `127.0.0.1:${typeof address === "object" && address ? address.port : 0}` };
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  ({ app, host } = await start({ socketLimits: { authDeadlineMs: AUTH_DEADLINE_MS } }));
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "significant_events" },
  });
  boardId = board.json().id as string;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

/** An authenticated board sync socket, resolved once the state frame arrives. */
async function openSync(target = host, options?: WebSocket.ClientOptions): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${target}/api/v1/sync/boards/${boardId}`, options);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: adminToken })));
    ws.on("error", reject);
    ws.once("message", (raw: Buffer) => {
      if (raw.toString().startsWith('{"type":"state"')) resolve();
      else reject(new Error(raw.toString()));
    });
  });
  return ws;
}

function closed(ws: WebSocket): Promise<{ code: number; at: number }> {
  return new Promise((resolve) => ws.once("close", (code: number) => resolve({ code, at: performance.now() })));
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString()))));
}

describe("socket admission", () => {
  it("closes a socket that has not authenticated by the deadline, and keeps one that has", async () => {
    const opened = performance.now();
    const silent = new WebSocket(`ws://${host}/api/v1/sync/boards/${boardId}`);
    const authed = await openSync();
    const result = await closed(silent);
    expect(result.code).toBe(1008);
    expect(result.at - opened).toBeGreaterThanOrEqual(AUTH_DEADLINE_MS - 50);
    await new Promise((resolve) => setTimeout(resolve, AUTH_DEADLINE_MS));
    expect(authed.readyState).toBe(WebSocket.OPEN);
    authed.close();
  });

  it("refuses a frame over 1 MiB and an update over the schema bound", async () => {
    const big = await openSync();
    const bigClosed = closed(big);
    big.send("x".repeat(MAX_PAYLOAD_BYTES + 1));
    expect((await bigClosed).code).toBe(1009);

    const long = await openSync();
    const frame = JSON.stringify({ type: "update", update: "A".repeat(MAX_UPDATE_CHARS + 1) });
    expect(frame.length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    const reply = nextMessage(long);
    const longClosed = closed(long);
    long.send(frame);
    expect(await reply).toMatchObject({ type: "error" });
    await longClosed;
  });
});

describe("heartbeat", () => {
  it("terminates a peer that stops answering pings and keeps one that answers", async () => {
    const beat = await start({ socketLimits: { heartbeatMs: 150 } });
    try {
      const dead = await openSync(beat.host, { autoPong: false });
      const live = await openSync(beat.host);
      const deadClosed = closed(dead);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect((await deadClosed).code).toBe(1006);
      expect(live.readyState).toBe(WebSocket.OPEN);
      live.close();
    } finally {
      await beat.app.close();
    }
  });
});

describe("notification push", () => {
  let holderToken: string;
  let bystanderToken: string;
  let outsiderToken: string;
  let positionId: string;
  let holderId: string;
  let bystanderId: string;

  beforeAll(async () => {
    holderId = seed.memberId;
    holderToken = await tokenFor(app, "member@example.org", "another-good-password");
    bystanderId = await createPerson(admin, {
      email: "bystander@example.org", displayName: "Bystander", password: "bystander-password",
    });
    await addMembership(admin, bystanderId, seed.jurisdictionId, "member");
    bystanderToken = await tokenFor(app, "bystander@example.org", "bystander-password");
    const elsewhere = await createJurisdiction(admin, "elsewhere", "Elsewhere OES");
    const outsiderId = await createPerson(admin, {
      email: "outsider@example.org", displayName: "Outsider", password: "outsider-password",
    });
    await addMembership(admin, outsiderId, elsewhere, "admin");
    outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-password");
    const position = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
      headers: auth(adminToken),
      payload: { key: "ops_chief", title: "Operations Section Chief" },
    });
    positionId = position.json().id as string;
    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/positions/${positionId}/assignments`,
      headers: auth(adminToken),
      payload: { personId: holderId },
    });
    expect(assigned.statusCode).toBe(201);
  });

  interface Stream {
    readonly ws: WebSocket;
    readonly frames: string[];
  }

  async function openStream(token: string): Promise<Stream> {
    const ws = new WebSocket(`ws://${host}/api/v1/notifications/stream`);
    const frames: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const text = raw.toString();
        if (text === '{"type":"ready"}') resolve();
        else if (text.startsWith('{"type":"error"')) reject(new Error(text));
        else frames.push(text);
      });
    });
    return { ws, frames };
  }

  async function settle(streams: Stream[], expected: Stream[]): Promise<void> {
    const deadline = Date.now() + 5000;
    while (expected.some((s) => s.frames.length === 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Give a wrongly addressed signal the same chance to arrive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const s of streams) {
      expect(s.frames).toEqual(expected.includes(s) ? ['{"type":"changed"}'] : []);
      s.frames.length = 0;
    }
  }

  it("signals only the people who may read a notification written by another connection", async () => {
    const jurisdictionAdmin = await openStream(adminToken);
    const holder = await openStream(holderToken);
    const bystander = await openStream(bystanderToken);
    const outsider = await openStream(outsiderToken);
    const all = [jurisdictionAdmin, holder, bystander, outsider];

    const [personal] = await admin`
      insert into notifications (jurisdiction_id, person_id, channel, title, body, status)
      values (${seed.jurisdictionId}, ${bystanderId}, 'in_app', 'Personal', 'For the bystander', 'delivered')
      returning id`;
    await settle(all, [jurisdictionAdmin, bystander]);

    await admin`
      insert into notifications (jurisdiction_id, position_id, channel, title, body, status)
      values (${seed.jurisdictionId}, ${positionId}, 'in_app', 'Positional', 'For the chief', 'delivered')`;
    await settle(all, [jurisdictionAdmin, holder]);

    await admin`update notifications set read_at = now() where id = ${personal!.id}`;
    await settle(all, [jurisdictionAdmin, bystander]);

    // A rolled-back write announces nothing.
    await admin.begin(async (tx) => {
      await tx`
        insert into notifications (jurisdiction_id, person_id, channel, title, body, status)
        values (${seed.jurisdictionId}, ${bystanderId}, 'in_app', 'Never', 'Rolled back', 'delivered')`;
      await tx`select 1/0`;
    }).catch(() => undefined);
    await settle(all, []);

    for (const s of all) s.ws.close();
  });

  it("refuses a socket without a valid token", async () => {
    const ws = new WebSocket(`ws://${host}/api/v1/notifications/stream`);
    const reply = nextMessage(ws);
    const done = closed(ws);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: "not-a-token" })));
    expect(await reply).toMatchObject({ type: "error" });
    await done;
  });
});
