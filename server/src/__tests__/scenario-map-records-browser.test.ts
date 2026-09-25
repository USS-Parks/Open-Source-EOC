import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 6, map half: map and records agree. On the North Coast
 * Storm exercise Jordan Lee finds a shelter on the map; beside the map it
 * shows its status, its source, when it last changed and who changed it.
 * Opening the record puts it in its board's list and detail with a way back
 * to the map, and the record's "Show on map" returns to the map on the same
 * shelter. Run at the frames' size and at a 125%-scaled laptop's.
 */

const DIST = buildDir("map-records-app");
const SHOTS = shotDir("map-records");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const SHELTER = "Eureka Municipal Auditorium";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];
const outside: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("scenario 6, map half: map and records agree", () => {
  for (const viewport of VIEWPORTS) {
    it(`connects the map, the list and the detail on one shelter at ${viewport.width} by ${viewport.height}`, async () => {
      const context = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        outside.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html#/map?incident=${scenario.incidentId}`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("jordan.lee@humboldt.example");
      await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByTestId("cop-map").waitFor();
      const [shelter] = await admin`
        select r.id, r.board_id, b.title from board_records r join boards b on b.id = r.board_id
        where b.template_key = 'shelters' and r.data->>'name' = ${SHELTER}`;

      // Found on the map, the shelter says beside the map how it stands, since when, and who said so.
      // Filled on each try: the map settles after sign-in and can clear the box.
      const find = page.getByLabel("Find on map", { exact: true });
      await expect.poll(async () => {
        await find.fill(SHELTER);
        await find.press("Enter");
        return page.getByRole("button", { name: new RegExp(SHELTER) }).count();
      }, { timeout: 60_000 }).toBeGreaterThan(0);
      await page.getByRole("button", { name: new RegExp(SHELTER) }).first().click();
      const inspector = page.getByRole("complementary", { name: "Selected map feature" });
      await inspector.getByRole("heading", { name: SHELTER }).waitFor();
      await inspector.getByText(shelter!.title as string).waitFor();
      await inspector.getByText(/ by L\. Moreno$/).waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `inspector-${viewport.width}.png`) });

      // Opened, it is the selected row of its board and the record beside it, with a way back to the map.
      await inspector.getByRole("button", { name: "Open record" }).click();
      const detail = page.getByRole("region", { name: "Selected record" });
      await detail.getByText(SHELTER).first().waitFor();
      await page.locator("tr[data-selected]").filter({ hasText: SHELTER }).waitFor();
      await page.getByRole("region", { name: "Return path" }).getByRole("button").waitFor();
      await page.screenshot({ path: join(SHOTS, `record-${viewport.width}.png`) });

      // The record's "Show on map" returns to the map on the same shelter.
      await detail.getByRole("button", { name: "Show on map" }).click();
      await page.getByRole("complementary", { name: "Selected map feature" }).getByRole("heading", { name: SHELTER }).waitFor();
      expect(page.url()).toContain(`record=${shelter!.id as string}`);
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
