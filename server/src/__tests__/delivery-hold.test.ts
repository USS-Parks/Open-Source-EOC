import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Outbound messages are held through an outage instead of dropped. Each
 * delivery carries the time its jurisdiction's window for its kind runs out
 * (72 hours unless an administrator sets another); the worker retries until
 * then with no attempt limit, the notification says it is waiting, and past
 * the window it expires. An administrator may resend an expired delivery.
 */

const HOUR = 3_600_000;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let receiver: FastifyInstance;
let receiverUrl: string;
let jurisdictionId: string;
let adminToken: string;
let memberToken: string;
let boardId: string;
let down = true;
let priorKey: string | undefined;

async function rule(path: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/notification-rules`,
    headers: auth(adminToken),
    payload: { boardId, event: "record.created", channels: [{ kind: "webhook", url: `${receiverUrl}${path}` }] },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function write(entry: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/records`,
    headers: auth(adminToken),
    payload: { entry },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function reset(): Promise<void> {
  await admin`update notification_rules set enabled = false`;
  await admin`delete from delivery_outbox`;
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-delivery-key";
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "activity_log" },
  });
  boardId = board.json().id as string;
  receiver = Fastify({ logger: false });
  receiver.post("/fail", async (_req, reply) => reply.status(500).send("down"));
  receiver.post("/flaky", async (_req, reply) => (down ? reply.status(503).send("unreachable") : reply.send("ok")));
  await receiver.listen({ port: 0, host: "127.0.0.1" });
  const addr = receiver.server.address();
  receiverUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const allow = await app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${jurisdictionId}/notification-allowlist`,
    headers: auth(adminToken),
    payload: { entries: [receiverUrl] },
  });
  expect(allow.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await receiver?.close();
  await app?.close();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("the hold window", () => {
  it("holds each delivery for its jurisdiction's window, 72 hours unless an administrator sets another", async () => {
    await reset();
    const read = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${jurisdictionId}/delivery-holds`, headers: auth(memberToken) });
    expect(read.statusCode).toBe(200);
    expect(read.json().holds).toEqual([
      { kind: "email", hours: 72, isDefault: true, updatedAt: null },
      { kind: "sms", hours: 72, isDefault: true, updatedAt: null },
      { kind: "webhook", hours: 72, isDefault: true, updatedAt: null },
      { kind: "ntfy", hours: 72, isDefault: true, updatedAt: null },
    ]);
    await rule("/fail");
    await write("default window");
    const [first] = await admin`select extract(epoch from hold_until - created_at) as held from delivery_outbox`;
    expect(Number(first!.held)).toBe(72 * 3600);

    const refused = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/delivery-holds/webhook`,
      headers: auth(memberToken),
      payload: { hours: 6 },
    });
    expect(refused.statusCode).toBe(403);
    const tooLong = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/delivery-holds/webhook`,
      headers: auth(adminToken),
      payload: { hours: 721 },
    });
    expect(tooLong.statusCode).toBe(400);
    const set = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/delivery-holds/webhook`,
      headers: auth(adminToken),
      payload: { hours: 6 },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({ kind: "webhook", hours: 6, isDefault: false });
    const [audit] = await admin`select payload from audit_events where category = 'notification.hold_set'`;
    expect(audit!.payload).toEqual({ kind: "webhook", hours: 6, previousHours: 72 });

    await write("six-hour window");
    const rows = await admin`select extract(epoch from hold_until - created_at) as held from delivery_outbox order by created_at`;
    expect(rows.map((r) => Number(r.held))).toEqual([72 * 3600, 6 * 3600]);
    const after = (await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${jurisdictionId}/delivery-holds`, headers: auth(memberToken) })).json();
    expect(after.holds.find((h: { kind: string }) => h.kind === "webhook")).toMatchObject({ hours: 6, isDefault: false });
    await admin`delete from delivery_hold_windows`;
  });
});

