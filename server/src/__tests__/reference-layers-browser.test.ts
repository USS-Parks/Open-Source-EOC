import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { seedDeerhorn } from "../demo/deerhorn.js";
import { seedDelNorte } from "../demo/del-norte.js";
import { NORTH_COAST_PASSWORD, placeOnScenarioClock, seedNorthCoast } from "../demo/north-coast.js";
import { DEMO_DIRECTOR_EMAIL, SCENARIO_TIME_ZONE } from "../demo/scenario-kit.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The Map screen's statewide reference layers, as the desktop install
 * configures them: critical facilities clustered and then drawn by lifeline,
 * tribal lands with their names, and the risk choropleths. It visits the
 * places they are judged at, at the frames' size and a 125%-scaled laptop's,
 * in both themes, and opens a facility in the inspector.
 */

const DIST = buildDir("reference-layers-app");
const SHOTS = join(shotDir("reference-layers"), "reference-layers");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const THEMES = ["light", "dark"] as const;
const ARCHIVES = ["california", "facilities", "boundaries", "risk"];
const has = (name: string) => existsSync(join(process.cwd(), "web", "public", "basemap", name));

/** Saved views the walk opens, centered on what it checks. */
const VIEWS = [
  { name: "Eureka z10", center: [-124.16, 40.79], zoom: 10 },
  { name: "Eureka z13", center: [-124.155, 40.792], zoom: 13 },
  { name: "Saint Joseph Hospital z15", center: [-124.14259, 40.78376], zoom: 15 },
  { name: "Sutter Coast Hospital z14", center: [-124.19233, 41.774], zoom: 14 },
  { name: "Crescent City z14", center: [-124.1985, 41.7565], zoom: 14 },
  { name: "Hoopa and Yurok z9", center: [-123.75, 41.25], zoom: 9 },
  { name: "North coast z8", center: [-124.0, 41.2], zoom: 8 },
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
    ...Object.fromEntries(["facilities", "boundaries", "risk"].flatMap((name) => [
      [`OPENEOC_${name.toUpperCase()}_PMTILES_URL`, `/app/basemap/${name}.pmtiles`],
      [`OPENEOC_${name.toUpperCase()}_MANIFEST_URL`, `/app/basemap/${name}-manifest.json`],
    ])),
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
  for (const seed of [seedDelNorte, seedDeerhorn]) await placeOnScenarioClock(admin, await seed(app, admin));
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

/** Wait until the page has had no request in flight for a second, then let the last tiles paint. */
async function quiet(page: Page, inFlight: () => number): Promise<void> {
  let calm = 0;
  for (let waited = 0; waited < 30_000 && calm < 1_000; waited += 250) {
    await page.waitForTimeout(250);
    calm = inFlight() === 0 ? calm + 250 : 0;
  }
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

describe.skipIf(!ready)("the Map screen's reference layers", () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      it(`clusters and draws facilities, names tribal lands and shades risk (${theme}, ${viewport.width} by ${viewport.height})`, async () => {
        const problems: string[] = [];
        const outside: string[] = [];
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
        // Every warning counts but headless Chrome's missing geolocation; failed requests are named below.
        page.on("console", (message) => {
          const text = message.text();
          if ((message.type() === "warning" || message.type() === "error")
            && !/^Failed to load resource|Geolocation support is not available/.test(text)) problems.push(`${message.type()}: ${text}`);
        });
        page.on("request", () => { inFlight += 1; });
        page.on("requestfinished", () => { inFlight -= 1; });
        page.on("requestfailed", () => { inFlight -= 1; });
        // A workspace with no saved layout answers 404 by design.
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
        const size = `${theme}-${viewport.width}`;
        const shot = (name: string) => page.screenshot({ path: join(SHOTS, `${name}-${size}.png`) });
        const go = async (name: string) => {
          await page.getByTestId("map-tools").evaluate((section) => { (section as { open: boolean }).open = true; });
          await page.getByRole("button", { name, exact: true }).click();
          await quiet(page, () => inFlight);
        };
        const inspector = page.getByTestId("cop-feature-inspector");
        /** Click the facility a view is centered on and read the inspector. */
        const inspectCenter = async () => {
          await page.getByTestId("cop-map").click();
          await inspector.waitFor();
          return inspector.innerText();
        };

        await chooseIncident(page, "North Coast Storm");
        await openMap(page);
        await quiet(page, () => inFlight);
        // Seven lifelines hold facilities; the manifest marks the eighth empty.
        const lifelines = page.getByTestId("facility-layer-group");
        await lifelines.getByText("None in this layer").waitFor();
        expect(await lifelines.locator("input[type=checkbox]:checked").count()).toBe(7);
        await page.getByRole("navigation", { name: "Map layers" }).screenshot({ path: join(SHOTS, `layers-${size}.png`) });

        await go("Eureka z10");
        await shot("eureka-z10-clusters");
        await go("Eureka z13");
        await shot("eureka-z13-icons");
        await go("Saint Joseph Hospital z15");
        await shot("eureka-z15-names");
        const hospital = await inspectCenter();
        expect(hospital.toLowerCase()).toContain("critical facility");
        expect(hospital).toContain("Providence Saint Joseph Hospital Eureka");
        expect(hospital).toContain("Health & Medical");
        expect(hospital).not.toContain("Operational status");
        await shot("eureka-z15-inspector");
        await inspector.getByRole("button", { name: "Close selected map feature" }).click();
        // Crescent City's hospital, clear of Del Norte's incident areas, which draw above it.
        await go("Sutter Coast Hospital z14");
        expect(await inspectCenter()).toContain("Sutter Coast Hospital");
        await inspector.getByRole("button", { name: "Close selected map feature" }).click();
        await go("Crescent City z14");
        await shot("crescent-city-z14-reference");

        // Risk: one index at a time, tracts from z8.
        await page.locator("#cop-risk-layer").selectOption("nri_tsunami");
        await go("North coast z8");
        expect(await page.getByTestId("reference-legend-nri").innerText()).toContain("Very high");
        await shot("north-coast-z8-nri-tsunami");
        await page.locator("#cop-risk-layer").selectOption("svi");
        await go("Eureka z10");
        await page.getByTestId("reference-legend-svi").waitFor();
        await shot("eureka-z10-svi");
        await page.locator("#cop-risk-layer").selectOption("");

        // Crescent City under Del Norte's own incident layers.
        await chooseIncident(page, "Del Norte Atmospheric Rivers");
        await openMap(page);
        await quiet(page, () => inFlight);
        await go("Sutter Coast Hospital z14");
        await shot("crescent-city-hospital-z14");
        await go("Crescent City z14");
        await shot("crescent-city-z14");

        await chooseIncident(page, "Deerhorn Lightning Complex");
        await openMap(page);
        await quiet(page, () => inFlight);
        await go("Hoopa and Yurok z9");
        await shot("deerhorn-z9-tribal");

        await context.close();
        expect(problems).toEqual([]);
        expect(outside).toEqual([]);
      }, 300_000);
    }
  }
});
