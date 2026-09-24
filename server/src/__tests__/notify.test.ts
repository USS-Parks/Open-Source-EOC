import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { destinationRefusal } from "../notify/allowlist.js";
import { matches, signWebhookBody, type BoardEvent } from "../notify/engine.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

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
let worker: DeliveryWorker;

async function allow(entries: string[], token = adminToken) {
  return app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-allowlist`,
    headers: auth(token),
    payload: { entries },
  });
}

async function createRule(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`,
    headers: auth(adminToken),
    payload,
  });
}

async function writeRecord(token: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/records`,
    headers: auth(token),
    payload: { item: "Cots", quantity: 10, priority: "immediate", state: "submitted" },
  });
  expect(res.statusCode).toBe(201);
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  worker = new DeliveryWorker(runtime, { timeoutMs: 2000, maxAttempts: 1 });

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

  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  // The discard port stands in for a target that is listed but dead.
  await allow([receiverUrl, "http://127.0.0.1:9"]);

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
    expect(received).toHaveLength(0); // queued, not sent inline
    await worker.drain();
    expect(received).toHaveLength(2); // webhook + ntfy

    const hook = received.find((r) => r.path === "/hook")!;
    expect(hook.signature.startsWith("sha256=")).toBe(true);
    expect(hook.signature.slice(7)).toBe(signWebhookBody(webhookSecret, hook.body));
    expect(JSON.parse(hook.body).record.state).toBe("assigned");
    // Tampering breaks verification.
    expect(signWebhookBody(webhookSecret, hook.body + "x")).not.toBe(hook.signature.slice(7));

    const push = received.find((r) => r.path === "/eoc-ops")!;
    expect(push.title).toBe("Resource Requests record updated: Potable water");
    expect(push.body).toContain("State: Assigned (was Triaged)");

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
    await worker.drain();
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
    await worker.drain();
    expect(received).toHaveLength(1);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notifications/run-scheduled`,
      headers: auth(adminToken),
    });
    expect(second.json().fired).toBe(0); // interval guard holds
    await worker.drain();
    expect(received).toHaveLength(1);
  });
});

