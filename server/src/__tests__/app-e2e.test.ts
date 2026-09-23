import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { dictionaryValues } from "@openeoc/shared";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Real-browser proof of the app shell: the built SPA is served next to
 * the live API, a member signs in, the map-first console renders with the
 * COP and the boards dock, and the dashboard surface renders its widgets.
 * All non-local network is blocked, so this also proves the app runs with
 * no external dependency. Screenshots are written for manual review.
 */

const DIST = buildDir("app");
const SHOTS = shotDir("app");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;

const isFocused = (node: unknown) => {
  const element = node as { ownerDocument: { activeElement: unknown } };
  return element.ownerDocument.activeElement === element;
};

async function createBoard(templateKey: string): Promise<string> {
  const created = await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey });
  return created.id as string;
}

async function addRecord(boardId: string, data: Record<string, unknown>): Promise<void> {
  await post(app, memberToken, `/api/v1/boards/${boardId}/records`, data);
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  // The console walk covers the tracking surface, so this harness enables the
  // optional integrations explicitly. A default deployment registers neither.
  app = buildApp(runtime, { oidc: null, integrations: ["tracking", "facilities"] });

  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);

  adminToken = await login(app);
  memberToken = await login(app, "member@example.org", "another-good-password");

  const roads = await createBoard("road_closures");
  const shelters = await createBoard("shelters");
  const lifelines = await createBoard("lifelines");
  await createBoard("significant_events");
  await createBoard("resource_request");
  await createBoard("field_reports");
  const dashboard = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "eoc_status" },
  });

  await addRecord(roads, {
    road: "SR-169 at Pecwan",
    reason: "Active fire",
    status: "closed",
    location: { type: "Point", coordinates: [-123.61, 41.29] },
  });
  await addRecord(roads, {
    road: "Bald Hills Rd",
    reason: "Downed lines",
    status: "one_lane",
    location: { type: "Point", coordinates: [-123.79, 41.15] },
  });

  const lifelineValues = dictionaryValues("lifelines.lifelines") ?? [];
  const statusValues = dictionaryValues("lifelines.status") ?? [];
  if (lifelineValues[0] && statusValues[0])
    await addRecord(lifelines, { lifeline: lifelineValues[0], status: statusValues[0] });
  if (lifelineValues[1] && statusValues[statusValues.length - 1])
    await addRecord(lifelines, {
      lifeline: lifelineValues[1],
      status: statusValues[statusValues.length - 1],
    });

  // Shelter postures, so the shelters-by-status donut shows segments.
  await addRecord(shelters, { name: "Hoopa High Gym", status: "normal", capacity: 200, occupancy: 84 });
  await addRecord(shelters, { name: "Weitchpec Center", status: "evacuating", capacity: 60, occupancy: 12 });
  await addRecord(shelters, { name: "Klamath Hall", status: "closed", capacity: 40, occupancy: 0 });

  // ESF conditions, so the dashboard shows the ESF status cards.
  const esfBoard = await createBoard("esf_status");
  await addRecord(esfBoard, { esf: "esf_8_public_health_medical", status: "stressed" });
  await addRecord(esfBoard, { esf: "esf_1_transportation", status: "normal" });

  // Activate an incident so the Forms/IAP screen has one to build from.
  const activation = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "wildfire", name: "Bald Hills Fire" },
  });
  if (activation.statusCode !== 201) throw new Error(`activation failed: ${activation.body}`);
  const activeIncidentId = activation.json().incidentId as string;
  const period = await app.inject({
    method: "PUT", url: `/api/v1/incidents/${activeIncidentId}/operational-area`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { expectedRevision: 0, geometry: null, operationalPeriod: {
      label: "Bald Hills OP 1", startsAt: "2026-09-21T06:00:00.000Z",
      endsAt: "2026-09-22T06:00:00.000Z",
    }, reason: "Synthetic browser exercise planning period" },
  });
  expect(period.statusCode, period.body).toBe(200);
  await admin`insert into incident_boards (incident_id, board_id)
    select ${activeIncidentId}, id from boards where jurisdiction_id = ${seed.jurisdictionId}
    on conflict do nothing`;
  await admin`update board_records set incident_id = ${activeIncidentId}
    where incident_id is null and board_id in
      (select id from boards where jurisdiction_id = ${seed.jurisdictionId})`;
  const overview = await app.inject({
    method: "PUT", url: `/api/v1/incidents/${activeIncidentId}/dashboard-configs/incident-overview`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { expectedRevision: 0, composition: { title: "EOC Status", panels: [
      { key: "closed", source: "dashboard", dashboardId: dashboard.json().id, widgetKey: "closed_roads", presentation: "tile" },
      { key: "esf", source: "dashboard", dashboardId: dashboard.json().id, widgetKey: "esfs", presentation: "status" },
    ] } },
  });
  expect(overview.statusCode, overview.body).toBe(201);

  // A push feed with one point, so the COP shows a live external feed layer.
  const feed = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/feeds`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "NWS Alerts", kind: "geojson", push: true, staleAfterSeconds: 3600 },
  });
  if (feed.statusCode === 201) {
    const feedId = feed.json().id as string;
    const feedToken = feed.json().ingestToken as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${feedId}/ingest`,
      headers: { "x-feed-token": feedToken },
      payload: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-123.7, 41.4] },
            properties: { title: "Flood Warning", severity: "critical" },
          },
        ],
      },
    });
  }

  // A stored smart form (JSON path) that maps to the field-reports board.
  await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      key: "rapid_needs",
      version: 1,
      title: "Rapid Needs Survey",
      boardTemplate: "field_reports",
      nodes: [
        { kind: "field", name: "summary", type: "text", required: true, label: "Summary" },
        {
          kind: "field",
          name: "category",
          type: "select_one",
          label: "Category",
          choices: [
            { name: "hazard", label: "Hazard" },
            { name: "damage", label: "Damage" },
            { name: "resource", label: "Resource" },
            { name: "other", label: "Other" },
          ],
        },
      ],
    },
  });

  browser = await launchBrowser();
}, 120000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the operations console in a real browser, offline", () => {
  it("keeps the branded frame usable across desktop, laptop, tablet and phone", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("member@example.org");
      await page.getByLabel("Password").fill("another-good-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.locator('[data-testid="cop-map"]').waitFor();
      await page.getByRole("button", { name: "Close context drawer" }).click();
      const originalHash = new URL(page.url()).hash;
      await page.getByRole("link", { name: "Skip to workspace" }).focus();
      await page.keyboard.press("Enter");
      expect(new URL(page.url()).hash).toBe(originalHash);
      expect(await page.locator("main").evaluate(isFocused)).toBe(true);
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width: 1440, height: 900 });
        if (theme === "dark") {
          await page.getByRole("button", { name: "Account menu" }).click();
          await page.getByRole("button", { name: "Use dark theme" }).click();
          await page.getByRole("button", { name: "Account menu" }).click();
        }
        for (const width of [1440, 1280, 900, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(150);
          expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
          expect((await page.locator('[data-testid="cop-map"]').boundingBox())!.width).toBeGreaterThan(width < 761 ? 260 : 450);
          if (width === 390) {
            expect(await page.locator("#eoc-shell-navigation").getAttribute("inert")).not.toBeNull();
            await page.getByRole("button", { name: "All sections" }).click();
            expect(await page.getByRole("button", { name: "Close sections" }).evaluate(isFocused)).toBe(true);
            await page.keyboard.press("Shift+Tab");
            expect(await page.getByRole("button", { name: "Templates", exact: true }).evaluate(isFocused)).toBe(true);
            await page.keyboard.press("Escape");
            expect(await page.getByRole("button", { name: "All sections" }).evaluate(isFocused)).toBe(true);
          }
          await page.getByRole("button", { name: "Open context" }).click();
          if (width < 1181) {
            expect(await page.locator("main").getAttribute("inert")).not.toBeNull();
            const drawer = page.getByRole("dialog", { name: "Context", exact: true });
            await page.keyboard.press("Tab");
            expect(await drawer.evaluate((node) => {
              const element = node as unknown as { contains(value: unknown): boolean; ownerDocument: { activeElement: unknown } };
              return element.contains(element.ownerDocument.activeElement);
            })).toBe(true);
            if (width === 390) expect(await page.getByRole("button", { name: "Close context drawer" }).evaluate(isFocused)).toBe(true);
          } else {
            const resize = page.getByRole("separator", { name: "Resize context drawer" });
            const priorWidth = Number(await resize.getAttribute("aria-valuenow"));
            await resize.focus();
            await page.keyboard.press("ArrowLeft");
            expect(Number(await resize.getAttribute("aria-valuenow"))).toBe(priorWidth + 16);
            await page.keyboard.press("Home");
            expect(await resize.getAttribute("aria-valuenow")).toBe("280");
          }
          await page.getByRole("button", { name: "Close context drawer" }).click();
          expect(await page.getByRole("button", { name: "Open context" }).evaluate(isFocused)).toBe(true);
          await page.screenshot({ path: join(SHOTS, `shell-frame-${theme}-${width}.png`) });
        }
      }
      await page.evaluate("window.location.hash = '#/unknown-workspace'");
      // Narrow routes keep the context drawer closed until explicitly opened.
      await page.getByRole("heading", { name: "Page not found", level: 2 }).waitFor();
      await page.getByRole("button", { name: "Open Map", exact: true }).click();
      await page.locator('[data-testid="cop-map"]').waitFor();
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally { await page.close(); }
  }, 90000);

  it("signs in and renders the map-first console and the dashboard", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => console.error("browser pageerror:", String(e).slice(0, 300)));
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
        return route.continue();
      }
      external.push(url);
      return route.abort();
    });

    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });

    // Sign in.
    await page.getByLabel("Email").fill("member@example.org");
    await page.getByLabel("Password").fill("another-good-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Console-only markers: the live COP, its controls and legend, the dock.
    await page.waitForSelector('[data-testid="cop-map"]', { timeout: 20000 });
    await page.waitForFunction("location.hash.includes('period=')");
    // The preceding frame journey intentionally persists a closed drawer and
    // dark theme. Set this journey's presentation through the actual controls.
    if (await page.getByRole("button", { name: "Open context", exact: true }).count()) {
      await page.getByRole("button", { name: "Open context", exact: true }).click();
    }
    await page.getByRole("button", { name: "Account menu" }).click();
    if (await page.getByRole("button", { name: "Use light theme" }).count()) {
      await page.getByRole("button", { name: "Use light theme" }).click();
    }
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.waitForSelector(".maplibregl-ctrl-zoom-in", { timeout: 20000 });
    await page.getByText("Status", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
    await page
      .getByRole("button", { name: /road closures/i })
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    // The external feed appears as its own togglable COP layer group.
    await page.getByText("Feeds", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByText("NWS Alerts").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, "app-map-light.png"), fullPage: false });

    // Open a board from the dock: its live view renders as a data table.
    await page.getByRole("button", { name: "Road Closures" }).first().click();
    await page.getByText("SR-169 at Pecwan").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "app-board-light.png"), fullPage: false });

    // The dashboard surface renders its widgets.
    await page.getByRole("button", { name: "Overview" }).click();
    await page.getByText("EOC Status").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByText("Closed roads").first().waitFor({ state: "visible", timeout: 20000 });
    await page
      .getByText("Emergency Support Functions")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, "app-dashboard-light.png"), fullPage: false });

    // The Forms surface previews an ICS form and assembles an IAP from the
    // live incident, all through the browser.
    await page.getByRole("button", { name: "ICS Forms", exact: true }).click();
    await page.getByRole("heading", { name: "ICS Forms and IAP Assembly" }).waitFor();
    await page.getByLabel("Operational period revision").selectOption("1");
    await page.getByRole("button", { name: "Preview selected form" }).click();
    await page.getByRole("region", { name: "Preview: ICS-201 Incident Briefing" }).waitFor();
    await page.getByRole("button", { name: "Assemble draft IAP" }).click();
    await page.getByRole("region", { name: "Assembled draft" }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "app-forms-light.png"), fullPage: false });

    // The IAP working list: the assembled plan shows as In Progress with a full
    // progress bar, then advances through submit and command approval. Status
    // assertions are scoped to the working list so they do not match the
    // always-present KPI count chips above it.
    await page.getByRole("button", { name: "Review draft in IAP workspace" }).click();
    await page.getByRole("heading", { name: "Incident Action Plans" }).waitFor();
    const iapList = page.getByRole("region", { name: "Plans", exact: true });
    await iapList.getByRole("button", { name: /Bald Hills OP 1.*In progress/i }).click();
    const iapDetail = page.getByRole("region", { name: "Plan detail", exact: true });
    await iapDetail.getByText("In progress", { exact: true }).waitFor();
    await iapDetail.getByRole("button", { name: "Download revision 1 PDF" }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "app-iap-light.png"), fullPage: false });
    // The member (a writer, not an admin) can submit the plan for approval;
    // approval and completion are admin-only and covered by the server tests.
    await iapDetail.getByRole("button", { name: "Submit for approval" }).click();
    await iapDetail.getByText("In approval", { exact: true }).waitFor();

    // Field capture: enter WGS84 coordinates with the keyboard and save them
    // as a road-closure record through the same point-capture seam.
    await page.getByRole("button", { name: "Map" }).click();
    await page.waitForSelector('[data-testid="cop-map"]', { timeout: 20000 });
    await page.getByRole("region", { name: "Common operating picture map" }).waitFor();

    // Map operator tools: the cursor/zoom readout, zoom-to-extent, home,
    // distance and area measure, find-on-map, and bookmarks.
    await page.waitForSelector('[data-testid="cop-readout"]', { timeout: 20000 });
    await page.getByText("Map tools and saved views", { exact: true }).click();
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Measure", exact: true }).click();
    await page.getByRole("button", { name: "Measuring…" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Measuring…" }).click();
    await page.getByRole("button", { name: "Measure", exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Measure area", exact: true }).click();
    await page.getByRole("button", { name: "Measuring area…" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Measuring area…" }).click();
    // Find a seeded road closure by its reason and a typed coordinate, and
    // jump to each.
    await page.getByLabel("Find on map").fill("Downed lines");
    await page.getByLabel("Find on map").press("Enter");
    await page.getByRole("button", { name: /Downed lines/ }).click();
    await page.getByLabel("Find on map").fill("41.3, -123.5");
    await page.getByLabel("Find on map").press("Enter");
    await page.getByRole("button", { name: /Go to 41.3000, -123.5000/ }).click();
    // Bookmark the view and confirm it lists.
    await page.getByLabel("Bookmark name").fill("Weitchpec");
    await page.getByRole("button", { name: "Save view" }).click();
    await page.getByRole("button", { name: "Weitchpec", exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(SHOTS, "app-map-tools.png"), fullPage: false });

    await page.getByRole("button", { name: "Add point" }).click();
    await page.getByLabel("Map record board").selectOption({ label: "Road Closures" });
    await page.getByLabel("Longitude").fill("-123.53");
    await page.getByLabel("Latitude").fill("41.31");
    await page.getByRole("button", { name: "Use coordinates" }).click();
    await page.getByText("New map record").waitFor({ state: "visible", timeout: 20000 });
    const recordPanel = page.getByRole("region", { name: "New map record" });
    await recordPanel.getByLabel("Road").fill("SR-96 at Weitchpec");
    await recordPanel.getByLabel("Reason").fill("Rockslide");
    await recordPanel.getByLabel("Status").selectOption("closed");
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, "app-map-add.png"), fullPage: false });
    await recordPanel.getByRole("button", { name: "Save record" }).click();
    await page.getByText("New map record").waitFor({ state: "hidden", timeout: 20000 });

    // A geotagged field report with a photo attachment, dropped on the map.
    await page.getByRole("button", { name: "Add point" }).click();
    await page.getByLabel("Map record board").selectOption({ label: "Field Reports" });
    await page
      .locator('[data-testid="cop-map"] canvas')
      .first()
      .click({ position: { x: 360, y: 340 } });
    const reportPanel = page.getByRole("region", { name: "New map record" });
    await reportPanel.getByLabel("Summary").fill("Culvert washout on Bald Hills Rd");
    await reportPanel.getByLabel("Category").selectOption("damage");
    await reportPanel.getByLabel("Photo").setInputFiles({
      name: "washout.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    await reportPanel.getByText("attached", { exact: false }).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, "app-map-photo.png"), fullPage: false });
    await reportPanel.getByRole("button", { name: "Save record" }).click();
    await page.getByText("New map record").waitFor({ state: "hidden", timeout: 20000 });

    // Files: upload a document and find it through platform search.
    await page.getByRole("button", { name: "Files" }).click();
    await page.getByRole("heading", { name: "Files", exact: true, level: 2 }).waitFor();
    await page.getByLabel("File", { exact: true }).setInputFiles({
      name: "sitrep-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Evacuation staging at the rodeo grounds."),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByText("Stored sitrep-note.txt as version 1.").waitFor();
    await page.getByLabel("Search records and files").fill("sitrep");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByText("sitrep-note.txt").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, "app-files-light.png"), fullPage: false });

    // Incidents: the activated incident is listed. Scope to the main content
    // so the match is the list entry, not the hidden incident-switcher option
    // that carries the same name in the command bar.
    await page.getByRole("button", { name: "Incident Setup" }).click();
    await page
      .getByRole("main")
      .getByText("Bald Hills Fire", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    // Resource requests (213RR): submit one and advance its lifecycle state.
    await page.getByRole("button", { name: "Resources" }).click();
    await page.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await page.getByLabel("Requested item").fill("Sandbags, 500 ct");
    await page.getByRole("button", { name: "Submit request" }).click();
    await page.getByText("Sandbags, 500 ct").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Next state for Sandbags, 500 ct").selectOption("triaged");
    await page.getByRole("button", { name: "Advance" }).first().click();
    // The row's state badge flips to "triaged" (the first allowed transition).
    await page.getByText("triaged", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });

    // After-action review: record an observation against a Core Capability.
    await page.getByRole("button", { name: "AAR" }).click();
    await page.getByRole("heading", { name: "After-action review" }).waitFor();
    const obsPanel = page.getByRole("form", { name: "Record an observation" });
    await obsPanel.getByLabel("Core capability").selectOption("mass_care_services");
    await obsPanel.getByLabel("Capability element").selectOption("training");
    await page.getByLabel("Observation", { exact: true }).fill("Shelter stood up within two hours.");
    await obsPanel.getByRole("button", { name: "Record observation" }).click();
    await page
      .getByText("Shelter stood up within two hours.")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    // The observation renders the capability's proper label (scoped to the
    // Observations list so it does not match the select's hidden <option>).
    await page
      .locator("[data-record-id]").filter({ hasText: "Shelter stood up within two hours." })
      .getByText("Mass Care Services")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    // A corrective action in the improvement plan, against a Core Capability.
    const caPanel = page.getByRole("form", { name: "Create a corrective action" });
    await caPanel.getByLabel("Action capability").selectOption("operational_communications");
    await caPanel.getByLabel("Action element").selectOption("equipment");
    await caPanel.getByLabel("Corrective action", { exact: true }).fill("Add a backup repeater at the EOC.");
    await caPanel.getByRole("button", { name: "Create corrective action" }).click();
    await page
      .getByText("Add a backup repeater at the EOC.")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    // Feeds: the seeded push feed is listed on the Feeds admin screen.
    await page.getByRole("button", { name: "Feeds" }).click();
    await page.getByRole("heading", { name: "Feeds", exact: true, level: 2 }).waitFor();
    await page.getByText("NWS Alerts").first().waitFor({ state: "visible", timeout: 20000 });

    // Smart Forms: render an imported XLSForm and submit it to a board.
    await page.getByRole("button", { name: "Smart Forms" }).click();
    await page.getByRole("heading", { name: "Rapid Needs Survey" }).waitFor({ state: "visible", timeout: 20000 });
    const fieldForm = page.getByRole("form", { name: "Field report form" });
    await fieldForm.getByLabel("Summary *").fill("Two homes flooded on the flat");
    await fieldForm.getByLabel("Category").selectOption("damage");
    await fieldForm.getByRole("button", { name: "Queue field report" }).click();
    await page.getByText("Report synchronized with retained server attribution.").waitFor();

    // Tracking & Reunification: register an object and find it by name.
    await page.getByRole("button", { name: "Tracking" }).click();
    await page.getByRole("tab", { name: "Register", exact: true }).click();
    await page.getByLabel("Field-safe label", { exact: true }).fill("Jane Doe");
    await page.getByRole("button", { name: "Register tracked object" }).click();
    await page.getByText(/Registered .*Continue with the first custody handoff/).waitFor();
    await page.getByRole("tab", { name: "Find & reunify" }).click();
    await page.getByLabel("Name, field-safe label, or #tag").fill("Jane");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByText("Jane Doe").first().waitFor({ state: "visible", timeout: 20000 });

    // Messages: start a position-addressed thread and post to it.
    await page.getByRole("button", { name: "Messages" }).click();
    await page.getByText("New thread").waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Thread title", { exact: true }).fill("Ops coordination");
    await page.getByRole("button", { name: "Start thread" }).click();
    await page.getByText("Ops coordination").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Message", { exact: true }).fill("Staging established at rodeo grounds.");
    await page.getByRole("button", { name: "Send" }).click();
    await page
      .getByText("Staging established at rodeo grounds.")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    // Gallery: every side tab, in light and then in dark (the night-shift EOC).
    // This is the visual sample set; content is proven by the assertions above.
    const TABS: ReadonlyArray<readonly [string, string]> = [
      ["Map", "map"],
      ["Overview", "dashboard"],
      ["Incident Setup", "incidents"],
      ["Boards", "boards"],
      ["SITREP", "sitreps"],
      ["ICS Forms", "forms"],
      ["IAP", "iap"],
      ["Smart Forms", "smartforms"],
      ["Resources", "resources"],
      ["Tracking", "tracking"],
      ["AAR", "aar"],
      ["Feeds", "feeds"],
      ["Messages", "messages"],
      ["Files", "files"],
      ["Notifications", "alerts"],
    ];
    const gallery = async (theme: string) => {
      for (const [label, key] of TABS) {
        if (label === "Notifications") {
          await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
          await page.getByRole("button", { name: "Open center" }).click();
        } else {
          await page.getByRole("button", { name: label, exact: true }).click();
        }
        await page.waitForTimeout(label === "Map" ? 1600 : 800);
        await page.screenshot({ path: join(SHOTS, `tab-${key}-${theme}.png`), fullPage: false });
      }
    };
    await gallery("light");
    // Theme remains an account control in the command bar.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.waitForTimeout(500);
    await gallery("dark");

    expect(external).toEqual([]);
    await page.close();
  }, 180000);

  it("records incident areas through the map and keeps another incident separate", async () => {
    const activate = async (name: string) => {
      const response = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
        headers: { authorization: `Bearer ${adminToken}` }, payload: { templateKey: "daily_ops", name } });
      expect(response.statusCode).toBe(201); return response.json().incidentId as string;
    };
    const first = await activate("Area proof Alpha"), second = await activate("Area proof Bravo");
    const page = await browser.newPage({ viewport: { width: 1600, height: 1800 } });
    const errors: string[] = [], external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url); return route.abort();
    });
    try {
      await page.goto(`${baseUrl}/app/index.html`);
      await page.getByLabel("Email").fill("admin@example.org");
      await page.getByLabel("Password").fill("correct-horse-battery");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("button", { name: "Incident Setup", exact: true }).click();
      const openArea = async (name: string) => {
        await page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Operational area" }).click();
        return page.getByRole("region", { name: name + ": operational area", exact: true });
      };
      const area = await openArea("Area proof Alpha");
      await area.getByRole("button", { name: "Draw replacement boundary" }).click();
      const canvas = area.locator(".maplibregl-canvas");
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      for (const [x, y] of [[0.35, 0.3], [0.7, 0.3], [0.7, 0.65]])
        await canvas.click({ position: { x: box!.width * x!, y: box!.height * y! } });
      await area.getByRole("button", { name: "Close boundary" }).click();
      await area.getByLabel("Operational period", { exact: true }).fill("OP 1");
      await area.getByLabel("Period starts").fill("2026-09-20T08:00");
      await area.getByLabel("Period ends").fill("2026-09-20T20:00");
      await area.getByLabel("Reason for revision").fill("Initial operational area");
      await area.getByRole("button", { name: "Save area revision" }).click();
      await area.getByText(/^Revision 1\./).waitFor();
      await area.screenshot({ path: join(SHOTS, "incident-area-light.png") });
      const polygon = [[[-122, 38], [-121.8, 38], [-121.8, 38.2], [-122, 38]]];
      const multi = { type: "MultiPolygon", coordinates: [polygon,
        [[[-121.7, 38.3], [-121.5, 38.3], [-121.5, 38.5], [-121.7, 38.3]]]] };
      await area.getByLabel("Import operational area").setInputFiles({ name: "area.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(multi)) });
      await area.getByText(/Imported area: area.geojson/).waitFor();
      await area.getByLabel("Reason for revision").fill("Separate response areas confirmed");
      await area.getByRole("button", { name: "Save area revision" }).click();
      await area.getByText(/^Revision 2\./).waitFor();
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
      await area.locator(".maplibregl-canvas").waitFor();
      await area.screenshot({ path: join(SHOTS, "incident-area-dark.png") });
      await area.getByRole("button", { name: "View revision 1" }).click();
      await area.getByText(/Viewing revision 1/).waitFor();
      expect(await area.getByRole("button", { name: "Save area revision" }).count()).toBe(0);
      await area.getByRole("button", { name: "Return to current draft" }).click();
      const partnerOrganization = await createJurisdiction(admin, "area-partner", "Valley Mutual Aid");
      const partnerPerson = await createPerson(admin, { email: "area-partner@example.org", displayName: "Partner Operator", password: "partner-proof-password" });
      await addMembership(admin, partnerPerson, partnerOrganization, "member");
      await page.locator("li").filter({ hasText: "Area proof Alpha" }).getByRole("button", { name: "Participants", exact: true }).click();
      const participants = page.getByRole("region", { name: "Area proof Alpha: participants", exact: true });
      await participants.getByLabel("Organization code").fill("area-partner");
      await participants.getByLabel("Participant email").fill("area-partner@example.org");
      await participants.getByLabel("Incident position", { exact: true }).fill("Mutual Aid Liaison");
      await participants.getByLabel("Incident role", { exact: true }).selectOption("coordinator");
      await participants.getByLabel("Participation expires").fill("2099-09-20T20:00");
      await participants.getByLabel("Participation reason").fill("Mutual aid coordination requested");
      await participants.getByRole("button", { name: "Add participant", exact: true }).click();
      await participants.getByText("Participant added to this incident.", { exact: true }).waitFor();
      await participants.getByText("Partner Operator", { exact: true }).waitFor();
      const partnerToken = await login(app, "area-partner@example.org", "partner-proof-password");
      const partnerRead = (id: string) => app.inject({ method: "GET", url: "/api/v1/incidents/" + id + "/operational-area", headers: { authorization: "Bearer " + partnerToken } });
      expect((await partnerRead(first)).statusCode).toBe(200);
      expect((await partnerRead(second)).statusCode).toBe(404);
      await participants.screenshot({ path: join(SHOTS, "incident-participants-dark.png") });
      await participants.getByRole("button", { name: "End participation for Partner Operator", exact: true }).click();
      await participants.getByLabel("Reason for ending participation").fill("Mutual aid demobilized");
      await participants.getByRole("button", { name: "End participation", exact: true }).click();
      await participants.getByText("Participation ended. Incident access has been revoked.", { exact: true }).waitFor();
      expect((await partnerRead(first)).statusCode).toBe(404);
      const other = await openArea("Area proof Bravo");
      await other.getByText(/^Revision 0\./).waitFor();
      expect(await other.getByLabel("Operational period", { exact: true }).inputValue()).toBe("");
      expect(await other.getByLabel("Reason for revision").inputValue()).toBe("");
      const read = async (id: string) => (await app.inject({ method: "GET", url: `/api/v1/incidents/${id}/operational-area`, headers: { authorization: `Bearer ${adminToken}` } })).json();
      expect((await read(first)).geometry).toEqual(multi);
      expect((await read(first)).operationalPeriod.label).toBe("OP 1");
      expect((await read(second)).geometry).toBeNull();
      expect(errors).toEqual([]); expect(external).toEqual([]);
    } finally { await page.close(); }
  }, 90000);

  it("restores scoped workspace context, periods and positions through reload and Back", async () => {
    const call = (token: string, method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    const activate = async (name: string) => {
      const response = await call(adminToken, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "wildfire", name });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().incidentId as string;
    };
    const first = await activate("Context Alpha"), second = await activate("Context Bravo");
    for (const [incidentId, labels] of [[first, ["Alpha day", "Alpha night"]], [second, ["Bravo day"]]] as const) {
      for (const [index, label] of labels.entries()) {
        const response = await call(adminToken, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
          expectedRevision: index, geometry: null, reason: "Synthetic context proof",
          operationalPeriod: { label, startsAt: `2026-09-${21 + index}T08:00:00-07:00`, endsAt: `2026-09-${21 + index}T20:00:00-07:00` },
        });
        expect(response.statusCode, response.body).toBe(200);
      }
    }
    const detail = (await call(adminToken, "GET", `/api/v1/incidents/${first}`)).json();
    const positionId = detail.positions[0].id as string;
    const unassignedId = detail.positions[1].id as string;
    expect((await call(adminToken, "POST", `/api/v1/positions/${positionId}/assignments`, { personId: seed.memberId })).statusCode).toBe(201);
    const boardId = await createBoard("road_closures");
    await admin`insert into incident_boards (incident_id, board_id) values (${first}, ${boardId}), (${second}, ${boardId})`;
    const record = async (incidentId: string, road: string) => {
      const response = await call(memberToken, "POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, { road, status: "closed", reason: "Context proof" });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().id as string;
    };
    const firstRecord = await record(first, "Context Alpha road"), secondRecord = await record(second, "Context Bravo road");
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = [], external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url); return route.abort();
    });
    const saved = (kind: string, key: string, incidentId = first, token = memberToken) =>
      call(token, "GET", `/api/v1/incidents/${incidentId}/saved-state/${kind}/${key}`);
    const afterSave = () => page.waitForResponse((response) => response.request().method() === "PUT"
      && response.url().includes("/saved-state/") && response.status() === 200);
    try {
      await page.goto(`${baseUrl}/app/index.html#/?incident=${first}&period=1`);
      await page.getByLabel("Email").fill("member@example.org");
      await page.getByLabel("Password").fill("another-good-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("option", { name: "Alpha night", exact: true }).waitFor({ state: "attached" });
      expect(await page.getByLabel("Operational period", { exact: true }).inputValue()).toBe("1");
      let save = afterSave();
      await page.getByLabel("Operational period", { exact: true }).selectOption("2"); await save;
      await page.goBack();
      await page.waitForFunction("document.querySelector('select[aria-label=\"Operational period\"]')?.value === '1'");
      save = afterSave();
      await page.getByLabel("Operational period", { exact: true }).selectOption("2"); await save;
      save = afterSave();
      await page.getByRole("button", { name: "Compact navigation", exact: true }).click(); await save;
      const resize = page.getByRole("separator", { name: "Resize context drawer" });
      save = afterSave(); await resize.focus(); await page.keyboard.press("End"); await save;
      expect((await saved("workspace_layout", "map")).json().state.payload).toMatchObject({ drawerWidth: 520, compactNavigation: true });
      expect((await saved("workspace_layout", "map", second)).statusCode).toBe(404);
      expect((await saved("workspace_layout", "map", first, adminToken)).statusCode).toBe(404);
      await page.screenshot({ path: join(SHOTS, "shell-context-light.png") });
      await page.getByRole("button", { name: "Account menu" }).click(); save = afterSave();
      await page.getByRole("button", { name: "Use dark theme" }).click(); await save;
      await page.getByRole("button", { name: "Account menu" }).click();
      const positionRefresh = page.waitForResponse((response) => response.url().endsWith("/api/v1/me") && response.status() === 200);
      await page.getByLabel("Acting position", { exact: true }).selectOption(positionId);
      await positionRefresh;
      expect((await call(memberToken, "POST", `/api/v1/positions/${unassignedId}/sign-in`, {})).statusCode).toBe(403);
      await page.reload();
      await page.getByRole("button", { name: "Expand navigation", exact: true }).waitFor();
      expect(await page.getByLabel("Operational period", { exact: true }).inputValue()).toBe("2");
      expect(await page.getByLabel("Acting position", { exact: true }).inputValue()).toBe(positionId);
      expect(await page.locator("[data-theme]").getAttribute("data-theme")).toBe("dark");
      expect(await resize.getAttribute("aria-valuenow")).toBe("520");
      const oldState = (await saved("workspace_layout", "map")).json().state;
      expect((await call(memberToken, "PUT", `/api/v1/incidents/${first}/saved-state/workspace_layout/map`, {
        schemaVersion: 1, expectedRevision: oldState.revision, payload: { ...oldState.payload, drawerWidth: 300 },
      })).statusCode).toBe(200);
      await resize.focus(); await page.keyboard.press("Home");
      await page.getByRole("button", { name: "Keep this session", exact: true }).waitFor();
      save = afterSave(); await page.getByRole("button", { name: "Keep this session", exact: true }).click(); await save;
      expect((await saved("workspace_layout", "map")).json().state.payload.drawerWidth).toBe(280);
      await page.screenshot({ path: join(SHOTS, "shell-context-dark.png") });
      await page.evaluate((hash) => { (globalThis as unknown as { location: { hash: string } }).location.hash = hash; }, `#/board/${boardId}?incident=${first}&period=2&record=${firstRecord}&return=${encodeURIComponent(`#/?incident=${first}&period=2`)}`);
      const selected = page.getByRole("region", { name: "Selected record", exact: true });
      await selected.getByText("Context Alpha road", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Return to previous workspace" }).click();
      await page.locator('[data-testid="cop-map"]').waitFor();
      await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?incident=${first}&period=2&record=${secondRecord}`);
      await selected.getByText("Record unavailable in this view", { exact: true }).waitFor();
      expect(await selected.getByText("Context Bravo road").count()).toBe(0);
      await page.getByLabel("Selected incident").selectOption(second);
      await page.getByRole("option", { name: "Bravo day", exact: true }).waitFor({ state: "attached" });
      expect(new URL(page.url()).hash).not.toContain("record=");
      expect(await page.getByLabel("Operational period", { exact: true }).inputValue()).toBe("");
      expect(await selected.count()).toBe(0);
      await page.getByLabel("Selected incident").selectOption(first);
      await page.getByRole("option", { name: "Alpha night", exact: true }).waitFor({ state: "attached" });
      expect(await page.getByLabel("Operational period", { exact: true }).inputValue()).toBe("2");
      expect(errors).toEqual([]); expect(external).toEqual([]);
    } finally { await page.close(); }
  }, 150000);
});
