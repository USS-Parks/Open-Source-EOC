import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("pcop-kpi-app");
const SHOTS = shotDir("pcop-kpi");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let datasetId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);

  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Synthetic viewport impact exercise",
  });
  incidentId = incident.incidentId as string;
  const area = await app.inject({
    method: "PUT",
    url: `/api/v1/incidents/${incidentId}/operational-area`,
    headers: auth(token),
    payload: {
      expectedRevision: 0,
      geometry: polygon(-124.44, 40, -123.41, 41.47),
      operationalPeriod: null,
      reason: "Synthetic KPI browser area",
    },
  });
  expect(area.statusCode).toBe(200);

  const pack = await post(app, token, `/api/v1/incidents/${incidentId}/data-packs`, {
    name: "Synthetic Humboldt parcel KPI fixture",
    organizationSlug: "yurok",
    description: "Synthetic fixture for viewport KPI reconciliation.",
    datasets: [{
      key: "humboldt_parcels",
      name: "Synthetic Humboldt parcels",
      kind: "geojson",
      coverage: polygon(-124.44, 40, -123.41, 41.47),
      fieldMapping: { title: "APN", sourceId: "id", geometry: "geometry" },
    }],
  });
  const packId = (pack.pack as { id: string }).id;
  datasetId = (await admin`select id from data_pack_datasets where pack_id = ${packId}`)[0]!.id as string;
  await post(app, token, `/api/v1/data-packs/datasets/${datasetId}/load`, {
    records: [
      { id: "parcel-a", APN: "A-100", geometry: { type: "Point", coordinates: [-124.0, 40.8] } },
      { id: "parcel-b", APN: "B-200", geometry: { type: "Point", coordinates: [-123.8, 41.0] } },
    ],
  }, 200);

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  const datasetItems = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
  await page.getByRole("button", { name: "Sign in" }).click();
  await datasetItems;
  await page.locator('[data-testid="cop-map"] canvas').waitFor({ timeout: 30_000 });
  await page.getByRole("region", { name: "Common operating picture map" }).waitFor();
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("COP viewport KPI presentation", () => {
  it("updates with map extent and drills the same revision and bbox to source records", async () => {
    // The impact indicators open over the map on request.
    await page.getByRole("button", { name: "Impact in view" }).click();
    const impactRegion = page.getByRole("region", { name: "Map impact indicators" });
    const structures = page.getByTestId("impact-kpi-structures_parcels");
    await structures.waitFor({ timeout: 30_000 });
    // The panel opens on request, so its first analysis may still be arriving.
    await expect.poll(() => page.getByTestId("impact-kpi-infrastructure_facilities").textContent(), { timeout: 30_000 })
      .toContain("coverage unknown");
    expect(await page.getByTestId("impact-kpi-infrastructure_facilities").getAttribute("data-value-state"))
      .toBe("unknown");

    await page.getByText("Map tools and saved views", { exact: true }).click();
    const twoRecords = page.waitForResponse(async (response) => {
      if (!response.url().includes(`/api/v1/incidents/${incidentId}/impact?bbox=`) || response.status() !== 200) return false;
      return (await response.json()).impact.categories.structures_parcels.value === 2;
    });
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await twoRecords;
    await structures.getByText("2", { exact: true }).waitFor();

    await page.getByLabel("Find on map").fill("40.8, -124.0");
    await page.getByLabel("Find on map").press("Enter");
    const oneRecord = page.waitForResponse(async (response) => {
      if (!response.url().includes(`/api/v1/incidents/${incidentId}/impact?bbox=`) || response.status() !== 200) return false;
      return (await response.json()).impact.categories.structures_parcels.value === 1;
    });
    await page.getByRole("button", { name: /Go to 40.8000, -124.0000/ }).click();
    await oneRecord;
    await structures.getByText("1", { exact: true }).waitFor();
    expect(await structures.textContent()).toContain("Current map viewport");

    await structures.getByRole("button", { name: "Sources" }).click();
    await page.getByText("Humboldt County Assessor · Public record (county open data)").waitFor();
    const scopedBbox = await impactRegion.getAttribute("data-analysis-bbox");
    expect(scopedBbox).toBeTruthy();
    const contribution = page.waitForResponse((response) =>
      response.url().includes(`/impact/sources/${datasetId}/records?`) && response.status() === 200);
    await page.getByRole("button", { name: "View contributing records" }).click();
    const contributionResponse = await contribution;
    const contributionUrl = new URL(contributionResponse.url());
    expect(contributionUrl.searchParams.get("revision")).toBe("1");
    expect(contributionUrl.searchParams.get("bbox")).toBe(scopedBbox);
    await page.getByText(/parcel-a · contribution 1/).waitFor();
    await page.getByText("All contributing records loaded.").waitFor();
    expect(await page.getByRole("region", { name: "Map impact indicators" }).textContent())
      .toContain("Geographic exposure does not set lifeline condition");
    await page.screenshot({ path: join(SHOTS, "pcop-kpi-light-wide.png"), fullPage: false });
    await page.getByRole("button", { name: "Close impact sources" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await structures.getByText("1", { exact: true }).waitFor();
    expect(await page.evaluate(
      "document.documentElement.scrollWidth > document.documentElement.clientWidth",
    )).toBe(false);
    const lightNarrowSources = structures.getByRole("button", { name: "Sources" });
    await lightNarrowSources.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.trim() === 'Sources'")).toBe(true);
    await page.keyboard.press("Enter");
    await page.getByRole("complementary", { name: "Affected structures / parcels sources" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "pcop-kpi-light-narrow.png"), fullPage: true });
    await page.getByRole("button", { name: "Close impact sources" }).click();

    await page.setViewportSize({ width: 1440, height: 900 });
    const oldCanvas = await page.locator('[data-testid="cop-map"] canvas').elementHandle();
    const darkDatasetItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.waitForFunction("old => !old.isConnected", oldCanvas);
    await darkDatasetItems;
    await page.locator('[data-testid="cop-map"] canvas').waitFor({ timeout: 30_000 });
    const darkStructures = page.getByTestId("impact-kpi-structures_parcels");
    await darkStructures.waitFor({ timeout: 30_000 });
    await page.getByText("Map tools and saved views", { exact: true }).click();
    const darkTwoRecords = page.waitForResponse(async (response) => {
      if (!response.url().includes(`/api/v1/incidents/${incidentId}/impact?bbox=`) || response.status() !== 200) return false;
      return (await response.json()).impact.categories.structures_parcels.value === 2;
    });
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await darkTwoRecords;
    await darkStructures.getByText("2", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "pcop-kpi-dark-wide.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Find on map").fill("40.8, -124.0");
    await page.getByLabel("Find on map").press("Enter");
    const darkNarrowOneRecord = page.waitForResponse(async (response) => {
      if (!response.url().includes(`/api/v1/incidents/${incidentId}/impact?bbox=`) || response.status() !== 200) return false;
      return (await response.json()).impact.categories.structures_parcels.value === 1;
    });
    await page.getByRole("button", { name: /Go to 40.8000, -124.0000/ }).click();
    await darkNarrowOneRecord;
    await darkStructures.getByText("1", { exact: true }).waitFor();
    expect(await page.evaluate(
      "document.documentElement.scrollWidth > document.documentElement.clientWidth",
    )).toBe(false);
    const darkNarrowSources = darkStructures.getByRole("button", { name: "Sources" });
    await darkNarrowSources.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.trim() === 'Sources'")).toBe(true);
    await page.keyboard.press("Enter");
    await page.getByRole("complementary", { name: "Affected structures / parcels sources" }).waitFor();
    const darkScopedBbox = await impactRegion.getAttribute("data-analysis-bbox");
    expect(darkScopedBbox).toBeTruthy();
    const darkContribution = page.waitForResponse((response) =>
      response.url().includes(`/impact/sources/${datasetId}/records?`) && response.status() === 200);
    const viewRecords = page.getByRole("button", { name: "View contributing records" });
    await viewRecords.focus();
    await page.keyboard.press("Enter");
    const darkContributionUrl = new URL((await darkContribution).url());
    expect(darkContributionUrl.searchParams.get("revision")).toBe("1");
    expect(darkContributionUrl.searchParams.get("bbox")).toBe(darkScopedBbox);
    await page.getByText(/parcel-a · contribution 1/).waitFor();
    await page.getByText("All contributing records loaded.").waitFor();
    await page.screenshot({ path: join(SHOTS, "pcop-kpi-dark-narrow.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);

  it("draws a parcel layer from vector tiles at once, reading one page of its items", async () => {
    await page.setViewportSize({ width: 1586, height: 992 });
    const pages: string[] = [];
    const listen = (response: { url(): string }) => {
      if (response.url().includes(`/api/v1/datasets/${datasetId}/items`)) pages.push(response.url());
    };
    page.on("response", listen);
    const tile = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/tiles/datasets/${datasetId}/`) && response.status() === 200, { timeout: 60_000 });
    await page.reload({ waitUntil: "load" });
    await tile;
    page.off("response", listen);
    expect(pages).toHaveLength(1);
    await page.getByText("Drawn from vector tiles: every feature is on the map.").waitFor({ state: "attached" });
    expect(await page.getByText("Display incomplete: bounded page limit reached.").count()).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
