import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("d29-field-app");
const SHOTS = shotDir("d29-field");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let incidentId: string;
let boardId: string;
let actorId: string;
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
  actorId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  // This walk registers a tracked object, so the harness enables the optional
  // integrations explicitly. A default deployment registers neither.
  app = buildApp(runtime, { oidc: null, integrations: ["tracking", "facilities"] });
  serveStatic(app, "/d29-app", DIST);
  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "D29 Field Operations Exercise",
  });
  incidentId = incident.incidentId as string;
  const board = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/boards`, {
    templateKey: "field_reports", title: "Field Reports",
  });
  boardId = board.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/forms`, {
    key: "rapid_field_report", version: 1, title: "Rapid field report", boardTemplate: "field_reports",
    nodes: [
      { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
      { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
        choices: [{ name: "hazard", label: "Hazard" }, { name: "damage", label: "Damage" },
          { name: "resource", label: "Resource" }, { name: "other", label: "Other" }] },
      { kind: "field", name: "photo", type: "image", label: "Photo" },
      { kind: "field", name: "location", type: "geopoint", label: "Location" },
    ],
  });

  baseUrl = await listen(app);
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
  await page.goto(`${baseUrl}/d29-app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
  await page.getByRole("heading", { name: "Record once, synchronize with attribution" }).waitFor();
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("field reporting and tracking workspace", () => {
  it("captures attachments, survives an offline queue, reuses map placement, and retains custody attribution", async () => {
    const workspace = page.getByRole("region", { name: "Field report capture" });
    const form = workspace.getByRole("form", { name: "Field report form" });
    await form.getByLabel("Summary *").fill("Utility pole leaning over the evacuation route");
    await form.getByLabel("Category *").selectOption("hazard");
    await form.getByLabel("Latitude and longitude").fill("40.802 -124.163");
    await form.getByLabel("Photo").setInputFiles({
      name: "field-photo.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl9sAAAAASUVORK5CYII=", "base64"),
    });
    await form.getByText("Attached: field-photo.png. It uploads after the report synchronizes.").waitFor();
    await form.getByRole("button", { name: "Queue field report" }).click();
    await workspace.getByText("Report synchronized with retained server attribution.").waitFor();

    await page.context().setOffline(true);
    await workspace.getByText("Offline capture").waitFor();
    await form.getByLabel("Summary *").fill("Washout blocks the secondary access road");
    await form.getByLabel("Category *").selectOption("damage");
    await form.getByLabel("Latitude and longitude").fill("40.806 -124.171");
    await form.getByRole("button", { name: "Queue field report" }).click();
    await workspace.getByText(/1 field submission queued on this device/).waitFor();
    await expect(workspace.getByRole("button", { name: "Sync 1 queued" }).isDisabled()).resolves.toBe(true);

    const beforeReconnect = await admin`
      select id from board_records where board_id = ${boardId} and incident_id = ${incidentId}`;
    expect(beforeReconnect).toHaveLength(1);
    await page.context().setOffline(false);
    await workspace.getByRole("button", { name: "Sync 1 queued" }).click();
    await workspace.getByText(/All field submissions synchronized at receipt/).waitFor();

    const reports = await admin`
      select id, incident_id, data, created_by, st_astext(geom) as point
      from board_records where board_id = ${boardId} and incident_id = ${incidentId}
      order by created_at`;
    expect(reports).toHaveLength(2);
    expect(reports.every((row) => row.created_by === actorId)).toBe(true);
    expect(reports.map((row) => (row.data as { summary: string }).summary)).toEqual([
      "Utility pole leaning over the evacuation route", "Washout blocks the secondary access road",
    ]);
    expect(reports[0]!.point).toContain("POINT");
    expect(typeof (reports[0]!.data as { photo?: unknown }).photo).toBe("string");
    const syncAudits = await admin`
      select id from audit_events where category = 'board.record.created'
        and subject_id in (${reports[0]!.id}, ${reports[1]!.id})
        and payload ->> 'via' = 'sync'`;
    expect(syncAudits).toHaveLength(2);
    await page.screenshot({ path: join(SHOTS, "d29-smartforms-light-1440.png"), fullPage: false });

    await workspace.getByRole("button", { name: "Open map capture" }).click();
    await page.getByRole("button", { name: "Add point" }).click();
    await page.getByLabel("Map record board").selectOption(boardId);
    await page.getByLabel("Longitude").fill("-124.18");
    await page.getByLabel("Latitude").fill("40.81");
    await page.getByRole("button", { name: "Use coordinates" }).click();
    await page.getByText("New map record").waitFor();
    await page.getByLabel("Summary").fill("Map-placed staging observation");
    await page.getByLabel("Category").selectOption("resource");
    await page.getByRole("button", { name: "Save record" }).click();
    await page.getByText("New map record").waitFor({ state: "hidden" });
    const [mapPlaced] = await admin`
      select incident_id, st_x(geom) as longitude, st_y(geom) as latitude
      from board_records where board_id = ${boardId}
        and data ->> 'summary' = 'Map-placed staging observation'`;
    expect(mapPlaced!.incident_id).toBe(incidentId);
    expect(Number(mapPlaced!.longitude)).toBeCloseTo(-124.18);
    expect(Number(mapPlaced!.latitude)).toBeCloseTo(40.81);

    await page.getByRole("button", { name: "Tracking", exact: true }).click();
    const tracking = page.getByRole("region", { name: "Tracking and reunification" });
    await tracking.getByRole("tab", { name: "Register" }).click();
    await tracking.getByLabel("Tracked kind").selectOption("evacuee");
    await tracking.getByLabel("Field-safe label").fill("Family group 12");
    await tracking.getByLabel("Initial station").fill("North shelter intake");
    await tracking.getByLabel("Agency").fill("County Mass Care");
    await tracking.getByRole("button", { name: "Register tracked object" }).click();
    const registration = tracking.getByText(/Registered TRK-[A-Z0-9]+/);
    await registration.waitFor();
    const tag = (await registration.textContent())!.match(/TRK-[A-Z0-9]+/)![0];
    await tracking.getByLabel("Custody state").selectOption("transferred");
    await tracking.getByLabel("Agency").fill("County Transit");
    await tracking.getByLabel("Location").fill("South reception center");
    await tracking.getByLabel("Handoff note").fill("Bus 14 receipt confirmed");
    await tracking.getByRole("button", { name: "Record custody handoff" }).click();
    await tracking.getByText(`Custody receipt recorded for ${tag}: Transferred.`).waitFor();

    const [tracked] = await admin`select id, created_by, restricted from tracked_objects where tag = ${tag}`;
    expect(tracked!.created_by).toBe(actorId);
    expect(tracked!.restricted).toEqual({});
    const chain = await admin`
      select custody_state, recorded_by from tracking_events where object_id = ${tracked!.id} order by created_at`;
    expect(chain.map((row) => row.custody_state)).toEqual(["registered", "transferred"]);
    expect(chain.every((row) => row.recorded_by === actorId)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d29-tracking-light-1440.png"), fullPage: false });

    await useDarkTheme();
    await page.screenshot({ path: join(SHOTS, "d29-tracking-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await tracking.getByRole("tab", { name: "Find & reunify" }).click();
    await tracking.getByLabel("Name, field-safe label, or #tag").fill(`#${tag}`);
    const search = tracking.getByRole("button", { name: "Search" });
    await search.focus();
    await page.keyboard.press("Enter");
    await tracking.getByText("Family group 12").waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d29-tracking-narrow-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
