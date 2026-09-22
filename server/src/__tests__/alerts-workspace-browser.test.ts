import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("alerts-workspace-app");
const SHOTS = shotDir("alerts-workspace");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let adminToken: string;
let incidentId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function request(method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const response = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload ? { payload } : {}),
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
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
  baseUrl = await listen(app);

  adminToken = await login(app);
  const incident = await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "Synthetic D28 Alert Exercise" });
  incidentId = incident.incidentId as string;
  await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`, {
    incidentId,
    alert: {
      sender: "duty@example.org", status: "Draft", msgType: "Alert", scope: "Public",
      info: [{ language: "en-US", category: ["Safety"], event: "Shelter opening", urgency: "Expected", severity: "Moderate", certainty: "Likely", headline: "High school shelter open", description: "Synthetic exercise shelter information for interface review." }],
    },
  });
  await admin`
    insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
    values (${seed.jurisdictionId}, ${seed.adminId}, 'workflow', 'Shelter approval requested',
      'Review the synthetic shelter request before the next operational briefing.', 'delivered',
      ${admin.json({ incidentId, urgency: "Expected" } as never)})`;

  browser = await launchBrowser({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
});

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn() {
  await page.goto(`${baseUrl}/app/index.html`);
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).waitFor({ state: "visible", timeout: 20000 });
}

async function openCenter() {
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  await page.getByRole("button", { name: "Open center" }).click();
  await page.getByRole("heading", { name: "Alerts and notifications" }).waitFor({ state: "visible", timeout: 20000 });
}

describe("real alert workspace", () => {
  it("keeps read, acknowledgement, local review, and external delivery visibly separate", async () => {
    await signIn();
    await openCenter();
    await page.getByRole("button", { name: /Shelter approval requested/ }).click();
    await page.getByText("Not acknowledged", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Acknowledge notification" }).click();
    await page.getByText(/by Admin/).waitFor({ state: "visible", timeout: 20000 });
    await page.screenshot({ path: join(SHOTS, "alerts-wide-light.png"), fullPage: false });

    await page.getByRole("tab", { name: /Alert records/ }).click();
    await page.getByRole("button", { name: /High school shelter open/ }).click();
    await page.getByRole("heading", { name: "High school shelter open" }).waitFor({ state: "visible" });
    await page.getByText("No workspace outbound attempt recorded", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Submit for local review" }).click();
    await page.getByRole("button", { name: "Approve local alert" }).waitFor({ state: "visible", timeout: 20000 });

    const compose = page.getByRole("button", { name: "Compose local alert" });
    await compose.focus();
    await compose.press("Enter");
    await page.getByLabel("Record type").selectOption("Exercise");
    await page.getByLabel("Event").fill("Evacuation drill");
    await page.getByLabel("Headline").fill("Synthetic evacuation exercise");
    await page.getByLabel("Description").fill("Exercise content only. No public warning is sent.");
    await page.getByRole("button", { name: "Review local draft" }).press("Enter");
    await page.getByText("Local workspace only", { exact: true }).waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "External send unavailable" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Save local draft" }).press("Enter");
    await page.getByText("Synthetic evacuation exercise", { exact: true }).waitFor({ state: "visible", timeout: 20000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(SHOTS, "alerts-narrow-light.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "alerts-wide-dark.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(SHOTS, "alerts-narrow-dark.png"), fullPage: false });
    const contained = await page.evaluate("(() => { const node = document.querySelector('.notification-workspace'); return !!node && node.scrollWidth <= node.clientWidth; })()");
    expect(contained).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120000);
});
