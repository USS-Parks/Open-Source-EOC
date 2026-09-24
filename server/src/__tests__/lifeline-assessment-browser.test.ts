import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("lifeline-assessment-app");
const SHOTS = shotDir("lifeline-assessment");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let adminToken: string;
let outsiderToken: string;
let incidentId: string;
let jurisdictionId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function request(
  token: string,
  method: "POST" | "PUT",
  url: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await app.inject({ method, url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function signIn(target: Page, email: string, password: string): Promise<void> {
  await target.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await target.getByLabel("Email").fill(email);
  await target.getByLabel("Password").fill(password);
  await target.getByRole("button", { name: "Sign in" }).click();
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  const viewerId = await createPerson(admin, {
    email: "viewer@example.org",
    displayName: "Read Only Operator",
    password: "viewer-cannot-write",
  });
  await addMembership(admin, viewerId, jurisdictionId, "viewer");
  const outsideJurisdictionId = await createJurisdiction(admin, "outside-county", "Outside County EOC");
  const outsiderId = await createPerson(admin, {
    email: "outside@example.org",
    displayName: "Outside Operator",
    password: "outside-only-password",
  });
  await addMembership(admin, outsiderId, outsideJurisdictionId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);

  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);

  adminToken = await login(app);
  outsiderToken = await login(app, "outside@example.org", "outside-only-password");
  const incident = await request(
    adminToken,
    "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "daily_ops", name: "Harbor Energy Response" },
  );
  incidentId = incident.incidentId as string;
  const now = Date.now();
  await request(adminToken, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
    expectedRevision: 0,
    geometry: null,
    operationalPeriod: {
      label: "OP Current",
      startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
    },
    reason: "Current operational period for browser acceptance",
  });
  await request(adminToken, "POST", `/api/v1/jurisdictions/${jurisdictionId}/positions`, {
    key: "utility_liaison",
    title: "Utility Liaison",
  });
  const resource = await request(
    adminToken,
    "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`,
    { origin: "eoc", item: "Mobile generator", quantity: 1, priority: "immediate", incidentId },
  );
  expect(resource.id).toEqual(expect.any(String));
  await request(adminToken, "POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
    lifeline: "energy",
    condition: "unstable",
    assessedAt: new Date(now - 15 * 60 * 1000).toISOString(),
    confidence: "estimated",
    impactStatement: "Initial feeder interruption",
    operationalPeriod: "OP Current",
    stabilizationOutlook: "Utility inspection underway",
    components: [],
    evidence: [],
    responsibleOrganizationIds: [],
    actions: [],
  });

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    externalRequests.push(url);
    return route.abort();
  });
  await signIn(page, "admin@example.org", "correct-horse-battery");
  await page.getByRole("button", { name: "ESFs & Lifelines" }).click();
  await page.locator('[data-lifeline="energy"]').waitFor({ state: "visible" });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("real incident Community Lifeline assessment workflow", () => {
  it("authors an attributed Energy assessment and presents the frozen result in a briefing", async () => {
    const energy = page.locator('[data-lifeline="energy"]');
    await energy.getByRole("button", { name: "Open Energy details" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(`location.hash.startsWith("#/lifeline/energy?") && location.hash.includes("incident=")`);
    await page.getByRole("button", { name: "Update assessment" }).click();

    const form = page.locator(".eoc-lifeline-assessment-form");
    await form.getByLabel("Condition").selectOption("stabilizing");
    await form.getByLabel("Confidence").selectOption("confirmed");
    await form.getByLabel("Impact explanation").fill("North district feeder damage limits service");
    await form.getByLabel("Stabilization outlook").fill("Staged restoration is expected this operational period");
    await form.getByRole("button", { name: "Add component" }).click();
    await form.getByLabel("Component name").fill("Electricity distribution");
    await form.getByLabel("Affected geography").fill("North district");
    await form.getByLabel("Component impact").fill("Three neighborhoods remain without utility power");
    await form.getByLabel("Causes, one per line").fill("Damaged feeder");
    await form.getByLabel("Dependencies, one per line").fill("Transportation access");
    await form.getByRole("button", { name: "Add evidence" }).click();
    await form.getByLabel("Description").fill("Utility field team confirmed feeder damage");
    await form.getByLabel("Source reference").fill("UTIL-2026-17");
    await form.getByRole("button", { name: "Add action" }).click();
    await form.getByLabel("Action title").fill("Inspect and isolate damaged feeder");
    await form.getByLabel("Status").selectOption("in_progress");
    await form.getByLabel("Estimated completion").fill("2026-09-22T01:30");
    await form.getByLabel("Responsible organization").selectOption(jurisdictionId);
    await form.getByLabel("Assigned owner").selectOption({ label: "Utility Liaison" });
    await form.getByLabel("Linked resource request").selectOption({ label: "Mobile generator · submitted" });
    await form.getByRole("button", { name: "Save revised assessment" }).click();

    await page.getByRole("status").filter({ hasText: "Assessment recorded" }).waitFor();
    await energy.getByText("North district feeder damage limits service", { exact: true }).waitFor();
    await page.getByRole("button", { name: "View history" }).click();
    await page.getByText("Utility field team confirmed feeder damage", { exact: true }).waitFor();
    expect(await page.getByText(/Admin · No acting position/).first().isVisible()).toBe(true);
    expect(await page.getByText("Inspect and isolate damaged feeder", { exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "lifeline-assessment-light-1440.png"), fullPage: false });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "lifeline-assessment-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "lifeline-assessment-dark-390.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(SHOTS, "lifeline-assessment-light-390.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 1000 });

    const sitrep = await request(
      adminToken,
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/sitreps`,
      { period: "OP Current", incidentId },
    );
    const sitrepId = sitrep.id as string;
    await page.evaluate(`location.hash = "#/sitrep/${sitrepId}?incident=${incidentId}"`);
    const briefing = page.getByRole("article", { name: "Situation report: OP Current" });
    await briefing.waitFor();
    expect(await briefing.getByText("North district feeder damage limits service", { exact: true }).isVisible()).toBe(true);
    expect(await briefing.getByText(/Inspect and isolate damaged feeder/).isVisible()).toBe(true);
    expect(await briefing.getByText(/Staged restoration is expected/).isVisible()).toBe(true);
  }, 120_000);

  it("keeps a viewer's rejected draft and isolates an unrelated organization", async () => {
    const viewer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await viewer.emulateMedia({ reducedMotion: "reduce" });
    try {
      await signIn(viewer, "viewer@example.org", "viewer-cannot-write");
      await viewer.evaluate(`location.hash = "#/lifeline/energy?incident=${incidentId}"`);
      await viewer.getByRole("button", { name: "Update assessment" }).click();
      const form = viewer.locator(".eoc-lifeline-assessment-form");
      await form.getByLabel("Impact explanation").fill("Viewer draft must remain after denial");
      await form.getByRole("button", { name: "Save revised assessment" }).click();
      const alert = form.getByRole("alert");
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Draft values are retained");
      expect(await form.getByLabel("Impact explanation").inputValue()).toBe("Viewer draft must remain after denial");
    } finally {
      await viewer.close();
    }

    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}/lifeline-assessments`,
      headers: auth(outsiderToken),
    });
    expect(denied.statusCode, denied.body).toBe(404);

    const outsider = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await signIn(outsider, "outside@example.org", "outside-only-password");
      await outsider.evaluate(`location.hash = "#/lifeline/energy?incident=${incidentId}"`);
      await outsider.getByText("Select an incident", { exact: true }).waitFor();
      expect(await outsider.locator(".eoc-lifeline-drawer").count()).toBe(0);
      expect(await outsider.getByText("North district feeder damage limits service", { exact: true }).count()).toBe(0);
    } finally {
      await outsider.close();
    }

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
