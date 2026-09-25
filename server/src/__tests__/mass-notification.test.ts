import type { Server } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson, principalForPerson } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { fixtureMessages } from "../notify/channels.js";
import { runDueCalldowns } from "../notify/mass.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";
import { bodyOf, fakeRelay, type SmtpSession } from "./smtp-relay.js";

/**
 * Mass notification to contacts: one notification per contact and channel
 * through the delivery queue, receipts from what the relay or provider
 * answered, acknowledgement by a per-recipient link or in the app, and a
 * call-down that moves to the next contact when the current one has not
 * acknowledged in time. Email goes to a fake relay and SMS to the fixture
 * provider; nothing leaves the machine.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let sessions: SmtpSession[];
let refusedSessions: SmtpSession[];
const relays: Server[] = [];
let relayPort: number;
let refusingPort: number;
const contact: Record<string, string> = {};
let groupId: string;

const TOKEN = /\/api\/v1\/ack\/([A-Za-z0-9_-]{22})/;

async function call(method: string, url: string, token: string | null, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url,
    headers: token ? auth(token) : {},
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function send(payload: Record<string, unknown>, token = memberToken): Promise<string> {
  const res = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`, token, payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function detail(id: string, token = memberToken) {
  const res = await call("GET", `/api/v1/mass-notifications/${id}`, token);
  expect(res.statusCode).toBe(200);
  return res.json() as {
    state: string;
    acknowledged: number;
    notified: number;
    completedAt: string | null;
    recipients: Array<{
      name: string;
      notifiedAt: string | null;
      acknowledgedAt: string | null;
      acknowledgedVia: string | null;
      deliveries: Array<{ channel: string; address: string | null; state: string; error: string | null; receipt: Record<string, unknown> | null }>;
    }>;
  };
}

/** The acknowledgement token the fixture SMS provider recorded for a number, newest first. */
function smsToken(phone: string): string {
  const message = fixtureMessages(seed.jurisdictionId).find((m) => m.to === phone);
  const match = message ? TOKEN.exec(message.body) : null;
  if (!match) throw new Error(`no acknowledgement link sent to ${phone}`);
  return match[1]!;
}

async function drain(): Promise<void> {
  await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
}

async function setEmailRelay(port: number): Promise<void> {
  const res = await call("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/email`, adminToken, {
    settings: { host: "127.0.0.1", port, security: "none", from: "eoc@example.org" },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  const relay = await fakeRelay({});
  const refusing = await fakeRelay({ refuseMail: "550 5.7.1 sender refused" });
  relays.push(relay.server, refusing.server);
  ({ sessions, port: relayPort } = relay);
  ({ sessions: refusedSessions, port: refusingPort } = refusing);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  await setEmailRelay(relayPort);
  const sms = await call("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms`, adminToken, {
    settings: { provider: "fixture" },
  });
  expect(sms.statusCode).toBe(200);
  const people = [
    { key: "a", name: "Avery First", emails: ["avery@example.org"], phones: ["+17075550101"], personId: seed.memberId },
    { key: "b", name: "Bailey Second", emails: ["bailey@example.org"], phones: ["+17075550102"] },
    { key: "c", name: "Cameron Third", emails: ["cameron@example.org"], phones: [] },
  ];
  for (const { key, ...body } of people) {
    const res = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contacts`, adminToken, body);
    expect(res.statusCode).toBe(201);
    contact[key] = res.json().id as string;
  }
  const group = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contact-groups`, adminToken, {
    name: "Duty officers",
    contactIds: [contact.a, contact.b, contact.c],
  });
  groupId = group.json().id as string;
}, 60_000);

beforeEach(async () => {
  // Each test starts with no open call-downs left over from the one before.
  await admin`update mass_notifications set completed_at = now() where completed_at is null`;
});

