import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { seedCascadia } from "../demo/cascadia.js";
import { seedDeerhorn } from "../demo/deerhorn.js";
import { seedDelNorte } from "../demo/del-norte.js";
import { NORTH_COAST_PASSWORD, placeOnScenarioClock, seedNorthCoast } from "../demo/north-coast.js";
import { DEMO_DIRECTOR_EMAIL, SCENARIO_TIME_ZONE } from "../demo/scenario-kit.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The Map screen against the four exercises in one database, as the demo
 * builds it, signed in as the demo's director: a Humboldt County OES
 * administrator who takes part in the exercises other organizations own. It
 * captures each exercise's map at the frames' size and at a 125%-scaled
 * laptop's, in both themes, and the places the map parity work is judged:
 * Del Norte's own layers drawn with their cartography, tribal lands near
 * Deerhorn, and building footprints over imagery in Eureka.
 */

const DIST = buildDir("map-parity-app");
const SHOTS = join(shotDir("map-parity"), "map-parity");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const THEMES = ["light", "dark"] as const;
/** A saved view the walk opens: downtown Eureka at street zoom. */
const EUREKA = { name: "Eureka street view", center: [-124.1637, 40.8021], zoom: 16 };

const EXERCISES = {
  northCoast: "North Coast Storm",
  deerhorn: "Deerhorn Lightning Complex",
  delNorte: "Del Norte Atmospheric Rivers",
  cascadia: "Cascadia Earthquake and Tsunami",
} as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;

/** The offline archives present in this checkout, configured as the desktop install configures them. */
function runtimeConfig(): Record<string, string> {
  const has = (name: string) => existsSync(join(process.cwd(), "web", "public", "basemap", name));
  return {
    OPENEOC_SYNTHETIC_DATA: "1",
    ...(has("california.pmtiles") ? { OPENEOC_BASEMAP_PMTILES_URL: "/app/basemap/california.pmtiles" } : {}),
    ...(has("buildings.pmtiles") ? { OPENEOC_BUILDINGS_PMTILES_URL: "/app/basemap/buildings.pmtiles" } : {}),
    ...(has("overlays.pmtiles") ? {
      OPENEOC_OVERLAYS_PMTILES_URL: "/app/basemap/overlays.pmtiles",
      OPENEOC_OVERLAYS_MANIFEST_URL: "/app/basemap/overlays-manifest.json",
    } : {}),
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

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  serveStatic(app, "/app", DIST);
  await placeOnScenarioClock(admin, await seedNorthCoast(app, admin));
  for (const seed of [seedDeerhorn, seedDelNorte, seedCascadia]) await placeOnScenarioClock(admin, await seed(app, admin));
  baseUrl = await listen(app);
  mkdirSync(SHOTS, { recursive: true });
  browser = await launchBrowser({ coreRail: true });
}, 900_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

/** Wait until the page has had no request in flight for a second: the map has drawn what it asked for. */
async function quiet(page: Page, inFlight: () => number): Promise<void> {
  let calm = 0;
  for (let waited = 0; waited < 30_000 && calm < 1_000; waited += 250) {
    await page.waitForTimeout(250);
    calm = inFlight() === 0 ? calm + 250 : 0;
  }
  // ponytail: the app exposes no map-idle signal; a short settle lets the last tiles paint.
  await page.waitForTimeout(1_500);
}

async function chooseIncident(page: Page, name: string): Promise<void> {
  const select = page.getByLabel("Selected incident");
  const value = await select.locator("option", { hasText: name }).getAttribute("value");
  await select.selectOption(value!);
  await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: name }).waitFor({ state: "attached" });
}

async function openMap(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Map", exact: true }).click();
  await page.locator(".maplibregl-canvas").first().waitFor();
}

