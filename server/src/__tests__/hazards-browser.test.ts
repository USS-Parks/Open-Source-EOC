import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("h11-app");
const SHOTS = shotDir("h11");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let boardId: string;
let datasetId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function post(token: string, url: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function stableCanvasShot(): Promise<Buffer> {
  const canvas = page.locator('[data-testid="cop-map"] canvas');
  let previous = await canvas.screenshot();
  for (let frame = 0; frame < 12; frame += 1) {
    await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const current = await canvas.screenshot();
    if (current.equals(previous)) return current;
    previous = current;
  }
  throw new Error("map canvas did not settle within 12 animation samples");
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const hazardTemplate = {
    key: "synthetic_hazard_areas",
    version: 1,
    title: "Synthetic Hazard Areas",
    description: "Synthetic fixture polygons for H11 browser verification.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "severity", label: "Severity", type: "enum", enumId: "symbology.status", required: true },
      { key: "area", label: "Area", type: "geometry", geometryKind: "polygon", required: true },
    ],
    views: [{ key: "all", title: "All areas", columns: ["name", "severity"] }],
  };
  await admin`
    insert into board_templates (key, version, title, definition)
    values ('synthetic_hazard_areas', 1, 'Synthetic Hazard Areas', ${admin.json(hazardTemplate)})`;

  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  const board = await post(token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: "synthetic_hazard_areas",
  });
  boardId = board.id as string;
  const incident = await post(token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops",
    name: "Synthetic H11 Hazard Exercise",
  });
  const incidentId = incident.incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  await post(token, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
    name: "Synthetic evacuation warning",
    severity: "critical",
    area: {
      type: "Polygon",
      coordinates: [[[-124.12, 40.82], [-123.98, 40.82], [-123.98, 40.96], [-124.12, 40.96], [-124.12, 40.82]]],
    },
  });
  const area = await app.inject({
    method: "PUT",
    url: `/api/v1/incidents/${incidentId}/operational-area`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      expectedRevision: 0,
      geometry: {
        type: "Polygon",
        coordinates: [[[-124.2, 40.7], [-123.8, 40.7], [-123.8, 41.1], [-124.2, 41.1], [-124.2, 40.7]]],
      },
      operationalPeriod: null,
      reason: "Synthetic H11 browser extent",
    },
  });
  expect(area.statusCode).toBe(200);

  const pack = await post(token, `/api/v1/incidents/${incidentId}/data-packs`, {
    name: "Synthetic local NFHL fixture",
    organizationSlug: "yurok",
    description: "Synthetic fixture only; no live FEMA request.",
    datasets: [{
      key: "fema_nfhl_flood",
      name: "FEMA flood zones (synthetic fixture)",
      kind: "geojson",
      coverage: {
        type: "Polygon",
        coordinates: [[[-124.2, 40.7], [-123.8, 40.7], [-123.8, 41.1], [-124.2, 41.1], [-124.2, 40.7]]],
      },
      fieldMapping: { title: "zone", category: "subtype", sourceId: "id", geometry: "geometry" },
    }],
  });
  const packId = (pack.pack as { id: string }).id;
  datasetId = (await admin`
    select id from data_pack_datasets where pack_id = ${packId}`)[0]!.id as string;
  await post(token, `/api/v1/data-packs/datasets/${datasetId}/load`, {
    records: [
      {
        id: "synthetic-ae",
        zone: "AE",
        subtype: "",
        geometry: {
          type: "Polygon",
          coordinates: [[[-124.05, 40.86], [-123.9, 40.86], [-123.9, 41.0], [-124.05, 41.0], [-124.05, 40.86]]],
        },
      },
      {
        id: "synthetic-x-shaded",
        zone: "X",
        subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
        geometry: {
          type: "Polygon",
          coordinates: [[[-124.17, 40.73], [-124.08, 40.73], [-124.08, 40.8], [-124.17, 40.8], [-124.17, 40.73]]],
        },
      },
      {
        id: "synthetic-outside",
        zone: "AE",
        subtype: "",
        geometry: {
          type: "Polygon",
          coordinates: [[[-118.4, 34.0], [-118.3, 34.0], [-118.3, 34.1], [-118.4, 34.1], [-118.4, 34.0]]],
        },
      },
    ],
  });

  baseUrl = await listen(app);

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  const boardItems = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/ogc/collections/${boardId}/items`) && response.status() === 200);
  const datasetItems = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
  await page.getByRole("button", { name: "Sign in" }).click();
  await Promise.all([boardItems, datasetItems]);
  await page.waitForSelector('[data-testid="cop-map"] canvas', { timeout: 20_000 });
  await page.getByText("Flood hazard (static reference)").waitFor({ state: "visible", timeout: 20_000 });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("real-map hazard and flood presentation", () => {
  it("renders synthetic operational and FEMA polygons with functional toggles in both themes", async () => {
    await page.getByText("Freshness: live").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("map-tools").locator("summary").click();
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await page.getByText("High risk (A, AE, AO)").waitFor({ state: "visible" });
    await page.getByText("Moderate risk (shaded X)").waitFor({ state: "visible" });
    await page.getByText("Unknown or unclassified").waitFor({ state: "visible" });
    await page.getByText(/Static FEMA reference, separate from current incident status/).waitFor({ state: "visible" });

    const floodToggle = page.getByLabel("FEMA flood zones (synthetic fixture)");
    const hazardToggle = page.getByLabel("Synthetic Hazard Areas");
    expect(await floodToggle.isChecked()).toBe(true);
    expect(await hazardToggle.isChecked()).toBe(true);
    const visible = await stableCanvasShot();
    await floodToggle.uncheck();
    expect(await floodToggle.isChecked()).toBe(false);
    const floodHidden = await stableCanvasShot();
    expect(floodHidden.equals(visible)).toBe(false);
    await floodToggle.check();
    const floodRestored = await stableCanvasShot();
    expect(floodRestored.equals(floodHidden)).toBe(false);
    await hazardToggle.uncheck();
    expect(await hazardToggle.isChecked()).toBe(false);
    const hazardHidden = await stableCanvasShot();
    expect(hazardHidden.equals(floodRestored)).toBe(false);
    await hazardToggle.check();
    expect((await stableCanvasShot()).equals(hazardHidden)).toBe(false);
    await page.screenshot({ path: join(SHOTS, "h11-hazards-light.png"), fullPage: false });

    const oldCanvas = await page.locator('[data-testid="cop-map"] canvas').elementHandle();
    const darkBoardItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/ogc/collections/${boardId}/items`) && response.status() === 200);
    const darkDatasetItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.waitForFunction("old => !old.isConnected", oldCanvas);
    await Promise.all([darkBoardItems, darkDatasetItems]);
    await page.waitForSelector('[data-testid="cop-map"] canvas', { timeout: 20_000 });
    await page.getByText("Freshness: live").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByText("Flood hazard (static reference)").waitFor({ state: "visible" });
    await page.getByTestId("map-tools").locator("summary").click();
    const darkFloodToggle = page.getByLabel("FEMA flood zones (synthetic fixture)");
    const darkHazardToggle = page.getByLabel("Synthetic Hazard Areas");
    expect(await darkFloodToggle.isChecked()).toBe(true);
    expect(await darkHazardToggle.isChecked()).toBe(true);
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    const darkVisible = await stableCanvasShot();
    await darkFloodToggle.uncheck();
    const darkFloodHidden = await stableCanvasShot();
    expect(darkFloodHidden.equals(darkVisible)).toBe(false);
    await darkFloodToggle.check();
    const darkFloodRestored = await stableCanvasShot();
    expect(darkFloodRestored.equals(darkFloodHidden)).toBe(false);
    await darkHazardToggle.uncheck();
    const darkHazardHidden = await stableCanvasShot();
    expect(darkHazardHidden.equals(darkFloodRestored)).toBe(false);
    await darkHazardToggle.check();
    expect((await stableCanvasShot()).equals(darkHazardHidden)).toBe(false);
    await page.screenshot({ path: join(SHOTS, "h11-hazards-dark.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
