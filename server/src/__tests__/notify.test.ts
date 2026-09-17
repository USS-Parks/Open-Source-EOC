import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { matches, signWebhookBody, type BoardEvent } from "../notify/engine.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let receiver: FastifyInstance;
let receiverUrl: string;
let received: Array<{
  path: string;
  signature: string;
  body: string;
  title?: string | undefined;
}> = [];
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let boardId: string;
let adminToken: string;
let memberToken: string;
let webhookSecret: string;
let recordId: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });

  receiver = Fastify({ logger: false });
  // Keep raw bytes: signature verification must see exactly what was sent.
  receiver.removeAllContentTypeParsers();
  receiver.addContentTypeParser("*", { parseAs: "string" }, (_r, body, done) =>
    done(null, body),
  );
  receiver.post("/*", (req, reply) => {
    received.push({
      path: req.url,
      signature: String(req.headers["x-openeoc-signature"] ?? ""),
      body: String(req.body ?? ""),
      title: req.headers.title as string | undefined,
    });
    return reply.send("ok");
  });
  await receiver.listen({ port: 0, host: "127.0.0.1" });
  const addr = receiver.server.address();
  receiverUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");

  // Requesting position: admin signs into ops chief, then creates the 213RR.
  const pos = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`,
    headers: auth(adminToken),
    payload: { key: "ops_chief", title: "Operations Section Chief" },
  });
  const positionId = pos.json().id as string;
  await app.inject({
    method: "POST",
    url: `/api/v1/positions/${positionId}/assignments`,
    headers: auth(adminToken),
    payload: { personId: seed.adminId },
  });
  await app.inject({
    method: "POST",
    url: `/api/v1/positions/${positionId}/sign-in`,
    headers: auth(adminToken),
  });

  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "resource_request" },
  });
  boardId = board.json().id as string;
});

afterAll(async () => {
  await app.close();
  await receiver.close();
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

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("condition matching (unit)", () => {
  const event: BoardEvent = {
    jurisdictionId: "j",
    boardId: "b",
    boardKey: "resource_request",
    recordId: "r",
    event: "record.updated",
    record: { state: "assigned", item: "water" },
    previous: { state: "sourcing", item: "water" },
  };
  it("matches any, eq, and changed_to correctly", () => {
    expect(matches({ op: "any" }, event)).toBe(true);
    expect(matches({ op: "eq", field: "state", value: "assigned" }, event)).toBe(true);
    expect(matches({ op: "eq", field: "state", value: "closed" }, event)).toBe(false);
    expect(matches({ op: "changed_to", field: "state", value: "assigned" }, event)).toBe(true);
    expect(
      matches({ op: "changed_to", field: "item", value: "water" }, event),
    ).toBe(false); // was already water: no transition
  });
});

describe("the 213RR notification lane (F4 acceptance)", () => {
  it("a state change fans out to in-app, webhook, and push, all logged", async () => {
    const rule = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`,
      headers: auth(adminToken),
      payload: {
        boardId,
        event: "record.updated",
        condition: { op: "changed_to", field: "state", value: "assigned" },
        channels: [
          { kind: "inapp", target: "requesting_position" },
          { kind: "webhook", url: `${receiverUrl}/hook` },
          { kind: "ntfy", url: receiverUrl, topic: "eoc-ops" },
        ],
      },
    });
    expect(rule.statusCode).toBe(201);
    webhookSecret = rule.json().webhookSecret as string;
    expect(webhookSecret).toBeTruthy();

    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(adminToken),
      payload: { item: "Potable water", quantity: 500, priority: "immediate", state: "submitted" },
    });
    recordId = rec.json().id as string;
    expect(received).toHaveLength(0); // rule watches updates to assigned only

    received = [];
    const upd = await app.inject({
      method: "PATCH",
      url: `/api/v1/boards/${boardId}/records/${recordId}`,
      headers: auth(memberToken),
      payload: { state: "triaged" },
    });
    expect(upd.statusCode).toBe(200);
    expect(received).toHaveLength(0); // not the watched transition

    await app.inject({
      method: "PATCH",
      url: `/api/v1/boards/${boardId}/records/${recordId}`,
      headers: auth(memberToken),
      payload: { state: "assigned" },
    });
    expect(received).toHaveLength(2); // webhook + ntfy

    const hook = received.find((r) => r.path === "/hook")!;
    expect(hook.signature.startsWith("sha256=")).toBe(true);
    expect(hook.signature.slice(7)).toBe(signWebhookBody(webhookSecret, hook.body));
    expect(JSON.parse(hook.body).record.state).toBe("assigned");
    // Tampering breaks verification.
    expect(signWebhookBody(webhookSecret, hook.body + "x")).not.toBe(hook.signature.slice(7));

    const push = received.find((r) => r.path === "/eoc-ops")!;
    expect(push.body).toContain("resource_request");

    // The requesting position (ops chief, the record creator) has a tray entry.
    const tray = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: auth(adminToken),
    });
    const inapp = (tray.json().notifications as Array<{ channel: string; status: string }>).filter(
      (n) => n.channel === "inapp",
    );
    expect(inapp.length).toBeGreaterThanOrEqual(1);
    expect(inapp[0]!.status).toBe("delivered");

    const logged = await admin`
      select channel, status from notifications where jurisdiction_id = ${seed.jurisdictionId}`;
    expect(logged.filter((n) => n.status === "delivered")).toHaveLength(3);
  });

  it("a dead channel fails visibly and the rest still deliver", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`,
      headers: auth(adminToken),
      payload: {
        boardId,
        event: "record.updated",
        condition: { op: "changed_to", field: "state", value: "deployed" },
        channels: [
          { kind: "webhook", url: "http://127.0.0.1:9/dead" },
          { kind: "ntfy", url: receiverUrl, topic: "eoc-ops" },
        ],
      },
    });
    received = [];
    const upd = await app.inject({
      method: "PATCH",
      url: `/api/v1/boards/${boardId}/records/${recordId}`,
      headers: auth(memberToken),
      payload: { state: "deployed" },
    });
    expect(upd.statusCode).toBe(200); // the API call itself is unaffected
    expect(received).toHaveLength(1); // ntfy delivered despite webhook death

    const failed = await admin`
      select channel, detail from notifications where status = 'failed'`;
    expect(failed).toHaveLength(1);
    expect(failed[0]!.channel).toBe("webhook");
    expect((failed[0]!.detail as { error?: string }).error).toBeTruthy();
  });

  it("scheduled rules fire once per interval", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`,
      headers: auth(adminToken),
      payload: {
        event: "scheduled",
        channels: [{ kind: "ntfy", url: receiverUrl, topic: "eoc-sched" }],
        scheduleIntervalMinutes: 60,
      },
    });
    received = [];
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notifications/run-scheduled`,
      headers: auth(adminToken),
    });
    expect(first.json().fired).toBe(1);
    expect(received).toHaveLength(1);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notifications/run-scheduled`,
      headers: auth(adminToken),
    });
    expect(second.json().fired).toBe(0); // interval guard holds
    expect(received).toHaveLength(1);
  });
});
