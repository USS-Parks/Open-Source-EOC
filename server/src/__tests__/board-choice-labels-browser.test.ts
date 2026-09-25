import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * A choice field reads as its label wherever a record shows: the record's
 * detail, its change history, and the cards of the kanban and calendar
 * modes. A Resource Requests board has two choice fields, so a kanban card
 * grouped by priority shows the state beside it.
 */

const DIST = buildDir("board-choice-labels-app");
let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let boardId: string;
let recordId: string;
const pageErrors: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: "resource_request", title: "Requests" })).id as string;
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  recordId = (await post(app, token, `/api/v1/boards/${boardId}/records`, {
    item: "Sandbags", quantity: 200, priority: "immediate", state: "submitted", needed_by: due,
  })).id as string;
  const moved = await app.inject({ method: "PATCH", url: `/api/v1/boards/${boardId}/records/${recordId}`,
    headers: { authorization: `Bearer ${token}` }, payload: { state: "accepted" } });
  expect(moved.statusCode, moved.body).toBe(200);
  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1586, height: 992 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("choice labels", () => {
  it("shows a choice field's label in the record detail, its history, and the kanban and calendar cards", async () => {
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?view=all&record=${recordId}`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    const detail = page.getByRole("region", { name: "Selected record" });
    await detail.getByText("Immediate", { exact: true }).waitFor();
    await detail.getByText("Accepted", { exact: true }).waitFor();
    expect(await detail.getByText("immediate", { exact: true }).count()).toBe(0);

    await page.getByRole("tab", { name: "Change history" }).click();
    await page.getByRole("list", { name: "Record history" }).getByText("Submitted → Accepted").waitFor();

    const modes = page.getByRole("group", { name: "Show records as" });
    await modes.getByRole("button", { name: "Kanban" }).click();
    const card = page.locator(".board-kanban__card", { hasText: "Sandbags" });
    await card.getByText(/State: Accepted/).waitFor();
    expect(await card.getByText(/State: accepted/).count()).toBe(0);
    await modes.getByRole("button", { name: "Calendar" }).click();
    await page.locator(".board-calendar").getByRole("button", { name: /Sandbags/ }).waitFor();
    expect(await page.locator(".board-calendar").getByText("accepted", { exact: true }).count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 120_000);
});
