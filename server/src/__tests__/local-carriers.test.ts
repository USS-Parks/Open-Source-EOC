import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson, principalForPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { readDueSmsReplies, replyChoice } from "../contacts/carriers.js";
import { runDueCalldowns } from "../notify/mass.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";
import { fixtureGateway, type FixtureGateway } from "./sms-gateway-fixture.js";

/**
 * Local carriers (AG-05) on a real database: SMS through a gateway on the
 * site network (the fixture phone here), replies read back from its inbox as
 * acknowledgements and answers, acknowledgements entered from a printed
 * call-down sheet, and the radio and runner log. Nothing leaves the machine.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let gateway: FixtureGateway;
let adminToken: string;
let memberToken: string;
let viewerToken: string;
let groupId: string;
let priorKey: string | undefined;
const PHONES = { avery: "+17075550101", bailey: "+17075550102", cameron: "+17075550103" };
const HOUR = 3_600_000;

async function call(method: string, url: string, token: string | null, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url,
    headers: token ? auth(token) : {},
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function setGateway(settings: Record<string, unknown>, secret?: string) {
  return call("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms`, adminToken, {
    settings: { provider: "gateway", username: gateway.username, ...settings },
    ...(secret === undefined ? {} : { secret }),
  });
}

async function send(payload: Record<string, unknown>): Promise<string> {
  const res = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`, memberToken,
    { groupId, channels: ["sms"], mode: "broadcast", ...payload });
  expect(res.statusCode, res.body).toBe(201);
  await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
  return res.json().id as string;
}

interface Recipient {
  id: string;
  name: string;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedVia: string | null;
  response: string | null;
  replies: Array<{ body: string; outcome: string }>;
  deliveries: Array<{ state: string; receipt: Record<string, unknown> | null }>;
}

async function detail(id: string) {
  const res = await call("GET", `/api/v1/mass-notifications/${id}`, memberToken);
  expect(res.statusCode).toBe(200);
  const body = res.json() as { acknowledged: number; completedAt: string | null; responses: Array<{ option: string; count: number }>; recipients: Recipient[] };
  return { ...body, by: (name: string) => body.recipients.find((r) => r.name === name)! };
}

async function readReplies(token = adminToken) {
  return call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/sms-replies/read`, token);
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-carrier-key";
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const viewerId = await createPerson(admin, { email: "viewer@example.org", displayName: "Viewer", password: "viewer-password-1" });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  gateway = await fixtureGateway();
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  viewerToken = await tokenFor(app, "viewer@example.org", "viewer-password-1");
  const ids: string[] = [];
  for (const [name, phone] of [["Avery First", PHONES.avery], ["Bailey Second", PHONES.bailey], ["Cameron Third", PHONES.cameron]] as const) {
    const res = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contacts`, adminToken, { name, phones: [phone] });
    expect(res.statusCode).toBe(201);
    ids.push(res.json().id as string);
  }
  const group = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/contact-groups`, adminToken,
    { name: "Duty officers", contactIds: ids });
  groupId = group.json().id as string;
}, 60_000);

beforeEach(() => {
  gateway.down = false;
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  await gateway?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the answer a text reply picks", () => {
  it("takes an answer's number or its words, and nothing else", () => {
    const options = ["Available", "Not available", "Available after 2200"];
    expect(replyChoice("1", options)).toBe(0);
    expect(replyChoice(" 3. ", options)).toBe(2);
    expect(replyChoice("not  AVAILABLE!", options)).toBe(1);
    expect(replyChoice("0", options)).toBeNull();
    expect(replyChoice("4", options)).toBeNull();
    expect(replyChoice("who is this?", options)).toBeNull();
  });
});

describe("an SMS gateway on the site network", () => {
  it("is configured by an administrator only, at an address on the site network, with its password kept", async () => {
    const offSite = await setGateway({ url: "http://203.0.113.9:8080" }, gateway.password);
    expect(offSite.statusCode).toBe(422);
    expect(offSite.json().error).toContain("an IP address on the site network");
    expect((await setGateway({ url: "http://sms-phone.example.org:8080" }, gateway.password)).statusCode).toBe(422);
    expect((await setGateway({ url: gateway.url })).json().error).toBe("enter the gateway password");
    const member = await call("PUT", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms`, memberToken,
      { settings: { provider: "gateway", url: gateway.url, username: "sms" }, secret: "x" });
    expect(member.statusCode).toBe(403);
    const saved = await setGateway({ url: gateway.url }, gateway.password);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(gateway.password);
    expect(saved.json()).toMatchObject({ settings: { provider: "gateway", url: gateway.url }, replies: [] });

    const test = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms/test`, adminToken,
      { to: "+17075550100" });
    expect(test.statusCode, test.body).toBe(200);
    expect(test.json().receipt).toMatchObject({ provider: "gateway", messageId: "msg-1", status: "Pending" });
    expect(gateway.sent.at(-1)).toMatchObject({ to: "+17075550100", text: expect.stringContaining("The channel is working.") });
  });

  it("sends a question by text and reads the answers back as the recipients' acknowledgements", async () => {
    const id = await send({ subject: "Levee watch", message: "Seepage at mile 4. Can you staff the levee?", responseOptions: ["Available", "Not available"] });
    const texts = gateway.sent.filter((t) => t.text.startsWith("Levee watch:"));
    expect(texts.map((t) => t.to).sort()).toEqual(Object.values(PHONES).sort());
    expect(texts[0]!.text).toMatch(/Reply 1 for Available or 2 for Not available, or answer at http\S+\/api\/v1\/ack\/[A-Za-z0-9_-]{22}$/);
    expect((await detail(id)).by("Avery First").deliveries[0]).toMatchObject({ state: "sent", receipt: { provider: "gateway", status: "Pending" } });

    gateway.reply(PHONES.avery, "1");
    // A phone may give the sender in national form.
    gateway.reply("7075550102", "not available.");
    gateway.reply(PHONES.cameron, "who is this?");
    gateway.reply("+15550001111", "wrong number");
    expect((await readReplies(memberToken)).statusCode).toBe(403);
    const read = await readReplies();
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({ read: 4, acknowledged: 0, answered: 2, notAnAnswer: 1, unmatched: 1 });
    // Each text is read once.
    expect((await readReplies()).json()).toMatchObject({ read: 0 });

    let receipts = await detail(id);
    expect(receipts.responses).toEqual([{ option: "Available", count: 1 }, { option: "Not available", count: 1 }]);
    expect(receipts.by("Avery First")).toMatchObject({ acknowledgedVia: "sms", response: "Available", replies: [{ body: "1", outcome: "answered" }] });
    expect(receipts.by("Bailey Second")).toMatchObject({ acknowledgedVia: "sms", response: "Not available" });
    expect(receipts.by("Cameron Third")).toMatchObject({ acknowledgedAt: null, replies: [{ body: "who is this?", outcome: "not_an_answer" }] });
    const view = await call("GET", `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms`, adminToken);
    expect(view.json().replies.map((r: { sender: string; outcome: string; recipient: string | null }) => [r.sender, r.outcome, r.recipient]).sort())
      .toEqual([
        ["+15550001111", "unmatched", null],
        ["+17075550101", "answered", "Avery First"],
        ["+17075550103", "not_an_answer", "Cameron Third"],
        ["7075550102", "answered", "Bailey Second"],
      ]);

    // Avery changes the answer by a second text; the first acknowledgement's time stands.
    const first = receipts.by("Avery First").acknowledgedAt;
    gateway.reply(PHONES.avery, "2", new Date(Date.now() + 1000));
    expect((await readReplies()).json()).toMatchObject({ read: 1, answered: 1 });
    receipts = await detail(id);
    expect(receipts.by("Avery First")).toMatchObject({ response: "Not available", acknowledgedAt: first });
    expect(receipts.responses).toEqual([{ option: "Available", count: 0 }, { option: "Not available", count: 2 }]);
  });

  it("takes any reply as an acknowledgement when the send asks nothing, and reads on the scheduler while a text can be answered", async () => {
    const id = await send({ subject: "Shelter open", message: "Klamath shelter opens at 1800." });
    const text = gateway.sent.find((t) => t.to === PHONES.bailey && t.text.startsWith("Shelter open:"))!;
    expect(text.text).toMatch(/Reply to acknowledge, or open http\S+\/api\/v1\/ack\//);
    const [due] = await admin`select * from sms_reply_readers()`;
    expect(due).toMatchObject({ jurisdiction_id: seed.jurisdictionId, person_id: seed.adminId });

    // The phone is off: the job logs it and reads nothing.
    gateway.down = true;
    const warnings: unknown[] = [];
    expect(await readDueSmsReplies(runtime, { warn: (...args: unknown[]) => { warnings.push(args); } })).toBe(0);
    expect(JSON.stringify(warnings)).toContain("SMS gateway replies not read");
    expect((await readReplies()).statusCode).toBe(502);

    gateway.down = false;
    gateway.reply(PHONES.bailey, "ok, on my way");
    expect(await readDueSmsReplies(runtime, { warn: () => undefined })).toBe(1);
    expect((await detail(id)).by("Bailey Second")).toMatchObject({ acknowledgedVia: "sms", response: null });
  });

  it("does not match a reply sent before the text by more than the clock allowance", async () => {
    const id = await send({ subject: "Road check", message: "Is Hwy 96 open at Weitchpec?" });
    gateway.reply(PHONES.cameron, "yes", new Date(Date.now() - 20 * 60_000));
    const [recipient] = await admin`
      select r.notified_at from mass_notification_recipients r
      where r.mass_notification_id = ${id} and r.name = 'Cameron Third'`;
    // The inbox is read from ten minutes before the earliest open text, so the old one is not even fetched.
    expect((recipient!.notified_at as Date).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await readReplies()).json()).toMatchObject({ read: 0 });
    expect((await detail(id)).by("Cameron Third").acknowledgedAt).toBeNull();
  });
});

describe("the printed call-down sheet", () => {
  it("enters who was reached, when and their answer, all or none, by a writer only", async () => {
    const id = await send({ subject: "Evacuation warning", message: "Zone 4 evacuation warning. Can you drive the van?", responseOptions: ["Yes", "No"] });
    const { recipients } = await detail(id);
    const [avery, bailey] = [recipients.find((r) => r.name === "Avery First")!, recipients.find((r) => r.name === "Bailey Second")!];
    const path = `/api/v1/mass-notifications/${id}/acknowledgements`;
    // After the send and before the entry, as a time written on the sheet is.
    const reached = new Date().toISOString();

    expect((await call("POST", path, viewerToken, { entries: [{ recipientId: avery.id, response: "Yes" }] })).statusCode).toBe(403);
    const wrong = await call("POST", path, memberToken, {
      entries: [{ recipientId: avery.id, response: "Yes", at: reached }, { recipientId: bailey.id, response: "Maybe" }],
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error).toBe("choose one of the send's answers for Bailey Second");
    expect((await detail(id)).by("Avery First").acknowledgedAt).toBeNull();
    const [other] = await admin`select id from mass_notification_recipients where mass_notification_id <> ${id} limit 1`;
    expect((await call("POST", path, memberToken, { entries: [{ recipientId: other!.id as string, response: "Yes" }] })).statusCode).toBe(422);

    const entered = await call("POST", path, memberToken, {
      entries: [
        { recipientId: avery.id, response: "Yes", at: reached },
        // A time in the future is taken as now.
        { recipientId: bailey.id, response: "No", at: new Date(Date.now() + 5 * HOUR).toISOString() },
      ],
    });
    expect(entered.statusCode, entered.body).toBe(200);
    expect(entered.json()).toEqual({ recorded: 2 });
    const receipts = await detail(id);
    expect(receipts.by("Avery First")).toMatchObject({ acknowledgedVia: "sheet", response: "Yes", acknowledgedAt: reached });
    expect(Date.parse(receipts.by("Bailey Second").acknowledgedAt!)).toBeLessThanOrEqual(Date.now());
    expect(receipts.responses).toEqual([{ option: "Yes", count: 1 }, { option: "No", count: 1 }]);
    const [audit] = await admin`
      select payload from audit_events where category = 'notification.mass_acknowledgements_entered' order by seq desc limit 1`;
    expect(audit!.payload).toMatchObject({ via: "sheet", entries: [{ recipientId: avery.id }, { recipientId: bailey.id }] });
  });

  it("counts a call-down contact reached from the sheet before their turn, and the call-down ends", async () => {
    const res = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/mass-notifications`, memberToken, {
      subject: "Page the duty officer", message: "Call the EOC.", groupId, channels: ["sms"], mode: "calldown", intervalMinutes: 10,
    });
    const id = res.json().id as string;
    let receipts = await detail(id);
    expect(receipts.by("Cameron Third").notifiedAt).toBeNull();
    const entered = await call("POST", `/api/v1/mass-notifications/${id}/acknowledgements`, memberToken,
      { entries: [{ recipientId: receipts.by("Cameron Third").id }] });
    expect(entered.statusCode, entered.body).toBe(200);
    receipts = await detail(id);
    expect(receipts.by("Cameron Third")).toMatchObject({ acknowledgedVia: "sheet" });
    expect(receipts.by("Cameron Third").notifiedAt).not.toBeNull();
    const actor = await principalForPerson(runtime, seed.adminId);
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId)).toBe(0);
    receipts = await detail(id);
    expect(receipts.completedAt).not.toBeNull();
    expect(receipts.by("Bailey Second").notifiedAt).toBeNull();
  });
});

describe("the radio and runner log", () => {
  it("keeps traffic passed by radio or runner and lists what awaits a receipt", async () => {
    const board = await call("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, adminToken, { templateKey: "radio_runner_log" });
    expect(board.statusCode, board.body).toBe(201);
    const boardId = board.json().id as string;
    const entry = (data: Record<string, unknown>) => call("POST", `/api/v1/boards/${boardId}/records`, memberToken, {
      occurred_at: "2026-09-25T17:05:00Z", from_station: "EOC", to_station: "Weitchpec station", message: "Road 169 closed at the bridge.", ...data,
    });
    expect((await entry({ direction: "sent", means: "runner", runner: "J. Lee" })).statusCode).toBe(201);
    expect((await entry({ direction: "sent", means: "radio", channel: "Tac 2", receipt_confirmed: true })).statusCode).toBe(201);
    expect((await entry({ direction: "received", means: "radio" })).statusCode).toBe(201);
    expect((await entry({ direction: "sent", means: "carrier pigeon" })).statusCode).toBe(400);
    const waiting = await call("GET", `/api/v1/boards/${boardId}/views/unconfirmed`, memberToken);
    expect(waiting.json().records.map((r: { means: string; runner?: string }) => [r.means, r.runner])).toEqual([["runner", "J. Lee"]]);
    expect((await call("GET", `/api/v1/boards/${boardId}/views/all`, memberToken)).json().records).toHaveLength(3);
  });
});
