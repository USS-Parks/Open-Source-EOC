import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("81c-workspace-app");
const SHOTS = shotDir("81c-workspace");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let roadBoardId: string;
let roadBoardTitle: string;
let dashboardId: string;
let token: string;
let jurisdictionId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function request(method: "POST" | "PUT", url: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

interface WorkspaceBounds {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly left: number;
  readonly right: number;
  readonly viewport: number;
}

async function expectContained(selector: string): Promise<void> {
  const bounds = await page.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error(${JSON.stringify(`workspace target missing: ${selector}`)});
    const rect = node.getBoundingClientRect();
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
    };
  })()`) as unknown as WorkspaceBounds;
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
}

async function openRoute(path: string): Promise<void> {
  const hash = path.startsWith("map?") ? `#/?${path.slice("map?".length)}` : `#/${path}`;
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/81c-app", DIST);

  token = await login(app);
  const incident = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "81C responsive workspace exercise",
  });
  incidentId = incident.incidentId as string;
  const [roads] = await admin`
    select b.id, b.title from incident_boards ib join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId} and b.template_key = 'road_closures'`;
  expect(roads).toBeTruthy();
  roadBoardId = roads!.id as string;
  roadBoardTitle = roads!.title as string;
  await request("POST", `/api/v1/boards/${roadBoardId}/records?incidentId=${incidentId}`, {
    road: "SR-96 at Weitchpec", reason: "Debris flow", status: "closed",
    location: { type: "Point", coordinates: [-123.7, 41.3] },
  });
  const dashboard = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/dashboards`, {
    templateKey: "eoc_status", title: "81C incident overview sources",
  });
  dashboardId = dashboard.id as string;
  await request("PUT", `/api/v1/incidents/${incidentId}/dashboard-configs/incident-overview`, {
    expectedRevision: 0,
    composition: {
      title: "81C incident overview",
      panels: [
        { key: "closed", source: "dashboard", dashboardId, widgetKey: "closed_roads", presentation: "tile" },
        { key: "activity", source: "dashboard", dashboardId, widgetKey: "active_closures", presentation: "list" },
      ],
    },
  });

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, reducedMotion: "reduce" });
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

describe("responsive workspace proof", () => {
  it("keeps the real COP, board, and dashboard usable across prescribed widths with keyboard and touch control", async () => {
    await page.goto(`${baseUrl}/81c-app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await openRoute(`map?incident=${incidentId}`);
    const map = page.getByRole("region", { name: "Common operating picture map" });
    await map.waitFor({ timeout: 30_000 });
    const mapTools = page.getByTestId("map-tools");
    await mapTools.locator("summary").focus();
    await page.keyboard.press("Enter");
    expect(await mapTools.getAttribute("open")).not.toBeNull();
    await expectContained('[aria-label="Common operating picture map"]');
    await page.screenshot({ path: join(SHOTS, "81c-cop-wide-1440.png"), fullPage: false });

    await page.setViewportSize({ width: 1280, height: 900 });
    await openRoute(`board/${roadBoardId}?incident=${incidentId}`);
    await page.getByRole("heading", { name: roadBoardTitle, exact: true, level: 2 }).waitFor();
    const newRecord = page.getByRole("button", { name: "New record", exact: true });
    await newRecord.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await expectContained("#main");
    await page.screenshot({ path: join(SHOTS, "81c-boards-laptop-1280.png"), fullPage: false });

    await page.setViewportSize({ width: 900, height: 900 });
    await openRoute(`dashboard/${dashboardId}?incident=${incidentId}&view=incident-overview`);
    const statistics = page.getByRole("region", { name: "Incident statistics" });
    await statistics.waitFor({ timeout: 30_000 });
    const editFilters = page.getByRole("button", { name: "Edit filters" });
    const box = await editFilters.boundingBox();
    expect(box).toBeTruthy();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.getByRole("button", { name: "Apply filters" }).waitFor();
    await page.keyboard.press("Escape");
    await expectContained('[aria-label="Incident statistics"]');
    await page.screenshot({ path: join(SHOTS, "81c-dashboard-tablet-900.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(`map?incident=${incidentId}`);
    try {
      await map.waitFor({ timeout: 30_000 });
    } catch (cause) {
      const rendered = await page.evaluate(`JSON.stringify({
        hash: location.hash,
        title: document.title,
        body: document.body?.innerText.slice(0, 4000) ?? "",
      })`);
      await page.screenshot({ path: join(SHOTS, "81c-map-phone-failure.png"), fullPage: false });
      throw new Error(`Narrow map did not render: ${rendered}; page errors: ${JSON.stringify(pageErrors)}`, { cause });
    }
    await expectContained('[aria-label="Common operating picture map"]');
    await openRoute(`board/${roadBoardId}?incident=${incidentId}`);
    await page.getByRole("heading", { name: roadBoardTitle, exact: true, level: 2 }).waitFor();
    await expectContained("#main");
    await openRoute(`dashboard/${dashboardId}?incident=${incidentId}&view=incident-overview`);
    await statistics.waitFor({ timeout: 30_000 });
    await expectContained('[aria-label="Incident statistics"]');
    await page.screenshot({ path: join(SHOTS, "81c-dashboard-phone-390.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
