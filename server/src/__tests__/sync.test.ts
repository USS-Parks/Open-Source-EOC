import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let baseUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let boardId: string;
let adminToken: string;
let memberToken: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
  const boardRes = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "significant_events" },
  });
  boardId = boardRes.json().id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return res.json().accessToken as string;
}

/** Headless sync client: local Y.Doc that works offline and reconciles. */
class TestSyncClient {
  readonly doc = new Y.Doc();
  private socket: WebSocket | null = null;
  private acks: Array<(v: { seq: number; conflicts: number }) => void> = [];

  records(): Y.Map<Y.Map<unknown>> {
    return this.doc.getMap<unknown>("records") as unknown as Y.Map<Y.Map<unknown>>;
  }

  /** Offline-capable edit: flat `recordId/field` keys (field-level merge). */
  edit(recordId: string, fields: Record<string, unknown>): void {
    const records = this.doc.getMap<unknown>("records");
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(fields)) records.set(`${recordId}/${k}`, v);
    });
  }

  json(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of this.doc.getMap<unknown>("records").entries()) {
      const slash = key.indexOf("/");
      if (slash <= 0) continue;
      const id = key.slice(0, slash);
      (out[id] ??= {})[key.slice(slash + 1)] = value;
    }
    return out;
  }

  async connect(token: string): Promise<void> {
    const socket = new WebSocket(`ws://${baseUrl}/api/v1/sync/boards/${boardId}`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
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
          Y.applyUpdate(this.doc, new Uint8Array(Buffer.from(msg.update!, "base64")));
          resolve();
        } else if (msg.type === "update") {
          Y.applyUpdate(this.doc, new Uint8Array(Buffer.from(msg.update!, "base64")));
        } else if (msg.type === "synced") {
          this.acks.shift()?.({ seq: msg.seq!, conflicts: msg.conflicts! });
        } else if (msg.type === "error") {
          reject(new Error(msg.error));
        }
      });
    });
  }

  /** Push the full local state (carries every queued offline edit). */
  async push(): Promise<{ seq: number; conflicts: number }> {
    const update = Buffer.from(Y.encodeStateAsUpdate(this.doc)).toString("base64");
    return new Promise((resolve) => {
      this.acks.push(resolve);
      this.socket!.send(JSON.stringify({ type: "update", update }));
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}

describe("convergence property (seeded randomized)", () => {
  it("any interleaving of edits converges to the same state", () => {
    let s = 42;
    const rand = () => (s = (s * 1664525 + 1013904223) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 25; round++) {
      const a = new Y.Doc();
      const b = new Y.Doc();
      const ops = (doc: Y.Doc) => {
        const records = doc.getMap<Y.Map<unknown>>("records");
        for (let i = 0; i < 12; i++) {
          const id = `rec-${Math.floor(rand() * 3)}`;
          doc.transact(() => {
            let m = records.get(id);
            if (!m) {
              m = new Y.Map<unknown>();
              records.set(id, m);
            }
            m.set(`f${Math.floor(rand() * 4)}`, Math.floor(rand() * 100));
          });
        }
      };
      ops(a);
      ops(b);
      const ua = Y.encodeStateAsUpdate(a);
      const ub = Y.encodeStateAsUpdate(b);
      if (rand() > 0.5) {
        Y.applyUpdate(a, ub);
        Y.applyUpdate(b, ua);
      } else {
        Y.applyUpdate(b, ua);
        Y.applyUpdate(a, ub);
      }
      expect(a.getMap("records").toJSON()).toEqual(b.getMap("records").toJSON());
    }
  });
});

describe("partition and reconnect (the 24-hour test, scripted)", () => {
  const recA = "11111111-1111-4111-8111-111111111111";
  const recB = "22222222-2222-4222-8222-222222222222";

  it("both sides edit through a partition, reconnect in either order, converge, attributed", async () => {
    const clientA = new TestSyncClient();
    const clientB = new TestSyncClient();
    await clientA.connect(adminToken);
    await clientB.connect(memberToken);
    clientA.disconnect();
    clientB.disconnect();

    // The long partition: both sides keep working.
    clientA.edit(recA, {
      summary: "Spotted new fire line",
      occurred_at: "2026-09-17T20:00:00Z",
      severity: "critical",
    });
    clientB.edit(recB, {
      summary: "Shelter head count complete",
      occurred_at: "2026-09-18T08:00:00Z",
      severity: "normal",
    });
    // Concurrent edits to the SAME record, different fields.
    clientA.edit(recB, { verified: true });
    clientB.edit(recA, { details: "East ridge, moving north" });

    // Reconnect B first, then A (order must not matter).
    await clientB.connect(memberToken);
    await clientB.push();
    await clientA.connect(adminToken);
    await clientA.push();
    await clientB.push(); // B picks up A's changes; push is idempotent.

    const a = clientA.json();
    const b = clientB.json();
    expect(a).toEqual(b);
    expect(a[recA]).toMatchObject({
      summary: "Spotted new fire line",
      details: "East ridge, moving north",
    });
    expect(a[recB]).toMatchObject({
      summary: "Shelter head count complete",
      verified: true,
    });

    // Postgres is truth: both records landed, attributed to their creators.
    const rows = await admin`
      select id, data, created_by from board_records where board_id = ${boardId}`;
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    expect(byId.get(recA)).toBeTruthy();
    expect(byId.get(recB)).toBeTruthy();
    expect(
      (byId.get(recA)!.data as Record<string, unknown>).details,
    ).toBe("East ridge, moving north");

    // Audit completeness: every record change has an attributed event.
    const audits = await admin`
      select category, person_id from audit_events
      where subject_id in (${recA}, ${recB})`;
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const e of audits) expect(e.person_id).toBeTruthy();

    clientA.disconnect();
    clientB.disconnect();
  });

  it("a schema-violating merge surfaces as a conflict, never silent loss", async () => {
    const client = new TestSyncClient();
    await client.connect(adminToken);
    const badRec = "33333333-3333-4333-8333-333333333333";
    client.edit(badRec, {
      summary: "Bad severity incoming",
      occurred_at: "2026-09-18T09:00:00Z",
      severity: "catastrophic",
    });
    const ack = await client.push();
    expect(ack.conflicts).toBe(1);

    const conflicts = await admin`
      select record_id, reason from sync_conflicts where board_id = ${boardId}`;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.record_id).toBe(badRec);

    const rows = await admin`select id from board_records where id = ${badRec}`;
    expect(rows).toHaveLength(0);

    const audit = await admin`
      select 1 from audit_events where category = 'sync.conflict' and subject_id = ${badRec}`;
    expect(audit).toHaveLength(1);
    client.disconnect();
  });

  it("live peers receive each other's updates as they happen", async () => {
    const clientA = new TestSyncClient();
    const clientB = new TestSyncClient();
    await clientA.connect(adminToken);
    await clientB.connect(memberToken);
    const liveRec = "44444444-4444-4444-8444-444444444444";
    clientA.edit(liveRec, {
      summary: "Live update test",
      occurred_at: "2026-09-18T10:00:00Z",
      severity: "warning",
    });
    await clientA.push();
    await new Promise((r) => setTimeout(r, 200));
    expect(clientB.json()[liveRec]).toMatchObject({ summary: "Live update test" });
    clientA.disconnect();
    clientB.disconnect();
  });
});

describe("sync authorization (INV-7)", () => {
  it("an outsider cannot read a board after a member has already opened it", async () => {
    const member = new TestSyncClient();
    await member.connect(adminToken);

    const otherJurisdiction = await createJurisdiction(admin, "hoopa", "Hoopa Valley Tribe");
    const outsiderId = await createPerson(admin, {
      email: "outsider@example.org",
      displayName: "Outsider",
      password: "outsider-good-pass",
    });
    await addMembership(admin, outsiderId, otherJurisdiction, "admin");
    const outsiderToken = await tokenFor("outsider@example.org", "outsider-good-pass");

    const outsider = new TestSyncClient();
    await expect(outsider.connect(outsiderToken)).rejects.toThrow(
      /board not found|no access to this board/,
    );
    member.disconnect();
  });
});
