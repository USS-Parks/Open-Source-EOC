import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * One walk through screens for engines that had none: standing lifeline
 * status, dashboard creation and template export, checklist completion in
 * incident setup, thread export and the damage parcel baseline import.
 */

const DIST = buildDir("operator-screens");
const SHOTS = shotDir("operator-screens");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let incidentId: string;
let commanderId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await ensureStandardDashboards(admin);
  await admin`
    insert into incident_templates (key, title, definition)
    values ('screens_walk', 'Screens walk', ${admin.json({
      key: "screens_walk", title: "Screens walk", positions: ["incident_commander"], boards: [],
      checklists: [{ position: "incident_commander", items: ["Confirm shelter capacity"] }],
    } as never)})`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey: "lifelines" });
  incidentId = (await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "screens_walk", name: "Screens walk incident" })).incidentId as string;
  const [position] = await admin`
    select p.id from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId} and p.key = 'incident_commander'`;
  commanderId = position!.id as string;
  await post(app, token, `/api/v1/positions/${commanderId}/assignments`, { personId: seed.adminId });
  const thread = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/threads`, {
    kind: "group", title: "Shelter coordination", incidentId, members: [{ kind: "position", id: commanderId }],
  });
  const message = await app.inject({ method: "POST", url: `/api/v1/threads/${thread.id as string}/messages`,
    headers: auth(token), payload: { body: "High school gym opens at 1800." } });
  expect(message.statusCode, message.body).toBe(201);

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
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

async function downloaded(click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const download = page.waitForEvent("download");
  await click();
  const file = await download;
  return { name: file.suggestedFilename(), text: readFileSync((await file.path())!, "utf8") };
}

describe("screens for existing engines", () => {
  it("records standing lifeline status, creates a dashboard, completes a checklist item, exports a thread and imports a baseline", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    const selectedIncident = page.getByLabel("Selected incident", { exact: true });
    await selectedIncident.locator(`option[value="${incidentId}"]`).waitFor({ state: "attached" });
    await selectedIncident.selectOption(incidentId);
    const acting = page.getByLabel("Acting position", { exact: true });
    await acting.locator(`option[value="${commanderId}"]`).waitFor({ state: "attached" });
    const positionRefresh = page.waitForResponse((response) => response.url().endsWith("/api/v1/me") && response.status() === 200);
    await acting.selectOption(commanderId);
    await positionRefresh;

    // Standing lifeline status, outside the incident's assessments.
    await page.getByRole("button", { name: "ESFs & Lifelines", exact: true }).click();
    const standing = page.getByRole("list", { name: "Standing lifeline status" });
    await standing.waitFor();
    await page.getByLabel("Lifeline", { exact: true }).selectOption("energy");
    await page.getByLabel("Standing status", { exact: true }).selectOption("unstable");
    await page.getByLabel("Status note", { exact: true }).fill("Substation 4 offline");
    await page.getByRole("button", { name: "Record status" }).click();
    await page.getByText("Energy recorded as unstable.").waitFor();
    await standing.getByRole("listitem", { name: "Energy" }).getByText("Substation 4 offline").waitFor();
    const [lifeline] = await admin`
      select r.data from board_records r join boards b on b.id = r.board_id
      where b.jurisdiction_id = ${jurisdictionId} and b.template_key = 'lifelines'`;
    expect(lifeline!.data).toMatchObject({ lifeline: "energy", status: "unstable", note: "Substation 4 offline" });
    await standing.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "standing-lifelines-light-1440.png") });

    // A dashboard from a published template, then its template exported.
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByLabel("Dashboard template key").fill("eoc_status");
    await page.getByRole("button", { name: "Create dashboard" }).click();
    await page.getByText("Dashboard created from template eoc_status.").waitFor();
    const created = page.getByRole("listitem", { name: "EOC Status" });
    await created.getByText("Template eoc_status · version 1").waitFor();
    expect((await admin`select template_key, template_version from dashboards where jurisdiction_id = ${jurisdictionId}`))
      .toEqual([{ template_key: "eoc_status", template_version: 1 }]);
    const template = await downloaded(() => created.getByRole("button", { name: "Export template for EOC Status" }).click());
    expect(template.name).toBe("eoc_status-v1.json");
    expect(JSON.parse(template.text)).toMatchObject({ key: "eoc_status", version: 1, title: "EOC Status" });
    await created.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "dashboard-definitions-light-1440.png") });

    // The signed-in commander completes their checklist item in incident setup.
    await page.getByRole("button", { name: "Incident Setup", exact: true }).click();
    await page.locator("li").filter({ hasText: "Screens walk incident" }).getByRole("button", { name: "Operational area" }).click();
    const item = page.getByRole("listitem", { name: "Confirm shelter capacity" });
    await item.getByRole("button", { name: "Mark complete" }).click();
    await page.getByText("Confirm shelter capacity completed.").waitFor();
    await item.getByText("Completed by Incident Commander").waitFor();
    const [checklist] = await admin`select status, completed_by_position from checklist_items where incident_id = ${incidentId}`;
    expect(checklist).toEqual({ status: "completed", completed_by_position: commanderId });
    await item.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "incident-checklist-light-1440.png") });

    // The thread exports as text, one line per message.
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await page.getByRole("button", { name: /Shelter coordination/ }).click();
    await page.getByText("High school gym opens at 1800.", { exact: true }).waitFor();
    const thread = await downloaded(() => page.getByRole("button", { name: "Export thread" }).click());
    expect(thread.name).toBe("shelter-coordination.txt");
    expect(thread.text).toMatch(/^\S+ Admin: High school gym opens at 1800\.\n$/);
    await page.getByText("Thread exported with 1 message.").waitFor();

    // The parcel baseline imports from CSV.
    await page.getByRole("button", { name: "Damage Assessment", exact: true }).click();
    await page.getByLabel("Baseline file (CSV or JSON)").setInputFiles({
      name: "parcels.csv", mimeType: "text/csv",
      buffer: Buffer.from("parcelId,address,structureType,replacementValue,lon,lat\n"
        + "P-100,\"12 Main St, Klamath\",single_family,250000,-124.03,41.52\nP-101,40 Pine Rd,mobile_home,90000,,\n"),
    });
    await page.getByRole("button", { name: "Import baseline" }).click();
    await page.getByText("2 parcels imported into the baseline.").waitFor();
    const parcels = await admin`
      select parcel_id, address, replacement_value::float8 as value, geom is not null as located
      from damage_baselines where jurisdiction_id = ${jurisdictionId} order by parcel_id`;
    expect(parcels).toEqual([
      { parcel_id: "P-100", address: "12 Main St, Klamath", value: 250000, located: true },
      { parcel_id: "P-101", address: "40 Pine Rd", value: 90000, located: false },
    ]);
    await page.getByRole("button", { name: "Import baseline" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "damage-baseline-light-1440.png") });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
