import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardTemplateSchema } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir, watchPage } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * Field breadth on screen (AG-07), at the frames' 1586 by 992 and at 1534 by
 * 790. Each path goes offline and comes back: a member places a map point,
 * posts to an incident thread and queues a report on a board whose record
 * rules keep other people's records from them; an administrator adds a task.
 * Then a member's report queued while the incident closed reaches its
 * administrators as a late submission, which one accepts after reopening.
 */

const DIST = buildDir("field-breadth");
const SHOTS = shotDir("field-breadth");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;
/** The screens the walks open, by their code's file name. */
const SCREENS = ["MapSurface", "MessagesWorkspace", "SmartFormsSurface", "TasksSurface", "IncidentsSurface"];

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

const privateReports = BoardTemplateSchema.parse({
  key: "private_field_reports",
  version: 1,
  title: "Private field reports",
  fields: [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "name", label: "Name", type: "text" },
  ],
  views: [{ key: "all", title: "All", columns: ["code", "name"] }],
  recordAccess: { read: [{ kind: "creator" }], edit: [{ kind: "creator" }] },
});

interface Scene {
  readonly incidentId: string;
  readonly closures: string;
  readonly reports: string;
  readonly threadId: string;
  readonly hidden: string;
}

/** An incident per walk, with a map board, a restricted board holding an administrator's record, and a thread. */
async function scene(name: string): Promise<Scene> {
  const incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "daily_ops", name })).incidentId as string;
  const board = async (templateKey: string, title: string) => {
    const id = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey, title })).id as string;
    await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${id})`;
    return id;
  };
  const closures = await board("road_closures", `Closures ${name}`);
  const reports = await board("private_field_reports", `Private reports ${name}`);
  const hidden = (await post(app, adminToken, `/api/v1/boards/${reports}/records?incidentId=${incidentId}`,
    { code: "ADM-1", name: "Administrator's own report" })).id as string;
  const threadId = (await post(app, memberToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
    { kind: "group", title: `Division B ${name}`, incidentId, audience: "incident", members: [] })).id as string;
  return { incidentId, closures, reports, threadId, hidden };
}

async function open(viewport: { width: number; height: number }, email: string, password: string, incidentId: string): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/field-breadth/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
  await page.getByLabel("Selected incident").selectOption(incidentId);
  // Once up, the console loads every screen in the background. A screen whose
  // code was first fetched with the network down fails until a reload, so the
  // walk waits for the screens it opens before any of them goes offline.
  await expect.poll(async () => {
    const loaded = await page.evaluate(`performance.getEntriesByType("resource").map((entry) => entry.name).join(" ")`) as string;
    return SCREENS.every((screen) => loaded.includes(`/assets/${screen}-`));
  }, { timeout: 60_000 }).toBe(true);
  return page;
}

/** Show a screen with the connection up, so its code and data are in hand before the network drops. */
async function show(page: Page, hash: string): Promise<void> {
  await page.evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
  await page.waitForLoadState("networkidle");
}

const continuity = (page: Page) => page.getByRole("region", { name: "Offline continuity" });

async function reconcile(page: Page): Promise<void> {
  await continuity(page).getByRole("button", { name: "Reconnect and reconcile" }).click();
  await continuity(page).locator("header").getByText("No queued work", { exact: true }).waitFor();
}

/** The board document this device holds for a person and incident, decoded. */
async function deviceRecordIds(page: Page, key: string): Promise<string[]> {
  const bytes = await page.evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("openeoc-field");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("docs", "readonly").objectStore("docs").get(${JSON.stringify(key)});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value ? Array.from(value) : [];
  })()`) as number[];
  const doc = new Y.Doc();
  if (bytes.length) Y.applyUpdate(doc, new Uint8Array(bytes));
  return [...new Set([...doc.getMap("records").keys()].map((entry) => entry.split("/")[0]!))];
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${privateReports.key}, 1, ${privateReports.title}, ${admin.json(privateReports as never)})`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/field-breadth", DIST);
  adminToken = await login(app);
  memberToken = await login(app, "member@example.org", "another-good-password");
  await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/forms`, {
    key: "private_field_report", version: 1, title: "Private field report", boardTemplate: "private_field_reports",
    nodes: [
      { kind: "field", name: "code", type: "text", label: "Code", required: true },
      { kind: "field", name: "name", type: "text", label: "Name" },
    ],
  });
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("field breadth offline and back", () => {
  for (const viewport of VIEWPORTS) {
    const w = viewport.width;

    it(`queues a map point, a message and a restricted board's report offline and delivers them, at ${w} by ${viewport.height}`, async () => {
      const s = await scene(`Breadth ${w}`);
      const page = await open(viewport, "member@example.org", "another-good-password", s.incidentId);

      // A map point on the incident's closures board.
      await show(page, "#/map");
      await page.getByRole("button", { name: "Add point" }).waitFor();
      await page.context().setOffline(true);
      await page.getByRole("button", { name: "Add point" }).click();
      await page.getByLabel("Map record board").selectOption(s.closures);
      await page.getByLabel("Longitude").fill("-123.62");
      await page.getByLabel("Latitude").fill("41.21");
      await page.getByRole("button", { name: "Use coordinates" }).click();
      const record = page.getByRole("region", { name: "New map record" });
      await record.getByLabel("Road").fill(`SR-96 at Bluff Creek ${w}`);
      await record.getByLabel("Reason").fill("Slide across both lanes");
      await record.getByLabel("Status").selectOption("closed");
      await record.getByRole("button", { name: "Save record" }).click();
      await page.getByText(/^Saved on this device at .*; it is sent when the connection returns\.$/).waitFor();
      await continuity(page).getByText("1 board draft saved locally.").waitFor();
      await page.screenshot({ path: join(SHOTS, `map-kept-${w}.png`) });
      expect(await admin`select id from board_records where board_id = ${s.closures}`).toHaveLength(0);
      await page.context().setOffline(false);
      await reconcile(page);
      const [point] = await admin`
        select created_by, incident_id, st_x(geom) as longitude, st_y(geom) as latitude
        from board_records where board_id = ${s.closures}`;
      expect(point).toMatchObject({ created_by: seed.memberId, incident_id: s.incidentId });
      expect(Number(point!.longitude)).toBeCloseTo(-123.62);
      expect(Number(point!.latitude)).toBeCloseTo(41.21);

      // A message to the incident's thread.
      const report = watchPage(page);
      await show(page, "#/messages");
      await page.getByRole("button", { name: new RegExp(`^Division B Breadth ${w}`) }).click().catch(async (error: unknown) => {
        throw new Error(`The incident thread did not appear. ${String(error)}
${await report()}`, { cause: error });
      });
      await page.getByRole("region", { name: "Conversation" }).waitFor();
      await page.context().setOffline(true);
      const conversation = page.getByRole("region", { name: "Conversation" });
      await conversation.getByRole("textbox", { name: "Message" }).fill(`Slide at mile 12, ${w}`);
      await conversation.getByRole("button", { name: "Send" }).click();
      await conversation.getByText(/^Saved on this device at .*; it is sent when the connection returns\.$/).waitFor();
      await conversation.getByText("Queued on this device").waitFor();
      await continuity(page).getByText("1 message saved locally.").waitFor();
      await page.screenshot({ path: join(SHOTS, `message-kept-${w}.png`) });
      expect(await admin`select id from messages where thread_id = ${s.threadId}`).toHaveLength(0);
      await page.context().setOffline(false);
      await conversation.getByText(`Slide at mile 12, ${w}`).waitFor();
      await expect.poll(async () => (await admin`select body, sender_person from messages where thread_id = ${s.threadId}`))
        .toEqual([{ body: `Slide at mile 12, ${w}`, sender_person: seed.memberId }]);
      await conversation.getByText("Queued on this device").waitFor({ state: "detached" });

      // A report on the board whose record rules keep the administrator's record from this member.
      await show(page, "#/smartforms");
      const workspace = page.getByRole("region", { name: "Field report capture" });
      await workspace.getByLabel("Your organization's form").selectOption({ label: "Private field report" });
      await workspace.getByLabel("Incident board").selectOption(s.reports);
      const form = workspace.getByRole("form", { name: "Field report form" });
      await form.waitFor();
      await page.context().setOffline(true);
      await form.getByLabel("Code *").fill(`MBR-${w}`);
      await form.getByLabel("Name").fill("Member's culvert report");
      await form.getByRole("button", { name: "Queue field report" }).click();
      await page.getByText(/durably queued on this device/).waitFor();
      await page.screenshot({ path: join(SHOTS, `restricted-kept-${w}.png`) });
      await page.context().setOffline(false);
      await reconcile(page);
      const rows = await admin`select id, data, created_by from board_records where board_id = ${s.reports} order by created_at`;
      expect(rows.map((row) => (row.data as { code: string }).code)).toEqual(["ADM-1", `MBR-${w}`]);
      expect(rows[1]!.created_by).toBe(seed.memberId);
      // The device was sent none of the board's records, only its own went up.
      const onDevice = await deviceRecordIds(page, `board:${seed.memberId}:${s.incidentId}:${s.reports}`);
      expect(onDevice).toEqual([rows[1]!.id]);
      expect(onDevice).not.toContain(s.hidden);
      await page.screenshot({ path: join(SHOTS, `restricted-delivered-${w}.png`) });
      await page.context().close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 240_000);

    it(`adds a task kept offline, and sends work that reached a closed incident to its administrators, at ${w} by ${viewport.height}`, async () => {
      const s = await scene(`Closing ${w}`);
      const lead = await open(viewport, "admin@example.org", "correct-horse-battery", s.incidentId);

      // An administrator's new task, kept while offline.
      await show(lead, "#/tasks");
      await lead.getByRole("button", { name: "New task" }).click();
      await lead.context().setOffline(true);
      const editor = lead.getByRole("region", { name: "New task" });
      await editor.getByLabel("Task name").fill(`Check the Bluff Creek gauge ${w}`);
      await editor.getByRole("button", { name: "Add task" }).click();
      await lead.getByText(/^Saved on this device at .*; it is sent when the connection returns\.$/).waitFor();
      const kept = lead.getByRole("region", { name: "New tasks kept on this device" });
      await kept.getByText("Waiting for the connection").waitFor();
      await continuity(lead).getByText("1 new task saved locally.").waitFor();
      await lead.screenshot({ path: join(SHOTS, `task-kept-${w}.png`) });
      await lead.context().setOffline(false);
      await lead.getByText("1 kept new task added.").waitFor();
      await kept.waitFor({ state: "detached" });
      expect(await admin`select item from checklist_items where incident_id = ${s.incidentId} and item like 'Check the Bluff Creek%'`)
        .toEqual([{ item: `Check the Bluff Creek gauge ${w}` }]);

      // A member queues a report offline; the incident closes before it arrives.
      const member = await open(viewport, "member@example.org", "another-good-password", s.incidentId);
      await show(member, "#/smartforms");
      const workspace = member.getByRole("region", { name: "Field report capture" });
      await workspace.getByLabel("Your organization's form").selectOption({ label: "Private field report" });
      await workspace.getByLabel("Incident board").selectOption(s.reports);
      const form = workspace.getByRole("form", { name: "Field report form" });
      await form.waitFor();
      await member.context().setOffline(true);
      await form.getByLabel("Code *").fill(`LATE-${w}`);
      await form.getByLabel("Name").fill("Culvert found after the close");
      await form.getByRole("button", { name: "Queue field report" }).click();
      await member.getByText(/durably queued on this device/).waitFor();
      await post(app, adminToken, `/api/v1/incidents/${s.incidentId}/close`, {}, 200);
      await member.context().setOffline(false);
      await continuity(member).getByRole("button", { name: "Reconnect and reconcile" }).click();
      await continuity(member).getByText("1 item reached the incident after it closed and went to its administrators to accept or refuse.").waitFor();
      await member.screenshot({ path: join(SHOTS, `late-sent-${w}.png`) });
      expect(await admin`select id from board_records where board_id = ${s.reports} and data->>'code' = ${`LATE-${w}`}`).toHaveLength(0);
      await member.context().close();

      // The administrator finds it on the incident's setup, reopens and accepts it.
      await lead.reload({ waitUntil: "load" });
      await show(lead, "#/incidents");
      const row = lead.getByRole("listitem").filter({ hasText: `Closing ${w}` }).first();
      await row.getByRole("button", { name: "Participants" }).click();
      const late = lead.getByRole("region", { name: "Late submissions" });
      const item = late.getByRole("listitem", { name: `1 record on Private reports Closing ${w}` });
      await item.getByText("Awaiting a decision").waitFor();
      await item.getByText(/Sent by Member\./).waitFor();
      await item.getByText("Culvert found after the close").waitFor();
      expect(await item.getByRole("button", { name: `Accept 1 record on Private reports Closing ${w}` }).isDisabled()).toBe(true);
      await item.scrollIntoViewIfNeeded();
      await lead.screenshot({ path: join(SHOTS, `late-waiting-${w}.png`) });
      await row.getByRole("button", { name: "Reopen incident" }).click();
      await lead.getByLabel("Reason for reopening").fill("A late culvert report to accept");
      await lead.getByRole("button", { name: "Confirm reopen" }).click();
      await lead.getByText(`Closing ${w} is open again.`).waitFor();
      await item.getByRole("button", { name: `Accept 1 record on Private reports Closing ${w}` }).click();
      await late.getByText(`Accepted 1 record on Private reports Closing ${w}.`).waitFor();
      await item.getByText("Accepted", { exact: true }).waitFor();
      await item.scrollIntoViewIfNeeded();
      await lead.screenshot({ path: join(SHOTS, `late-accepted-${w}.png`) });
      const [accepted] = await admin`select created_by from board_records where board_id = ${s.reports} and data->>'code' = ${`LATE-${w}`}`;
      expect(accepted).toEqual({ created_by: seed.memberId });
      await lead.context().close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 240_000);
  }
});