describe("the Map screen across the four exercises", () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      it(`draws each exercise's layers, tribal lands and footprints over imagery (${theme}, ${viewport.width} by ${viewport.height})`, async () => {
        const pageErrors: string[] = [];
        const outside: string[] = [];
        const refusedItems: string[] = [];
        let inFlight = 0;
        const context = await browser.newContext({ viewport, timezoneId: SCENARIO_TIME_ZONE, locale: "en-US" });
        await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify(runtimeConfig())};
          try {
            localStorage.setItem("openeoc.theme", ${JSON.stringify(theme)});
            localStorage.setItem("openeoc.cop.bookmarks", ${JSON.stringify(JSON.stringify([EUREKA]))});
          } catch {}`);
        const page = await context.newPage();
        await page.emulateMedia({ reducedMotion: "reduce" });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        // MapLibre's warning for a style expression reading a missing value, such as tribal lands' admin level.
        page.on("console", (message) => {
          if (message.type() === "warning" && /Expected value to be of type/.test(message.text())) pageErrors.push(message.text());
        });
        page.on("request", () => { inFlight += 1; });
        page.on("requestfinished", () => { inFlight -= 1; });
        page.on("requestfailed", () => { inFlight -= 1; });
        page.on("response", (response) => {
          if (/\/api\/v1\/(ogc\/collections\/[^/]+\/items|tiles\/boards\/)/.test(response.url()) && response.status() >= 400) {
            refusedItems.push(`${response.status()} ${response.url()}`);
          }
        });
        await page.route("**/*", (route) => {
          const url = route.request().url();
          if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
          outside.push(url);
          return route.abort();
        });
        await page.goto(`${baseUrl}/app/index.html#/`, { waitUntil: "load" });
        await page.getByLabel("Email").fill(DEMO_DIRECTOR_EMAIL);
        await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.getByLabel("Selected incident").waitFor();
        const size = `${theme}-${viewport.width}`;
        const shot = (name: string) => page.screenshot({ path: join(SHOTS, `${name}-${size}.png`) });

        // Del Norte: another organization's exercise. Its own boards, and only
        // they, are the operational layers, and none of their reads is refused.
        await chooseIncident(page, EXERCISES.delNorte);
        await openMap(page);
        await quiet(page, () => inFlight);
        await shot("del-norte-map");
        // The board layers: the first list in the group; the incident's datasets follow under Feeds.
        const layers = page.getByTestId("operational-layer-group").locator("ul.eoc-cop-options").first().locator("label.eoc-cop-check");
        const titles = (await layers.allInnerTexts()).map((text) => text.trim()).filter((text) => text !== "Incident area");
        expect(titles.length).toBeGreaterThan(0);
        for (const title of titles) expect(title, "a layer outside Del Norte").toMatch(/^Del Norte Atmospheric Rivers: /);
        await page.getByRole("navigation", { name: "Map layers" }).screenshot({ path: join(SHOTS, `del-norte-layers-${size}.png`) });

        // Deerhorn: the Hoopa Valley and Yurok reservation lines and names.
        await chooseIncident(page, EXERCISES.deerhorn);
        await openMap(page);
        await quiet(page, () => inFlight);
        await shot("deerhorn-map");

        await chooseIncident(page, EXERCISES.cascadia);
        await openMap(page);
        await quiet(page, () => inFlight);
        await shot("cascadia-map");

        // North Coast Storm, then Eureka at street zoom over imagery.
        await chooseIncident(page, EXERCISES.northCoast);
        await openMap(page);
        await quiet(page, () => inFlight);
        await shot("north-coast-map");
        const imagery = page.getByRole("button", { name: "Imagery", exact: true });
        if (await imagery.getAttribute("aria-pressed") !== "true") await imagery.click();
        await page.getByTestId("map-tools").evaluate((section) => { (section as { open: boolean }).open = true; });
        await page.getByRole("button", { name: EUREKA.name, exact: true }).click();
        await quiet(page, () => inFlight);
        await shot("eureka-imagery-z16");

        await context.close();
        expect(refusedItems).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(outside).toEqual([]);
      }, 300_000);
    }
  }
});
