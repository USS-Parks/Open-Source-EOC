import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Board actions on screen (Veoci and air gap VA25, VC-17), at the frames'
 * 1586 by 992 and at 1534 by 790. An administrator adds an action in the
 * designer's Actions tab with its controls alone (at the first width it is
 * published and applied; at the second the published action reads back), and
 * a member confirming a damage report sets off both of the board's actions:
 * the confirmation time is stamped and a follow-up opens on the incident's
 * other board. The record's change history names the action on its write and
 * says what each run did.
 */

const DIST = buildDir("board-actions");
const SHOTS = shotDir("board-actions");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

const reportsTemplate = {
  key: "synthetic_damage_reports",
  version: 1,
  title: "Synthetic Damage Reports",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["new", "confirmed"] },
    { key: "confirmed_at", label: "Confirmed at", type: "datetime" },
  ],
  views: [{ key: "all", title: "All reports", columns: ["summary", "status", "confirmed_at"] }],
  actions: [{
    key: "stamp", label: "Stamp the confirmation", trigger: { kind: "field_changed", field: "status" },
    condition: { conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
    step: { kind: "set_field", field: "confirmed_at", value: "now" },
  }],
};

const followUpsTemplate = {
  key: "synthetic_follow_ups",
  version: 1,
  title: "Synthetic Follow-ups",
  fields: [
    { key: "task", label: "Task", type: "text" },
    { key: "report", label: "Report", type: "record_ref", targetBoardKey: "synthetic_damage_reports", labelField: "summary" },
  ],
  views: [{ key: "all", title: "All follow-ups", columns: ["task"] }],
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let reportsBoard: string;
let followUpsBoard: string;
let incidentId: string;
let memberToken: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function open(viewport: { width: number; height: number }, hash: string, email: string, password: string): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html#${hash}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const adminToken = await login(app);
  memberToken = await login(app, "member@example.org", "another-good-password");
  await post(app, adminToken, "/api/v1/templates", reportsTemplate);
  await post(app, adminToken, "/api/v1/templates", followUpsTemplate);
  const board = async (templateKey: string) =>
    (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey })).id as string;
  reportsBoard = await board(reportsTemplate.key);
  followUpsBoard = await board(followUpsTemplate.key);
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Culvert Damage Exercise",
  })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${reportsBoard}), (${incidentId}, ${followUpsBoard})`;
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("board actions on screen", () => {
  for (const [index, viewport] of VIEWPORTS.entries()) {
    it(`writes an action in the designer and shows each run in the record's history, at ${viewport.width} by ${viewport.height}`, async () => {
      const designer = await open(viewport, `/board/${reportsBoard}/design`, "admin@example.org", "correct-horse-battery");
      await designer.getByRole("heading", { name: "Customize Synthetic Damage Reports" }).waitFor();
      await designer.getByRole("tab", { name: "Actions", exact: true }).click();
      await designer.getByRole("region", { name: "Action 1: Stamp the confirmation" }).waitFor();
      if (index === 0) {
        await designer.getByRole("button", { name: "Add action" }).click();
        await designer.getByLabel("Action 2 label").fill("Open a follow-up");
        await designer.getByLabel("Action 2 runs when").selectOption("field_changed");
        await designer.getByLabel("Action 2 field that changes").selectOption("status");
        const conditions = designer.getByRole("group", { name: "Conditions for action 2" });
        await conditions.getByLabel("Run only when conditions on the record hold").check();
        await conditions.getByLabel("Condition 1 field").selectOption("status");
        await conditions.getByLabel("Condition 1 operator").selectOption("eq");
        await conditions.getByLabel("Condition 1 value").selectOption("confirmed");
        await designer.getByLabel("Action 2 does").selectOption("create_record");
        await designer.getByRole("combobox", { name: "Action 2 board to add the record to" }).selectOption(followUpsTemplate.key);
        await designer.getByRole("combobox", { name: "Action 2 reference back to this record" }).selectOption("report");
        await designer.getByRole("button", { name: "Copy a field into the new record" }).click();
        await designer.getByLabel("Action 2 copy 1 into").selectOption("task");
        await designer.getByLabel("Action 2 copy 1 from").selectOption("summary");
        await designer.screenshot({ path: join(SHOTS, `designer-${viewport.width}.png`) });
        const published = designer.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/api/v1/templates") && response.status() === 201);
        const upgraded = designer.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith(`/api/v1/boards/${reportsBoard}/upgrade`) && response.status() === 200);
        await designer.getByRole("button", { name: "Publish and apply version 2" }).click();
        await published;
        await upgraded;
        const [saved] = await admin`select definition from board_templates where key = ${reportsTemplate.key} and version = 2`;
        expect((saved!.definition as { actions: unknown[] }).actions[1]).toEqual({
          key: "action", label: "Open a follow-up", trigger: { kind: "field_changed", field: "status" },
          condition: { match: "all", conditions: [{ field: "status", op: "eq", value: "confirmed" }] },
          step: { kind: "create_record", board: followUpsTemplate.key, link: "report", mapping: [{ to: "task", from: "summary" }] },
        });
      } else {
        const published = designer.getByRole("region", { name: "Action 2: Open a follow-up" });
        expect(await published.getByLabel("Action 2 does").inputValue()).toBe("create_record");
        await published.getByRole("combobox", { name: "Action 2 reference back to this record" }).waitFor();
        await designer.screenshot({ path: join(SHOTS, `designer-${viewport.width}.png`) });
      }
      await designer.close();

      const summary = `Culvert on Bald Hills Road ${viewport.width}`;
      const recordId = (await post(app, memberToken, `/api/v1/boards/${reportsBoard}/records?incidentId=${incidentId}`,
        { summary, status: "new" })).id as string;
      const page = await open(viewport, `/board/${reportsBoard}?incident=${incidentId}&view=all&record=${recordId}`,
        "member@example.org", "another-good-password");
      await page.getByRole("heading", { name: "Synthetic Damage Reports", exact: true }).waitFor();
      const openContext = page.getByRole("button", { name: "Open context" });
      if (await openContext.isVisible()) await openContext.click();
      const selected = page.getByRole("region", { name: "Selected record" });
      await selected.getByRole("button", { name: "Edit record" }).click();
      const edit = page.getByRole("dialog", { name: "Edit Synthetic Damage Reports record" });
      await edit.getByRole("combobox", { name: "Status" }).selectOption("confirmed");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await edit.waitFor({ state: "hidden" });
      // The saved record reloads, and the pane with it; its attribution names the update once it has.
      await selected.getByText(/^Updated .+ by Member\.$/).waitFor();

      await selected.getByRole("tab", { name: "Change history" }).click();
      const history = selected.getByRole("list", { name: "Record history" });
      await history.getByText("Updated by action Stamp the confirmation").waitFor();
      await history.getByText("When Status changed: created a linked record on Synthetic Follow-ups.").waitFor();
      await history.getByText("When Status changed: set Confirmed at.").waitFor();
      await page.screenshot({ path: join(SHOTS, `history-${viewport.width}.png`) });

      const [followUp] = await admin`select data, created_by from board_records where board_id = ${followUpsBoard} and data ->> 'report' = ${recordId}`;
      expect(followUp!.data).toEqual({ report: recordId, task: summary });
      const [report] = await admin`select data from board_records where id = ${recordId}`;
      expect(Date.now() - Date.parse((report!.data as { confirmed_at: string }).confirmed_at)).toBeLessThan(120_000);
      await page.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
