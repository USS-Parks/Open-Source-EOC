import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * Charts in reports and create-record tiles on screen (VC-24), at the frames'
 * 1586 by 992 and at 1534 by 790: an administrator adds a bar chart to a new
 * report, sees it in the preview and in a run, then adds a create-record
 * tile with a preset to a saved incident dashboard and adds a record from it
 * without leaving the dashboard.
 */

const DIST = buildDir("report-chart-tiles");
const SHOTS = shotDir("report-chart-tiles");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let token: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

const supplies = {
  key: "chart_tile_supplies",
  version: 1,
  title: "Supply log",
  fields: [
    { key: "item", label: "Item", type: "text", required: true },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent"] },
    { key: "status", label: "Status", type: "enum", values: ["open", "filled"] },
  ],
  views: [{ key: "all", title: "All", columns: ["item", "quantity", "priority", "status"] }],
};

async function signIn(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`
    insert into board_templates (key, version, title, definition)
    values (${supplies.key}, 1, ${supplies.title}, ${admin.json(supplies as never)})`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  token = await login(app);
  boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: supplies.key })).id as string;
  for (const [item, quantity, priority] of [
    ["Sandbags", 100, "routine"], ["Water", 200, "routine"], ["Cots", 50, "urgent"], ["Generators", 3, "urgent"], ["Tarps", 40, "routine"],
  ] as const) {
    await post(app, token, `/api/v1/boards/${boardId}/records`, { item, quantity, priority, status: "filled" });
  }
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("report charts and create-record tiles on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`adds a chart to a report and a create-record tile to a dashboard, at ${viewport.width} by ${viewport.height}`, async () => {
      const name = `Supplies by priority ${viewport.width}`;
      const incidentName = `River Flood ${viewport.width}`;
      const incidentId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
        { templateKey: "wildfire", name: incidentName })).incidentId as string;
      await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
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
      await signIn(page);

      // A report with a bar chart of its records by priority.
      await page.getByRole("button", { name: "Reports", exact: true }).click();
      await page.getByRole("button", { name: "New report" }).click();
      const builder = page.getByRole("region", { name: "New report" });
      await builder.getByLabel("Report name").fill(name);
      await builder.getByLabel("Board", { exact: true }).selectOption({ label: "Supply log" });
      await builder.getByRole("group", { name: "Columns" }).getByRole("checkbox", { name: "Item" }).waitFor();
      const chart = builder.getByRole("group", { name: "Chart" });
      await chart.getByLabel("Chart", { exact: true }).selectOption("bar");
      await chart.getByLabel("Count records by").selectOption("priority");
      const preview = builder.getByRole("article", { name: "Records by Priority" });
      await preview.getByRole("img", { name: "Routine: 3" }).waitFor();
      await preview.getByRole("img", { name: "Urgent: 2" }).waitFor();
      await chart.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `report-chart-builder-${viewport.width}.png`) });
      await builder.getByRole("button", { name: "Save report" }).click();
      const detail = page.getByRole("region", { name: `Report: ${name}` });
      await detail.getByRole("button", { name: "Run", exact: true }).click();
      const run = detail.getByRole("region", { name: "Run" });
      await run.getByRole("article", { name: "Records by Priority" }).getByRole("img", { name: "Routine: 3" }).waitFor();
      await run.scrollIntoViewIfNeeded();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `report-chart-run-${viewport.width}.png`) });
      const [saved] = await admin`select definition from reports where name = ${name}`;
      expect(saved!.definition).toMatchObject({ chart: { display: "bar", field: "priority", interval: null } });

      // A create-record tile on the incident's saved dashboard, with the status preset to open.
      await page.goto(`${baseUrl}/app/index.html#/dashboard?incident=${incidentId}`, { waitUntil: "load" });
      if (await page.getByRole("button", { name: "Close context drawer" }).count()) {
        await page.getByRole("button", { name: "Close context drawer" }).click();
      }
      await page.getByRole("button", { name: "Create saved view" }).first().click();
      const editor = page.getByRole("region", { name: "Configure saved dashboard" });
      const tiles = editor.getByRole("group", { name: "Create-record tiles" });
      await tiles.getByLabel("Board for a new tile").selectOption({ label: "Supply log" });
      await tiles.getByRole("button", { name: "Add a preset value" }).click();
      await tiles.getByLabel("Preset 1 field").selectOption("status");
      await tiles.getByLabel("Preset 1 value").selectOption("open");
      await tiles.getByRole("button", { name: "Add create-record tile" }).click();
      await tiles.getByText("1 preset value").waitFor();
      await tiles.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `tile-configure-${viewport.width}.png`) });
      await editor.getByRole("button", { name: "Save view" }).click();

      const tile = page.getByRole("region", { name: "Incident statistics" }).getByRole("article", { name: "New Supply log record" });
      await tile.getByText("Starts with Status: Open").waitFor();
      await page.screenshot({ path: join(SHOTS, `tile-dashboard-${viewport.width}.png`) });
      await tile.getByRole("button", { name: "New Supply log record" }).click();
      const drawer = page.getByRole("dialog", { name: "New Supply log record" });
      await drawer.getByLabel(/^Item/).fill(`Cots ${viewport.width}`);
      await page.screenshot({ path: join(SHOTS, `tile-form-${viewport.width}.png`) });
      await drawer.getByRole("button", { name: "Save record" }).click();
      await tile.getByRole("status").getByText("Record saved to Supply log.").waitFor();
      expect(await drawer.count()).toBe(0);
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `tile-saved-${viewport.width}.png`) });
      const [record] = await admin`
        select incident_id, data from board_records where board_id = ${boardId} and data ->> 'item' = ${`Cots ${viewport.width}`}`;
      expect(record).toMatchObject({ incident_id: incidentId, data: { item: `Cots ${viewport.width}`, status: "open" } });

      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 240_000);
  }
});
