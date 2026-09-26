import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { readDueSmsReplies } from "../contacts/carriers.js";
import {
  GATEWAY_REPLIES_PER_HOUR, TEXTS_PER_HOUR, incidentTag, isCarrierKeyword, isEcho, numberForms, parseActivityText,
} from "../contacts/sms-activity.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { storableText } from "../notify/channels.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";
import { fixtureGateway, type FixtureGateway } from "./sms-gateway-fixture.js";

/**
 * Field activity by text message on a real database, through the fixture
 * phone: a LOG text from a registered number its person confirmed is filed on
 * their ICS 214 activity log as them, marked as texted everywhere it shows,
 * confirmed by text and in the app; every refusal files nothing, and those
 * that could tell a stranger which numbers are registered, or flood a phone,
 * send nothing back. Nothing leaves the machine.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let gateway: FixtureGateway;
let adminToken: string;
let memberToken: string;
let priorKey: string | undefined;
let northCoast: string;
let rileyId: string;
let rileyContact: string;
let umaId: string;
let taylorId: string;
const PHONES = {
  riley: "+17075550201", shared: "+17075550202", uma: "+17075550203", vic: "+17075550204", wren: "+17075550205",
};
const password = (email: string) => `${email}-password-1`;

async function call(method: string, url: string, token: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url,
    headers: auth(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const jurisdictionPath = (rest: string) => `/api/v1/jurisdictions/${seed.jurisdictionId}/${rest}`;

async function setGateway(activityLog: boolean, token = adminToken) {
  return call("PUT", jurisdictionPath("notification-channels/sms"), token, {
    settings: { provider: "gateway", url: gateway.url, username: gateway.username, ...(activityLog ? { activityLog } : {}) },
  });
}

async function read() {
  const res = await call("POST", jurisdictionPath("sms-replies/read"), adminToken);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Record<string, number>;
}

/** Each text the reader kept, by gateway id, with what it did. */
async function kept(id: string) {
  const [row] = await admin`
    select outcome, refusal, person_id, record_id, reply, body, received_at from sms_replies where gateway_message_id = ${id}`;
  return row;
}

async function texted() {
  return admin`
    select r.id, r.board_id, r.data, r.created_by, r.created_by_position, r.incident_id
    from board_records r where r.received_via = 'sms' order by r.created_at, r.id`;
}

async function person(name: string, email: string, role: "member" | "viewer", phones: string[]): Promise<{ id: string; contact: string }> {
  const id = await createPerson(admin, { email, displayName: name, password: password(email) });
  await addMembership(admin, id, seed.jurisdictionId, role);
  const res = await call("POST", jurisdictionPath("contacts"), adminToken, { name, phones, personId: id });
  expect(res.statusCode, res.body).toBe(201);
  return { id, contact: res.json().id as string };
}

async function activate(name: string): Promise<{ id: string; position: (key: string) => string }> {
  const res = await call("POST", jurisdictionPath("incidents"), adminToken, { templateKey: "wildfire", name });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().incidentId as string;
  const detail = (await call("GET", `/api/v1/incidents/${id}`, adminToken)).json() as { positions: Array<{ key: string; id: string }> };
  return { id, position: (key) => detail.positions.find((p) => p.key === key)!.id };
}

async function assign(positionId: string, personId: string) {
  const res = await call("POST", `/api/v1/positions/${positionId}/assignments`, adminToken, { personId });
  expect(res.statusCode, res.body).toBeLessThan(300);
}

const sentTo = (phone: string) => gateway.sent.filter((t) => t.to === phone);

/** The person, signed in, has a code texted to the number and enters it. */
async function confirmNumber(email: string, phone: string) {
  const token = await tokenFor(app, email, password(email));
  const sent = await call("POST", "/api/v1/me/sms-numbers/code", token, { jurisdictionId: seed.jurisdictionId, phone });
  expect(sent.statusCode, sent.body).toBe(200);
  const code = /your code to log activity by text is (\d{6})/.exec(sentTo(phone).at(-1)!.text)![1]!;
  const confirmed = await call("POST", "/api/v1/me/sms-numbers/confirm", token, { jurisdictionId: seed.jurisdictionId, phone, code });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-activity-key";
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  gateway = await fixtureGateway();
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const saved = await call("PUT", jurisdictionPath("notification-channels/sms"), adminToken, {
    settings: { provider: "gateway", url: gateway.url, username: gateway.username }, secret: gateway.password,
  });
  expect(saved.statusCode, saved.body).toBe(200);

  ({ id: rileyId, contact: rileyContact } = await person("Riley Responder", "riley@example.org", "member", [PHONES.riley]));
  const sam = await person("Sam Shared", "sam@example.org", "member", [PHONES.shared]);
  ({ id: taylorId } = await person("Taylor Shared", "taylor@example.org", "member", [PHONES.shared]));
  ({ id: umaId } = await person("Uma Unassigned", "uma@example.org", "member", [PHONES.uma]));
  const vic = await person("Vic Viewer", "vic@example.org", "viewer", [PHONES.vic]);
  const wren = await person("Wren Rapid", "wren@example.org", "member", [PHONES.wren]);
  const incident = await activate("North Coast Storm");
  northCoast = incident.id;
  await assign(incident.position("operations_section_chief"), rileyId);
  await assign(incident.position("planning_section_chief"), vic.id);
  await assign(incident.position("logistics_section_chief"), wren.id);
  await assign(incident.position("finance_admin_section_chief"), sam.id);
}, 90_000);

