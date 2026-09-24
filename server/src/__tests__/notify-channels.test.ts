import type { Server } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { fixtureMessages } from "../notify/channels.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { sendMail } from "../notify/smtp.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { bodyOf, fakeRelay, selfSigned } from "./smtp-relay.js";

/**
 * Email and SMS channels. A rule queues one delivery per recipient; the worker
 * sends email through the jurisdiction's SMTP relay (a fake relay here that
 * records the conversation) and SMS through the fixture provider or an HTTP
 * provider (a local receiver here). Nothing leaves the machine.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let boardId: string;
let adminToken: string;
let memberToken: string;
let cert: { key: string; cert: string };
let receiver: FastifyInstance;
let receiverUrl: string;
const smsPosts: Array<{ authorization: string; form: Record<string, string> }> = [];
const relays: Server[] = [];
let priorKey: string | undefined;

async function put(kind: "email" | "sms", payload: unknown, token = adminToken) {
  return app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/${kind}`,
    headers: auth(token),
    payload: payload as Record<string, unknown>,
  });
}

async function createRule(channels: unknown[], rateLimit?: { max: number; windowMinutes: number }) {
  return app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/notification-rules`,
    headers: auth(adminToken),
    payload: { boardId, event: "record.created", channels, ...(rateLimit ? { rateLimit } : {}) },
  });
}

async function write(entry: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/records`,
    headers: auth(memberToken),
    payload: { entry },
  });
  expect(res.statusCode).toBe(201);
}

async function reset(): Promise<void> {
  await admin`update notification_rules set enabled = false`;
  await admin`delete from delivery_outbox`;
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-channel-key";
  cert = selfSigned();
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
  receiver.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_r, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  receiver.post("/sms", async (req) => {
    smsPosts.push({ authorization: String(req.headers.authorization), form: req.body as Record<string, string> });
    return { sid: `SM${smsPosts.length}`, status: "queued" };
  });
  await receiver.listen({ port: 0, host: "127.0.0.1" });
  const addr = receiver.server.address();
  receiverUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  for (const relay of relays) relay.close();
  await receiver?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("channel configuration", () => {
  it("refuses an email rule before email is configured", async () => {
    const res = await createRule([{ kind: "email", to: ["duty@example.org"] }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("configure the email channel");
  });

  it("is admin-only and never returns the stored password", async () => {
    const settings = { host: "127.0.0.1", port: 2525, security: "starttls", username: "relay-user", from: "eoc@example.org" };
    expect((await put("email", { settings, secret: "relay-password" }, memberToken)).statusCode).toBe(403);
    const member = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/email`,
      headers: auth(memberToken),
    });
    expect(member.statusCode).toBe(403);
    const memberTest = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/sms/test`,
      headers: auth(memberToken),
      payload: { to: "+17075550100" },
    });
    expect(memberTest.statusCode).toBe(403);

    // A sign-in over plain text is refused, and a user name needs a password.
    expect((await put("email", { settings: { ...settings, security: "none" }, secret: "x" })).statusCode).toBe(422);
    expect((await put("email", { settings })).statusCode).toBe(422);

    const saved = await put("email", { settings, secret: "relay-password" });
    expect(saved.statusCode).toBe(200);
    // Saving again without the secret keeps it.
    expect((await put("email", { settings })).statusCode).toBe(200);
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/email`,
      headers: auth(adminToken),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ kind: "email", settings, secretStorageAvailable: true });
    expect(read.json().credentialFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(read.body).not.toContain("relay-password");
    expect(read.body).not.toContain("v1:");
    const [row] = await admin`select secret_envelope from notification_channels where kind = 'email'`;
    expect(row!.secret_envelope).toMatch(/^v1:/);
    const [audit] = await admin`
      select payload from audit_events where category = 'notification.channel_configured' order by seq desc limit 1`;
    expect(JSON.stringify(audit!.payload)).not.toContain("relay-password");
  });
});

describe("email", () => {
  it("queues one delivery per recipient and sends each over STARTTLS with AUTH PLAIN", async () => {
    const relay = await fakeRelay({ cert, authMethods: "PLAIN LOGIN" });
    relays.push(relay.server);
    const settings = { host: "127.0.0.1", port: relay.port, security: "starttls", username: "relay-user", from: "eoc@example.org" };
    expect((await put("email", { settings })).statusCode).toBe(200);
    expect((await createRule([{ kind: "email", to: ["duty@example.org", "chief@example.org"] }])).statusCode).toBe(201);
    await write("Road 169 closed at the bridge");
    const queued = await admin`select kind, target, headers, status from delivery_outbox order by target`;
    expect(queued.map((r) => [r.kind, r.target, r.status])).toEqual([
      ["email", "chief@example.org", "pending"],
      ["email", "duty@example.org", "pending"],
    ]);
    expect(relay.sessions).toHaveLength(0);

    const worker = new DeliveryWorker(runtime, { timeoutMs: 3000, smtpTls: { ca: cert.cert } });
    expect(await worker.drain()).toMatchObject({ delivered: 2, retried: 0, dead: 0 });
    expect(relay.sessions).toHaveLength(2);
    for (const session of relay.sessions) {
      expect(session.secure).toBe(true);
      expect(session.auth).toBe("PLAIN relay-user:relay-password");
      // STARTTLS came before AUTH, and EHLO was repeated over TLS.
      const verbs = session.commands.map((c) => c.split(/[ :]/)[0]);
      expect(verbs).toEqual(["EHLO", "STARTTLS", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
      expect(session.commands).toContain("MAIL FROM:<eoc@example.org>");
      expect(session.data).toContain("Subject: New Activity Log record: Road 169 closed at the bridge");
      expect(session.data).toContain("From: eoc@example.org");
      expect(bodyOf(session.data)).toContain("Entry: Road 169 closed at the bridge");
    }
    expect(relay.sessions.flatMap((s) => s.commands.filter((c) => c.startsWith("RCPT"))).sort()).toEqual([
      "RCPT TO:<chief@example.org>",
      "RCPT TO:<duty@example.org>",
    ]);
    const delivered = await admin`
      select d.status, d.receipt, n.status as notification, n.detail ->> 'to' as "to"
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(delivered.every((r) => r.status === "delivered" && r.notification === "delivered")).toBe(true);
    for (const row of delivered) {
      expect(row.receipt.queueId).toMatch(/^Q[12]$/);
      expect(row.receipt.response).toContain("250 2.0.0 Ok: queued as");
      expect(row.receipt.messageId).toMatch(/@example\.org$/);
    }
    await reset();
  });

  it("retries a relay that refuses, then dead-letters the delivery", async () => {
    const relay = await fakeRelay({ refuseMail: "451 4.3.0 Try again later" });
    relays.push(relay.server);
    const settings = { host: "127.0.0.1", port: relay.port, security: "none", from: "eoc@example.org" };
    expect((await put("email", { settings })).statusCode).toBe(200);
    expect((await createRule([{ kind: "email", to: ["duty@example.org"] }])).statusCode).toBe(201);
    await write("Shelter at capacity");
    const worker = new DeliveryWorker(runtime, { timeoutMs: 3000, maxAttempts: 2, baseDelayMs: 0 });
    expect((await worker.drain()).retried).toBe(1);
    expect((await worker.drain()).dead).toBe(1);
    expect(relay.sessions).toHaveLength(2);
    const [row] = await admin`
      select d.status, d.attempts, d.receipt, n.status as notification, n.detail ->> 'error' as error
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(row).toMatchObject({ status: "dead", attempts: 2, receipt: null, notification: "failed" });
    expect(row!.error).toContain("451 4.3.0 Try again later");
    await reset();
  });

  it("dead-letters at once when the relay refuses the message permanently", async () => {
    const relay = await fakeRelay({ refuseMail: "550 5.7.1 Sender not permitted" });
    relays.push(relay.server);
    const settings = { host: "127.0.0.1", port: relay.port, security: "none", from: "eoc@example.org" };
    expect((await put("email", { settings })).statusCode).toBe(200);
    expect((await createRule([{ kind: "email", to: ["duty@example.org"] }])).statusCode).toBe(201);
    await write("Road closed at the bridge");
    const worker = new DeliveryWorker(runtime, { timeoutMs: 3000, maxAttempts: 8, baseDelayMs: 0 });
    expect((await worker.drain()).dead).toBe(1);
    expect(relay.sessions).toHaveLength(1);
    const [row] = await admin`
      select d.status, d.attempts, n.detail ->> 'error' as error
      from delivery_outbox d join notifications n on n.id = d.notification_id`;
    expect(row).toMatchObject({ status: "dead", attempts: 1 });
    expect(row!.error).toContain("550 5.7.1");
    await reset();
  });

  it("speaks implicit TLS with AUTH LOGIN, reads multi-line replies and dot-stuffs", async () => {
    const relay = await fakeRelay({ cert, implicit: true, authMethods: "LOGIN" });
    relays.push(relay.server);
    const receipt = await sendMail(
      { host: "127.0.0.1", port: relay.port, security: "tls", username: "relay-user", from: "eoc@example.org" },
      "relay-password",
      { to: "duty@example.org", subject: "Évacuation ordonnée pour la zone 4", body: "one\n.two" },
      { timeoutMs: 3000, tls: { ca: cert.cert } },
    );
    expect(receipt.queueId).toBe("Q1");
    const [session] = relay.sessions;
    expect(session).toMatchObject({ secure: true, auth: "LOGIN relay-user:relay-password" });
    expect(session!.data).toContain("Subject: =?UTF-8?B?");
    expect(bodyOf(session!.data)).toBe("one\n.two");
    // A server certificate the client does not trust is refused.
    await expect(
      sendMail(
        { host: "127.0.0.1", port: relay.port, security: "tls", from: "eoc@example.org" },
        null,
        { to: "duty@example.org", subject: "x", body: "x" },
        { timeoutMs: 3000 },
      ),
    ).rejects.toThrow();
  });

  it("does not fall back to plain text when STARTTLS is missing", async () => {
    const relay = await fakeRelay({});
    relays.push(relay.server);
    await expect(
      sendMail(
        { host: "127.0.0.1", port: relay.port, security: "starttls", username: "u", from: "eoc@example.org" },
        "secret-password",
        { to: "duty@example.org", subject: "x", body: "x" },
        { timeoutMs: 3000 },
      ),
    ).rejects.toThrow("does not offer STARTTLS");
    expect(relay.sessions[0]!.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
  });
});

describe("SMS", () => {
  it("records messages with the fixture provider and sends nothing", async () => {
    expect((await put("sms", { settings: { provider: "fixture" } })).statusCode).toBe(200);
    expect((await createRule([{ kind: "sms", to: ["+17075550100", "+17075550101"] }])).statusCode).toBe(201);
    await write("Levee breach reported");
    const worker = new DeliveryWorker(runtime, { timeoutMs: 3000 });
    expect(await worker.drain()).toMatchObject({ delivered: 2 });
    const recorded = fixtureMessages(jurisdictionId);
    expect(recorded.map((m) => m.to).sort()).toEqual(["+17075550100", "+17075550101"]);
    expect(recorded[0]!.body).toBe("New Activity Log record: Levee breach reported\nEntry: Levee breach reported");
    const rows = await admin`select receipt from delivery_outbox where kind = 'sms'`;
    for (const row of rows) expect(row.receipt).toMatchObject({ provider: "fixture", sent: false });
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/sms`,
      headers: auth(adminToken),
    });
    expect(read.json().fixtureMessages).toHaveLength(2);
    expect(smsPosts).toHaveLength(0);
    await reset();
  });

  it("posts a form with basic auth to an HTTP provider on the allowlist", async () => {
    const settings = { provider: "http", url: `${receiverUrl}/sms`, username: "AC-test-account", from: "+17075550199" };
    const refused = await put("sms", { settings, secret: "provider-token" });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toContain("allowlist");
    const allow = await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-allowlist`,
      headers: auth(adminToken),
      payload: { entries: [receiverUrl] },
    });
    expect(allow.statusCode).toBe(200);
    const saved = await put("sms", { settings, secret: "provider-token" });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("provider-token");

    expect((await createRule([{ kind: "sms", to: ["+17075550100"] }])).statusCode).toBe(201);
    await write("Water main break");
    const worker = new DeliveryWorker(runtime, { timeoutMs: 3000 });
    expect(await worker.drain()).toMatchObject({ delivered: 1 });
    expect(smsPosts).toHaveLength(1);
    expect(smsPosts[0]!.authorization).toBe(`Basic ${Buffer.from("AC-test-account:provider-token").toString("base64")}`);
    expect(smsPosts[0]!.form).toMatchObject({ To: "+17075550100", From: "+17075550199" });
    expect(smsPosts[0]!.form.Body).toContain("New Activity Log record: Water main break");
    const [row] = await admin`select receipt from delivery_outbox where kind = 'sms'`;
    expect(row!.receipt).toMatchObject({ provider: "http", messageId: "SM1", status: "queued" });

    // The test route sends at once and answers with the provider's receipt.
    const test = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-channels/sms/test`,
      headers: auth(adminToken),
      payload: { to: "+17075550102" },
    });
    expect(test.statusCode).toBe(200);
    expect(test.json().receipt).toMatchObject({ provider: "http", messageId: "SM2" });

    // Removed from the allowlist, the provider is no longer contacted.
    await write("Second break");
    await app.inject({
      method: "PUT",
      url: `/api/v1/jurisdictions/${jurisdictionId}/notification-allowlist`,
      headers: auth(adminToken),
      payload: { entries: [] },
    });
    expect(await worker.drain()).toMatchObject({ dead: 1, delivered: 0 });
    expect(smsPosts).toHaveLength(2);
    await reset();
  });
});

describe("rate caps", () => {
  it("count each recipient against the rule's cap", async () => {
    await put("sms", { settings: { provider: "fixture" } });
    const rule = await createRule(
      [{ kind: "sms", to: ["+17075550100", "+17075550101", "+17075550102"] }],
      { max: 2, windowMinutes: 10 },
    );
    expect(rule.statusCode).toBe(201);
    const ruleId = rule.json().id as string;
    await write("Evacuation warning, zone 4");
    const [queued] = await admin`select count(*)::int as n from delivery_outbox where rule_id = ${ruleId}`;
    expect(queued!.n).toBe(2);
    const [notice] = await admin`
      select detail from notifications where rule_id = ${ruleId} and status = 'suppressed'`;
    expect(notice!.detail).toMatchObject({ suppressed: 1, limit: 2 });
    await reset();
  });
});
