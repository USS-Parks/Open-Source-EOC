import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("field-reports-browser");
const SHOTS = shotDir("field-reports-browser");
// Text of a panel that stands in for a screen: a section with no screen, a refusal, or not found.
const PLACEHOLDER = /is unavailable|This section is not available|is available to administrators|Page not found/;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let incidentId: string;
let reportBoardId: string;
let reportId: string;

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  // An instance admin who administers the jurisdiction sees every rail entry, Templates included.
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  // Tracking and facilities are optional integrations with rail entries; the
  // walk below covers them enabled, as a deployment that shows them would be.
  app = buildApp(runtime, { oidc: null, integrations: ["tracking", "facilities"] });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const adminToken = await login(app);
  const memberToken = await login(app, "member@example.org", "another-good-password");
  const boards = `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`;
  await post(app, adminToken, boards, { templateKey: "field_reports", title: "Organization Field Reports" });
  reportBoardId = (await post(app, adminToken, boards, { templateKey: "field_reports", title: "Bald Hills Field Reports" })).id as string;
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "wildfire", name: "Bald Hills Fire" })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${reportBoardId})`;
  reportId = (await post(app, memberToken, `/api/v1/boards/${reportBoardId}/records?incidentId=${incidentId}`, {
    summary: "Culvert washout on Bald Hills Rd", category: "damage",
    location: { type: "Point", coordinates: [-123.79, 41.15] },
  })).id as string;
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn(email: string, password: string): Promise<{ page: Page; errors: string[]; external: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url); return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const selectedIncident = page.getByLabel("Selected incident", { exact: true });
  await selectedIncident.locator(`option[value="${incidentId}"]`).waitFor({ state: "attached" });
  await selectedIncident.selectOption(incidentId);
  return { page, errors, external };
}

/** Open every rail entry in turn: each shows its own titled screen and none shows the placeholder panel. */
async function walkRail(page: Page): Promise<string[]> {
  const rail = page.locator("#eoc-shell-navigation .eoc-shell-nav-scroll button");
  const labels = await rail.locator("span").allTextContents();
  for (const [index, label] of labels.entries()) {
    await rail.nth(index).click();
    await page.locator(".eoc-shell-page-header h1").getByText(label, { exact: true }).waitFor();
    expect(await rail.nth(index).getAttribute("aria-current"), label).toBe("page");
    await page.waitForTimeout(300);
    expect(await page.locator(".eoc-shell-workspace").textContent(), label).not.toMatch(PLACEHOLDER);
  }
  return labels;
}

describe("field reports and the navigation rail in a real browser", () => {
  it("lists the incident's field reports, opens a report and links to capture", async () => {
    const { page, errors, external } = await signIn("admin@example.org", "correct-horse-battery");
    await page.getByRole("button", { name: "Field Reports", exact: true }).click();
    await page.locator(".eoc-shell-page-header h1").filter({ hasText: "Field Reports" }).waitFor();
    const workspace = page.locator(".eoc-shell-workspace");
    await workspace.getByRole("heading", { name: "Bald Hills Field Reports" }).waitFor();
    await workspace.getByText("Culvert washout on Bald Hills Rd", { exact: true }).waitFor();
    // The incident has its own board, so the organization-wide one is not offered.
    expect(await workspace.getByLabel("Field Reports board").count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "field-reports-light-1440.png"), fullPage: true });

    await page.getByLabel(`Select record ${reportId}`).click();
    await page.waitForURL((url) => url.hash.startsWith(`#/board/${reportBoardId}`) && url.hash.includes(`record=${reportId}`));
    const openContext = page.getByRole("button", { name: "Open context" });
    if (await openContext.isVisible()) await openContext.click();
    const selected = page.getByRole("region", { name: "Selected record" });
    await selected.getByText("Culvert washout on Bald Hills Rd").first().waitFor();
    await page.goBack();
    await page.locator(".eoc-shell-page-header h1").filter({ hasText: "Field Reports" }).waitFor();

    await page.getByRole("button", { name: "Capture a field report" }).click();
    await page.locator(".eoc-shell-page-header h1").filter({ hasText: "Smart Forms" }).waitFor();
    await page.getByRole("button", { name: "Field Reports", exact: true }).click();
    await workspace.getByText("Culvert washout on Bald Hills Rd", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await workspace.getByText("Culvert washout on Bald Hills Rd", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "field-reports-dark-390.png"), fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 90_000);

  it("gives every rail entry a screen, for an administrator and for a member", async () => {
    const asAdmin = await signIn("admin@example.org", "correct-horse-battery");
    const adminLabels = await walkRail(asAdmin.page);
    expect(adminLabels).toEqual(expect.arrayContaining(["Field Reports", "Templates", "Administration", "Federation"]));
    expect(adminLabels).not.toContain("Settings");
    expect(asAdmin.errors).toEqual([]);
    await asAdmin.page.close();

    const asMember = await signIn("member@example.org", "another-good-password");
    const memberLabels = await walkRail(asMember.page);
    expect(memberLabels).toContain("Field Reports");
    expect(memberLabels).not.toContain("Administration");
    expect(memberLabels).not.toContain("Templates");
    expect(memberLabels).not.toContain("Settings");
    expect(asMember.errors).toEqual([]);
    await asMember.page.close();
  }, 180_000);
});
