import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";
import { FIELD_SURVEY, FIELD_SURVEY_TEMPLATE, xlsFormWorkbook } from "./xlsform-workbook.js";

const DIST = buildDir("field-depth-app");
const SHOTS = shotDir("field-depth");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl9sAAAAASUVORK5CYII=", "base64");
const WAV = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([44, 0, 0, 0]), Buffer.from("WAVEfmt ", "ascii"),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0]), Buffer.from("data", "ascii"),
  Buffer.from([8, 0, 0, 0, 128, 128, 128, 128, 128, 128, 128, 128])]);

/** For each search box, whether its icon lies inside its input, left of where the typed text starts. */
function searchIconsInInputs(boxes: unknown[]): boolean[] {
  type Box = { left: number; right: number; top: number; bottom: number };
  type Found = { getBoundingClientRect(): Box };
  const view = globalThis as unknown as { getComputedStyle(element: Found): { paddingLeft: string } };
  return boxes.map((box) => {
    const scope = box as { querySelector(selector: string): Found };
    const input = scope.querySelector("input");
    const [icon, field] = [scope.querySelector("svg").getBoundingClientRect(), input.getBoundingClientRect()];
    return icon.top >= field.top && icon.bottom <= field.bottom && icon.left >= field.left
      && icon.right <= field.left + parseFloat(view.getComputedStyle(input).paddingLeft);
  });
}