afterAll(async () => {
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
  await gateway?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("what a text says", () => {
  it("reads LOG, #incident and the entry", () => {
    expect(parseActivityText("Arrived at staging")).toEqual({ marked: false, incident: null, entry: "Arrived at staging" });
    expect(parseActivityText(" log: Arrived ")).toEqual({ marked: true, incident: null, entry: "Arrived" });
    expect(parseActivityText("LOG #North  Arrived")).toEqual({ marked: true, incident: "north", entry: "Arrived" });
    expect(parseActivityText("#deer: road clear")).toEqual({ marked: true, incident: "deer", entry: "road clear" });
    expect(parseActivityText("Logged three calls")).toEqual({ marked: false, incident: null, entry: "Logged three calls" });
    expect(parseActivityText("LOG")).toEqual({ marked: true, incident: null, entry: "" });
  });

  it("knows carrier keywords, echoes, registrable numbers, incident tags and text the database keeps", () => {
    for (const word of ["STOP", "stop.", "Help", "UNSUBSCRIBE", "opt out", "START"]) expect(isCarrierKeyword(word)).toBe(true);
    expect(isCarrierKeyword("stop at the bridge")).toBe(false);
    expect(isEcho(' OpenEOC: filed on the log: "x"')).toBe(true);
    expect(isEcho("LOG OpenEOC: x")).toBe(false);
    expect(numberForms("+1 (707) 555-0201")).toEqual(["17075550201"]);
    expect(numberForms("7075550201")).toEqual(["7075550201", "17075550201"]);
    expect(numberForms("72345")).toBeNull();
    expect(numberForms("VERIZON")).toBeNull();
    // A number abroad ending in the same ten digits is not the same number.
    expect(numberForms("+447075550201")).toEqual(["447075550201"]);
    const names = ["North Coast Storm", "North Fork Fire", "Deerhorn Fire"];
    expect(names.map((name) => incidentTag(name, names))).toEqual(["northc", "northf", "deerhorn"]);
    expect(storableText("LOG x\u0000y\r\n\tz\u0085")).toBe("LOG xy\n\tz");
    expect(storableText("LOG x\ud83d")).toBe("LOG x�");
    expect(storableText("ok 😀")).toBe("ok 😀");
  });
});

describe("field activity by text message", () => {
  it("files nothing while it is off, and only an administrator turns it on", async () => {
    const before = gateway.reply(PHONES.riley, "LOG Arrived at staging");
    expect(await read()).toMatchObject({ read: 1, unmatched: 1, logged: 0 });
    expect((await setGateway(true, memberToken)).statusCode).toBe(403);
    const on = await setGateway(true);
    expect(on.statusCode, on.body).toBe(200);
    const since = on.json().activityLogSince as string;
    expect(Date.parse(since)).toBeGreaterThan(Date.now() - 60_000);
    // Saving again keeps the time it was turned on.
    expect((await setGateway(true)).json().activityLogSince).toBe(since);
    expect(await read()).toMatchObject({ read: 0 });
    // A text read while it was off is never filed afterwards.
    expect(await kept(before)).toMatchObject({ outcome: "unmatched" });
    expect(await texted()).toHaveLength(0);
    // With no send open, the scheduler now reads the gateway for activity.
    const [due] = await admin`select jurisdiction_id from sms_reply_readers()`;
    expect(due).toMatchObject({ jurisdiction_id: seed.jurisdictionId });
  });

  it("files nothing, silently, from a number its person has not confirmed; the person confirms it signed in", async () => {
    const sent = gateway.sent.length;
    const id = gateway.reply(PHONES.riley, "LOG Arrived at staging");
    expect(await read()).toMatchObject({ read: 1, unmatched: 1, logged: 0 });
    expect(await kept(id)).toMatchObject({ outcome: "unmatched", reply: null });
    expect(gateway.sent.length).toBe(sent);

    const riley = await tokenFor(app, "riley@example.org", password("riley@example.org"));
    const listed = await call("GET", "/api/v1/me/sms-numbers", riley);
    expect(listed.json().numbers).toEqual([expect.objectContaining({ phone: PHONES.riley, confirmedAt: null })]);
    // Only a number on the person's own contact entry, and only by the person.
    expect((await call("POST", "/api/v1/me/sms-numbers/code", riley, { jurisdictionId: seed.jurisdictionId, phone: PHONES.uma })).statusCode).toBe(404);
    const codeSent = await call("POST", "/api/v1/me/sms-numbers/code", riley, { jurisdictionId: seed.jurisdictionId, phone: PHONES.riley });
    expect(codeSent.statusCode, codeSent.body).toBe(200);
    const code = /is (\d{6})/.exec(sentTo(PHONES.riley).at(-1)!.text)![1]!;
    expect((await call("POST", "/api/v1/me/sms-numbers/code", riley, { jurisdictionId: seed.jurisdictionId, phone: PHONES.riley })).statusCode).toBe(429);
    // An administrator cannot confirm it for them: the code is theirs to enter.
    expect((await call("POST", "/api/v1/me/sms-numbers/confirm", adminToken,
      { jurisdictionId: seed.jurisdictionId, phone: PHONES.riley, code })).statusCode).toBe(422);
    const wrong = code === "000000" ? "000001" : "000000";
    expect((await call("POST", "/api/v1/me/sms-numbers/confirm", riley, { jurisdictionId: seed.jurisdictionId, phone: PHONES.riley, code: wrong })).json().error)
      .toBe("the code does not match");
    // No application role writes a code, a count or a confirmation, or reads a code, around the two functions.
    const known = createHash("sha256").update("000000").digest("hex");
    for (const [as, write] of [
      [rileyId, (tx: Sql) => tx`update sms_activity_numbers set code_hash = ${known}, attempts = 0 where person_id = ${rileyId}`],
      [rileyId, (tx: Sql) => tx`update sms_activity_numbers set confirmed_at = now() where person_id = ${rileyId}`],
      [rileyId, (tx: Sql) => tx`
        insert into sms_activity_numbers (jurisdiction_id, person_id, phone, code_hash, code_expires_at)
        values (${seed.jurisdictionId}, ${rileyId}, '+17075550299', ${known}, now() + interval '1 hour')`],
      [rileyId, (tx: Sql) => tx`select code_hash from sms_activity_numbers`],
      [seed.adminId, (tx: Sql) => tx`select code_hash from sms_activity_numbers`],
    ] as const) await expect(withPerson(runtime, as, write)).rejects.toThrow(/permission denied/);
    const ok = await call("POST", "/api/v1/me/sms-numbers/confirm", riley, { jurisdictionId: seed.jurisdictionId, phone: PHONES.riley, code });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await call("GET", "/api/v1/me/sms-numbers", riley)).json().numbers[0].confirmedAt).not.toBeNull();

    for (const [email, phone] of [["sam@example.org", PHONES.shared], ["uma@example.org", PHONES.uma],
      ["vic@example.org", PHONES.vic], ["wren@example.org", PHONES.wren]] as const) await confirmNumber(email, phone);
  });

  it("counts wrong codes across new codes and locks the number for a day after five", async () => {
    await admin`update sms_activity_numbers set confirmed_at = null, code_sent_at = null where person_id = ${umaId}`;
    const uma = await tokenFor(app, "uma@example.org", password("uma@example.org"));
    const body = { jurisdictionId: seed.jurisdictionId, phone: PHONES.uma };
    const askCode = async () => {
      const res = await call("POST", "/api/v1/me/sms-numbers/code", uma, body);
      return res.statusCode === 200 ? /is (\d{6})/.exec(sentTo(PHONES.uma).at(-1)!.text)![1]! : res.statusCode;
    };
    const enter = (code: string) => call("POST", "/api/v1/me/sms-numbers/confirm", uma, { ...body, code });
    const wrongFor = (code: string) => (code === "000000" ? "000001" : "000000");
    const attempts = async () => (await admin`select attempts from sms_activity_numbers where person_id = ${umaId}`)[0]!.attempts as number;
    const first = await askCode() as string;
    for (let i = 0; i < 3; i += 1) expect((await enter(wrongFor(first))).statusCode).toBe(422);
    await admin`update sms_activity_numbers set code_sent_at = now() - interval '6 minutes' where person_id = ${umaId}`;
    const second = await askCode() as string;
    // A new code does not give five more tries.
    expect(await attempts()).toBe(3);
    for (let i = 0; i < 2; i += 1) expect((await enter(wrongFor(second))).statusCode).toBe(422);
    expect((await enter(second)).statusCode).toBe(429);
    await admin`update sms_activity_numbers set code_sent_at = now() - interval '6 minutes' where person_id = ${umaId}`;
    expect(await askCode()).toBe(429);
    // A day later the number has a new window of five tries.
    await admin`update sms_activity_numbers set locked_until = now() - interval '1 second' where person_id = ${umaId}`;
    const third = await askCode() as string;
    expect(await attempts()).toBe(0);
    expect((await enter(third)).statusCode).toBe(200);
  });

  it("issues one code however many ask at once, caps codes a day, and refuses a null or undated code", async () => {
    const taylor = await tokenFor(app, "taylor@example.org", password("taylor@example.org"));
    const body = { jurisdictionId: seed.jurisdictionId, phone: PHONES.shared };
    const sent = sentTo(PHONES.shared).length;
    const asked = await Promise.all(Array.from({ length: 8 }, () => call("POST", "/api/v1/me/sms-numbers/code", taylor, body)));
    expect(asked.map((res) => res.statusCode).sort()).toEqual([200, 429, 429, 429, 429, 429, 429, 429]);
    expect(sentTo(PHONES.shared)).toHaveLength(sent + 1);
    const code = /is (\d{6})/.exec(sentTo(PHONES.shared).at(-1)!.text)![1]!;
    const confirmAs = (given: string | null) => withPerson(runtime, taylorId, async (tx) =>
      (await tx`select public.confirm_sms_activity_number(${seed.jurisdictionId}, ${PHONES.shared}, ${given}) as r`)[0]!.r);
    expect(await confirmAs(null)).toBe("wrong");
    await admin`update sms_activity_numbers set code_expires_at = null where person_id = ${taylorId}`;
    expect(await confirmAs(createHash("sha256").update(code).digest("hex"))).toBe("expired");

    // Five codes a day to one person, and to one number.
    await admin`update sms_activity_numbers set code_sent_at = now() - interval '6 minutes' where person_id = ${taylorId}`;
    await admin`
      insert into sms_activity_codes (jurisdiction_id, person_id, phone)
      select ${seed.jurisdictionId}, ${taylorId}, '+10000000000' from generate_series(1, 4)`;
    expect((await call("POST", "/api/v1/me/sms-numbers/code", taylor, body)).json().error).toBe("five codes have been sent today; try again tomorrow");
    await admin`delete from sms_activity_codes where phone = '+10000000000'`;
    await admin`
      insert into sms_activity_codes (jurisdiction_id, person_id, phone)
      select ${seed.jurisdictionId}, ${umaId}, ${PHONES.shared} from generate_series(1, 4)`;
    expect((await call("POST", "/api/v1/me/sms-numbers/code", taylor, body)).statusCode).toBe(429);
    await admin`delete from sms_activity_codes where person_id = ${umaId} and phone = ${PHONES.shared}`;
    expect((await call("POST", "/api/v1/me/sms-numbers/code", taylor, body)).statusCode).toBe(200);
  });

  it("files a confirmed number's LOG text as the person, marks it everywhere, and tells them by text and in the app", async () => {
    const id = gateway.reply(PHONES.riley, "LOG Arrived at staging, 12 personnel");
    expect(await readDueSmsReplies(runtime, { warn: () => undefined })).toBe(1);
    const [record] = await texted();
    expect(record).toMatchObject({ created_by: rileyId, incident_id: northCoast, data: { entry: "Arrived at staging, 12 personnel" } });
    expect(record!.created_by_position).not.toBeNull();
    const confirmationText = 'OpenEOC: filed on the North Coast Storm activity log: "Arrived at staging, 12 personnel". Not you? Call the EOC.';
    expect(await kept(id)).toMatchObject({ outcome: "logged", person_id: rileyId, record_id: record!.id, reply: confirmationText });
    const [audit] = await admin`
      select person_id, incident_id, payload from audit_events
      where category = 'board.record.created' and subject_id = ${record!.id as string}`;
    expect(audit).toMatchObject({ person_id: rileyId, incident_id: northCoast, payload: { via: "sms", source: { gatewayMessageId: id } } });
    expect(sentTo(PHONES.riley).at(-1)!.text).toBe(confirmationText);
    const [notice] = await admin`select title, body, detail from notifications where person_id = ${rileyId} and channel = 'sms_activity'`;
    expect(notice).toMatchObject({ title: "Activity filed as you by text message", detail: { recordId: record!.id } });
    expect(notice!.body).toContain("If you did not send it, tell the EOC.");

    // On screen, in print and in exports the record is marked as texted.
    const boardId = record!.board_id as string;
    const detail = await call("GET", `/api/v1/boards/${boardId}/records/${record!.id as string}/detail?incidentId=${northCoast}`, memberToken);
    expect(detail.json()).toMatchObject({ receivedVia: "sms", createdBy: { personId: rileyId } });
    const history = await call("GET", `/api/v1/boards/${boardId}/records/${record!.id as string}/history?incidentId=${northCoast}`, memberToken);
    expect(history.json().entries[0]).toMatchObject({ category: "board.record.created", via: "sms" });
    const view = await call("GET", `/api/v1/boards/${boardId}/views/all?incidentId=${northCoast}`, memberToken);
    expect(view.json().records).toEqual([expect.objectContaining({ entry: "Arrived at staging, 12 personnel", receivedVia: "sms" })]);
    const form = await call("GET", `/api/v1/incidents/${northCoast}/ics-forms/ICS-214?period=OP%201`, adminToken);
    expect((form.json().sections[0].rows as string[][]).map((r) => r[1])).toEqual(["Arrived at staging, 12 personnel (by text)"]);
    const csv = await call("GET", `/api/v1/boards/${boardId}/views/all/export?incidentId=${northCoast}`, memberToken);
    expect(csv.body.split("\r\n")[0]).toBe("id,entry,notable,received_via");
    expect(csv.body.split("\r\n")[1]).toMatch(/,"Arrived at staging, 12 personnel",[^,]*,sms$/);
    const channel = await call("GET", jurisdictionPath("notification-channels/sms"), adminToken);
    expect(channel.json().replies[0]).toMatchObject({ outcome: "logged", recipient: "Riley Responder", incident: "North Coast Storm" });
  });

  it("never files a text without LOG or #, such as an auto-reply, nor the product's own text coming back", async () => {
    const sent = gateway.sent.length;
    const auto = gateway.reply(PHONES.riley, "I'm driving with Do Not Disturb on. I'll see your message when I get where I'm going.");
    const echo = gateway.reply(PHONES.riley, 'OpenEOC: filed on the North Coast Storm activity log: "x". Not you? Call the EOC.');
    expect(await read()).toMatchObject({ read: 2, unmatched: 1, refused: 1, logged: 0 });
    expect(await kept(auto)).toMatchObject({ outcome: "unmatched" });
    expect(await kept(echo)).toMatchObject({ outcome: "refused", refusal: "echo", reply: null });
    expect(gateway.sent.length).toBe(sent);
    expect(await texted()).toHaveLength(1);
  });

  it("answers nothing and files nothing for an unregistered number, a short code or a carrier keyword", async () => {
    const sent = gateway.sent.length;
    const ids = [
      gateway.reply("+15550001111", "LOG Arrived at staging"),
      // The same ten digits in another country is not Riley's number.
      gateway.reply("+447075550201", "LOG Arrived at staging"),
      gateway.reply("72345", "LOG Your code is 1234"),
      gateway.reply(PHONES.riley, "STOP"),
      gateway.reply(PHONES.riley, "LOG stop"),
    ];
    expect(await read()).toMatchObject({ read: 5, unmatched: 4, refused: 1, logged: 0 });
    expect(await Promise.all(ids.map(async (id) => (await kept(id))!.refusal)))
      .toEqual([null, null, null, null, "keyword"]);
    expect(gateway.sent.length).toBe(sent);
    expect(await texted()).toHaveLength(1);
  });

  it("keeps a text the database would refuse, and the texts after it still file", async () => {
    const nul = gateway.reply(PHONES.riley, "LOG Checked\u0000 the levee");
    const surrogate = gateway.reply(PHONES.riley, "LOG Opened the shelter \ud83d");
    const stranger = gateway.reply("+15550001111", "hello\u0000");
    // A phone date the database cannot store fails that text alone, kept as failed.
    const broken = gateway.reply(PHONES.riley, "LOG From the far future", new Date(Date.UTC(275000, 0, 1)));
    expect(await read()).toMatchObject({ read: 4, logged: 2, unmatched: 1, refused: 1 });
    expect(await kept(nul)).toMatchObject({ outcome: "logged", body: "LOG Checked the levee" });
    expect(await kept(surrogate)).toMatchObject({ outcome: "logged", body: "LOG Opened the shelter �" });
    expect(await kept(stranger)).toMatchObject({ outcome: "unmatched", body: "hello" });
    expect(await kept(broken)).toMatchObject({ outcome: "refused", refusal: "failed" });
    // The reader is not stuck on it: the next text files.
    const after = gateway.reply(PHONES.riley, "LOG Cleared the culvert");
    expect(await read()).toMatchObject({ read: 1, logged: 1 });
    expect(await kept(after)).toMatchObject({ outcome: "logged" });
    // Entries filed in one read share a creation time, so they are compared in any order.
    expect((await texted()).map((r) => (r.data as { entry: string }).entry).sort()).toEqual([
      "Arrived at staging, 12 personnel", "Checked the levee", "Cleared the culvert", "Opened the shelter �",
    ]);
  });

  it("files a text once, however often or by however many readers it is read", async () => {
    gateway.reply(PHONES.riley, "LOG Walked the levee", new Date(), "replayed-1");
    gateway.reply(PHONES.riley, "LOG Walked the levee", new Date(), "replayed-1");
    expect(await read()).toMatchObject({ logged: 1 });
    expect(await read()).toMatchObject({ read: 0 });
    gateway.reply(PHONES.riley, "LOG Fueled the generator");
    const sent = gateway.sent.length;
    const both = await Promise.all([read(), read()]);
    expect(both[0]!.logged! + both[1]!.logged!).toBe(1);
    expect(gateway.sent.length).toBe(sent + 1);
    expect(await texted()).toHaveLength(6);
  });

  it("refuses, and says why to the registered number, a shared number, an empty or too long entry, no assignment, or a log that will not take it", async () => {
    const cases = [
      [PHONES.shared, "LOG Arrived", "shared_number", "more than one contacts directory entry"],
      [PHONES.riley, `LOG ${"x".repeat(1001)}`, "too_long", "under 1000 characters"],
      [PHONES.riley, "LOG", "empty", "Text LOG and what you did"],
      [PHONES.uma, "LOG Arrived", "no_assignment", "no position on an open incident"],
      // Vic holds a position but only views the jurisdiction, so the log refuses the entry as Vic.
      [PHONES.vic, "LOG Arrived", "refused_by_log", "did not take the entry"],
    ] as const;
    const ids = cases.map(([phone, text]) => gateway.reply(phone, text));
    expect(await read()).toMatchObject({ read: 5, refused: 5, logged: 0 });
    for (const [i, [phone, , refusal, says]] of cases.entries()) {
      expect(await kept(ids[i]!)).toMatchObject({ outcome: "refused", refusal, record_id: null, reply: expect.stringContaining(says) });
      expect(sentTo(phone).map((t) => t.text)).toContainEqual(expect.stringContaining(says));
    }
    expect(await texted()).toHaveLength(6);
  });

  it("counts toward a number's hourly limit only what was filed or answered, across readers", async () => {
    // Silent refusals, which anyone can cause, never lock the real number out.
    for (let i = 0; i < TEXTS_PER_HOUR + 5; i += 1) gateway.reply(PHONES.riley, "LOG stop");
    expect(await read()).toMatchObject({ refused: TEXTS_PER_HOUR + 5 });
    gateway.reply(PHONES.riley, "LOG Still here");
    expect(await read()).toMatchObject({ logged: 1 });

    const start = Date.now();
    for (let i = 0; i <= TEXTS_PER_HOUR; i += 1) gateway.reply(PHONES.wren, `LOG Load ${i} out`, new Date(start + i));
    const both = await Promise.all([read(), read()]);
    expect(both[0]!.logged! + both[1]!.logged!).toBe(TEXTS_PER_HOUR);
    expect(both[0]!.refused! + both[1]!.refused!).toBe(1);
    expect(sentTo(PHONES.wren).filter((t) => t.text.startsWith("OpenEOC: filed"))).toHaveLength(TEXTS_PER_HOUR);
    const [limited] = await admin`select body, reply from sms_replies where refusal = 'rate_limited'`;
    expect(limited).toMatchObject({ body: `LOG Load ${TEXTS_PER_HOUR} out`, reply: null });
  });

  it("stops answering, and sending codes, once the gateway has sent its hourly share of both, and still files", async () => {
    const half = GATEWAY_REPLIES_PER_HOUR / 2;
    await admin`
      insert into sms_replies (jurisdiction_id, gateway_message_id, sender, body, received_at, outcome, reply)
      select ${seed.jurisdictionId}, 'cap-' || n, '+15550009999', 'x', now(), 'unmatched', 'y'
      from generate_series(1, ${half}) n`;
    await admin`
      insert into sms_activity_codes (jurisdiction_id, person_id, phone)
      select ${seed.jurisdictionId}, ${umaId}, '+10000000001' from generate_series(1, ${half})`;
    const sent = gateway.sent.length;
    const id = gateway.reply(PHONES.riley, "LOG Quiet hour");
    expect(await read()).toMatchObject({ logged: 1 });
    expect(await kept(id)).toMatchObject({ outcome: "logged", reply: null });
    expect(gateway.sent.length).toBe(sent);
    await admin`update sms_activity_numbers set code_sent_at = now() - interval '6 minutes' where person_id = ${taylorId}`;
    const taylor = await tokenFor(app, "taylor@example.org", password("taylor@example.org"));
    expect((await call("POST", "/api/v1/me/sms-numbers/code", taylor, { jurisdictionId: seed.jurisdictionId, phone: PHONES.shared })).json().error)
      .toBe("the SMS gateway has sent all it may this hour; try again later");
    await admin`delete from sms_replies where gateway_message_id like 'cap-%'`;
    await admin`delete from sms_activity_codes where phone = '+10000000001'`;
  });

  it("tries a text again after a deadlock, and leaves one that keeps failing for the next read", async () => {
    await admin`create sequence mp15a_flaky`;
    await admin`create table mp15a_flaky_limit (n bigint not null)`;
    await admin`insert into mp15a_flaky_limit values (1)`;
    await admin.unsafe(`
      create function mp15a_flaky() returns trigger language plpgsql security definer as $$
      begin
        if nextval('mp15a_flaky') <= (select n from mp15a_flaky_limit) then
          raise exception 'induced deadlock' using errcode = '40P01';
        end if;
        return new;
      end $$`);
    await admin`create trigger mp15a_flaky before insert on sms_replies for each row execute function mp15a_flaky()`;
    try {
      const count = (await texted()).length;
      const once = gateway.reply(PHONES.riley, "LOG Refilled the sandbags");
      expect(await read()).toMatchObject({ read: 1, logged: 1 });
      expect(await kept(once)).toMatchObject({ outcome: "logged" });
      expect(await texted()).toHaveLength(count + 1);

      await admin`update mp15a_flaky_limit set n = 1000000`;
      const stuck = gateway.reply(PHONES.riley, "LOG Checked the pumps");
      expect(await read()).toMatchObject({ read: 0 });
      expect(await kept(stuck)).toBeUndefined();
      expect(await texted()).toHaveLength(count + 1);
      await admin`update mp15a_flaky_limit set n = 0`;
      expect(await read()).toMatchObject({ read: 1, logged: 1 });
      expect(await kept(stuck)).toMatchObject({ outcome: "logged" });
    } finally {
      await admin`drop trigger mp15a_flaky on sms_replies`;
      await admin`drop function mp15a_flaky()`;
      await admin`drop table mp15a_flaky_limit`;
      await admin`drop sequence mp15a_flaky`;
    }
  });

  it("lets members read replies to sends but only administrators and its person read an activity text", async () => {
    const rows = (as: string) => withPerson(runtime, as, (tx) => tx`select outcome, person_id from sms_replies`);
    const member = await rows(seed.memberId);
    expect(member.some((r) => r.outcome === "unmatched")).toBe(true);
    expect(member.filter((r) => r.outcome === "logged" || r.outcome === "refused")).toEqual([]);
    const riley = await rows(rileyId);
    expect(riley.some((r) => r.outcome === "logged")).toBe(true);
    expect(riley.filter((r) => r.outcome === "logged" || r.outcome === "refused").every((r) => r.person_id === rileyId)).toBe(true);
    expect((await rows(seed.adminId)).some((r) => r.outcome === "refused" && r.person_id !== rileyId)).toBe(true);
  });

  it("goes by the server's clock, not the phone's, and shows the phone's time", async () => {
    const phoneTime = new Date(Date.now() - 5 * 60_000);
    const id = gateway.reply(PHONES.riley, "LOG The phone's clock is behind", phoneTime);
    expect(await read()).toMatchObject({ logged: 1 });
    expect((await kept(id))!.received_at).toEqual(phoneTime);
  });

  it("keeps a filed row only with the texted record it filed, as that person", async () => {
    const [record] = await texted();
    const plain = await call("POST", `/api/v1/boards/${record!.board_id as string}/records`, adminToken, { entry: "Typed" });
    expect(plain.statusCode, plain.body).toBe(201);
    const insert = (as: string, personId: string, recordId: string) => withPerson(runtime, as, (tx) => tx`
      insert into sms_replies (jurisdiction_id, gateway_message_id, sender, body, received_at, outcome, person_id, record_id)
      values (${seed.jurisdictionId}, ${`forged-${as}-${recordId}`}, '+15550001111', 'x', now(), 'logged', ${personId}, ${recordId})`);
    await expect(insert(seed.memberId, seed.memberId, record!.id as string)).rejects.toThrow(/row-level security/);
    await expect(insert(seed.adminId, seed.adminId, plain.json().id as string)).rejects.toThrow(/row-level security/);
    await expect(insert(seed.adminId, seed.adminId, record!.id as string)).rejects.toThrow(/row-level security/);
    // One row per texted record.
    await expect(insert(seed.adminId, rileyId, record!.id as string)).rejects.toThrow(/duplicate key/);
  });

  it("asks someone on more than one incident to pick one with #", async () => {
    await activate("Deerhorn Fire");
    const ask = gateway.reply(PHONES.riley, "LOG Cleared the road");
    const wrong = gateway.reply(PHONES.riley, "#klamath Cleared the road");
    expect(await read()).toMatchObject({ refused: 2, logged: 0 });
    expect(await kept(ask)).toMatchObject({ refusal: "choose_incident" });
    expect(await kept(wrong)).toMatchObject({ refusal: "choose_incident" });
    expect(sentTo(PHONES.riley).at(-1)!.text).toBe("OpenEOC: nothing filed. Start the text with the incident: #north or #deerhorn.");
    gateway.reply(PHONES.riley, "#deer: Cleared the road");
    expect(await read()).toMatchObject({ logged: 1 });
    const [deerhorn] = await admin`select id from incidents where name = 'Deerhorn Fire'`;
    expect((await texted()).at(-1)).toMatchObject({ incident_id: deerhorn!.id, data: { entry: "Cleared the road" } });
  });

  it("still answers an open send with a reply, and files a LOG text while one is open", async () => {
    const group = await call("POST", jurisdictionPath("contact-groups"), adminToken, { name: "Field", contactIds: [rileyContact] });
    const send = await call("POST", jurisdictionPath("mass-notifications"), memberToken,
      { groupId: group.json().id, channels: ["sms"], mode: "broadcast", subject: "Check in", message: "Check in when staged." });
    expect(send.statusCode, send.body).toBe(201);
    await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
    gateway.reply(PHONES.riley, "Staged at the bridge");
    expect(await read()).toMatchObject({ acknowledged: 1, logged: 0 });
    gateway.reply(PHONES.riley, "LOG #north Staged at the bridge");
    expect(await read()).toMatchObject({ acknowledged: 0, logged: 1 });
    expect((await texted()).at(-1)).toMatchObject({ incident_id: northCoast, data: { entry: "Staged at the bridge" } });
  });

  it("clears a number's confirmation when its contact's person link changes, and audits the change", async () => {
    for (const personId of [umaId, rileyId]) {
      const res = await call("PUT", `/api/v1/contacts/${rileyContact}`, adminToken,
        { name: "Riley Responder", phones: [PHONES.riley], personId });
      expect(res.statusCode, res.body).toBe(200);
    }
    const [row] = await admin`select 1 from sms_activity_numbers where person_id = ${rileyId}`;
    expect(row).toBeUndefined();
    const [audit] = await admin`
      select payload from audit_events where category = 'contact.updated' and subject_id = ${rileyContact} order by seq desc limit 1`;
    expect(audit!.payload).toMatchObject({ personId: rileyId, phones: [PHONES.riley], previous: { personId: umaId, phones: [PHONES.riley] } });
    const count = (await texted()).length;
    const sent = gateway.sent.length;
    gateway.reply(PHONES.riley, "LOG #north After the relink");
    expect(await read()).toMatchObject({ unmatched: 1, logged: 0 });
    expect(gateway.sent.length).toBe(sent);
    expect(await texted()).toHaveLength(count);
  });

  it("clears a number's confirmation when its contact is deactivated, even if it is reactivated", async () => {
    await confirmNumber("riley@example.org", PHONES.riley);
    for (const active of [false, true]) {
      const res = await call("PUT", `/api/v1/contacts/${rileyContact}`, adminToken,
        { name: "Riley Responder", phones: [PHONES.riley], personId: rileyId, active });
      expect(res.statusCode, res.body).toBe(200);
    }
    const [row] = await admin`select 1 from sms_activity_numbers where person_id = ${rileyId}`;
    expect(row).toBeUndefined();
  });

  it("files nothing once it is turned off", async () => {
    await confirmNumber("riley@example.org", PHONES.riley);
    const off = await setGateway(false);
    expect(off.json().activityLogSince).toBeNull();
    const count = (await texted()).length;
    gateway.reply(PHONES.riley, "LOG #north After it was off");
    expect(await read()).toMatchObject({ logged: 0 });
    expect(await texted()).toHaveLength(count);
  });
});