afterAll(async () => {
  for (const relay of relays) relay.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("broadcast", () => {
  it("queues one notification per contact and channel and records the send", async () => {
    const id = await send({
      subject: "Levee watch",
      message: "Report to the EOC by 1800.",
      groupId,
      channels: ["email", "sms", "inapp"],
      mode: "broadcast",
    });
    const queued = await admin`
      select d.kind, d.target, d.status, d.rule_id from delivery_outbox d
      join notifications n on n.id = d.notification_id
      join mass_notification_recipients r on r.id = n.mass_recipient_id
      where r.mass_notification_id = ${id} order by d.target`;
    expect(queued.map((q) => [q.kind, q.target, q.status])).toEqual([
      ["sms", "+17075550101", "pending"],
      ["sms", "+17075550102", "pending"],
      ["email", "avery@example.org", "pending"],
      ["email", "bailey@example.org", "pending"],
      ["email", "cameron@example.org", "pending"],
    ]);
    expect(queued.every((q) => q.rule_id === null)).toBe(true);
    // The contact linked to a person also gets an in-app notice addressed to that person.
    const [inapp] = await admin`
      select n.person_id, n.status, n.title from notifications n
      join mass_notification_recipients r on r.id = n.mass_recipient_id
      where r.mass_notification_id = ${id} and n.channel = 'inapp'`;
    expect(inapp).toMatchObject({ person_id: seed.memberId, status: "delivered", title: "Levee watch" });
    const [record] = await admin`select sent_by, group_name, channels, mode from mass_notifications where id = ${id}`;
    expect(record).toMatchObject({ sent_by: seed.memberId, group_name: "Duty officers", channels: ["email", "sms", "inapp"], mode: "broadcast" });
    const [audit] = await admin`select payload from audit_events where category = 'notification.mass_sent' and subject_id = ${id}`;
    expect(audit!.payload).toMatchObject({ mode: "broadcast", recipients: 3 });

    // Receipts: queued until the worker sends, then what the relay and provider answered.
    const before = await detail(id);
    expect(before.state).toBe("sent");
    expect(before.recipients[0]!.deliveries.map((d) => [d.channel, d.state])).toEqual([
      ["email", "queued"],
      ["inapp", "delivered"],
      ["sms", "queued"],
    ]);
    expect(before.recipients[2]!.deliveries.map((d) => d.channel)).toEqual(["email"]);
    await drain();
    const after = await detail(id, viewerToken);
    const avery = after.recipients[0]!.deliveries;
    expect(avery.find((d) => d.channel === "email")).toMatchObject({ state: "sent", address: "avery@example.org" });
    expect(String(avery.find((d) => d.channel === "email")!.receipt!.response)).toContain("250 2.0.0 Ok: queued as");
    expect(avery.find((d) => d.channel === "sms")!.receipt).toMatchObject({ provider: "fixture", sent: false });
    const averyMail = sessions.find((s) => s.commands.includes("RCPT TO:<avery@example.org>"))!;
    expect(averyMail.data).toContain("Subject: Levee watch");
    expect(bodyOf(averyMail.data)).toMatch(TOKEN);
  });

  it("shows a relay's refusal as failed with its error", async () => {
    await setEmailRelay(refusingPort);
    try {
      const id = await send({ subject: "Refused", message: "x", contactIds: [contact.b], channels: ["email"], mode: "broadcast" });
      await drain();
      const [delivery] = (await detail(id)).recipients[0]!.deliveries;
      expect(delivery).toMatchObject({ channel: "email", state: "failed" });
      expect(delivery!.error).toContain("550 5.7.1 sender refused");
      expect(refusedSessions).toHaveLength(1);
    } finally {
      await setEmailRelay(relayPort);
    }
  });

  it("is refused to viewers and checks what it is sent to", async () => {
    const body = { subject: "S", message: "M", groupId, channels: ["email"], mode: "broadcast" };
    const url = `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`;
    expect((await call("POST", url, viewerToken, body)).statusCode).toBe(403);
    const { groupId: _group, ...nobody } = body;
    expect((await call("POST", url, memberToken, nobody)).json().error).toMatch(/send to a contact group, chosen contacts/);
    expect((await call("POST", url, memberToken, { ...body, groupIds: [groupId] })).statusCode).toBe(422);
    expect((await call("POST", url, memberToken, { ...body, mode: "calldown" })).statusCode).toBe(422);
    const fallback = { ...body, channels: ["sms", "email"], fallbackMinutes: 5 };
    expect((await call("POST", url, memberToken, { ...fallback, mode: "calldown", intervalMinutes: 5 })).json().error)
      .toMatch(/applies to a broadcast/);
    expect((await call("POST", url, memberToken, { ...fallback, channels: ["sms", "inapp"] })).json().error)
      .toMatch(/needs both SMS and email/);
    expect((await call("POST", url, memberToken, { ...body, channels: ["fax"] })).statusCode).toBe(400);
    const listed = await call("GET", url, viewerToken);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().massNotifications.length).toBeGreaterThanOrEqual(2);
  });
});

describe("acknowledgement link", () => {
  it("acknowledges one recipient, shows nothing about the send, and refuses an expired or unknown token", async () => {
    const id = await send({ subject: "Shelter open", message: "Check in.", groupId, channels: ["sms"], mode: "broadcast" });
    await drain();
    const avery = smsToken("+17075550101");
    const bailey = smsToken("+17075550102");

    const page = await call("GET", `/api/v1/ack/${avery}`, null);
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("<button type=\"submit\">Acknowledge</button>");
    expect(page.body).not.toContain("Shelter open");
    expect(page.body).not.toContain("Avery");
    // Opening the link records nothing; only the button does.
    expect((await detail(id)).acknowledged).toBe(0);

    const done = await app.inject({ method: "POST", url: `/api/v1/ack/${avery}`, headers: { "content-type": "text/plain" }, payload: "" });
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain("Acknowledged");
    const acked = await detail(id);
    expect(acked.recipients.map((r) => [r.name, r.acknowledgedVia])).toEqual([
      ["Avery First", "link"],
      ["Bailey Second", null],
      ["Cameron Third", null],
    ]);

    await admin`
      update mass_notification_recipients set token_expires_at = now() - interval '1 minute'
      where mass_notification_id = ${id} and name = 'Bailey Second'`;
    const expired = await app.inject({ method: "POST", url: `/api/v1/ack/${bailey}`, headers: { "content-type": "text/plain" }, payload: "" });
    expect(expired.statusCode).toBe(404);
    expect(expired.body).toContain("not valid or has expired");
    expect((await call("GET", "/api/v1/ack/AAAAAAAAAAAAAAAAAAAAAA", null)).statusCode).toBe(404);
    expect((await call("GET", "/api/v1/ack/short", null)).statusCode).toBe(404);
    expect((await detail(id)).acknowledged).toBe(1);

    // Acknowledgement is written only through the link and the app, never by a direct update.
    await expect(
      withPerson(runtime, seed.adminId, (tx) => tx`
        update mass_notification_recipients set acknowledged_at = now() where mass_notification_id = ${id}`),
    ).rejects.toThrow(/permission denied/);
  });

  it("acknowledges a contact linked to a person when that person acknowledges in the app", async () => {
    const id = await send({ subject: "In app", message: "Confirm.", contactIds: [contact.a], channels: ["inapp"], mode: "broadcast" });
    const [notice] = await admin`
      select n.id from notifications n join mass_notification_recipients r on r.id = n.mass_recipient_id
      where r.mass_notification_id = ${id}`;
    const res = await call("POST", `/api/v1/notifications/${notice!.id as string}/acknowledge`, memberToken);
    expect(res.statusCode).toBe(200);
    const [recipient] = (await detail(id)).recipients;
    expect(recipient).toMatchObject({ acknowledgedVia: "app" });
  });

  it("limits link requests from one address", async () => {
    const hit = () => app.inject({ method: "GET", url: "/api/v1/ack/AAAAAAAAAAAAAAAAAAAAAA", remoteAddress: "192.0.2.7" });
    for (let i = 0; i < 30; i += 1) expect((await hit()).statusCode).toBe(404);
    expect((await hit()).statusCode).toBe(429);
  });
});

describe("response options", () => {
  const answer = (token: string, body: string) =>
    app.inject({ method: "POST", url: `/api/v1/ack/${token}`, headers: { "content-type": "text/plain" }, payload: body });

  it("asks a question with three answers, takes each on the link and counts them", async () => {
    const id = await send({
      subject: "Shift availability", message: "Can you work the 1900 shift?", groupId, channels: ["sms", "email"],
      mode: "broadcast", responseOptions: ["Available", "Not available", "<b>Later</b>"],
    });
    await drain();
    const avery = smsToken("+17075550101");
    const bailey = smsToken("+17075550102");
    const text = fixtureMessages(seed.jurisdictionId).find((m) => m.to === "+17075550101")!;
    expect(text.body).toContain("Answer Available, Not available or <b>Later</b>:");

    const page = await call("GET", `/api/v1/ack/${avery}`, null);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<h1>Answer this message</h1>");
    expect(page.body).toContain('<button type="submit" name="response" value="0">Available</button>');
    // An answer is the sender's words, shown as text, never as markup.
    expect(page.body).toContain("&#60;b&#62;Later&#60;/b&#62;");
    expect(page.body).not.toContain("<b>Later</b>");
    expect(page.body).not.toContain("Shift availability");

    // An acknowledgement without an answer, or with one not offered, is refused and records nothing.
    expect((await answer(avery, "")).statusCode).toBe(400);
    expect((await answer(avery, "response=3\r\n")).statusCode).toBe(400);
    expect((await detail(id)).acknowledged).toBe(0);

    const done = await answer(avery, "response=1\r\n");
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain("Your answer, Not available, is recorded.");
    expect((await answer(bailey, "response=0\r\n")).statusCode).toBe(200);
    let sent = (await call("GET", `/api/v1/mass-notifications/${id}`, memberToken)).json();
    expect(sent.responses).toEqual([
      { option: "Available", count: 1 }, { option: "Not available", count: 1 }, { option: "<b>Later</b>", count: 0 },
    ]);
    expect(sent.recipients.map((r: { name: string; response: string | null }) => [r.name, r.response])).toEqual([
      ["Avery First", "Not available"], ["Bailey Second", "Available"], ["Cameron Third", null],
    ]);

    // Avery changes the answer; the first acknowledgement's time stands.
    const [first] = await admin`select acknowledged_at from mass_notification_recipients where mass_notification_id = ${id} and name = 'Avery First'`;
    expect((await answer(avery, "response=2\r\n")).statusCode).toBe(200);
    sent = (await call("GET", `/api/v1/mass-notifications/${id}`, memberToken)).json();
    expect(sent.responses.map((r: { count: number }) => r.count)).toEqual([1, 0, 1]);
    const [again] = await admin`select acknowledged_at from mass_notification_recipients where mass_notification_id = ${id} and name = 'Avery First'`;
    expect(again!.acknowledged_at).toEqual(first!.acknowledged_at);
    expect(sent.acknowledged).toBe(2);
  });

  it("keeps a plain acknowledgement for a send that asks nothing, and refuses duplicate or overlong answers", async () => {
    const id = await send({ subject: "Plain", message: "No question.", contactIds: [contact.b], channels: ["sms"], mode: "broadcast" });
    await drain();
    const token = smsToken("+17075550102");
    const page = await call("GET", `/api/v1/ack/${token}`, null);
    expect(page.body).toContain("<button type=\"submit\">Acknowledge</button>");
    expect((await answer(token, "")).statusCode).toBe(200);
    expect((await detail(id)).acknowledged).toBe(1);
    expect((await call("GET", `/api/v1/mass-notifications/${id}`, memberToken)).json().responses).toEqual([]);
    const url = `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`;
    const base = { subject: "S", message: "M", contactIds: [contact.b], channels: ["sms"], mode: "broadcast" };
    expect((await call("POST", url, memberToken, { ...base, responseOptions: ["Yes", "Yes"] })).statusCode).toBe(400);
    expect((await call("POST", url, memberToken, { ...base, responseOptions: ["x".repeat(61)] })).statusCode).toBe(400);
    expect((await call("POST", url, memberToken, { ...base, responseOptions: ["1", "2", "3", "4", "5", "6", "7"] })).statusCode).toBe(400);
  });
});

describe("call-down", () => {
  const minutes = (n: number) => new Date(Date.now() + n * 60_000);

  it("escalates to the next contact after the interval and stops at the first acknowledgement", async () => {
    const id = await send({ subject: "Page duty officer", message: "Call the EOC.", groupId, channels: ["sms"], mode: "calldown", intervalMinutes: 10 });
    const actor = await principalForPerson(runtime, seed.adminId);
    let state = await detail(id);
    expect(state.recipients.map((r) => Boolean(r.notifiedAt))).toEqual([true, false, false]);
    expect(state.state).toBe("calling");

    // Within the interval nothing moves, and the scheduler finds nothing due.
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(5))).toBe(0);
    expect(await runtime`select * from scheduler_due('calldowns', ${minutes(5)})`).toHaveLength(0);
    const due = await runtime`select * from scheduler_due('calldowns', ${minutes(11)})`;
    expect(due.map((r) => ({ ...r }))).toEqual([
      { jurisdiction_id: seed.jurisdictionId, person_id: seed.adminId },
    ]);
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(11))).toBe(1);
    state = await detail(id);
    expect(state.recipients.map((r) => Boolean(r.notifiedAt))).toEqual([true, true, false]);

    await drain();
    const bailey = smsToken("+17075550102");
    await app.inject({ method: "POST", url: `/api/v1/ack/${bailey}`, headers: { "content-type": "text/plain" }, payload: "" });
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(12))).toBe(0);
    state = await detail(id);
    expect(state.state).toBe("acknowledged");
    expect(state.completedAt).not.toBeNull();
    expect(state.recipients.map((r) => [r.name, Boolean(r.notifiedAt), r.acknowledgedVia])).toEqual([
      ["Avery First", true, null],
      ["Bailey Second", true, "link"],
      ["Cameron Third", false, null],
    ]);
    // A finished call-down calls no one else, however long it waits.
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(60))).toBe(0);
  });

  it("moves on at once when more acknowledgements are needed, and ends unacknowledged when no one is left", async () => {
    const id = await send({
      subject: "Two needed",
      message: "Two responders.",
      groupId,
      channels: ["sms", "email"],
      mode: "calldown",
      intervalMinutes: 15,
      acknowledgementsNeeded: 2,
    });
    const actor = await principalForPerson(runtime, seed.adminId);
    await drain();
    await app.inject({ method: "POST", url: `/api/v1/ack/${smsToken("+17075550101")}`, headers: { "content-type": "text/plain" }, payload: "" });
    // The current contact acknowledged, so the next is called without waiting the interval.
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(1))).toBe(1);
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(17))).toBe(1);
    let state = await detail(id);
    expect(state.notified).toBe(3);
    expect(state.state).toBe("calling");
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, minutes(33))).toBe(0);
    state = await detail(id);
    expect(state.state).toBe("unacknowledged");
    expect(state.acknowledged).toBe(1);
  });
});

describe("records", () => {
  it("keeps what a send reached after its contact is deleted", async () => {
    const res = await call("DELETE", `/api/v1/contacts/${contact.c}`, adminToken);
    expect(res.statusCode).toBe(204);
    const kept = await admin`
      select contact_id, name, email from mass_notification_recipients where name = 'Cameron Third' and notified_at is not null`;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((r) => r.contact_id === null && r.email === "cameron@example.org")).toBe(true);
  });
});