describe("the notification allowlist", () => {
  it("is read and replaced by admins only, and stored in normalized form", async () => {
    const url = `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-allowlist`;
    expect((await app.inject({ method: "GET", url, headers: auth(memberToken) })).statusCode).toBe(403);
    expect((await allow([receiverUrl], memberToken)).statusCode).toBe(403);

    for (const bad of [
      "http://hooks.example.org",
      "https://hooks.example.org/path",
      "*.org",
      "ftp://hooks.example.org",
    ]) {
      expect((await allow([bad])).statusCode, bad).toBe(422);
    }

    const put = await allow([
      "https://Hooks.Example.org:443",
      "*.Example.net",
      receiverUrl,
      "http://127.0.0.1:9",
    ]);
    expect(put.statusCode).toBe(200);
    const expected = ["https://hooks.example.org", "*.example.net", receiverUrl, "http://127.0.0.1:9"];
    expect(put.json().entries).toEqual(expected);
    const got = await app.inject({ method: "GET", url, headers: auth(adminToken) });
    expect(got.json().entries).toEqual(expected);
    const [audit] = await admin`
      select payload from audit_events where category = 'notification.allowlist_updated'
      order by seq desc limit 1`;
    expect((audit!.payload as { entries: string[] }).entries).toEqual(expected);
    await allow([receiverUrl, "http://127.0.0.1:9"]);
  });

  it("refuses a rule whose destination is not listed", async () => {
    for (const channel of [
      { kind: "webhook", url: "https://unlisted.example.com/hook" },
      { kind: "ntfy", url: "http://127.0.0.1:1", topic: "loopback-but-unlisted" },
    ]) {
      const res = await createRule({ event: "record.created", channels: [channel] });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain("allowlist");
    }
  });

  it("refuses a queued delivery whose destination was removed from the list", async () => {
    await admin`update notification_rules set enabled = false`;
    const rule = await createRule({
      boardId,
      event: "record.created",
      channels: [{ kind: "webhook", url: `${receiverUrl}/removed` }],
    });
    expect(rule.statusCode).toBe(201);
    await allow(["http://127.0.0.1:9"]);
    await writeRecord(adminToken);
    received = [];
    expect((await worker.drain()).dead).toBe(1);
    expect(received).toHaveLength(0);
    const [note] = await admin`
      select status, detail ->> 'error' as error from notifications
      where rule_id = ${rule.json().id as string}`;
    expect(note).toMatchObject({ status: "failed" });
    expect(note!.error).toContain("allowlist");
    await allow([receiverUrl, "http://127.0.0.1:9"]);
  });

  it("refuses a private address reached through a host suffix, not one named exactly", async () => {
    await admin`update notification_rules set enabled = false`;
    await allow(["*.example.test", receiverUrl]);
    const rule = await createRule({
      boardId,
      event: "record.created",
      channels: [
        { kind: "webhook", url: "https://hooks.example.test/private" },
        { kind: "ntfy", url: receiverUrl, topic: "named" },
      ],
    });
    expect(rule.statusCode).toBe(201);
    await writeRecord(adminToken);
    received = [];
    // The suffix host resolves into the loopback range; nothing is fetched.
    const resolving = new DeliveryWorker(runtime, {
      maxAttempts: 1,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const pass = await resolving.drain();
    expect(pass).toMatchObject({ delivered: 1, dead: 1 });
    expect(received.map((r) => r.path)).toEqual(["/named"]);
    const [failed] = await admin`
      select detail ->> 'error' as error from notifications
      where rule_id = ${rule.json().id as string} and status = 'failed'`;
    expect(failed!.error).toContain("private address");
    // The same suffix host on a public address may be sent to.
    expect(
      await destinationRefusal(["*.example.test"], "https://hooks.example.test/x", async () => [
        { address: "203.0.113.7", family: 4 },
      ]),
    ).toBeNull();
    await allow([receiverUrl, "http://127.0.0.1:9"]);
  });
});

describe("per-rule rate caps", () => {
  it("queues up to the cap and records the excess on one notice an admin can see", async () => {
    await admin`update notification_rules set enabled = false`;
    const rule = await createRule({
      boardId,
      event: "record.created",
      channels: [{ kind: "ntfy", url: receiverUrl, topic: "capped" }],
      rateLimit: { max: 2, windowMinutes: 10 },
    });
    expect(rule.statusCode).toBe(201);
    const ruleId = rule.json().id as string;
    // A member writes: the cap holds even for a caller who cannot read the queue.
    for (let i = 0; i < 5; i += 1) await writeRecord(memberToken);

    const [queued] = await admin`
      select count(*)::int as n from delivery_outbox where rule_id = ${ruleId}`;
    expect(queued!.n).toBe(2);
    const suppressed = await admin`
      select detail from notifications where rule_id = ${ruleId} and status = 'suppressed'`;
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.detail).toMatchObject({ suppressed: 3, limit: 2, windowMinutes: 10 });

    const tray = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: auth(adminToken) });
    const shown = (tray.json().notifications as Array<{ status: string; detail: { suppressed?: number } }>)
      .find((n) => n.status === "suppressed");
    expect(shown?.detail.suppressed).toBe(3);

    received = [];
    await worker.drain();
    expect(received.filter((r) => r.path === "/capped")).toHaveLength(2);
  });

  it("bounds the cap a rule may ask for", async () => {
    const res = await createRule({
      event: "record.created",
      channels: [{ kind: "ntfy", url: receiverUrl, topic: "too-many" }],
      rateLimit: { max: 601, windowMinutes: 10 },
    });
    expect(res.statusCode).toBe(400);
  });
});