describe("waiting for a route", () => {
  it("keeps retrying with no attempt limit and says the message is waiting", async () => {
    await reset();
    await rule("/fail");
    await write("into an outage");
    const worker = new DeliveryWorker(runtime, { baseDelayMs: 0, breakerThreshold: 1000 });
    for (let pass = 0; pass < 10; pass += 1) {
      expect(await worker.drain()).toMatchObject({ retried: 1, dead: 0, expired: 0 });
    }
    const [row] = await admin`
      select d.status, d.attempts, d.next_attempt_at <= d.hold_until as within, n.status as note, n.detail
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(row).toMatchObject({ status: "pending", attempts: 10, within: true, note: "pending" });
    expect(row!.detail.waiting).toMatchObject({ attempts: 10, lastError: "target responded 500" });
    expect(Date.parse(row!.detail.waiting.holdUntil as string) - Date.parse(row!.detail.waiting.since as string))
      .toBeGreaterThan(71 * HOUR);

    const listed = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: auth(adminToken) });
    const item = (listed.json().notifications as Array<{ status: string; detail: Record<string, unknown> }>)
      .find((n) => n.detail.waiting);
    expect(item).toMatchObject({ status: "pending", detail: { waiting: { lastError: "target responded 500" } } });
  });
});

describe("expiry and resend", () => {
  it("expires a message held past its window, then an administrator resends it and it goes out", async () => {
    await reset();
    down = true;
    await rule("/flaky");
    await write("before the outage ends");
    const late = new DeliveryWorker(runtime, { baseDelayMs: 0, now: () => Date.now() + 73 * HOUR });
    expect(await late.drain()).toMatchObject({ expired: 1, dead: 0 });
    const [expired] = await admin`
      select d.id, d.status, n.id as note_id, n.status as note, n.detail
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(expired).toMatchObject({ status: "expired", note: "failed" });
    expect(expired!.detail.expired).toBe(true);
    expect(expired!.detail.error).toMatch(/^Expired, not sent: no route before .*Last error: target responded 503$/);
    expect(expired!.detail.waiting).toBeUndefined();
    const [counts] = await admin`select * from outbox_counts()`;
    expect(counts).toMatchObject({ delivery_expired: 1 });
    // An expired delivery is never claimed again on its own.
    expect(await new DeliveryWorker(runtime, { baseDelayMs: 0 }).drain()).toMatchObject({ delivered: 0, retried: 0, expired: 0 });

    const noteId = expired!.note_id as string;
    const memberTry = await app.inject({ method: "POST", url: `/api/v1/notifications/${noteId}/resend`, headers: auth(memberToken) });
    expect([403, 404]).toContain(memberTry.statusCode);
    const resent = await app.inject({ method: "POST", url: `/api/v1/notifications/${noteId}/resend`, headers: auth(adminToken) });
    expect(resent.statusCode, resent.body).toBe(202);
    const deliveryId = resent.json().deliveryId as string;
    const [fresh] = await admin`
      select d.status, d.attempts, d.resent_from, n.status as note, n.detail
      from delivery_outbox d join notifications n on n.id = d.notification_id where d.id = ${deliveryId}`;
    expect(fresh).toMatchObject({ status: "pending", attempts: 0, resent_from: expired!.id, note: "pending" });
    expect(fresh!.detail.expired).toBeUndefined();
    expect(fresh!.detail.resentFrom).toBe(expired!.id);
    const [audit] = await admin`select payload from audit_events where category = 'notification.resent'`;
    expect(audit!.payload).toEqual({ deliveryId, previousStatus: "failed" });
    const again = await app.inject({ method: "POST", url: `/api/v1/notifications/${noteId}/resend`, headers: auth(adminToken) });
    expect(again.statusCode).toBe(409);
    // A resent delivery counts once, as the resend.
    const [recounted] = await admin`select * from outbox_counts()`;
    expect(recounted).toMatchObject({ delivery_expired: 0, delivery_pending: 1 });

    down = false;
    expect(await new DeliveryWorker(runtime, { baseDelayMs: 0 }).drain()).toMatchObject({ delivered: 1 });
    const [done] = await admin`select status, detail from notifications where id = ${noteId}`;
    expect(done!.status).toBe("delivered");
    expect(done!.detail.waiting).toBeUndefined();
  });

  it("expires instead of deferring when a target's circuit is still open at the end of the hold", async () => {
    await reset();
    await rule("/fail");
    await write("behind an open circuit");
    let clock = Date.now();
    const worker = new DeliveryWorker(runtime, {
      baseDelayMs: 0,
      breakerThreshold: 1,
      breakerCooldownMs: 200 * HOUR,
      now: () => clock,
    });
    expect(await worker.drain()).toMatchObject({ retried: 1 });
    // Before the hold ends, an open circuit defers without spending attempts.
    expect(await worker.drain()).toMatchObject({ deferred: 1 });
    await admin`update delivery_outbox set next_attempt_at = now()`;
    clock += 73 * HOUR;
    expect(await worker.drain()).toMatchObject({ expired: 1, deferred: 0 });
    const [row] = await admin`
      select d.status, n.detail from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(row!.status).toBe("expired");
    expect(row!.detail.error).toMatch(/Last error: the target kept failing$/);
  });

  it("still fails at once when the destination is refused, whatever the hold", async () => {
    await reset();
    await rule("/fail");
    await write("to a destination later removed");
    await admin`update notification_allowlists set entries = '{}' where jurisdiction_id = ${jurisdictionId}`;
    expect(await new DeliveryWorker(runtime, { baseDelayMs: 0 }).drain()).toMatchObject({ dead: 1, retried: 0 });
    await admin`update notification_allowlists set entries = ${[receiverUrl]} where jurisdiction_id = ${jurisdictionId}`;
  });
});
