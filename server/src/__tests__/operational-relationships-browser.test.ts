import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IapDocument } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("operational-relationships-browser");
const SHOTS = shotDir("operational-relationships");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let datasetId: string;
let adminId: string;
let boardId: string;
let boardTitle: string;
let boardRecordId: string;
let iapId: string;
let iapRevision: number;
const featureId = "route/7";
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

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  adminId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);

  const token = await login(app);
  const incident = await post(token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "wildfire",
    name: "Operational relationship route exercise",
  });
  incidentId = incident.incidentId as string;
  const detail = await app.inject({
    method: "GET",
    url: `/api/v1/incidents/${incidentId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(detail.statusCode, detail.body).toBe(200);
  const commanderId = (detail.json().positions as Array<{ id: string; key: string }>)
    .find((position) => position.key === "incident_commander")?.id;
  expect(commanderId).toBeTruthy();
  await post(token, `/api/v1/positions/${commanderId}/assignments`, { personId: adminId });

  const area = await app.inject({
    method: "PUT",
    url: `/api/v1/incidents/${incidentId}/operational-area`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      expectedRevision: 0,
      geometry: polygon(-124.44, 40, -123.41, 41.47),
      operationalPeriod: null,
      reason: "Map relationship browser fixture",
    },
  });
  expect(area.statusCode, area.body).toBe(200);

  await post(token, `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
    lifeline: "transportation",
    condition: "unstable",
    assessedAt: new Date().toISOString(),
    confidence: "confirmed",
    impactStatement: "County Route 7 is closed at the river crossing.",
    components: [],
    evidence: [],
    responsibleOrganizationIds: [],
    actions: [],
  });

  const [board] = await admin`select b.id, b.title from boards b
    join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = 'shelters'`;
  expect(board).toBeTruthy();
  boardId = board!.id as string;
  boardTitle = board!.title as string;
  const boardRecord = await post(token, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
    name: "River Crossing Shelter",
    status: "normal",
    capacity: 40,
    occupancy: 12,
  });
  boardRecordId = boardRecord.id as string;
  const iap = await post(token, `/api/v1/incidents/${incidentId}/iap`, {
    operationalPeriod: "OP 1",
    objectives: ["Restore Route 7"],
  });
  iapId = iap.id as string;
  iapRevision = Number((await admin`select content_revision from iaps where id = ${iapId}`)[0]!.content_revision);

  const pack = await post(token, `/api/v1/incidents/${incidentId}/data-packs`, {
    name: "Operational relationship route fixture",
    organizationSlug: "yurok",
    description: "Persisted point used by the map relationship browser journey.",
    datasets: [{
      key: "route_closures",
      name: "Recorded route closures",
      kind: "geojson",
      coverage: polygon(-124.44, 40, -123.41, 41.47),
      fieldMapping: { title: "name", sourceId: "id", geometry: "geometry" },
    }],
  });
  const packId = (pack.pack as { id: string }).id;
  datasetId = (await admin`select id from data_pack_datasets where pack_id = ${packId}`)[0]!.id as string;
  await post(token, `/api/v1/data-packs/datasets/${datasetId}/load`, {
    records: [{
      id: featureId,
      name: "County Route 7 closure",
      geometry: { type: "Point", coordinates: [-124.0, 40.8] },
    }],
  });

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
  const initialItems = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
  await page.getByRole("button", { name: "Sign in" }).click();
  await initialItems;
  await page.locator('[data-testid="cop-map"] canvas').waitFor({ timeout: 30_000 });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("map relationship browser journey", () => {
  it("links an authoritative map feature to a recorded assessment and returns to it", async () => {
    const encodedRoute = `#/map/${encodeURIComponent(datasetId)}/${encodeURIComponent(featureId)}?incident=${encodeURIComponent(incidentId)}`;
    const focusedItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
    await page.goto(`${baseUrl}/app/index.html${encodedRoute}`, { waitUntil: "load" });
    await focusedItems;

    const inspector = page.getByRole("complementary", { name: "Selected map feature" });
    await inspector.waitFor({ timeout: 30_000 });
    await inspector.getByRole("heading", { name: "County Route 7 closure", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Link selected dataset feature", exact: true }).waitFor();
    await page.getByLabel("Recorded assessment").selectOption(
      "lifeline|fema_community_lifelines|transportation",
    );
    const created = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/incidents/${incidentId}/operational-relationships`)
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Link selected feature", exact: true }).click();
    expect((await created).status()).toBe(201);
    await page.getByRole("status").filter({ hasText: "Linked County Route 7 closure" }).waitFor();

    const relationships = await admin`select incident_id, source_domain, source_framework,
      source_definition_key, target_kind, target_dataset_id, target_feature_id, created_by
      from operational_relationships where incident_id = ${incidentId}`;
    expect(relationships).toEqual([expect.objectContaining({
      incident_id: incidentId,
      source_domain: "lifeline",
      source_framework: "fema_community_lifelines",
      source_definition_key: "transportation",
      target_kind: "map_feature",
      target_dataset_id: datasetId,
      target_feature_id: featureId,
      created_by: adminId,
    })]);
    await page.screenshot({ path: join(SHOTS, "operational-relationships-light-wide.png"), fullPage: false });

    const reloadedItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
    const reloadedRelationships = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/incidents/${incidentId}/operational-relationships`)
      && response.request().method() === "GET" && response.status() === 200);
    await page.reload({ waitUntil: "load" });
    await Promise.all([reloadedItems, reloadedRelationships]);
    const reloadedInspector = page.getByRole("complementary", { name: "Selected map feature" });
    await reloadedInspector.waitFor({ timeout: 30_000 });
    await reloadedInspector.getByRole("heading", { name: "County Route 7 closure", exact: true }).waitFor();
    const featureLinks = page.getByRole("region", { name: "Existing assessment links" });
    await featureLinks.getByText("Lifeline: Transportation", { exact: true }).waitFor();
    const boardRecords = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/boards/${boardId}/views/`) && response.status() === 200);
    await featureLinks.getByRole("button", { name: "Open linked Lifeline", exact: true }).click();
    expect(new URL(page.url()).hash).toContain("#/lifeline/transportation");
    await boardRecords;
    const relationshipPanel = page.getByRole("region", { name: "Operational relationships" });
    await relationshipPanel.locator('li[data-target-kind="map_feature"] > span')
      .filter({ hasText: `Map feature ${featureId}` }).waitFor();
    await relationshipPanel.getByLabel("Link type").selectOption("board_record");
    await relationshipPanel.getByLabel("Incident board or facility record").selectOption(boardRecordId);
    const boardLinkCreated = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/incidents/${incidentId}/operational-relationships`)
      && response.request().method() === "POST");
    await relationshipPanel.getByRole("button", { name: "Add recorded link", exact: true }).click();
    expect((await boardLinkCreated).status()).toBe(201);
    await relationshipPanel.locator('li[data-target-kind="board_record"] > span')
      .filter({ hasText: `${boardTitle}: River Crossing Shelter` }).waitFor();

    await relationshipPanel.getByLabel("Link type").selectOption("iap_objective");
    await relationshipPanel.getByLabel("IAP objective snapshot").selectOption(`${iapId}:${iapRevision}:0`);
    const iapLinkCreated = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/incidents/${incidentId}/operational-relationships`)
      && response.request().method() === "POST");
    await relationshipPanel.getByRole("button", { name: "Add recorded link", exact: true }).click();
    expect((await iapLinkCreated).status()).toBe(201);
    const [iapRow] = await admin`select content from iaps where id = ${iapId}`;
    const originalContent = iapRow!.content as IapDocument;
    const objectives = originalContent.forms.find((form) => form.id === "ICS-202")?.sections
      .find((section) => section.heading === "Objectives")?.lines;
    expect(objectives?.[0]).toBe("Restore Route 7");
    const revisedContent: IapDocument = {
      ...originalContent,
      forms: originalContent.forms.map((form) => form.id === "ICS-202" ? {
        ...form,
        sections: form.sections.map((section) => section.heading === "Objectives" ? {
          ...section,
          ...(section.lines ? { lines: section.lines.map((line, index) => index === 0 ? "Revised objective text" : line) } : {}),
        } : section),
      } : form),
    };
    await admin`update iaps set content_revision = content_revision + 1,
      content = ${admin.json(revisedContent as never)} where id = ${iapId}`;
    const refreshedRelationships = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/incidents/${incidentId}/operational-relationships`)
      && response.request().method() === "GET" && response.status() === 200);
    await page.reload({ waitUntil: "load" });
    await refreshedRelationships;
    const refreshedPanel = page.getByRole("region", { name: "Operational relationships" });
    const iapRelationship = refreshedPanel.locator('li[data-target-kind="iap_objective"]');
    await iapRelationship.locator(":scope > span")
      .filter({ hasText: "OP 1 · objective 1: Restore Route 7" }).waitFor();
    await iapRelationship.getByText(`Recorded content revision ${iapRevision}`, { exact: true }).waitFor();
    await iapRelationship.getByText("Stale IAP revision", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "operational-relationships-light-lifeline.png"), fullPage: false });

    await refreshedPanel.getByRole("button", { name: "Open IAP", exact: true }).click();
    expect(new URL(page.url()).hash).toContain(`#/iap/${iapId}`);
    await page.getByRole("region", { name: "Stored IAP forms" }).waitFor();
    await page.goBack({ waitUntil: "load" });
    const returnedPanel = page.getByRole("region", { name: "Operational relationships" });
    await returnedPanel.waitFor();
    await returnedPanel.getByRole("button", { name: "Open source record", exact: true }).click();
    expect(new URL(page.url()).hash).toContain(`#/board/${boardId}`);
    expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("record")).toBe(boardRecordId);
    const selectedRecord = page.getByRole("region", { name: "Selected record" });
    await selectedRecord.waitFor();
    await selectedRecord.getByText("River Crossing Shelter", { exact: true }).waitFor();
    await page.goBack({ waitUntil: "load" });
    await page.getByRole("region", { name: "Operational relationships" }).waitFor();

    const returnedItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
    await page.getByRole("region", { name: "Operational relationships" })
      .getByRole("button", { name: "Open on map", exact: true }).click();
    await returnedItems;
    await inspector.waitFor({ timeout: 30_000 });
    await inspector.getByRole("heading", { name: "County Route 7 closure", exact: true }).waitFor();
    expect(new URL(page.url()).hash).toBe(`${encodedRoute}&period=unset`);

    const oldCanvas = await page.locator('[data-testid="cop-map"] canvas').elementHandle();
    const darkItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/datasets/${datasetId}/items`) && response.status() === 200);
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.waitForFunction("old => !old.isConnected", oldCanvas);
    await darkItems;
    await page.getByRole("complementary", { name: "Selected map feature" }).waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(SHOTS, "operational-relationships-dark-wide.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("complementary", { name: "Selected map feature" }).waitFor();
    await page.getByRole("heading", { name: "Link selected dataset feature", exact: true }).waitFor();
    expect(await page.evaluate(
      "document.documentElement.scrollWidth > document.documentElement.clientWidth",
    )).toBe(false);
    await page.screenshot({ path: join(SHOTS, "operational-relationships-dark-narrow.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
