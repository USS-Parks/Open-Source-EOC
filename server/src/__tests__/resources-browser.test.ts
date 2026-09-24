import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("d22-app");
const SHOTS = shotDir("d22");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let incidentId: string;
let participantId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "D22 Resource Exercise", kind: "incident",
  });
  incidentId = incident.incidentId as string;
  const partnerOrganization = await createJurisdiction(admin, "d22-resource-partner", "D22 Mutual Aid");
  const partner = await createPerson(admin, {
    email: "d22-resource-partner@example.org", displayName: "D22 Resource Partner", password: "d22-resource-password",
  });
  await addMembership(admin, partner, partnerOrganization, "member");
  const grant = await post(app, token, `/api/v1/incidents/${incidentId}/participants`, {
    organizationSlug: "d22-resource-partner", personEmail: "d22-resource-partner@example.org",
    incidentPositionTitle: "Resource Support", role: "contributor", expiresAt: "2099-09-21T20:00:00.000Z",
    reason: "D22 supplier coordination proof",
  });
  participantId = (grant.participant as { id: string }).id;
  await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/positions`, {
    key: "d22_logistics", title: "D22 Logistics",
  });
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

describe("real-browser resource coordination", () => {
  it("takes an incident-scoped request through named supplier assignment with retained history", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Selected incident").selectOption(incidentId);
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await page.getByLabel("Requested item").fill("Portable water tender");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Priority").selectOption("immediate");
    await page.getByLabel("Request notes").fill("D22 bridge support");
    const submitted = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/jurisdictions/${jurisdictionId}/resource-requests`));
    await page.getByRole("button", { name: "Submit request" }).click();
    expect((await submitted).status()).toBe(201);
    await page.getByText("Submitted", { exact: true }).waitFor();
    await page.getByLabel("Next state for Portable water tender").selectOption("triaged");
    await page.getByRole("button", { name: "Advance", exact: true }).click();
    await page.getByText("Triaged", { exact: true }).waitFor();
    await page.getByLabel("Next state for Portable water tender").selectOption("sourcing");
    await page.getByRole("button", { name: "Advance", exact: true }).click();
    await page.getByRole("button", { name: "Assign and advance", exact: true }).waitFor();
    await page.getByLabel("Assignment for Portable water tender").selectOption(`participant:${participantId}`);
    const assigned = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/assign"));
    await page.getByRole("button", { name: "Assign and advance", exact: true }).click();
    expect((await assigned).status()).toBe(200);
    await page.getByText("Assigned", { exact: true }).waitFor();
    await page.getByText("Supplying: D22 Mutual Aid").waitFor();
    await page.getByText("Owner: D22 Resource Partner · Resource Support · D22 Mutual Aid").waitFor();
    const history = page.getByRole("button", { name: "History", exact: true });
    await history.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.trim()")).toBe("History");
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "History", exact: true }).waitFor();
    expect(new URL(page.url()).hash).toContain("/resources/");
    await page.reload();
    await page.getByRole("heading", { name: "History", exact: true }).waitFor();
    await page.getByText("assigned to Resource Support").waitFor();
    await page.screenshot({ path: join(SHOTS, "d22-light.png"), fullPage: false });
    await page.getByRole("button", { name: "Close history" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("heading", { name: "Resource coordination" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "d22-wide-dark.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    expect(await page.evaluate(`(() => { const element = document.querySelector('[aria-label="Requests and next actions"]');
      return element !== null && element.scrollWidth <= element.clientWidth; })()`)).toBe(true);
    await history.scrollIntoViewIfNeeded();
    expect(await history.isVisible()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d22-narrow-dark.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
