import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { placeOnScenarioClock, SCENARIO_TIME_ZONE, type ScenarioRun } from "../demo/scenario-kit.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * A walk through one exercise scenario in a real browser, as its lead: the
 * overview, the map with the exercise layers, lifelines, resources and field
 * reports, at the frames' size and at a 125%-scaled laptop's. Each screen must
 * show what the seed wrote, fit without sideways scrolling, raise no page
 * error and ask nothing of the network beyond the host. The captures are kept
 * for the review package.
 */

export interface ScenarioWalk {
  readonly name: string;
  readonly seed: (app: FastifyInstance, sql: Sql) => Promise<ScenarioRun>;
  readonly email: string;
  readonly password: string;
  readonly incident: string;
  readonly position: string;
  /** Text each screen must show once loaded. */
  readonly expect: {
    readonly overview: readonly string[];
    readonly map: readonly string[];
    readonly lifelines: readonly string[];
    readonly resources: readonly string[];
    readonly fieldReports: readonly string[];
  };
}

const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

/** The offline archives present in this checkout, configured as a desktop install configures them. */
function runtimeConfig(): Record<string, string> {
  const has = (name: string) => existsSync(join(process.cwd(), "web", "public", "basemap", name));
  return {
    OPENEOC_SYNTHETIC_DATA: "1",
    ...(has("california.pmtiles") ? { OPENEOC_BASEMAP_PMTILES_URL: "/app/basemap/california.pmtiles" } : {}),
    ...(has("north-coast-imagery.pmtiles") ? {
      OPENEOC_IMAGERY_TILE_URL: "pmtiles:///app/basemap/north-coast-imagery.pmtiles",
      OPENEOC_IMAGERY_ATTRIBUTION: "Imagery: USDA NAIP via USGS The National Map",
    } : {}),
    ...(has("north-coast-terrain.pmtiles") ? {
      OPENEOC_TERRAIN_TILE_URL: "pmtiles:///app/basemap/north-coast-terrain.pmtiles",
      OPENEOC_TERRAIN_ATTRIBUTION: "Elevation: USGS 3DEP",
    } : {}),
  };
}

export function walkScenario(walk: ScenarioWalk): void {
  const DIST = buildDir(`${walk.name}-walk-app`);
  // A folder of its own: a configured shot directory is shared by every test.
  const SHOTS = join(shotDir(`${walk.name}-walk`), `${walk.name}-walk`);
  let admin: Sql;
  let runtime: Sql;
  let app: FastifyInstance;
  let browser: Browser;
  let baseUrl: string;
  let scenario: ScenarioRun;

  beforeAll(async () => {
    await buildWeb(DIST);
    ({ admin, runtime } = await freshDb());
    app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
    serveStatic(app, "/app", DIST);
    scenario = await walk.seed(app, admin);
    await placeOnScenarioClock(admin, scenario);
    baseUrl = await listen(app);
    mkdirSync(SHOTS, { recursive: true });
    browser = await launchBrowser({ coreRail: true });
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await runtime?.end();
    await admin?.end();
  });

  async function section(page: Page, name: string, texts: readonly string[], shot: string): Promise<void> {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();
    await page.waitForLoadState("networkidle");
    try {
      for (const text of texts) await page.getByText(text, { exact: false }).first().waitFor({ timeout: 30_000 });
      if (name === "Map") {
        // ponytail: the app exposes no map-idle signal, so the capture waits for the canvas and a settle time.
        await page.locator(".maplibregl-canvas").first().waitFor();
        await page.waitForTimeout(3_000);
      }
    } finally {
      await page.screenshot({ path: join(SHOTS, `${shot}.png`) });
    }
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), `${name} scrolls sideways`).toBe(true);
  }

  describe(`the ${walk.incident} exercise in a real browser`, () => {
    for (const viewport of VIEWPORTS) {
      it(`shows the scenario on every main screen at ${viewport.width} by ${viewport.height}`, async () => {
        const pageErrors: string[] = [];
        const outside: string[] = [];
        const context = await browser.newContext({ viewport, timezoneId: SCENARIO_TIME_ZONE, locale: "en-US" });
        await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify(runtimeConfig())};`);
        const page = await context.newPage();
        await page.clock.setFixedTime(scenario.clock);
        await page.emulateMedia({ reducedMotion: "reduce" });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.route("**/*", (route) => {
          const url = route.request().url();
          if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
          outside.push(url);
          return route.abort();
        });
        await page.goto(`${baseUrl}/app/index.html#/?incident=${scenario.incidentId}`, { waitUntil: "load" });
        await page.getByLabel("Email").fill(walk.email);
        await page.getByLabel("Password").fill(walk.password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: walk.incident }).waitFor({ state: "attached" });
        await page.getByLabel("Acting position").selectOption({ label: walk.position });
        await page.locator('select[aria-label="Acting position"] option:checked', { hasText: walk.position }).waitFor({ state: "attached" });

        const size = `${viewport.width}`;
        await section(page, "Overview", walk.expect.overview, `overview-${size}`);
        await section(page, "Map", walk.expect.map, `map-${size}`);
        await section(page, "ESFs & Lifelines", walk.expect.lifelines, `lifelines-${size}`);
        await section(page, "Resources", walk.expect.resources, `resources-${size}`);
        await section(page, "Field Reports", walk.expect.fieldReports, `field-reports-${size}`);
        await context.close();
        expect(pageErrors).toEqual([]);
        expect(outside).toEqual([]);
      }, 240_000);
    }
  });
}