/** Tap the open capture map at fractions of its width and height, waiting for each point to register. */
async function tapMap(group: Locator, spots: ReadonlyArray<readonly [number, number]>): Promise<void> {
  const canvas = group.locator('[data-testid="cop-map"] canvas');
  await canvas.waitFor({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  for (const [index, [x, y]] of spots.entries()) {
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await group.getByText(`${index + 1} point${index === 0 ? "" : "s"} placed`).waitFor();
  }
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/field-depth-app", DIST);
  const token = await login(app);
  await post(app, token, "/api/v1/templates", FIELD_SURVEY_TEMPLATE);
  const incident = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "Culvert Failure Survey",
  });
  incidentId = incident.incidentId as string;
  const board = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: FIELD_SURVEY_TEMPLATE.key, title: "Field Survey Reports",
  });
  boardId = board.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;

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
  await page.goto(`${baseUrl}/field-depth-app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}, 180_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("field depth in the smart form runner", () => {
  it("imports an XLSForm with every field depth type, captures it online and offline, and attaches the files", async () => {
    // The designer imports the workbook; its file name is the form key.
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByRole("button", { name: "Create template" }).click();
    await page.getByRole("tab", { name: "Import" }).click();
    await page.getByLabel("Form file").setInputFiles({
      name: "field_survey.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsFormWorkbook(FIELD_SURVEY),
    });
    await page.getByRole("list", { name: "Imported definitions" }).getByText("Form field_survey, version 1").waitFor();

    await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Field report capture" });
    await workspace.getByLabel("Your organization's form").selectOption({ label: "Field damage survey" });
    await workspace.getByLabel("Incident board").selectOption({ label: "Field Survey Reports" });
    const form = workspace.getByRole("form", { name: "Field report form" });
    await form.getByLabel(/^Summary/).fill("Culvert failure on Old Arcata Road");

    // Cascading select: the town list follows the county.
    await form.getByLabel(/^County/).selectOption("del_norte");
    expect(await form.getByLabel(/^Town/).locator("option").allTextContents()).toEqual(["Choose an option", "Klamath", "Crescent City"]);
    await form.getByLabel(/^County/).selectOption("humboldt");
    expect(await form.getByLabel(/^Town/).locator("option").allTextContents()).toEqual(["Choose an option", "Eureka", "Arcata"]);
    await form.getByLabel(/^Town/).selectOption("arcata");

    // A line of three taps, then a polygon of three taps closed on its first point.
    const line = form.getByRole("group", { name: "Road segment" });
    await line.getByRole("button", { name: "Draw on map" }).click();
    await tapMap(line, [[0.35, 0.4], [0.5, 0.5], [0.65, 0.45]]);
    await line.getByRole("button", { name: "Stop drawing" }).click();
    const area = form.getByRole("group", { name: "Affected area" });
    await area.getByRole("button", { name: "Draw on map" }).click();
    await tapMap(area, [[0.4, 0.35], [0.6, 0.35], [0.5, 0.6]]);
    await area.getByRole("button", { name: "Close polygon" }).click();
    await area.getByText(/4 points placed, polygon closed/).waitFor();
    // The form's narrow map keeps its search icons inside their inputs.
    expect(await area.locator(".eoc-cop-filter, .eoc-cop-find").evaluateAll(searchIconsInInputs)).toEqual([true, true]);
    await page.screenshot({ path: join(SHOTS, "field-depth-polygon-light-1440.png"), fullPage: false });
    await area.getByRole("button", { name: "Stop drawing" }).click();

    await form.getByLabel("Asset tag", { exact: true }).fill("CUL-0042");
    await form.getByLabel("Photo", { exact: true }).setInputFiles({ name: "culvert.png", mimeType: "image/png", buffer: PNG });
    await form.getByLabel("Voice note", { exact: true }).setInputFiles({ name: "voice-note.wav", mimeType: "audio/wav", buffer: WAV });
    await form.getByText("Attached: voice-note.wav. It uploads after the report synchronizes.").waitFor();
    const crews = form.getByRole("group", { name: "Crew", exact: true });
    await crews.getByRole("button", { name: "Add Crew" }).click();
    await crews.getByRole("button", { name: "Add Crew" }).click();
    for (const [index, [name, size]] of [["Engine 12", "4"], ["Dozer 3", "2"]].entries()) {
      const entry = crews.getByRole("region", { name: `Crew ${index + 1}` });
      await entry.getByLabel(/^Crew name/).fill(name!);
      await entry.getByLabel("Crew size").fill(size!);
    }
    await crews.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "field-depth-repeat-light-1440.png"), fullPage: false });
    await form.getByRole("button", { name: "Queue field report" }).click();
    await workspace.getByText("Report synchronized with retained server attribution.").waitFor();

    const [record] = await admin`
      select id, data, st_geometrytype(geom) as kind from board_records where board_id = ${boardId} and incident_id = ${incidentId}`;
    const data = record!.data as Record<string, unknown>;
    expect(record!.kind).toBe("ST_LineString");
    expect((data.route as { coordinates: unknown[] }).coordinates).toHaveLength(3);
    const ring = (data.area as { type: string; coordinates: number[][][] }).coordinates[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[3]).toEqual(ring[0]);
    expect(data).toMatchObject({ summary: "Culvert failure on Old Arcata Road", county: "humboldt", town: "arcata", asset_tag: "CUL-0042" });
    expect(JSON.parse(data.crews as string)).toEqual([{ crew_name: "Engine 12", crew_size: 4 }, { crew_name: "Dozer 3", crew_size: 2 }]);
    const files = await admin`
      select id, name, content_type from files where attached_kind = 'record' and attached_id = ${record!.id} order by name`;
    expect(files.map((file) => [file.name, file.content_type])).toEqual([["culvert.png", "image/png"], ["voice-note.wav", "audio/wav"]]);
    expect([data.photo, data.voice_note]).toEqual(files.map((file) => file.id));

    // The created record shows both attachments on the board.
    await page.evaluate((hash) => { (globalThis as unknown as { location: { hash: string } }).location.hash = hash; },
      `#/board/${boardId}?incident=${incidentId}&view=all&record=${record!.id as string}`);
    await page.getByRole("button", { name: "culvert.png" }).waitFor();
    await page.getByRole("button", { name: "voice-note.wav" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "field-depth-record-light-1440.png"), fullPage: false });

    // Offline: the report and its photo queue on the device and deliver on reconnect.
    await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
    await workspace.getByLabel("Incident board").selectOption({ label: "Field Survey Reports" });
    await workspace.getByRole("heading", { name: "Field damage survey" }).waitFor();
    await page.context().setOffline(true);
    await workspace.getByText("Offline capture").waitFor();
    await form.getByLabel(/^Summary/).fill("Second culvert blocked by debris");
    await form.getByLabel(/^County/).selectOption("del_norte");
    await form.getByLabel(/^Town/).selectOption("klamath");
    await form.getByRole("group", { name: "Road segment" }).getByLabel(/^Line points/).fill("41.52 -124.03;41.53 -124.04");
    await form.getByLabel("Photo", { exact: true }).setInputFiles({ name: "debris.png", mimeType: "image/png", buffer: PNG });
    await form.getByRole("button", { name: "Queue field report" }).click();
    await workspace.getByText("1 field submission and 1 attachment queued on this device.").waitFor();
    expect(await admin`select id from board_records where board_id = ${boardId}`).toHaveLength(1);
    await page.screenshot({ path: join(SHOTS, "field-depth-offline-light-1440.png"), fullPage: false });

    await page.context().setOffline(false);
    await workspace.getByRole("button", { name: "Sync 2 queued" }).click();
    await workspace.getByText(/All field submissions synchronized at receipt/).waitFor();
    const [queued] = await admin`
      select id, data from board_records where board_id = ${boardId} and data ->> 'summary' = 'Second culvert blocked by debris'`;
    expect((queued!.data as Record<string, unknown>).town).toBe("klamath");
    const [debris] = await admin`
      select id from files where attached_kind = 'record' and attached_id = ${queued!.id} and name = 'debris.png'`;
    expect((queued!.data as Record<string, unknown>).photo).toBe(debris!.id);

    // Dark theme: a typed polygon on the capture map, then a repeat entry on a phone without sideways scrolling.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    const darkArea = form.getByRole("group", { name: "Affected area" });
    await darkArea.getByLabel(/^Boundary points/).fill("41.52 -124.03;41.53 -124.03;41.53 -124.05;41.52 -124.03");
    await darkArea.getByRole("button", { name: "Draw on map" }).click();
    await darkArea.locator('[data-testid="cop-map"] canvas').waitFor({ timeout: 30_000 });
    await darkArea.getByText(/4 points placed, polygon closed/).waitFor();
    await darkArea.evaluate((element) =>
      (element as unknown as { scrollIntoView(options: { block: string }): void }).scrollIntoView({ block: "center" }));
    await page.screenshot({ path: join(SHOTS, "field-depth-polygon-dark-1440.png"), fullPage: false });
    await darkArea.getByRole("button", { name: "Stop drawing" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const darkCrews = form.getByRole("group", { name: "Crew", exact: true });
    await darkCrews.getByRole("button", { name: "Add Crew" }).click();
    await darkCrews.getByRole("region", { name: "Crew 1" }).getByLabel(/^Crew name/).fill("Water tender 7");
    await darkCrews.scrollIntoViewIfNeeded();
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "field-depth-repeat-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 240_000);
});
