import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { dictionaryValues } from "@openeoc/shared";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/** Real-browser proof for the saved incident overview dashboard composition. */
const DIST = buildDir("dashboard");
const SHOTS = shotDir("dashboard");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let incidentId: string;
let dashboardId: string;
let adminToken: string;
let memberToken: string;
let jurisdictionId: string;
let lifelineCondition: string;

async function createBoard(templateKey: string): Promise<string> {
  const board = await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey });
  const boardId = board.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  return boardId;
}

async function attachedBoard(templateKey: string): Promise<string> {
  const [row] = await admin`
    select b.id from incident_boards ib
    join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId} and b.template_key = ${templateKey}`;
  expect(row, `missing attached ${templateKey} board`).toBeTruthy();
  return row!.id as string;
}

async function addRecord(boardId: string, data: Record<string, unknown>): Promise<void> {
  await post(app, memberToken, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, data);
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  const switcher = page.getByRole("button", { name: theme === "light" ? "Use light theme" : "Use dark theme" });
  if (await switcher.count()) await switcher.click();
  await page.getByRole("button", { name: "Account menu" }).click();
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
  serveStatic(app, "/dashboard-app", DIST);
  baseUrl = await listen(app);

  adminToken = await login(app);
  memberToken = await login(app, "member@example.org", "another-good-password");
  const activation = await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "P-DASH Fire",
  });
  incidentId = activation.incidentId as string;

  const roads = await attachedBoard("road_closures");
  const lifelines = await createBoard("lifelines");
  const dashboard = await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/dashboards`, {
    templateKey: "eoc_status", title: "Incident overview sources",
  });
  dashboardId = dashboard.id as string;

  await addRecord(roads, {
    road: "SR-96 at Weitchpec", reason: "Debris flow", status: "closed",
    location: { type: "Point", coordinates: [-123.7, 41.3] },
  });
  await addRecord(roads, {
    road: "Bald Hills Road", reason: "Fire operations", status: "closed",
    location: { type: "Point", coordinates: [-123.8, 41.2] },
  });
  const lifeline = dictionaryValues("lifelines.lifelines")?.[0] ?? "energy";
  lifelineCondition = dictionaryValues("lifelines.status")?.[0] ?? "stable";
  await addRecord(lifelines, { lifeline, status: lifelineCondition, note: "Reported by operations" });
  await admin`
    insert into incident_area_revisions (incident_id, revision, geometry, reason, created_by)
    values (${incidentId}, 1,
      ST_GeomFromText('POLYGON((-124 40,-122 40,-122 42,-124 42,-124 40))', 4326),
      'P-DASH browser fixture', ${seed.adminId})`;

  const composition = {
    title: "Incident overview",
    panels: [
      { key: "closed", source: "dashboard", dashboardId, widgetKey: "closed_roads", presentation: "tile" },
      { key: "closures_map", source: "dashboard", dashboardId, widgetKey: "active_closures", presentation: "map" },
      { key: "lifelines", source: "dashboard", dashboardId, widgetKey: "lifelines", presentation: "status" },
      { key: "priority_activity", source: "dashboard", dashboardId, widgetKey: "active_closures", presentation: "list" },
      { key: "structures", source: "impact", category: "structures_parcels", presentation: "tile" },
    ],
  };
  const saved = await app.inject({
    method: "PUT", url: `/api/v1/incidents/${incidentId}/dashboard-configs/incident-overview`,
    headers: auth(memberToken), payload: { expectedRevision: 0, composition },
  });
  expect(saved.statusCode, saved.body).toBe(201);
  browser = await launchBrowser();
}, 120000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("incident overview dashboard in a real browser", () => {
  it("composes server totals, COP records, lifelines, priority activity and restored filters offline", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url);
      return route.abort();
    });
    try {
      const viewState = encodeURIComponent(JSON.stringify({ scope: "incident" }));
      await page.goto(`${baseUrl}/dashboard-app/index.html#/dashboard/${dashboardId}?incident=${incidentId}&view=incident-overview&filter=${viewState}`);
      await page.getByLabel("Email").fill("member@example.org");
      await page.getByLabel("Password").fill("another-good-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      if (await page.getByRole("button", { name: "Close context drawer" }).count()) {
        await page.getByRole("button", { name: "Close context drawer" }).click();
      }

      await page.getByRole("region", { name: "Incident statistics" }).waitFor({ timeout: 30000 });
      expect(await page.getByRole("region", { name: "Incident statistics" }).textContent()).toContain("Closed roads");
      expect(await page.getByTestId("panel-structures").locator('[data-state="unavailable"]').count()).toBe(1);
      await page.getByRole("region", { name: "Active closures" }).waitFor({ timeout: 30000 });
      await page.getByText("2 mapped of 2 contributing records").waitFor({ timeout: 30000 });
      expect((await page.getByRole("region", { name: "Community Lifelines" }).textContent())?.toLowerCase()).toContain(lifelineCondition);
      expect(await page.getByRole("region", { name: "Priority work and recent activity" }).textContent())
        .toContain("SR-96 at Weitchpec");
      expect(await page.getByText("Incident-area totals").count()).toBeGreaterThan(0);
      await page.screenshot({ path: join(SHOTS, "p-dash-light-1440.png") });

      await setTheme(page, "dark");
      await page.screenshot({ path: join(SHOTS, "p-dash-dark-1440.png") });
      await page.setViewportSize({ width: 900, height: 900 });
      await page.screenshot({ path: join(SHOTS, "p-dash-dark-900.png") });
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, "light");
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, "p-dash-light-390.png"), fullPage: true });

      await page.setViewportSize({ width: 900, height: 900 });
      await page.getByRole("button", { name: "Edit filters" }).click();
      await page.getByLabel("Category field").fill("status");
      await page.getByLabel("Category value").fill("closed");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await page.getByText("Category: closed").waitFor();
      expect(decodeURIComponent(new URL(page.url()).hash)).toContain('"equals":"closed"');
      await page.goBack();
      await page.getByRole("region", { name: "Incident statistics" }).waitFor();
      expect(await page.getByText("Category: closed").count()).toBe(0);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120000);
});
