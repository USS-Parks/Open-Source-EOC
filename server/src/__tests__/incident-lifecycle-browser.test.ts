import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("incident-lifecycle-app");
const SHOTS = shotDir("incident-lifecycle");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let stormId: string;
let leveeId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function press(control: Locator): Promise<void> {
  await control.waitFor({ state: "visible" });
  await control.evaluate((button) => (button as unknown as { click(): void }).click());
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const incidents = `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`;
  stormId = (await post(app, token, incidents, { templateKey: "wildfire", name: "Coastal Storm" })).incidentId as string;
  leveeId = (await post(app, token, incidents, { templateKey: "daily_ops", name: "Levee Watch" })).incidentId as string;
  const detail = await app.inject({ method: "GET", url: `/api/v1/incidents/${stormId}`, headers: auth(token) });
  const board = (detail.json().boards as Array<{ id: string; title: string }>).find((b) => b.title === "Coastal Storm: activity_log")!;
  await post(app, token, `/api/v1/boards/${board.id}/records?incidentId=${stormId}`, { entry: "Surge warning issued" });
  const area = await app.inject({ method: "PUT", url: `/api/v1/incidents/${stormId}/operational-area`, headers: auth(token), payload: {
    expectedRevision: 0, geometry: null, reason: "Night shift",
    operationalPeriod: { label: "OP-2 Night", startsAt: "2026-09-23T20:00:00Z", endsAt: "2026-09-24T08:00:00Z" },
  } });
  expect(area.statusCode, area.body).toBe(200);
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

describe("real-browser incident lifecycle", () => {
  it("closes and archives an incident, finds it under the archive filter, and locks another against guests", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await press(page.getByRole("button", { name: "Sign in" }));
    // The command bar selects an incident once the list loads; open the surface after that.
    await page.getByLabel("Selected incident").waitFor();
    await press(page.getByRole("button", { name: "Incident Setup", exact: true }));

    const master = page.getByRole("region", { name: "Jurisdiction master view", exact: true });
    const stormRow = master.getByRole("row", { name: /Coastal Storm/ });
    await stormRow.waitFor();
    for (const text of ["Open", "Incident", "OP-2 Night", "Guest grants apply"])
      expect(await stormRow.getByText(text, { exact: true }).isVisible()).toBe(true);

    await press(page.locator("li").filter({ hasText: "Levee Watch" }).getByRole("button", { name: "Close incident" }));
    await press(page.getByRole("button", { name: "Confirm closeout" }));
    const leveeRow = master.getByRole("row", { name: /Levee Watch/ });
    await leveeRow.getByText("Closed", { exact: true }).waitFor();
    await press(leveeRow.getByRole("button", { name: "Archive" }));
    await page.getByText("Levee Watch is archived.").waitFor();
    await leveeRow.waitFor({ state: "detached" });
    const incidentItems = page.locator("li").filter({ has: page.getByRole("button", { name: "Operational area" }) });
    await incidentItems.filter({ hasText: "Coastal Storm" }).waitFor();
    expect(await incidentItems.filter({ hasText: "Levee Watch" }).count()).toBe(0);
    await expect.poll(() => page.getByLabel("Selected incident").locator("option", { hasText: "Levee Watch" }).count(),
      { timeout: 15_000 }).toBe(0);

    await master.getByLabel("Archived incidents").selectOption("only");
    await leveeRow.getByText("Archived", { exact: true }).waitFor();
    expect(await master.getByRole("row", { name: /Coastal Storm/ }).count()).toBe(0);
    await master.getByLabel("Archived incidents").selectOption("exclude");

    await press(stormRow.getByRole("button", { name: "Lock guest access" }));
    await page.getByText("Guest access to Coastal Storm is locked.").waitFor();
    await stormRow.getByText("Locked", { exact: true }).waitFor();
    const stormItem = incidentItems.filter({ hasText: "Coastal Storm" });
    await stormItem.getByText("Guest access locked", { exact: true }).waitFor();
    await press(stormItem.getByRole("button", { name: "Operational area" }));
    const setup = page.getByRole("region", { name: "Coastal Storm: incident setup", exact: true });
    await setup.getByText("Guest access is locked.").waitFor();
    await setup.getByText("Guest access is locked.").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "incident-lifecycle-light.png"), fullPage: false });

    const [storm] = await admin`select locked_at, locked_by from incidents where id = ${stormId}`;
    expect(storm!.locked_at).toBeTruthy();
    const [levee] = await admin`select closed_at, archived_at from incidents where id = ${leveeId}`;
    expect(levee!.closed_at).toBeTruthy();
    expect(levee!.archived_at).toBeTruthy();

    await press(page.getByRole("button", { name: "Account menu" }));
    await press(page.getByRole("button", { name: "Use dark theme" }));
    await press(page.getByRole("button", { name: "Account menu" }));
    await press(page.getByRole("button", { name: "Incident Setup", exact: true }));
    await stormRow.getByText("Locked", { exact: true }).waitFor();
    await stormRow.scrollIntoViewIfNeeded();
    // Bring the rollup columns into the table's scroll area for the capture.
    await master.locator(".eoc-operational-table-scroll").evaluate((area) => { (area as unknown as { scrollLeft: number }).scrollLeft = 560; });
    await page.screenshot({ path: join(SHOTS, "incident-lifecycle-dark.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await master.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "incident-lifecycle-narrow-dark.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
