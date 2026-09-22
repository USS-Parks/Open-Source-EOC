import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("tasks-browser");
const SHOTS = shotDir("tasks-browser");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let token: string;
let incidentId: string;
let adminId: string;
let incidentCommanderPositionId: string;

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const identity = await seedIdentity(admin);
  adminId = identity.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`
    insert into incident_templates (key, title, definition)
    values ('tasks_browser', 'Tasks browser', ${admin.json({
      key: "tasks_browser", title: "Tasks browser", positions: ["incident_commander"], boards: [],
      checklists: [{ position: "incident_commander", items: [{ item: "Confirm evacuation routes", category: "operations", due: { kind: "relative", anchor: "created", minutes: 30 } }] }],
    } as never)})`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  token = await login(app);
  const activated = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${identity.jurisdictionId}/incidents`, headers: auth(token), payload: { templateKey: "tasks_browser", name: "Tasks browser incident" } });
  expect(activated.statusCode, activated.body).toBe(201);
  incidentId = activated.json().incidentId as string;
  const [position] = await admin`
    select p.id from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId} and p.key = 'incident_commander'`;
  incidentCommanderPositionId = position!.id as string;
  const assigned = await app.inject({ method: "POST", url: `/api/v1/positions/${position!.id}/assignments`, headers: auth(token), payload: { personId: adminId } });
  expect(assigned.statusCode, assigned.body).toBe(201);
  const signedIn = await app.inject({ method: "POST", url: `/api/v1/positions/${position!.id}/sign-in`, headers: auth(token) });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  browser = await launchBrowser();
}, 120000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("task workspace in a real browser", () => {
  it("queues an offline completion, reconciles its receipt, and keeps the task workspace usable across themes", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const external: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url); return route.abort();
    });
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    const selectedIncident = page.getByLabel("Selected incident", { exact: true });
    await selectedIncident.locator(`option[value="${incidentId}"]`).waitFor({ state: "attached" });
    await selectedIncident.selectOption(incidentId);
    const actingPosition = page.getByLabel("Acting position", { exact: true });
    await actingPosition.locator(`option[value="${incidentCommanderPositionId}"]`).waitFor({ state: "attached" });
    const positionRefresh = page.waitForResponse((response) => response.url().endsWith("/api/v1/me") && response.status() === 200);
    await actingPosition.selectOption(incidentCommanderPositionId);
    await positionRefresh;
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await page.locator(".eoc-tasks-surface").getByRole("heading", { name: "Tasks" }).waitFor({ timeout: 10000 });
    await page.getByText("Confirm evacuation routes").waitFor({ timeout: 10000 });
    await page.getByRole("tab", { name: "Team Tasks" }).click();
    await page.getByLabel("Due").selectOption("next_24_hours");
    await page.getByText("Confirm evacuation routes").waitFor({ timeout: 10000 });
    await page.getByRole("tab", { name: "My Tasks" }).click();
    await page.getByText("My incident tasks", { exact: true }).waitFor({ timeout: 10000 });
    await page.locator("[data-table-id='incident-tasks'] table").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Complete" }).waitFor({ state: "visible" });
    await page.waitForFunction("() => { const complete = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Complete'); return complete instanceof HTMLButtonElement && !complete.disabled; }");
    expect(await page.getByRole("button", { name: "Complete" }).isEnabled()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "tasks-browser-light.png"), fullPage: true });
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "My Tasks" }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate("document.activeElement?.textContent")).toBe("Team Tasks");
    await page.getByText("Incident team tasks", { exact: true }).waitFor({ timeout: 10000 });
    await page.locator("[data-table-id='incident-tasks'] table").waitFor({ state: "visible" });
    await page.screenshot({ path: join(SHOTS, "tasks-browser-dark-390.png"), fullPage: true });
    expect(await page.evaluate("document.querySelector('.eoc-tasks-surface').scrollWidth <= document.querySelector('.eoc-tasks-surface').clientWidth")).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("tab", { name: "My Tasks" }).click();
    await page.getByText("My incident tasks", { exact: true }).waitFor({ timeout: 10000 });
    await page.locator("[data-table-id='incident-tasks'] table").waitFor({ state: "visible" });
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByText("Completion queued locally; server confirmation is still pending.").waitFor({ timeout: 10000 });
    await page.context().setOffline(false);
    await page.evaluate("window.dispatchEvent(new Event('online'))");
    await page.getByText(/queued completion.*reconciled/).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Open incident templates" }).click();
    await page.getByRole("heading", { name: "Activate an incident" }).waitFor({ timeout: 10000 });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 60000);
});
