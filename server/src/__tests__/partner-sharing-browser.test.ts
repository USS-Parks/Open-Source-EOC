import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir, waitForSignIn, watchPage } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";
import { join } from "node:path";

/**
 * Partner sharing in the browser, allow and deny: on the North Coast Storm
 * exercise the CA Energy Commission's utility liaison works the incident's
 * shared information as a partner, and a person from an organization with no
 * part in the incident sees none of it.
 */

const DIST = buildDir("partner-sharing-app");
const SHOTS = shotDir("partner-sharing");
const OUTSIDER = { email: "outsider@elsewhere.example", password: "outsider-password-long" };

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];

async function signIn(email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
  const page = await context.newPage();
  const report = watchPage(page);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:") ? route.continue() : route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await waitForSignIn(page, report);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Sections" }).waitFor();
  return page;
}

const rail = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  const outsiderOrg = await createJurisdiction(admin, "elsewhere-county", "Elsewhere County OES");
  const outsider = await createPerson(admin, { ...OUTSIDER, displayName: "Elsewhere Planner" });
  await addMembership(admin, outsider, outsiderOrg, "member");
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("partner sharing on the North Coast Storm exercise", () => {
  it("shows the utility liaison the county's requests and lets it request from the county", async () => {
    const liaison = await signIn("a.brooks@cec.example", NORTH_COAST_PASSWORD);
    await liaison.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
    await rail(liaison, "Resources");
    const list = liaison.locator(".resources-list");
    await list.getByText("Generator support for Wendy's Shelter").waitFor();
    expect(await list.getByText(/sent to Humboldt County OES$/).count()).toBeGreaterThan(1);

    await liaison.getByLabel("Request from").selectOption({ label: "Humboldt County OES (incident owner)" });
    await liaison.getByLabel("Requested item").fill("Fuel for the substation generators");
    await liaison.getByRole("button", { name: "Submit request" }).click();
    await list.getByText("Fuel for the substation generators").waitFor();
    const [row] = await admin`
      select r.jurisdiction_id, p.email from resource_requests r join persons p on p.id = r.requested_by
      where r.item = 'Fuel for the substation generators'`;
    expect(row).toMatchObject({ jurisdiction_id: scenario.jurisdictionId, email: "a.brooks@cec.example" });
    await liaison.screenshot({ path: join(SHOTS, "liaison-resources.png") });
    await liaison.context().close();
  }, 90_000);

  it("opens the county's generator request from the liaison's linked action", async () => {
    const liaison = await signIn("a.brooks@cec.example", NORTH_COAST_PASSWORD);
    await liaison.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
    await rail(liaison, "ESFs & Lifelines");
    await liaison.getByRole("button", { name: "Open Energy details" }).click();
    const drawer = liaison.getByRole("complementary", { name: "Energy" });
    await drawer.getByText("Logistics Section Chief").waitFor();
    await drawer.getByRole("button", { name: /Generator request/ }).click();
    await liaison.getByRole("region", { name: /^REQ-\d+ Generator support for Wendy's Shelter$/ }).waitFor();
    await liaison.screenshot({ path: join(SHOTS, "liaison-linked-request.png") });
    await liaison.context().close();
  }, 90_000);

  // Two people sign in, each in a fresh browser context: on the Windows CI runner
  // this ran past the 30 second default, where it takes about 4 seconds locally.
  it("lets the utility liaison post in an incident-wide thread that the county reads", async () => {
    const liaison = await signIn("a.brooks@cec.example", NORTH_COAST_PASSWORD);
    await liaison.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
    await rail(liaison, "Messages");
    await liaison.getByLabel("Thread title").fill("Utility restoration");
    await liaison.getByRole("button", { name: "Start thread" }).click();
    await liaison.locator(".d27-recipient-context").getByText("Everyone on the incident").waitFor();
    await liaison.getByRole("textbox", { name: "Message" }).fill("Substation 4 back on line at 10:15.");
    await liaison.getByRole("button", { name: "Send" }).click();
    await liaison.getByRole("status").filter({ hasText: "Message stored" }).waitFor();
    await liaison.screenshot({ path: join(SHOTS, "liaison-messages.png") });
    await liaison.context().close();

    const county = await signIn("jordan.lee@humboldt.example", NORTH_COAST_PASSWORD);
    await rail(county, "Messages");
    await county.getByRole("button", { name: /Utility restoration/ }).click();
    const message = county.getByRole("list", { name: "Stored messages" }).getByRole("listitem")
      .filter({ hasText: "Substation 4 back on line at 10:15." });
    await message.waitFor();
    expect(await message.textContent()).toContain("CA Energy Commission");
    await county.screenshot({ path: join(SHOTS, "county-messages.png") });
    await county.context().close();
  }, 90_000);

  it("shows a person outside the incident none of it", async () => {
    const outsider = await signIn(OUTSIDER.email, OUTSIDER.password);
    await rail(outsider, "Resources");
    await outsider.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await outsider.waitForLoadState("networkidle");
    expect(await outsider.getByText("Generator support for Wendy's Shelter").count()).toBe(0);
    // The page's own session asks for the incident's requests directly and is refused.
    const status = await outsider.evaluate(`(async () => {
      const tokens = JSON.parse(localStorage.getItem("openeoc.tokens") || "{}");
      const response = await fetch("/api/v1/incidents/${scenario.incidentId}/resource-requests",
        { headers: { authorization: "Bearer " + tokens.accessToken } });
      return response.status;
    })()`);
    expect(status).toBe(404);
    await outsider.context().close();
    expect(pageErrors).toEqual([]);
  }, 90_000);
});
