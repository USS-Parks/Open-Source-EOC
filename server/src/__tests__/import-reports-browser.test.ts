import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { parseCsv } from "../boards/transfer.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * Validated migration on screen (VC-13), at the frames' 1586 by 992 and at
 * 1534 by 790: an administrator downloads the people template, checks a
 * people file, gives the first password and imports it, and the new people
 * are on the People tab; downloads a board's import template with its
 * dictionary values and imports records from WebEOC; then opens the people
 * import's report on the Records tab, filters its refused rows and signs it
 * off in their name.
 */

const DIST = buildDir("import-reports-app");
const SHOTS = shotDir("import-reports");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function signIn(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

async function download(page: Page, click: () => Promise<void>): Promise<string[][]> {
  const [file] = await Promise.all([page.waitForEvent("download"), click()]);
  return parseCsv(readFileSync((await file.path())!, "utf8"));
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await admin`insert into positions (jurisdiction_id, key, title)
    values (${seed.jurisdictionId}, 'planning_section_chief', 'Planning Section Chief')`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  await post(app, await login(app), `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    { templateKey: "significant_events", title: "Significant Events" });
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("validated migration on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`imports people and records, and signs off the people import's report, at ${viewport.width} by ${viewport.height}`, async () => {
      const w = viewport.width;
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await signIn(page);
      await page.getByRole("button", { name: "Administration", exact: true }).click();

      // The people template lists the roles and this jurisdiction's positions.
      const people = page.getByRole("region", { name: "Import people" });
      expect(await download(page, () => people.getByRole("button", { name: "Download template" }).click())).toEqual([
        ["email", "name", "role", "positions"],
        ["", "", "admin", "planning_section_chief"],
        ["", "", "member", ""],
        ["", "", "viewer", ""],
      ]);

      // Check a file: two new people and one row refused, and nothing written.
      await people.getByLabel("People file (CSV or Excel)").setInputFiles({ name: `staff-${w}.csv`, mimeType: "text/csv",
        buffer: Buffer.from(`email,name,role,positions\r\nana.${w}@example.org,Ana Reyes ${w},member,planning_section_chief\r\n`
          + `sam.${w}@example.org,Sam Lee ${w},viewer,\r\nbad.${w},Bad Row,member,\r\n`) });
      await people.getByText("3 rows read: 2 new accounts, 0 to update, 0 skipped, 1 refused.").waitFor();
      await people.getByRole("cell", { name: `email "bad.${w}" is not an email address` }).waitFor();
      expect(await admin`select 1 from persons where email = ${`ana.${w}@example.org`}`).toHaveLength(0);
      await people.getByLabel("First password for the new accounts").fill("river-bend-first-2026");
      await people.getByRole("heading", { name: "Check result" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `people-check-${w}.png`), fullPage: false });

      await people.getByRole("button", { name: "Import 2 people" }).click();
      await people.getByText("Imported 2 new accounts; 0 updated, 0 skipped, 1 refused.").waitFor();
      await page.getByRole("button", { name: `Ana Reyes ${w}`, exact: true }).waitFor();
      const [held] = await admin`
        select pos.key from position_assignments a join persons p on p.id = a.person_id join positions pos on pos.id = a.position_id
        where p.email = ${`ana.${w}@example.org`} and a.revoked_at is null`;
      expect(held?.key).toBe("planning_section_chief");

      // A board's import template holds the dictionary's values; records come in from WebEOC.
      await page.getByRole("tab", { name: "Records" }).click();
      const migration = page.getByRole("region", { name: "WebEOC migration" });
      await migration.getByLabel("Target board").selectOption({ label: "Significant Events" });
      const template = await download(page, () => migration.getByRole("button", { name: "Download import template" }).click());
      expect(template[0]).toEqual(["summary", "details", "occurred_at", "severity", "verified"]);
      expect(template.slice(1).map((row) => row[3])).toEqual(["normal", "warning", "critical", "unknown"]);
      await migration.getByLabel("WebEOC export (CSV or Excel)").setInputFiles({ name: `events-${w}.csv`, mimeType: "text/csv",
        buffer: Buffer.from(`summary,severity,occurred_at\r\nLevee seep ${w},warning,2026-09-20T15:10:00Z\r\n,warning,2026-09-20T15:20:00Z\r\n`) });
      await migration.getByRole("button", { name: "Import 1 record" }).click();
      await migration.getByText("Imported 1 record. 1 row rejected, 0 already imported.").waitFor();

      // The people import's report: its mapping and refused row, signed off in the administrator's name.
      const reports = page.getByRole("region", { name: "Import reports" });
      const list = reports.getByRole("table", { name: "Import reports" });
      await list.getByRole("button", { name: /^WebEOC migration: Significant Events, run / }).first().waitFor();
      const peopleReport = list.getByRole("row").filter({ hasText: `staff-${w}.csv` });
      await peopleReport.getByText("Waiting for sign-off").waitFor();
      await peopleReport.getByRole("button", { name: /^People: Accounts and positions, run / }).click();
      await reports.getByRole("heading", { name: "People: Accounts and positions" }).waitFor();
      await reports.getByText("3 read: 2 created, 0 updated, 0 skipped, 1 refused").waitFor();
      await reports.getByLabel("Show", { exact: true }).selectOption("refused");
      await reports.getByRole("cell", { name: `bad.${w}`, exact: true }).waitFor();
      await reports.getByLabel("Sign-off note (optional)").fill(`Checked the staff roster ${w}.`);
      await reports.getByRole("heading", { name: "People: Accounts and positions" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `people-report-${w}.png`), fullPage: false });
      await reports.getByRole("button", { name: "Sign off this report" }).click();
      await reports.getByText(new RegExp(`^Signed off by Admin, .*\\. Note: Checked the staff roster ${w}\\.$`)).waitFor();
      await peopleReport.getByText("Signed off by Admin").waitFor();
      const [signed] = await admin`
        select p.display_name from import_reports r join persons p on p.id = r.signed_off_by where r.source_name = ${`staff-${w}.csv`}`;
      expect(signed?.display_name).toBe("Admin");
      await page.screenshot({ path: join(SHOTS, `people-report-signed-${w}.png`), fullPage: false });

      // Nothing on the screen scrolls sideways.
      expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
