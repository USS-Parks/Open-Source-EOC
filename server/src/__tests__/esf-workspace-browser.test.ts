import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/** Real-browser proof for the ESF coordination workspace. */
const DIST = buildDir("p-life-3-app");
const SHOTS = shotDir("p-life-3");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let jurisdictionId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function esfAssessment(
  framework: "california" | "federal",
  esf: string,
  activation: "activated" | "not_activated",
  capacity: "adequate" | "constrained",
  assessedAt: string,
) {
  return {
    identity: { framework, esf, definitionVersion: 1 },
    activation,
    capacity,
    assessedAt,
    confidence: "confirmed",
    situation: framework === "california"
      ? "Mutual aid staffing is below the requested night operational level."
      : "Transportation coordination remains active for route clearance.",
    operationalPeriod: "OP Current",
    coordinatorOrganizationId: jurisdictionId,
    supportingOrganizationIds: [],
    missions: ["Coordinate route clearance"],
    priorities: ["Confirm night staffing"],
    evidence: [{ kind: "reported", description: "Coordinator briefing", sourceReference: "SITREP 7" }],
    relatedLifelines: ["transportation"],
    actions: [{
      key: "stage_mutual_aid",
      title: "Stage mutual aid crew",
      status: "in_progress",
      responsibleOrganizationId: jurisdictionId,
    }],
  };
}

async function setDarkTheme(): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/esf-app", DIST);

  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire",
    name: "P-LIFE-3 ESF Coordination Exercise",
  });
  incidentId = incident.incidentId as string;
  const now = Date.now();
  const area = await app.inject({
    method: "PUT",
    url: `/api/v1/incidents/${incidentId}/operational-area`,
    headers: auth(token),
    payload: {
      expectedRevision: 0,
      geometry: null,
      operationalPeriod: {
        label: "OP Current",
        startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
      },
      reason: "P-LIFE-3 browser acceptance period",
    },
  });
  expect(area.statusCode, area.body).toBe(200);

  const assessedAt = new Date(now - 10 * 60 * 1000).toISOString();
  await post(app, token, `/api/v1/incidents/${incidentId}/esf-assessments`,
    esfAssessment("california", "ca_esf_1", "activated", "constrained", assessedAt));
  await post(app, token, `/api/v1/incidents/${incidentId}/esf-assessments`,
    esfAssessment("federal", "esf_1_transportation", "activated", "adequate", assessedAt));

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
  await page.goto(`${baseUrl}/esf-app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "ESFs & Lifelines" }).click();
  await page.getByRole("button", { name: "ESF coordination" }).click();
  await page.getByRole("heading", { name: "Emergency Support Functions" }).waitFor({ state: "visible" });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("real incident ESF workspace", () => {
  it("shows both standard frameworks, edits actual assessment fields, and preserves attributed handoff history", async () => {
    const californiaCards = page.locator(".eoc-esf-card");
    await page.waitForFunction(`document.querySelectorAll(".eoc-esf-card").length === 18`);
    expect(await californiaCards.count()).toBe(18);
    expect(await page.getByText("California ESF 18: Cybersecurity", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText("Merged into California ESF 4 and California ESF 13", { exact: true }).isVisible()).toBe(true);
    const californiaIcons = californiaCards.locator("svg[data-icon]");
    const iconNames: Array<string | null> = [];
    for (let index = 0; index < 18; index += 1) iconNames.push(await californiaIcons.nth(index).getAttribute("data-icon"));
    expect(new Set(iconNames).size).toBe(18);

    await page.getByRole("button", { name: "Open California ESF 1: Transportation workspace" }).click();
    await page.waitForFunction(`location.hash.startsWith("#/esf/ca_esf_1?") && location.hash.includes("incident=")`);
    const detail = page.getByRole("complementary", { name: "California ESF 1: Transportation" });
    await detail.locator(".eoc-esf-detail-badges").getByText("Capacity: Constrained", { exact: true })
      .waitFor({ state: "visible" });
    expect(await detail.getByText("Coordinate route clearance", { exact: true }).isVisible()).toBe(true);
    expect(await detail.getByText("Confirm night staffing", { exact: true }).isVisible()).toBe(true);
    expect(await detail.getByText("Stage mutual aid crew", { exact: true }).isVisible()).toBe(true);
    expect(await detail.getByText("OP Current", { exact: true }).isVisible()).toBe(true);

    await detail.getByRole("button", { name: "Revise assessment" }).click();
    await detail.getByLabel("Activation").selectOption("demobilizing");
    await detail.getByRole("combobox", { name: "Capacity", exact: true }).selectOption("adequate");
    await detail.getByLabel("Staffing, capacity, and coordination situation")
      .fill("Night staffing confirmed; route clearance handoff is underway.");
    await detail.getByLabel("Missions, one per line").fill("Coordinate route clearance\nHandoff night operations");
    await detail.getByRole("button", { name: "Save assessment" }).click();
    await detail.locator(".eoc-esf-situation")
      .getByText("Night staffing confirmed; route clearance handoff is underway.", { exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(`document.querySelectorAll(".eoc-esf-history li").length === 2`);
    expect(await detail.getByText(/prior evidence item will be preserved/).count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "p-life-3-esf-light-1440.png"), fullPage: false });

    await detail.getByRole("button", { name: "Close ESF workspace" }).click();
    await page.getByRole("tab", { name: "Federal (15)" }).click();
    await page.waitForFunction(`document.querySelectorAll(".eoc-esf-card").length === 15`);
    expect(await page.locator(".eoc-esf-card").count()).toBe(15);
    expect(await page.getByText("Federal ESF 1: Transportation", { exact: true }).isVisible()).toBe(true);

    await setDarkTheme();
    await page.screenshot({ path: join(SHOTS, "p-life-3-esf-dark-1440.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    const federalOpen = page.getByRole("button", { name: "Open Federal ESF 1: Transportation workspace" });
    await federalOpen.focus();
    expect(await page.evaluate(`document.activeElement?.getAttribute("aria-label")`))
      .toBe("Open Federal ESF 1: Transportation workspace");
    await page.keyboard.press("Enter");
    await page.waitForFunction(`location.hash.startsWith("#/esf/esf_1_transportation?") && location.hash.includes("incident=")`);
    await page.getByRole("complementary", { name: "Federal ESF 1: Transportation" }).waitFor({ state: "visible" });
    expect(await page.evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "p-life-3-esf-narrow-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
