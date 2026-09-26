import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, placeOnScenarioClock, seedNorthCoast } from "../demo/north-coast.js";
import { DEMO_DIRECTOR_EMAIL, SCENARIO_TIME_ZONE } from "../demo/scenario-kit.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Building footprints on the Map screen: by use and by role, over the street
 * map and imagery, in both themes at the frames' size and a 125%-scaled
 * laptop's, in downtown Eureka and Crescent City. The hospitals' and fire
 * stations' footprints read as critical infrastructure in the role theme.
 */

const DIST = buildDir("buildings-app");
const SHOTS = join(shotDir("buildings"), "buildings");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const THEMES = ["light", "dark"] as const;
const ARCHIVES = ["california", "buildings", "facilities", "north-coast-imagery"];
const has = (name: string) => existsSync(join(process.cwd(), "web", "public", "basemap", name));

const VIEWS = [
  { name: "Eureka z15", center: [-124.1637, 40.8021], zoom: 15 },
  { name: "Eureka z16", center: [-124.1637, 40.8021], zoom: 16 },
  { name: "Crescent City z15", center: [-124.2015, 41.756], zoom: 15 },
  { name: "Crescent City z16", center: [-124.199, 41.755], zoom: 16 },
  { name: "Saint Joseph Hospital z16", center: [-124.14258, 40.78376], zoom: 16 },
  { name: "Eureka Fire Station 1 z16", center: [-124.16876, 40.80099], zoom: 16 },
  { name: "Crescent City Fire z16", center: [-124.19871, 41.75408], zoom: 16 },
  { name: "Sutter Coast Hospital z16", center: [-124.19232, 41.774], zoom: 16 },
] as const;

