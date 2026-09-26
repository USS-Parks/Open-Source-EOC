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
 * The incident and hazard cartography on the Map screen, across the
 * four exercises in one database as the demo builds it: each exercise's map
 * over the street map and over imagery, and a closer view where its hazards
 * and incident symbols are judged (Humboldt Bay's inundation and
 * liquefaction, Deerhorn's zones and perimeters at Weitchpec, Del Norte's
 * facilities at Crescent City, North Coast Storm's in Eureka), at the
 * frames' size and a 125%-scaled laptop's, in both themes. Nothing on the
 * map may raise a page error or a MapLibre warning, or reach off the host.
 */

const DIST = buildDir("incident-cartography-app");
const SHOTS = join(shotDir("incident-cartography"), "incident-cartography");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const THEMES = ["light", "dark"] as const;

const EXERCISES = [
  { key: "cascadia", name: "Cascadia Earthquake and Tsunami", view: { name: "Humboldt Bay", center: [-124.175, 40.795], zoom: 12 } },
  { key: "deerhorn", name: "Deerhorn Lightning Complex", view: { name: "Weitchpec", center: [-123.705, 41.19], zoom: 12.5 } },
  { key: "del-norte", name: "Del Norte Atmospheric Rivers", view: { name: "Crescent City", center: [-124.2, 41.765], zoom: 13 } },
  { key: "north-coast", name: "North Coast Storm", view: { name: "Eureka", center: [-124.155, 40.793], zoom: 14 } },
] as const;

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

/** Wait until the page has had no request in flight for a second and the map reports idle. */
async function quiet(page: Page, inFlight: () => number): Promise<void> {
  let calm = 0;
  for (let waited = 0; waited < 30_000 && calm < 1_000; waited += 250) {
    await page.waitForTimeout(250);
    calm = inFlight() === 0 ? calm + 250 : 0;
  }
  await page.locator('[data-testid="cop-map"][data-map-idle]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  // ponytail: idle can precede the last symbol placement by a frame or two; a short settle lets it paint.
  await page.waitForTimeout(1_000);
}

async function chooseIncident(page: Page, name: string): Promise<void> {
  const select = page.getByLabel("Selected incident");
  const value = await select.locator("option", { hasText: name }).getAttribute("value");
  await select.selectOption(value!);
  await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: name }).waitFor({ state: "attached" });
}

async function basemap(page: Page, title: "Map" | "Imagery"): Promise<void> {
  const button = page.getByTestId("reference-layer-group").getByRole("button", { name: title, exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
}

describe("incident and hazard cartography on the Map screen", () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      it(`draws each exercise's hazards and incident symbols (${theme}, ${viewport.width} by ${viewport.height})`, async () => {
        const problems: string[] = [];
        const outside: string[] = [];
        let inFlight = 0;
        // The console saves the theme with the signed-in person's workspace, so each walk starts from none.
        await admin`delete from saved_states`;
        const context = await browser.newContext({ viewport, timezoneId: SCENARIO_TIME_ZONE, locale: "en-US" });
        await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify(runtimeConfig())};
          try {
            localStorage.setItem("openeoc.theme", ${JSON.stringify(theme)});
            localStorage.setItem("openeoc.cop.bookmarks", ${JSON.stringify(JSON.stringify(EXERCISES.map((exercise) => exercise.view)))});
          } catch {}`);
        const page = await context.newPage();
        await page.emulateMedia({ reducedMotion: "reduce" });
        page.on("pageerror", (error) => problems.push(error.message));
        // MapLibre reports a style problem (a missing image, a bad expression value) as a console warning or error.
        // Not counted: a failed request (its response is, below); headless Chrome's missing geolocation; and the
        // warning CopMap's last refresh raises on a map already removed when the screen changes incident.
        page.on("console", (message) => {
          const text = message.text();
          if ((message.type() === "warning" || message.type() === "error")
            && !/^Failed to load resource|^Geolocation support is not available|^There is no style added to the map/.test(text)) {
            problems.push(`${message.type()}: ${text}`);
          }
        });
        // A workspace layout nobody has saved yet reads as 404, as it does on every screen.
        page.on("response", (response) => {
          if (response.status() >= 400 && !response.url().includes("/saved-state/")) problems.push(`${response.status()} ${response.url().replace(baseUrl, "")}`);
        });
        page.on("request", () => { inFlight += 1; });
        page.on("requestfinished", () => { inFlight -= 1; });
        page.on("requestfailed", () => { inFlight -= 1; });
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
        const frame = page.locator(".eoc-cop-map-frame");
        const shot = (name: string) => frame.screenshot({ path: join(SHOTS, `${name}-${size}.png`) });
        // Each theme opens on its own basemap: the street map in light, imagery in dark.
        const [first, second] = theme === "light" ? ["Map", "Imagery"] as const : ["Imagery", "Map"] as const;

        for (const exercise of EXERCISES) {
          await chooseIncident(page, exercise.name);
          await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Map", exact: true }).click();
          await page.locator(".maplibregl-canvas").first().waitFor();
          // The map takes a basemap choice once its style has loaded.
          await quiet(page, () => inFlight);
          await basemap(page, first);
          await quiet(page, () => inFlight);
          await shot(`${exercise.key}-${first.toLowerCase()}`);
          await basemap(page, second);
          await quiet(page, () => inFlight);
          await shot(`${exercise.key}-${second.toLowerCase()}`);
          await basemap(page, first);
          await page.getByTestId("map-tools").evaluate((section) => { (section as { open: boolean }).open = true; });
          await page.getByRole("button", { name: exercise.view.name, exact: true }).click();
          await quiet(page, () => inFlight);
          await shot(`${exercise.key}-${exercise.view.name.toLowerCase().replaceAll(" ", "-")}`);
        }

        await context.close();
        expect(problems).toEqual([]);
        expect(outside).toEqual([]);
      }, 480_000);
    }
  }
});
