import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Every view option on screen (VC-18), at the frames' 1586 by 992 and at
 * 1534 by 790: an administrator adds a view to a board in the designer and,
 * without writing any JSON, gives it columns, an any-of filter of a day
 * condition and a group holding a day from today, a sort and a grouping,
 * publishes and applies the version, and the board shows the records the
 * view keeps, grouped and sorted.
 */

const DIST = buildDir("board-conditions");
const SHOTS = shotDir("board-conditions");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;
const DAY = 86_400_000;
const now = Date.now();

/**
 * A zone where it is between 06:00 and 18:00 now, so its "today" holds while the file runs; the browser runs in it.
 * Each is its own canonical name: Chromium reports some zones under an older alias (Asia/Kolkata as Asia/Calcutta).
 */
const zone = ["Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Karachi", "Asia/Tokyo"]
  .find((name) => {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: name, hour: "numeric", hourCycle: "h23" }).format(now));
    return hour >= 6 && hour < 18;
  })!;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function openPage(viewport: { width: number; height: number }, hash: string): Promise<Page> {
  const context = await browser.newContext({ viewport, timezoneId: zone });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html${hash}`);
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

async function rowSummaries(page: Page): Promise<string[]> {
  return (await page.getByRole("main").locator("tbody tr td:nth-child(2)").allTextContents()).map((text) => text.trim());
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  await post(app, token, "/api/v1/templates", {
    key: "claims", version: 1, title: "Claims",
    fields: [
      { key: "summary", label: "Summary", type: "text", required: true },
      { key: "priority", label: "Priority", type: "enum", values: ["low", "high"] },
      { key: "due", label: "Due", type: "datetime" },
    ],
    views: [{ key: "all", title: "All claims", columns: ["summary", "priority", "due"] }],
  });
  boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: "claims" })).id as string;
  const at = (ms: number) => new Date(ms).toISOString();
  for (const record of [
    { summary: "Due today", priority: "low", due: at(now) },
    { summary: "Overdue and high", priority: "high", due: at(now - 10 * DAY) },
    { summary: "Old and low", priority: "low", due: at(now - 10 * DAY) },
    { summary: "Later and high", priority: "high", due: at(now + 10 * DAY) },
    { summary: "No date", priority: "high" },
  ]) await post(app, token, `/api/v1/boards/${boardId}/records`, record);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("a view built on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`groups, sorts and filters any of a day condition and a group, at ${viewport.width} by ${viewport.height}`, async () => {
      const key = `attention_${viewport.width}`;
      const page = await openPage(viewport, `#/board/${boardId}/design`);
      await page.getByRole("heading", { name: "Customize Claims" }).waitFor();
      await page.getByRole("tab", { name: "Views" }).click();

      // Add the view with its columns.
      await page.getByLabel("View key", { exact: true }).fill(key);
      await page.getByLabel("View title", { exact: true }).fill(`Needs attention ${viewport.width}`);
      const columns = page.getByRole("group", { name: "View columns" });
      for (const field of ["summary", "priority", "due"]) await columns.getByRole("checkbox", { name: field, exact: true }).check();
      await page.getByRole("button", { name: "Add view" }).click();
      const view = page.locator("details.board-designer__field").filter({ hasText: `${key}: 3 columns` });
      await view.locator("summary").click();

      // Any of: due today, or high priority and due more than three days ago.
      const conditions = view.getByRole("group", { name: `Conditions for view ${key}` });
      await conditions.getByRole("button", { name: "Add condition", exact: true }).click();
      await conditions.getByLabel("Condition 1 field").selectOption("due");
      await conditions.getByLabel("Condition 1 operator").selectOption("on");
      expect(await conditions.getByLabel("Condition 1 value").inputValue()).toBe("today");
      await conditions.getByLabel("Records shown need").selectOption("any");
      await conditions.getByRole("button", { name: "Add group" }).click();
      await conditions.getByLabel("Group 1 condition 1 field").selectOption("priority");
      await conditions.getByLabel("Group 1 condition 1 operator").selectOption("eq");
      await conditions.getByLabel("Group 1 condition 1 value").selectOption("high");
      await conditions.getByRole("button", { name: "Add condition to group 1" }).click();
      await conditions.getByLabel("Group 1 condition 2 field").selectOption("due");
      await conditions.getByLabel("Group 1 condition 2 operator").selectOption("before");
      await conditions.getByRole("combobox", { name: /^Group 1 condition 2 value/ }).selectOption("days");
      await conditions.getByLabel("Group 1 condition 2 value, days from today (negative for earlier days)").fill("-3");
      await conditions.getByLabel("Group 1 needs").selectOption("all");
      expect(await conditions.getByLabel("Days counted in time zone").inputValue()).toBe(zone);

      // Sorted by due date, latest first, and grouped by priority.
      await view.getByRole("button", { name: "Add sort key" }).click();
      await view.getByLabel("Sort 1 field").selectOption("due");
      await view.getByLabel("Sort 1 direction").selectOption("desc");
      await view.getByLabel("Group by").selectOption("priority");
      await conditions.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `view-options-${viewport.width}.png`), fullPage: false });

      const published = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith("/api/v1/templates") && response.status() === 201);
      const upgraded = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/api/v1/boards/${boardId}/upgrade`) && response.status() === 200);
      await page.getByRole("button", { name: /^Publish and apply version \d+$/ }).click();
      await published;
      await upgraded;
      const [template] = await admin`select definition from board_templates where key = 'claims' order by version desc limit 1`;
      const saved = (template!.definition as { views: Array<Record<string, unknown>> }).views.find((candidate) => candidate.key === key);
      expect(saved).toEqual({
        key, title: `Needs attention ${viewport.width}`, kind: "list", columns: ["summary", "priority", "due"], filter: [],
        match: "any", timeZone: zone,
        where: [
          { field: "due", op: "on", value: "today" },
          { match: "all", conditions: [{ field: "priority", op: "eq", value: "high" }, { field: "due", op: "before", value: "today-3d" }] },
        ],
        sorts: [{ field: "due", dir: "desc" }], groupBy: "priority",
      });

      // The board shows what the view keeps: high before low, then latest due first.
      await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?view=${key}`);
      await expect.poll(() => rowSummaries(page)).toEqual(["Overdue and high", "Due today"]);
      const counts = page.getByRole("region", { name: "Group counts" });
      await counts.waitFor();
      expect(await counts.getByRole("listitem").allTextContents()).toEqual(["High 1", "Low 1"]);
      await page.screenshot({ path: join(SHOTS, `view-board-${viewport.width}.png`), fullPage: false });
      await page.context().close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
