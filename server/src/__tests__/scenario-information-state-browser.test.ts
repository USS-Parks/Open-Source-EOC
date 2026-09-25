import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 6, first half: information state you can read . On the
 * North Coast Storm exercise each way a screen can come up short says which
 * it is. A dataset that has sent nothing and one whose source failed are
 * named beside the map, not left off it in silence; a board filtered to
 * nothing says the column filters did it and how many records they hide; a
 * lifeline report shows when its condition was observed apart from when the
 * server received it; and a link to a board the reader may not open says so
 * and whom to ask, without saying what it holds. Run at the frames' size and
 * at a 125%-scaled laptop's.
 */

const DIST = buildDir("information-state-app");
const SHOTS = shotDir("information-state");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];
const outside: string[] = [];

async function signIn(email: string, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
  return page;
}

const rail = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  baseUrl = await listen(app);
  browser = await launchBrowser();
  // Two incident datasets with nothing to draw: one has sent nothing yet, one's source failed.
  const [pack] = await admin`
    insert into data_packs (incident_id, organization_id, name, created_by)
    values (${scenario.incidentId}, ${scenario.jurisdictionId}, 'River and tide data', ${scenario.people["lee"]!.id})
    returning id`;
  await admin`
    insert into data_pack_datasets (pack_id, key, name, kind, field_mapping, last_error) values
      (${pack!.id as string}, 'county_gauges', 'County river gauges', 'geojson', '{}'::jsonb, null),
      (${pack!.id as string}, 'tide_stations', 'Tide stations', 'geojson', '{}'::jsonb, 'The source answered 503 Service Unavailable')`;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("scenario 6, first half: information state you can read", () => {
  for (const viewport of VIEWPORTS) {
    it(`names why a screen comes up short at ${viewport.width} by ${viewport.height}`, async () => {
      const page = await signIn("jordan.lee@humboldt.example", viewport);

      // The map names the datasets it cannot draw, and why.
      await rail(page, "Map");
      await page.getByRole("status").filter({ hasText: "Not on the map:" })
        .getByText("Not on the map: County river gauges (no data received yet); Tide stations (The source answered 503 Service Unavailable).").waitFor();
      await page.screenshot({ path: join(SHOTS, `map-${viewport.width}.png`) });

      // A board filtered to nothing says the filters did it, and how much they hide.
      const [shelters] = await admin`
        select b.id from boards b join incident_boards ib on ib.board_id = b.id
        where ib.incident_id = ${scenario.incidentId} and b.template_key = 'shelters'`;
      await page.evaluate(`location.hash = ${JSON.stringify(`#/board/${shelters!.id as string}?incident=${scenario.incidentId}`)}`);
      await page.getByLabel("Filter Shelter").fill("no such shelter");
      await page.getByText("No records match the column filters").waitFor();
      await page.getByText(/^Clear the column filters to see the \d+ records in this view\.$/).waitFor();
      await page.screenshot({ path: join(SHOTS, `board-filtered-${viewport.width}.png`) });

      // A lifeline report keeps its observation time apart from its receipt.
      await rail(page, "ESFs & Lifelines");
      await page.getByRole("button", { name: "Open Energy details" }).click();
      const drawer = page.getByRole("complementary", { name: "Energy" });
      await drawer.getByRole("button", { name: "View history" }).click();
      await drawer.getByText("Assessment details").click();
      await drawer.getByText("Observed", { exact: true }).waitFor();
      await drawer.getByText("Received", { exact: true }).waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.context().close();

      // A link to a board the reader may not open says so, and whom to ask.
      const liaison = await signIn("a.brooks@cec.example", viewport);
      await liaison.evaluate(`location.hash = ${JSON.stringify(`#/board/${randomUUID()}`)}`);
      await liaison.getByText(/It is not open to your account, or it no longer exists\. If a link brought you here, ask whoever sent it, or an administrator of your organization, for access\./).waitFor();
      await liaison.screenshot({ path: join(SHOTS, `refused-${viewport.width}.png`) });
      await liaison.context().close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