/** Footprints the role theme must mark, each clicked at its facility's point. */
const CRITICAL = [
  { view: "Saint Joseph Hospital z16", facility: "Providence Saint Joseph Hospital Eureka" },
  { view: "Eureka Fire Station 1 z16", facility: "Eureka Fire Department Station 1" },
  { view: "Crescent City Fire z16", facility: "Crescent City Volunteer Fire Department" },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;

function runtimeConfig(): Record<string, string> {
  return {
    OPENEOC_SYNTHETIC_DATA: "1",
    OPENEOC_BASEMAP_PMTILES_URL: "/app/basemap/california.pmtiles",
    OPENEOC_BUILDINGS_PMTILES_URL: "/app/basemap/buildings.pmtiles",
    OPENEOC_BUILDINGS_OVERTURE_RELEASE: "2026-08-19.0",
    OPENEOC_FACILITIES_PMTILES_URL: "/app/basemap/facilities.pmtiles",
    OPENEOC_FACILITIES_MANIFEST_URL: "/app/basemap/facilities-manifest.json",
    OPENEOC_IMAGERY_TILE_URL: "pmtiles:///app/basemap/north-coast-imagery.pmtiles",
    OPENEOC_IMAGERY_ATTRIBUTION: "Imagery: USDA NAIP via USGS The National Map",
  };
}

const ready = ARCHIVES.every((name) => has(`${name}.pmtiles`));

beforeAll(async () => {
  if (!ready) return;
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  serveStatic(app, "/app", DIST);
  await placeOnScenarioClock(admin, await seedNorthCoast(app, admin));
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

/** Wait until the page has had no request in flight for a second, then let the last tiles paint and the joins run. */
async function quiet(page: Page, inFlight: () => number): Promise<void> {
  let calm = 0;
  for (let waited = 0; waited < 30_000 && calm < 1_000; waited += 250) {
    await page.waitForTimeout(250);
    calm = inFlight() === 0 ? calm + 250 : 0;
  }
  await page.waitForTimeout(1_500);
}

/**
 * The footprints drawn in view, counted through the Map screen's MapLibre
 * map, which the test reaches through React's record of the map container.
 */
function renderedFootprints(page: Page) {
  return page.getByTestId("cop-map").evaluate((node) => {
    const element = node as unknown as Record<string, unknown>;
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"))!;
    type Hook = { memoizedState?: { current?: unknown }; next?: Hook };
    type Fiber = { memoizedState?: Hook; return?: Fiber };
    type Found = { queryRenderedFeatures(options: object): { id?: unknown; properties: Record<string, unknown>; state?: Record<string, unknown> }[] };
    let map: Found | undefined;
    for (let fiber = element[key] as Fiber | undefined; fiber && !map; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook && typeof hook === "object" && !map; hook = hook.next) {
        const value = hook.memoizedState?.current as Found | undefined;
        if (value && typeof value.queryRenderedFeatures === "function") map = value;
      }
    }
    const footprints = new Map(map!.queryRenderedFeatures({ layers: ["building-use"] }).map((f) => [f.id, f]));
    let classified = 0;
    let critical = 0;
    let status = 0;
    for (const f of footprints.values()) {
      if (f.properties.class !== "yes" || f.properties.overture_subtype) classified += 1;
      if (f.state?.facilityType) critical += 1;
      if (f.state?.status) status += 1;
    }
    return { footprints: footprints.size, classified, critical, status };
  });
}

describe.skipIf(!ready)("building footprints by use and role", () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      it(`draws footprints by use and role over the map and imagery (${theme}, ${viewport.width} by ${viewport.height})`, async () => {
        const problems: string[] = [];
        const outside: string[] = [];
        const counts: Record<string, unknown> = {};
        let inFlight = 0;
        const context = await browser.newContext({ viewport, timezoneId: SCENARIO_TIME_ZONE, locale: "en-US" });
        await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify(runtimeConfig())};
          try {
            localStorage.setItem("openeoc.theme", ${JSON.stringify(theme)});
            localStorage.setItem("openeoc.cop.bookmarks", ${JSON.stringify(JSON.stringify(VIEWS))});
          } catch {}`);
        const page = await context.newPage();
        await page.emulateMedia({ reducedMotion: "reduce" });
        page.on("pageerror", (error) => problems.push(error.message));
        page.on("console", (message) => {
          const text = message.text();
          if ((message.type() === "warning" || message.type() === "error")
            && !/^Failed to load resource|Geolocation support is not available/.test(text)) problems.push(`${message.type()}: ${text}`);
        });
        page.on("request", () => { inFlight += 1; });
        page.on("requestfinished", () => { inFlight -= 1; });
        page.on("requestfailed", () => { inFlight -= 1; });
        page.on("response", (response) => {
          if (response.status() >= 400 && !response.url().includes("/saved-state/")) problems.push(`${response.status()} ${response.url()}`);
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
        await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Map", exact: true }).click();
        await page.locator(".maplibregl-canvas").first().waitFor();
        await quiet(page, () => inFlight);

        const size = `${theme}-${viewport.width}`;
        const layers = page.getByRole("navigation", { name: "Map layers" });
        const group = page.getByTestId("building-layer-group");
        const choose = (value: "use" | "role" | "plain" | "off") => page.locator("#cop-building-theme").selectOption(value);
        const basemap = (name: "Map" | "Imagery") => layers.getByRole("button", { name, exact: true }).click();
        const go = async (name: string) => {
          await page.getByTestId("map-tools").evaluate((section) => { (section as { open: boolean }).open = true; });
          await page.getByRole("button", { name, exact: true }).click();
          await quiet(page, () => inFlight);
        };
        const capture = async (name: string) => {
          counts[name] = await renderedFootprints(page);
          await page.screenshot({ path: join(SHOTS, `${name}-${size}.png`) });
        };

        // By use is the default in both themes.
        expect(await page.locator("#cop-building-theme").inputValue()).toBe("use");
        expect(await page.getByTestId("building-legend").innerText()).toContain("Utility and miscellaneous");
        await group.screenshot({ path: join(SHOTS, `layers-${size}.png`) });

        for (const base of ["Map", "Imagery"] as const) {
          await basemap(base);
          const tag = base === "Map" ? "street" : "imagery";
          await choose("use");
          await go("Eureka z15");
          await capture(`eureka-z15-use-${tag}`);
          await go("Eureka z16");
          await capture(`eureka-z16-use-${tag}`);
          await go("Crescent City z15");
          await capture(`crescent-city-z15-use-${tag}`);
          await choose("role");
          await quiet(page, () => inFlight);
          await capture(`crescent-city-z15-role-${tag}`);
          await go("Crescent City z16");
          await capture(`crescent-city-z16-role-${tag}`);
          await go("Eureka z16");
          await capture(`eureka-z16-role-${tag}`);
          await go("Sutter Coast Hospital z16");
          await capture(`sutter-coast-hospital-z16-role-${tag}`);
        }
        expect(await page.getByTestId("building-legend").innerText()).toContain("Critical infrastructure");

        // The facility icons step aside so a click lands on the footprint under them.
        await basemap("Map");
        const lifelines = page.getByTestId("facility-layer-group");
        for (const lifeline of ["Health & Medical", "Safety & Security"]) await lifelines.getByLabel(lifeline).uncheck();
        const inspector = page.getByTestId("cop-feature-inspector");
        for (const { view, facility } of CRITICAL) {
          await go(view);
          await page.getByTestId("cop-map").click();
          await inspector.waitFor();
          const text = await inspector.innerText();
          expect(text, view).toContain("Critical infrastructure");
          expect(text, view).toContain(facility);
          await capture(`${view.toLowerCase().replaceAll(" ", "-")}-role-inspector`);
          await inspector.getByRole("button", { name: "Close selected map feature" }).click();
        }

        // Off draws nothing and drops the legend; plain draws one color.
        await choose("plain");
        await go("Eureka z16");
        await capture("eureka-z16-plain-street");
        await choose("off");
        await quiet(page, () => inFlight);
        expect((await renderedFootprints(page)).footprints).toBe(0);
        expect(await page.getByTestId("building-legend").count()).toBe(0);

        writeFileSync(join(SHOTS, `counts-${size}.json`), `${JSON.stringify(counts, null, 2)}\n`);
        for (const [name, count] of Object.entries(counts)) {
          expect((count as { footprints: number }).footprints, name).toBeGreaterThan(0);
        }
        for (const name of ["eureka-z16-role-street", "sutter-coast-hospital-z16-role-street", "crescent-city-z16-role-street"]) {
          expect((counts[name] as { critical: number }).critical, name).toBeGreaterThan(0);
        }
        await context.close();
        expect(problems).toEqual([]);
        expect(outside).toEqual([]);
      }, 300_000);
    }
  }
});
