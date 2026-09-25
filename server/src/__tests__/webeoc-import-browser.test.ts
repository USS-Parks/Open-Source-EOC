import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { parseCsv, tableXlsx } from "../boards/transfer.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("webeoc-import-app");
const SHOTS = shotDir("webeoc-import");
const EXPORT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "webeoc-significant-events.csv"));

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    { templateKey: "significant_events", title: "Significant Events" })).id as string;
  baseUrl = await listen(app);
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

async function openMigration(): Promise<Locator> {
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("tab", { name: "Records" }).click();
  const panel = page.getByRole("region", { name: "WebEOC migration" });
  await panel.getByLabel("Target board").selectOption({ label: "Significant Events" });
  await panel.getByLabel("WebEOC export (CSV or Excel)").waitFor();
  return panel;
}

/** A viewport shot with the mapping table at the top, so the mapping and the result below it show together. */
async function shot(panel: Locator, name: string): Promise<void> {
  await panel.getByRole("heading", { name: "Board fields and their WebEOC columns" })
    .evaluate((heading) => (heading as unknown as { scrollIntoView(options: { block: string }): void }).scrollIntoView({ block: "start" }));
  await page.screenshot({ path: join(SHOTS, name), fullPage: false });
}

const records = async () =>(await admin`select count(*)::int as n from board_records where board_id = ${boardId}`)[0]!.n as number;

describe("WebEOC migration screen", () => {
  it("checks a WebEOC export, imports the valid rows, returns the rejection report and reads the records back", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    // Upload and dry run: fields are matched to columns by name and nothing is written.
    let panel = await openMigration();
    await panel.getByLabel("WebEOC server time zone").selectOption("America/Los_Angeles");
    await panel.getByLabel("WebEOC export (CSV or Excel)").setInputFiles({ name: "significant-events.csv", mimeType: "text/csv", buffer: EXPORT });
    await panel.getByRole("heading", { name: "Check result" }).waitFor();
    await panel.getByText("8 rows read: 3 will be created, 0 already imported, 5 rejected.").waitFor();
    expect(await panel.getByLabel("Column for Occurred").inputValue()).toBe("occurred");
    expect(await panel.getByLabel("Column for Verified").inputValue()).toBe("");
    await panel.getByText(/Not imported: remarks_extra\./).waitFor();
    await panel.getByLabel("Show", { exact: true }).selectOption("reject");
    await panel.getByRole("cell", { name: "Occurred is not a date" }).waitFor();
    expect(await records()).toBe(0);
    await shot(panel, "webeoc-check-light-1440.png");

    // Save the mapping, then commit: the valid rows are written and the rest come back as a report.
    await panel.getByLabel("Show", { exact: true }).selectOption("all");
    await panel.getByRole("button", { name: "Save mapping" }).click();
    await panel.getByText("Mapping saved for Significant Events.").waitFor();
    await panel.getByRole("button", { name: "Import 3 records" }).click();
    await panel.getByText("Imported 3 records. 5 rows rejected, 0 already imported.").waitFor();
    await panel.getByRole("heading", { name: "Import result" }).waitFor();
    expect(await records()).toBe(3);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Download rejection report" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("webeoc-rejections.csv");
    const report = readFileSync((await download.path())!, "utf8").trimEnd().split("\r\n");
    expect(report).toHaveLength(6);
    expect(report[0]).toMatch(/^Rejected row,Rejection reason,dataid,prevdataid,/);
    expect(report.slice(1).map((line) => line.split(",")[0])).toEqual(["4", "5", "6", "7", "8"]);
    const [saved] = await admin`select mapping, time_zone from webeoc_mappings where board_id = ${boardId}`;
    expect(saved).toEqual({
      mapping: { summary: "Summary", details: "Details", occurred_at: "occurred", severity: "severity" },
      time_zone: "America/Los_Angeles",
    });
    await shot(panel, "webeoc-import-light-1440.png");

    // Read back on the board itself.
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?view=all`);
    const main = page.getByRole("main");
    for (const summary of ["Levee seep reported", "Road washed out on Route 96", "Untracked note"])
      await main.getByText(summary, { exact: true }).waitFor();
    expect(await main.getByText("Power outage").count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "webeoc-readback-light-1440.png"), fullPage: false });

    // Dark theme: the same export again uses the saved mapping and skips what was imported.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    panel = await openMigration();
    await panel.getByText(/This board has a saved mapping/).waitFor();
    expect(await panel.getByLabel("WebEOC server time zone").inputValue()).toBe("America/Los_Angeles");
    await panel.getByLabel("WebEOC export (CSV or Excel)").setInputFiles({ name: "significant-events.csv", mimeType: "text/csv", buffer: EXPORT });
    await panel.getByText("8 rows read: 1 will be created, 3 already imported, 4 rejected.").waitFor();
    await shot(panel, "webeoc-check-dark-1440.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole("heading", { name: "Check result" }).scrollIntoViewIfNeeded();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "webeoc-check-dark-390.png"), fullPage: false });
    expect(await records()).toBe(3);

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);

  it("reads the same export saved as an Excel workbook", async () => {
    const [headers, ...rows] = parseCsv(EXPORT.toString("utf8"));
    const workbook = Buffer.from(tableXlsx({ headers: headers!, rows }));
    await page.setViewportSize({ width: 1440, height: 1000 });
    const panel = await openMigration();
    await panel.getByLabel("WebEOC export (CSV or Excel)").setInputFiles({
      name: "significant-events.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook,
    });
    await panel.getByText("8 rows read: 1 will be created, 3 already imported, 4 rejected.").waitFor();
    expect(await records()).toBe(3);
    expect(pageErrors).toEqual([]);
  }, 120_000);
});
