import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/** Real-browser proof for period-scoped AAR observations, improvement actions, analytics, and exact PDF export. */
const DIST = buildDir("p-aar-app");
const SHOTS = shotDir("p-aar");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let jurisdictionId: string;
let planningObservationId: string;
let planningActionId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function useDarkTheme(): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use light theme" }).waitFor({ state: "hidden" });
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/aar-app", DIST);

  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire",
    name: "P-AAR Accountability Exercise",
  });
  incidentId = incident.incidentId as string;
  const now = Date.now();
  const periods = [
    { label: "Operational Period 1", startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString() },
    { label: "Operational Period 2", startsAt: new Date(now + 3_600_000).toISOString(), endsAt: new Date(now + 7_200_000).toISOString() },
  ];
  for (const [index, operationalPeriod] of periods.entries()) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/incidents/${incidentId}/operational-area`,
      headers: auth(token),
      payload: {
        expectedRevision: index,
        geometry: null,
        operationalPeriod,
        reason: `P-AAR browser acceptance period ${index + 1}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  const planningObservation = await post(app, token, `/api/v1/incidents/${incidentId}/aar/observations`, {
    capability: "planning",
    capabilityElement: "training",
    kind: "improvement",
    observation: "The written handoff checklist was missing at shift change.",
    recommendation: "Publish the revised handoff checklist.",
    periodRevision: 1,
  });
  planningObservationId = planningObservation.id as string;
  await post(app, token, `/api/v1/incidents/${incidentId}/aar/observations`, {
    capability: "public_information_and_warning",
    capabilityElement: "none",
    kind: "strength",
    observation: "The second-period partner briefing started on time.",
    periodRevision: 2,
  });
  const [position] = await admin`
    select id from positions where jurisdiction_id = ${jurisdictionId}
      and key = 'planning_section_chief'`;
  const planningAction = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
    incidentId,
    capability: "planning",
    capabilityElement: "training",
    recommendation: "Run a checklist handoff drill.",
    priority: "high",
    dueDate: "2026-10-15",
    periodRevision: 1,
    assignment: { kind: "position", positionId: position!.id },
  });
  planningActionId = planningAction.id as string;
  await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
    incidentId,
    capability: "public_information_and_warning",
    capabilityElement: "none",
    recommendation: "Retain the briefing distribution list.",
    priority: "low",
    periodRevision: 2,
  });

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/aar-app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "AAR", exact: true }).click();
  await page.getByRole("heading", { name: "After-action review" }).waitFor({ state: "visible" });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("real incident improvement workspace", () => {
  it("reconciles period analytics to records and completes the observation-to-action-to-PDF workflow", async () => {
    const workspace = page.getByRole("region", { name: "After-action review" });
    await workspace.waitFor({ state: "visible" });
    const analytics = workspace.getByRole("region", { name: "Review coverage and progress" });
    await analytics.getByRole("button", { name: /4 Total records Drill into records/ }).waitFor();
    await workspace.locator("[data-record-id]").nth(3).waitFor({ state: "visible" });
    expect(await workspace.locator("[data-record-id]").count()).toBe(4);

    await workspace.getByLabel("Operational period").selectOption("1");
    await analytics.getByRole("button", { name: /2 Total records Drill into records/ }).waitFor();
    expect(await workspace.locator("[data-record-id]").count()).toBe(2);
    await analytics.getByRole("button", { name: /2 Planning Drill into records/ }).click();
    await workspace.locator(`[data-record-id="${planningObservationId}"]`).waitFor({ state: "visible" });
    await workspace.locator(`[data-record-id="${planningActionId}"]`).waitFor({ state: "visible" });

    const observationForm = workspace.getByRole("form", { name: "Record an observation" });
    await observationForm.getByLabel("Core capability").selectOption("planning");
    await observationForm.getByLabel("Capability element").selectOption("training");
    await observationForm.getByLabel("Observation").fill("A facilitator captured the improvement decision in the hotwash.");
    await observationForm.getByLabel("Recommendation").fill("Add a facilitator checkpoint to the handoff checklist.");
    await observationForm.getByRole("button", { name: "Record observation" }).click();
    await workspace.getByText("Observation recorded with incident and period provenance.").waitFor();

    await workspace.locator(`[data-record-id="${planningObservationId}"]`)
      .getByRole("button", { name: "Create action from this observation" }).click();
    const actionForm = workspace.getByRole("form", { name: "Create a corrective action" });
    await actionForm.getByLabel("Priority").selectOption("critical");
    await actionForm.getByLabel("Owner").selectOption({ label: "Position: Planning Section Chief" });
    await actionForm.getByLabel("Due date").fill("2026-10-20");
    await actionForm.getByRole("button", { name: "Create corrective action" }).click();
    await workspace.getByText(`Corrective action created; source observation ${planningObservationId} remains in evidence.`).waitFor();

    const existingAction = workspace.locator(`[data-record-id="${planningActionId}"]`);
    await existingAction.getByLabel("Status").selectOption("in_progress");
    const updateResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/corrective-actions/${planningActionId}`)
      && response.request().method() === "PATCH" && response.status() === 200);
    await existingAction.getByRole("button", { name: "Save progress" }).click();
    const updatedActionResponse = await updateResponse;
    expect(updatedActionResponse.request().postDataJSON()).toMatchObject({ expectedRevision: 0, status: "in_progress" });
    expect(await updatedActionResponse.json()).toMatchObject({ id: planningActionId, revision: 1, status: "in_progress" });
    await workspace.getByText("Corrective action progress saved.").waitFor();
    await existingAction.locator("header").getByText("In Progress", { exact: true }).waitFor();
    await existingAction.getByText("Revision 1", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "p-aar-light-1440.png"), fullPage: false });

    const pdfForm = workspace.getByRole("form", { name: "Compile the after-action report" });
    await pdfForm.getByLabel("Incident overview").fill("A two-period exercise tested planning handoffs and partner warning coordination.");
    await pdfForm.getByLabel("Objectives, one per line").fill("Improve shift handoffs\nRetain timely partner briefings");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      pdfForm.getByRole("button", { name: "Compile and download PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("after-action-review.pdf");

    await useDarkTheme();
    await page.screenshot({ path: join(SHOTS, "p-aar-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await analytics.getByRole("button", { name: /All records/ }).click();
    const critical = analytics.getByRole("button", { name: /Critical Drill into records/ });
    await critical.focus();
    expect(await page.locator(":focus").textContent()).toContain("Critical");
    await page.keyboard.press("Enter");
    await workspace.getByRole("heading", { name: "Priority: Critical" }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "p-aar-narrow-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
