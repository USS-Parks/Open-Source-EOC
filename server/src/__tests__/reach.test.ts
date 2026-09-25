import type { Server } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { fixtureMessages } from "../notify/channels.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";
import { fakeRelay, type SmtpSession } from "./smtp-relay.js";

/**
 * VA7: people addressed by group, position and shift. A position reaches
 * whoever holds it, through their contact card; an on-call page reaches the
 * person on shift, or the position's holders when no one is; an unanswered
 * SMS falls back to the contact's email, and an acknowledgement withdraws the
 * email not yet sent; rules address groups and positions; and an activation
 * sends its notice in the same transaction. Email goes to a fake relay and SMS
 * to the fixture provider; nothing leaves the machine.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let sessions: SmtpSession[];
let relay: Server;
let holderId: string;
let dutyId: string;
let nightId: string;
const position: Record<string, string> = {};
const contact: Record<string, string> = {};
const group: Record<string, string> = {};
let boardId: string;

const TOKEN = /\/api\/v1\/ack\/([A-Za-z0-9_-]{22})/;
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function call(method: string, url: string, payload?: unknown, token = adminToken) {
  return app.inject({
    method: method as "GET",
    url,
    headers: auth(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function created(method: string, url: string, payload: unknown): Promise<string> {
  const res = await call(method, url, payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const massUrl = () => `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`;

interface Detail {
  audience: string;
  fallbackMinutes: number | null;
  incidentId: string | null;
  recipients: Array<{
    name: string;
    reachedThrough: string | null;
    acknowledgedAt: string | null;
    deliveries: Array<{ channel: string; address: string | null; state: string; dueAt: string | null }>;
  }>;
}

async function detail(id: string): Promise<Detail> {
  const res = await call("GET", `/api/v1/mass-notifications/${id}`);
  expect(res.statusCode).toBe(200);
  return res.json() as Detail;
}

async function drain(): Promise<void> {
  await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  holderId = await createPerson(admin, { email: "holder@example.org", displayName: "Harper Holder", password: "holder-password-1" });
  dutyId = await createPerson(admin, { email: "duty@example.org", displayName: "Dana Duty", password: "duty-password-12" });
  nightId = await createPerson(admin, { email: "night@example.org", displayName: "Noel Night", password: "night-password-1" });
  for (const id of [holderId, dutyId, nightId]) await addMembership(admin, id, seed.jurisdictionId, "member");
  const mail = await fakeRelay({});
  ({ sessions, server: relay } = mail);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const email = await call("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/email`, {
    settings: { host: "127.0.0.1", port: mail.port, security: "none", from: "eoc@example.org" },
  });
  expect(email.statusCode).toBe(200);
  const sms = await call("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms`, {
    settings: { provider: "fixture" },
  });
  expect(sms.statusCode).toBe(200);

  for (const [key, title] of [["logistics", "Logistics Section Chief"], ["duty", "Duty Officer"],
    ["night", "Night Officer"], ["planning", "Planning Section Chief"]] as const) {
    position[key] = await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`, { key: `${key}_x`, title });
  }
  for (const [key, personId] of [["logistics", holderId], ["duty", seed.memberId], ["night", nightId]] as const) {
    const res = await call("POST", `/api/v1/positions/${position[key]}/assignments`, { personId });
    expect(res.statusCode, res.body).toBeLessThan(300);
  }
  // Dana is on shift as Duty Officer now; the Night Officer's shift ended an hour ago.
  await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/shifts`,
    { positionId: position.duty, personId: dutyId, startsAt: hours(-2), endsAt: hours(6) });
  await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/shifts`,
    { positionId: position.night, personId: nightId, startsAt: hours(-12), endsAt: hours(-1) });

  const cards = [
    { key: "holder", name: "Harper Holder", emails: ["harper@example.org"], phones: ["+17075550201"], personId: holderId },
    { key: "a", name: "Avery Able", emails: ["avery@example.org"], phones: ["+17075550202"] },
    { key: "b", name: "Blair Baker", emails: ["blair@example.org"], phones: ["+17075550203"] },
    { key: "desk", name: "Logistics desk", emails: ["logistics@example.org"], phones: [], positionId: position.logistics },
  ];
  for (const { key, ...body } of cards) contact[key] = await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contacts`, body);
  group.duty = await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contact-groups`,
    { name: "Duty officers", contactIds: [contact.a, contact.b] });
  group.logistics = await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contact-groups`,
    { name: "Logistics", contactIds: [contact.a, contact.holder] });
  boardId = await created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: "resource_request" });
}, 60_000);

afterAll(async () => {
  relay?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("reach by position and shift", () => {
  it("reaches a position's contact card and its holder through the holder's card", async () => {
    const id = await created("POST", massUrl(), {
      subject: "Staging", message: "Stage at the fairgrounds.", positionIds: [position.logistics],
      channels: ["email", "sms", "inapp"], mode: "broadcast",
    });
    const sent = await detail(id);
    expect(sent.audience).toBe("Logistics Section Chief");
    expect(sent.recipients.map((r) => [r.name, r.reachedThrough])).toEqual([
      ["Logistics desk", "Contact for Logistics Section Chief"],
      ["Harper Holder", "Holds Logistics Section Chief"],
    ]);
    const harper = sent.recipients[1]!.deliveries;
    expect(harper.map((d) => [d.channel, d.address, d.state])).toEqual([
      ["email", "harper@example.org", "queued"], ["inapp", null, "delivered"], ["sms", "+17075550201", "queued"],
    ]);
    const [notice] = await admin`
      select n.person_id from notifications n join mass_notification_recipients r on r.id = n.mass_recipient_id
      where r.mass_notification_id = ${id} and n.channel = 'inapp'`;
    expect(notice!.person_id).toBe(holderId);
  });

  it("pages whoever is on shift, and the position's holders when no one is", async () => {
    const onShift = await detail(await created("POST", massUrl(), {
      subject: "Page", message: "Call the EOC.", onCallPositionIds: [position.duty], channels: ["inapp", "sms"], mode: "broadcast",
    }));
    // Dana is on shift but has no contact card, so the page reaches her in the app only.
    expect(onShift.audience).toBe("On call: Duty Officer");
    expect(onShift.recipients.map((r) => [r.name, r.reachedThrough, r.deliveries.map((d) => d.channel)])).toEqual([
      ["Dana Duty", "On shift as Duty Officer", ["inapp"]],
    ]);

    const gap = await detail(await created("POST", massUrl(), {
      subject: "Page", message: "Call the EOC.", onCallPositionIds: [position.night], channels: ["inapp"], mode: "broadcast",
    }));
    expect(gap.audience).toBe("On call: Night Officer (no one on shift, so its holders)");
    expect(gap.recipients.map((r) => [r.name, r.reachedThrough])).toEqual([
      ["Noel Night", "Holds Night Officer, no one on shift"],
    ]);
  });

  it("reaches each person once across groups and positions, and says which part reached no one", async () => {
    const sent = await detail(await created("POST", massUrl(), {
      subject: "Briefing", message: "Briefing at 0700.", groupIds: [group.duty, group.logistics],
      positionIds: [position.logistics, position.planning], channels: ["email"], mode: "broadcast",
    }));
    expect(sent.recipients.map((r) => [r.name, r.reachedThrough])).toEqual([
      ["Avery Able", "Group: Duty officers"],
      ["Blair Baker", "Group: Duty officers"],
      ["Harper Holder", "Group: Logistics"],
      ["Logistics desk", "Contact for Logistics Section Chief"],
    ]);
    expect(sent.audience).toBe("Duty officers, Logistics, Logistics Section Chief, Planning Section Chief (no one reached)");
    const [record] = await admin`select group_id, audience from mass_notifications where subject = 'Briefing'`;
    // Two groups: the send names no single group.
    expect(record!.group_id).toBeNull();
    expect(record!.audience).toMatchObject({ positions: [{ reached: 2 }, { reached: 0 }] });
  });

  it("refuses a send that reaches no one, and a position from outside the jurisdiction", async () => {
    const empty = await call("POST", massUrl(), {
      subject: "S", message: "M", positionIds: [position.planning], channels: ["inapp"], mode: "broadcast",
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error).toMatch(/no one to notify/);
    const stranger = await call("POST", massUrl(), {
      subject: "S", message: "M", positionIds: ["00000000-0000-4000-8000-000000000000"], channels: ["inapp"], mode: "broadcast",
    });
    expect(stranger.statusCode).toBe(422);
  });
});

describe("fallback to the next device", () => {
  it("sends SMS first, withdraws the email when the SMS is acknowledged, and sends it when it is not", async () => {
    const id = await created("POST", massUrl(), {
      subject: "Levee breach", message: "Evacuate the north levee.", contactIds: [contact.a, contact.b],
      channels: ["sms", "email"], fallbackMinutes: 10, mode: "broadcast",
    });
    let sent = await detail(id);
    expect(sent.fallbackMinutes).toBe(10);
    for (const r of sent.recipients) {
      expect(r.deliveries.map((d) => [d.channel, d.state])).toEqual([["email", "scheduled"], ["sms", "queued"]]);
      const due = Date.parse(r.deliveries[0]!.dueAt!);
      expect(due - Date.now()).toBeGreaterThan(9 * 60_000);
      expect(due - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    }
    // A fallback is held for its window from when it falls due.
    const held = await admin`
      select extract(epoch from d.hold_until - d.next_attempt_at)::int as seconds from delivery_outbox d
      join notifications n on n.id = d.notification_id
      join mass_notification_recipients r on r.id = n.mass_recipient_id
      where r.mass_notification_id = ${id} and d.kind = 'email'`;
    expect(held.map((h) => h.seconds)).toEqual([72 * 3600, 72 * 3600]);

    await drain();
    // The worker sends only what is due: two texts, no mail yet.
    expect(sessions.filter((s) => s.data.includes("Levee breach"))).toHaveLength(0);
    const text = fixtureMessages(seed.jurisdictionId).find((m) => m.to === "+17075550202")!;
    const token = TOKEN.exec(text.body)![1]!;
    const ack = await app.inject({ method: "POST", url: `/api/v1/ack/${token}`, headers: { "content-type": "text/plain" }, payload: "" });
    expect(ack.statusCode).toBe(200);

    sent = await detail(id);
    const [avery, blair] = sent.recipients;
    expect(avery!.acknowledgedAt).not.toBeNull();
    // Avery answered the text, so the email waiting for Avery is withdrawn with its notification.
    expect(avery!.deliveries.map((d) => [d.channel, d.state])).toEqual([["sms", "sent"]]);
    expect(blair!.deliveries.map((d) => [d.channel, d.state])).toEqual([["email", "scheduled"], ["sms", "sent"]]);

    // Ten minutes on, Blair has not answered: the email goes.
    await admin`
      update delivery_outbox d set next_attempt_at = now() from notifications n
      where n.id = d.notification_id and n.detail ? 'fallbackAt' and d.status = 'pending'`;
    await drain();
    sent = await detail(id);
    expect(sent.recipients[1]!.deliveries.map((d) => [d.channel, d.state])).toEqual([["email", "sent"], ["sms", "sent"]]);
    const mails = sessions.filter((s) => s.data.includes("Subject: Levee breach"));
    expect(mails.map((s) => s.commands.find((c) => c.startsWith("RCPT TO")))).toEqual(["RCPT TO:<blair@example.org>"]);
  });

  it("goes straight to the next device a contact has an address for", async () => {
    const id = await created("POST", massUrl(), {
      subject: "Desk", message: "Desk check.", contactIds: [contact.desk], channels: ["sms", "email"], fallbackMinutes: 5, mode: "broadcast",
    });
    // The desk has no phone, so its email is the first device and goes at once.
    expect((await detail(id)).recipients[0]!.deliveries.map((d) => [d.channel, d.state])).toEqual([["email", "queued"]]);
  });
});

describe("rules addressed to groups and positions", () => {
  async function rule(channels: unknown[]): Promise<string> {
    return created("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`, {
      boardId, event: "record.created", channels, rateLimit: { max: 600, windowMinutes: 1 },
    });
  }

  it("reaches a position's holder, the person on call and a group, and logs a position that reaches no one", async () => {
    const holders = await rule([{ kind: "position", positionId: position.logistics, via: ["inapp", "email"] }]);
    const onCall = await rule([{ kind: "position", positionId: position.duty, reach: "on_call", via: ["inapp"] }]);
    const crew = await rule([{ kind: "group", groupId: group.duty, via: ["sms"] }]);
    const nobody = await rule([{ kind: "position", positionId: position.planning, via: ["email"] }]);
    const res = await call("POST", `/api/v1/boards/${boardId}/records`,
      { item: "Generators", quantity: 2, priority: "immediate", state: "submitted" });
    expect(res.statusCode, res.body).toBe(201);

    const logged = await admin`
      select rule_id, channel, status, person_id, position_id, detail from notifications
      where rule_id = any(${[holders, onCall, crew, nobody]}::uuid[])`;
    // One transaction writes them all at one time, so they are compared in a fixed order.
    const of = (ruleId: string) => logged.filter((n) => n.rule_id === ruleId)
      .map((n) => [n.channel, n.detail.to ?? n.person_id ?? n.position_id, n.detail.reachedThrough ?? null, n.status])
      .sort((a, b) => String(a).localeCompare(String(b)));
    // The desk card carries the position's shared email; Harper holds it, so the
    // app notice goes to Harper and not also to the position she would see it in.
    expect(of(holders)).toEqual([
      ["email", "harper@example.org", "Holds Logistics Section Chief", "pending"],
      ["email", "logistics@example.org", "Contact for Logistics Section Chief", "pending"],
      ["inapp", holderId, "Holds Logistics Section Chief", "delivered"],
    ]);
    expect(of(onCall)).toEqual([["inapp", dutyId, "On shift as Duty Officer", "delivered"]]);
    expect(of(crew).map((n) => n[1])).toEqual(["+17075550202", "+17075550203"]);
    const [failed] = logged.filter((n) => n.rule_id === nobody);
    expect([failed!.channel, failed!.status, failed!.detail.error]).toEqual(
      ["email", "failed", "No one to reach: Planning Section Chief (no one reached)"]);
    expect(logged.filter((n) => n.rule_id === nobody)).toHaveLength(1);
  });

  it("refuses a rule whose group or position is not the jurisdiction's", async () => {
    const url = `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`;
    const stranger = "00000000-0000-4000-8000-000000000000";
    for (const channel of [
      { kind: "group", groupId: stranger, via: ["inapp"] },
      { kind: "position", positionId: stranger, via: ["inapp"] },
    ]) {
      const res = await call("POST", url, { boardId, event: "record.created", channels: [channel] });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(/is not one of this jurisdiction's/);
    }
  });
});

describe("activation notifies", () => {
  it("sends the chosen group and the person on call a notice that names the incident", async () => {
    const res = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
      templateKey: "wildfire", name: "Bluff Creek Fire", kind: "incident",
      notify: { groupIds: [group.duty], onCallPositionIds: [position.duty], channels: ["inapp", "sms"] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { incidentId, notice } = res.json() as { incidentId: string; notice: { massNotificationId: string; recipients: number } };
    expect(notice.recipients).toBe(3);
    const sent = await detail(notice.massNotificationId);
    expect(sent.incidentId).toBe(incidentId);
    expect(sent.audience).toBe("Duty officers, On call: Duty Officer");
    expect(sent.recipients.map((r) => r.name)).toEqual(["Avery Able", "Blair Baker", "Dana Duty"]);
    const [record] = await admin`select subject, message, mode from mass_notifications where id = ${notice.massNotificationId}`;
    expect(record).toMatchObject({ subject: "Activated: Bluff Creek Fire", mode: "broadcast" });
    // Dana's in-app notice opens the incident; the send is on the incident's record.
    const [inapp] = await admin`
      select n.incident_id from notifications n join mass_notification_recipients r on r.id = n.mass_recipient_id
      where r.mass_notification_id = ${notice.massNotificationId} and n.channel = 'inapp'`;
    expect(inapp!.incident_id).toBe(incidentId);
    const [audit] = await admin`
      select incident_id from audit_events where category = 'notification.mass_sent' and subject_id = ${notice.massNotificationId}`;
    expect(audit!.incident_id).toBe(incidentId);
  });

  it("activates without a notice when none is asked for, and not at all when the notice reaches no one", async () => {
    const plain = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      { templateKey: "wildfire", name: "Quiet Fire" });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().notice).toBeUndefined();
    const refused = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
      templateKey: "wildfire", name: "Unheard Fire", notify: { positionIds: [position.planning], channels: ["inapp"] },
    });
    expect(refused.statusCode).toBe(422);
    expect(await admin`select id from incidents where name = 'Unheard Fire'`).toHaveLength(0);
  });
});
