import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("boards-designer-app");
const SHOTS = shotDir("boards-designer");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  // The standard library ships Shelters version 2, so the designer publishes version 3.
  boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: "shelters" })).id as string;

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("no-code board authoring", () => {
  it("configures, previews, publishes and reapplies a board version in both themes and widths", async () => {
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}/design`);
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Customize Shelters" }).waitFor();

    const nameField = page.locator("details.board-designer__field").filter({ hasText: "name: text" });
    await nameField.locator("summary").click();
    await nameField.getByLabel("name label").fill("Shelter site");
    await page.screenshot({ path: join(SHOTS, "boards-designer-wide-light.png"), fullPage: false });

    await page.getByRole("tab", { name: "Fields", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("tab", { name: "Layouts" }).getAttribute("aria-selected")).toBe("true");
    await page.getByRole("button", { name: "Add section" }).first().click();
    await page.getByRole("tab", { name: "Routing" }).click();
    await page.getByRole("button", { name: "Enable routing" }).click();
    await page.getByLabel("Assign during this transition").check();
    await page.getByLabel("Due rule").selectOption("relative");
    await page.getByLabel("Due after minutes").fill("90");
    await page.getByRole("button", { name: "Add approval" }).click();
    await page.getByRole("button", { name: "Add escalation" }).click();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("tab", { name: "Review & preview" }).click();
    await page.getByText("2 states and 1 transitions configured.").waitFor();
    await page.screenshot({ path: join(SHOTS, "boards-designer-wide-dark.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Routing" }).click();
    const geometry = await page.evaluate(`(() => {
      const node = document.querySelector('.board-designer');
      if (!node) throw new Error('board designer missing');
      const bounds = node.getBoundingClientRect();
      return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        left: bounds.left, right: bounds.right, viewport: document.documentElement.clientWidth };
    })()`) as { scrollWidth: number; clientWidth: number; left: number; right: number; viewport: number };
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({ path: join(SHOTS, "boards-designer-narrow-dark.png"), fullPage: false });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("tab", { name: "Review & preview" }).click();
    await page.getByRole("tab", { name: "List" }).click();
    await page.getByText("Shelter site", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "boards-designer-narrow-light.png"), fullPage: false });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const published = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/v1/templates") && response.status() === 201);
    const upgraded = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/boards/${boardId}/upgrade`) && response.status() === 200);
    await page.getByRole("button", { name: "Publish and apply version 3" }).click();
    await published;
    await upgraded;
    await page.waitForURL((url) => url.hash.startsWith(`#/board/${boardId}`) && !url.hash.includes("/design"));
    await page.evaluate(`location.hash = ${JSON.stringify(`#/board/${boardId}/design`)}`);
    await page.getByRole("heading", { name: "Customize Shelters" }).waitFor();
    await page.getByText("Version 3", { exact: true }).waitFor();

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);

  it("saves conditions, sorts and a grouping into a template's own view", async () => {
    const viewPage = await browser.newPage({ viewport: { width: 1586, height: 992 } });
    viewPage.on("pageerror", (error) => pageErrors.push(error.message));
    await viewPage.goto(`${baseUrl}/app/index.html#/board/${boardId}/design`);
    await viewPage.getByLabel("Email").fill("admin@example.org");
    await viewPage.getByLabel("Password").fill("correct-horse-battery");
    await viewPage.getByRole("button", { name: "Sign in" }).click();
    await viewPage.getByRole("heading", { name: "Customize Shelters" }).waitFor();
    await viewPage.getByRole("tab", { name: "Views" }).click();
    // The view already holds one condition; the one added here is the second.
    const view = viewPage.locator("details.board-designer__field").filter({ hasText: "open:" });
    await view.locator("summary").first().click();
    const conditions = view.getByRole("group", { name: "Conditions for view open" });
    await conditions.getByRole("button", { name: "Add condition", exact: true }).click();
    await conditions.getByLabel("Condition 2 field").selectOption("status");
    await conditions.getByLabel("Condition 2 operator").selectOption("eq");
    await conditions.getByLabel("Condition 2 value").selectOption("normal");
    await view.getByRole("button", { name: "Add sort key" }).click();
    await view.getByLabel("Sort 1 field").selectOption("occupancy");
    await view.getByLabel("Sort 1 direction").selectOption("desc");
    await view.getByLabel("Group by").selectOption("status");
    expect(await view.getByLabel("Archived records").count()).toBe(0);
    const published = viewPage.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/v1/templates") && response.status() === 201);
    await viewPage.getByRole("button", { name: /^Publish and apply version \d+$/ }).click();
    await published;
    const [template] = await admin`select definition from board_templates where key = 'shelters' order by version desc limit 1`;
    const saved = (template!.definition as { views: Array<Record<string, unknown>> }).views.find((candidate) => candidate.key === "open")!;
    expect(saved).toMatchObject({
      where: [{ field: "planned", op: "neq", value: true }, { field: "status", op: "eq", value: "normal" }],
      sorts: [{ field: "occupancy", dir: "desc" }], groupBy: "status",
    });
    expect(saved).not.toHaveProperty("sort");
    await viewPage.close();
    expect(pageErrors).toEqual([]);
  }, 120_000);
});
