import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("d20-app");
const SHOTS = shotDir("d20");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let token: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function activate(control: Locator): Promise<void> {
  await control.waitFor({ state: "visible" });
  await control.evaluate((button) => (button as unknown as { click(): void }).click());
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  token = await login(app);
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

describe("real-browser incident activation and participation", () => {
  it("activates, scopes area and records, proves partner discovery and access, then closes the incident", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await activate(page.getByRole("button", { name: "Sign in" }));
    await activate(page.getByRole("button", { name: "Incident Setup", exact: true }));
    await page.getByLabel("Scenario template").selectOption("daily_ops");
    await page.getByLabel("Incident name").fill("D20 California Exercise");
    await page.getByLabel("Incident type").selectOption("planned_event");
    const activated = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/jurisdictions/${jurisdictionId}/incidents`));
    await activate(page.getByRole("button", { name: "Activate", exact: true }));
    const response = await activated;
    expect(response.status()).toBe(201);
    const incidentId = (await response.json()).incidentId as string;
    const areaButton = page.locator("li").filter({ hasText: "D20 California Exercise" })
      .getByRole("button", { name: "Operational area" });
    await activate(areaButton);
    const setup = page.getByRole("region", { name: "D20 California Exercise: incident setup", exact: true });
    await setup.getByText("Operations Section Chief", { exact: true }).waitFor();
    expect(await setup.getByText(/they do not by themselves transfer ownership or establish unified command/i).isVisible()).toBe(true);
    const area = setup.getByRole("region", { name: "D20 California Exercise: operational area", exact: true });
    const areaCoordinates: Array<[string, string]> = [["-123.8", "41.1"], ["-123.6", "41.1"], ["-123.6", "41.3"]];
    for (const [longitude, latitude] of areaCoordinates) {
      await area.getByLabel("Longitude").fill(longitude);
      await area.getByLabel("Latitude").fill(latitude);
      await activate(area.getByRole("button", { name: "Add coordinate" }));
    }
    await activate(area.getByRole("button", { name: "Close boundary" }));
    await area.getByLabel("Operational period").fill("OP-D20");
    await area.getByLabel("Period starts").fill("2026-09-21T08:00");
    await area.getByLabel("Period ends").fill("2026-09-21T20:00");
    await area.getByLabel("Reason for revision").fill("Synthetic operational area confirmed");
    await activate(area.getByRole("button", { name: "Save area revision" }));
    await area.getByText(/^Revision 1\./).waitFor();
    await activate(area.getByRole("button", { name: "View revision 1" }));
    await area.getByText(/Viewing revision 1/).waitFor();
    await activate(area.getByRole("button", { name: "Return to current draft" }));
    await area.scrollIntoViewIfNeeded();
    expect(await area.getByRole("button", { name: "Save area revision" }).isVisible()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d20-light.png"), fullPage: false });

    const detail = await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}`, headers: { authorization: `Bearer ${token}` } });
    expect(detail.statusCode, detail.body).toBe(200);
    const boardId = detail.json().boards.find((board: { title: string }) => board.title === "D20 California Exercise: activity_log")?.id as string | undefined;
    expect(boardId).toBeTruthy();
    const record = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { entry: "D20 incident-scoped activity", notable: true } });
    expect(record.statusCode, record.body).toBe(201);
    const [stored] = await admin`select incident_id from board_records where id = ${record.json().id as string}`;
    expect(stored!.incident_id).toBe(incidentId);

    const partnerOrganization = await createJurisdiction(admin, "d20-partner", "D20 Mutual Aid");
    const partnerPerson = await createPerson(admin, { email: "d20-partner@example.org", displayName: "D20 Partner", password: "d20-partner-password" });
    await addMembership(admin, partnerPerson, partnerOrganization, "member");
    const participantsButton = page.locator("li").filter({ hasText: "D20 California Exercise" }).getByRole("button", { name: "Participants" });
    await participantsButton.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.trim()")).toBe("Participants");
    await page.keyboard.press("Enter");
    const participants = setup.getByRole("region", { name: "D20 California Exercise: participants", exact: true });
    await participants.getByLabel("Organization code").fill("d20-partner");
    await participants.getByLabel("Participant email").fill("d20-partner@example.org");
    await participants.getByLabel("Incident position").fill("Mutual Aid Liaison");
    await participants.getByLabel("Incident role").selectOption("coordinator");
    await participants.getByLabel("Participation expires").fill("2099-09-21T20:00");
    await participants.getByLabel("Participation reason").fill("Selected mutual-aid coordination");
    await activate(participants.getByRole("button", { name: "Add participant" }));
    await participants.getByText("D20 Partner", { exact: true }).waitFor();
    const partnerToken = await login(app, "d20-partner@example.org", "d20-partner-password");
    const partnerRead = () => app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}/operational-area`, headers: { authorization: `Bearer ${partnerToken}` } });
    expect((await partnerRead()).statusCode).toBe(200);
    await activate(participants.getByRole("button", { name: "End participation for D20 Partner" }));
    await participants.getByLabel("Reason for ending participation").fill("Synthetic demobilization");
    await activate(participants.getByRole("button", { name: "End participation", exact: true }));
    await participants.getByText(/Incident access has been revoked/i).waitFor();
    expect((await partnerRead()).statusCode).toBe(404);

    const closePartnerOrganization = await createJurisdiction(admin, "d20-close-partner", "D20 Close Partner");
    const closePartnerPerson = await createPerson(admin, { email: "d20-close-partner@example.org", displayName: "D20 Close Partner", password: "d20-close-partner-password" });
    await addMembership(admin, closePartnerPerson, closePartnerOrganization, "member");
    await participants.getByLabel("Organization code").fill("d20-close-partner");
    await participants.getByLabel("Participant email").fill("d20-close-partner@example.org");
    await participants.getByLabel("Incident position").fill("Closeout Liaison");
    await participants.getByLabel("Incident role").selectOption("coordinator");
    await participants.getByLabel("Participation expires").fill("2099-09-21T20:00");
    await participants.getByLabel("Participation reason").fill("Closeout access proof");
    await activate(participants.getByRole("button", { name: "Add participant" }));
    await participants.locator("strong").filter({ hasText: "D20 Close Partner" }).waitFor();
    const closePartnerToken = await login(app, "d20-close-partner@example.org", "d20-close-partner-password");
    const closePartnerRead = () => app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}/operational-area`, headers: { authorization: `Bearer ${closePartnerToken}` } });
    expect((await closePartnerRead()).statusCode).toBe(200);

    const closePartnerPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await closePartnerPage.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await closePartnerPage.getByLabel("Email").fill("d20-close-partner@example.org");
    await closePartnerPage.getByLabel("Password").fill("d20-close-partner-password");
    await activate(closePartnerPage.getByRole("button", { name: "Sign in" }));
    const remoteIncidentSelector = closePartnerPage.getByLabel("Selected incident");
    await remoteIncidentSelector.getByRole("option", { name: "D20 California Exercise", exact: true })
      .waitFor({ state: "attached" });
    await remoteIncidentSelector.selectOption(incidentId);
    await activate(closePartnerPage.getByRole("button", { name: "Incident Setup", exact: true }));
    const remoteIncident = closePartnerPage.locator("li").filter({ hasText: "D20 California Exercise" });
    await remoteIncident.getByRole("button", { name: "Operational area" }).waitFor();
    expect(await remoteIncident.getByRole("button", { name: "Operational area" }).isVisible()).toBe(true);
    await activate(remoteIncident.getByRole("button", { name: "Operational area" }));
    const remoteSetup = closePartnerPage.getByRole("region", { name: "D20 California Exercise: incident setup", exact: true });
    await remoteSetup.getByRole("region", { name: "D20 California Exercise: operational area", exact: true }).waitFor();
    expect(await remoteSetup.getByRole("region", { name: "D20 California Exercise: operational area", exact: true }).isVisible()).toBe(true);
    await closePartnerPage.close();

    await activate(page.getByRole("button", { name: "Account menu" }));
    await activate(page.getByRole("button", { name: "Use dark theme" }));
    await activate(page.getByRole("button", { name: "Account menu" }));
    await activate(page.getByRole("button", { name: "Incident Setup", exact: true }));
    await activate(page.locator("li").filter({ hasText: "D20 California Exercise" })
      .getByRole("button", { name: "Participants" }));
    const darkParticipants = page.getByRole("region", {
      name: "D20 California Exercise: participants", exact: true,
    });
    await darkParticipants.scrollIntoViewIfNeeded();
    expect(await darkParticipants.getByRole("button", { name: "Add participant" }).isVisible()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d20-wide-dark.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await darkParticipants.scrollIntoViewIfNeeded();
    expect(await darkParticipants.getByRole("button", { name: "Add participant" }).isVisible()).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d20-narrow-dark.png"), fullPage: false });
    await activate(page.locator("li").filter({ hasText: "D20 California Exercise" }).getByRole("button", { name: "Close incident" }));
    await page.getByText(/Closeout prevents new incident updates/i).waitFor();
    await activate(page.getByRole("button", { name: "Confirm closeout" }));
    await page.getByText("closed", { exact: true }).waitFor();
    expect((await closePartnerRead()).statusCode).toBe(200);
    const ownerClosedWrite = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { entry: "D20 owner write after close", notable: true } });
    expect(ownerClosedWrite.statusCode, ownerClosedWrite.body).toBe(409);
    const partnerClosedWrite = await app.inject({ method: "POST", url: `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
      headers: { authorization: `Bearer ${closePartnerToken}` }, payload: { entry: "D20 partner write after close", notable: true } });
    expect(partnerClosedWrite.statusCode, partnerClosedWrite.body).toBe(409);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
