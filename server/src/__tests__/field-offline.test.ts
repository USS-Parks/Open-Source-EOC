import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Offline field loop: a field user edits in airplane
 * mode, the app restarts while still offline, then reconnects and the
 * queued work reconciles into the server of record with an audit trail.
 * The client here speaks the same durable-doc + sync protocol as the
 * shipped browser FieldClient; the browser class's own durability is
 * unit-tested in the web package.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let baseUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let boardId: string;

/** A durable store that outlives a client instance (an app restart). */
type Durable = Map<string, Uint8Array>;

/** Minimal persistent field client: offline edits, reconnect-and-reconcile. */
class PersistentFieldClient {
  constructor(private readonly durable: Durable) {}

  private load(id: string): Y.Doc {
    const doc = new Y.Doc();
    const bytes = this.durable.get(id);
    if (bytes) Y.applyUpdate(doc, bytes);
    return doc;
  }

  edit(id: string, recordId: string, fields: Record<string, unknown>): void {
    const doc = this.load(id);
    const records = doc.getMap<unknown>("records");
    doc.transact(() => {
      for (const [k, v] of Object.entries(fields)) records.set(`${recordId}/${k}`, v);
    });
    this.durable.set(id, Y.encodeStateAsUpdate(doc));
  }

  records(id: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of this.load(id).getMap<unknown>("records").entries()) {
      const slash = key.indexOf("/");
      if (slash <= 0) continue;
      (out[key.slice(0, slash)] ??= {})[key.slice(slash + 1)] = value;
    }
    return out;
  }

  async sync(id: string, token: string): Promise<{ seq: number; conflicts: number }> {
    const doc = this.load(id);
    const socket = new WebSocket(`ws://${baseUrl}/api/v1/sync/boards/${id}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sync timeout")), 15000);
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.on("error", reject);
      socket.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          update?: string;
          seq?: number;
          conflicts?: number;
          error?: string;
        };
        if (msg.type === "state") {
          Y.applyUpdate(doc, new Uint8Array(Buffer.from(msg.update!, "base64")));
          socket.send(
            JSON.stringify({
              type: "update",
              update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
            }),
          );
        } else if (msg.type === "synced") {
          clearTimeout(timer);
          this.durable.set(id, Y.encodeStateAsUpdate(doc));
          socket.close();
          resolve({ seq: msg.seq!, conflicts: msg.conflicts! });
        } else if (msg.type === "error") {
          clearTimeout(timer);
          socket.close();
          reject(new Error(msg.error));
        }
      });
    });
  }
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "road_closures" },
  });
  boardId = board.json().id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function login(email: string, password: string): Promise<{ access: string; resume: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  const body = res.json();
  return { access: body.accessToken as string, resume: body.resumeToken as string };
}

async function tokenFor(email: string, password: string): Promise<string> {
  return (await login(email, password)).access;
}

async function viewRecords(token: string): Promise<Array<Record<string, unknown>>> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/boards/${boardId}/views/all`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json().records as Array<Record<string, unknown>>;
}

describe("the full airplane-mode loop", () => {
  it("edits offline, reconnects, and reconciles into the server of record with an audit trail", async () => {
    const token = await tokenFor("member@example.org", "another-good-password");
    const durable: Durable = new Map();
    const client = new PersistentFieldClient(durable);

    // Airplane mode: edits are local only, no socket touched.
    const c1 = randomUUID();
    const c2 = randomUUID();
    client.edit(boardId, c1, {
      road: "SR-169 at Pecwan",
      reason: "landslide",
      status: "closed",
    });
    client.edit(boardId, c2, { road: "SR-96 at Orleans", reason: "flooding", status: "one_lane" });
    expect(client.records(boardId)[c1]!.road).toBe("SR-169 at Pecwan");

    // Nothing on the server yet.
    expect(await viewRecords(token)).toHaveLength(0);

    // Reconnect and reconcile.
    const result = await client.sync(boardId, token);
    expect(result.conflicts).toBe(0);

    const records = await viewRecords(token);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.road).sort()).toEqual(
      ["SR-169 at Pecwan", "SR-96 at Orleans"].sort(),
    );

    // The reconciliation is attributed in the audit trail as sync-origin.
    const audits = await admin`
      select payload from audit_events
      where category = 'board.record.created' and subject_id in (${c1}, ${c2})`;
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => (a.payload as { via?: string }).via === "sync")).toBe(true);
  });

  it("loses nothing across an app restart while still offline", async () => {
    const token = await tokenFor("member@example.org", "another-good-password");
    const durable: Durable = new Map();

    // Edit offline, then the app dies before any reconnect.
    const rid = randomUUID();
    new PersistentFieldClient(durable).edit(boardId, rid, {
      road: "Bald Hills Rd",
      reason: "fire",
      status: "closed",
    });

    // A fresh client from the same durable store still has the edit.
    const revived = new PersistentFieldClient(durable);
    expect(revived.records(boardId)[rid]!.road).toBe("Bald Hills Rd");

    // It reconnects and the pre-restart edit reaches the server.
    await revived.sync(boardId, token);
    const roads = (await viewRecords(token)).map((r) => r.road);
    expect(roads).toContain("Bald Hills Rd");
  });

  it("renews a disconnected session on reconnect without losing queued edits", async () => {
    const { resume } = await login("member@example.org", "another-good-password");
    const durable: Durable = new Map();
    const client = new PersistentFieldClient(durable);
    client.edit(boardId, randomUUID(), {
      road: "US-101 at Big Lagoon",
      reason: "surf",
      status: "closed",
    });

    // On reconnect the cached resume token buys a fresh access token; the
    // queued edit is untouched and syncs under the renewed session.
    const renewed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resume",
      payload: { resumeToken: resume },
    });
    expect(renewed.statusCode).toBe(200);
    const freshToken = renewed.json().accessToken as string;

    await client.sync(boardId, freshToken);
    const roads = (await viewRecords(freshToken)).map((r) => r.road);
    expect(roads).toContain("US-101 at Big Lagoon");
  });
});
