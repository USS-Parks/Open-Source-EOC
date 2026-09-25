import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  NORTH_COAST_PASSWORD,
  NORTH_COAST_TIME_ZONE,
  placeOnScenarioClock,
  seedNorthCoast,
  type NorthCoastScenario,
} from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The design fidelity harness. It seeds the North Coast Storm reference
 * scenario through the API, places it on the scenario clock (09:42 local),
 * opens the console at the canonical frames' 1586 by 992 viewport in both
 * themes, captures the incident overview and the ESFs & Lifelines workspace
 * with Energy selected, and writes each capture beside its canonical frame.
 * `pnpm fidelity` writes the side-by-side images to docs/design/fidelity;
 * a plain test run writes them to the browser shot directory.
 */

const DIST = buildDir("fidelity-app");
const SHOTS = shotDir("fidelity");
const OUT = process.env["OPENEOC_FIDELITY_DIR"] ?? SHOTS;
const FRAMES = join(process.cwd(), "docs", "design", "canonical-references");
const VIEWPORT = { width: 1586, height: 992 };

/**
 * The offline archives present in this checkout, configured as a desktop
 * install configures them: the street basemap, NAIP imagery and 3DEP
 * elevation. A checkout without them captures over the bundled basemap.
 */
function runtimeConfig(): Record<string, string> {
  const has = (name: string) => existsSync(join(process.cwd(), "web", "public", "basemap", name));
  return {
    // The reference scenario is synthetic, as a demo profile's is.
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

type Theme = "light" | "dark";
interface Capture { readonly name: string; readonly theme: Theme; readonly frame: string | null }

const CAPTURES: readonly Capture[] = [
  { name: "overview-dark", theme: "dark", frame: "02-overview-dark.jpg" },
  { name: "overview-light", theme: "light", frame: "01-overview-light.jpg" },
  { name: "lifelines-light", theme: "light", frame: "03-lifelines-light.jpg" },
  { name: "lifelines-dark", theme: "dark", frame: null },
];

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];

async function useTheme(theme: Theme): Promise<void> {
  const current = await page.locator(".eoc-theme").first().getAttribute("data-theme");
  if (current === theme) return;
  const menu = page.locator("details.eoc-shell-account");
  if (await menu.getAttribute("open") === null) await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: theme === "dark" ? "Use dark theme" : "Use light theme" }).click();
  await expect.poll(() => page.locator(".eoc-theme").first().getAttribute("data-theme")).toBe(theme);
  if (await menu.getAttribute("open") !== null) await page.getByRole("button", { name: "Account menu" }).click();
}

async function openOverview(): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Overview", exact: true }).click();
}

async function openEnergy(): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "ESFs & Lifelines" }).click();
  await page.getByRole("button", { name: "Open Energy details" }).click();
  await page.getByRole("complementary", { name: "Energy" }).waitFor();
}

/** The capture beside its frame, both at the frame's 1280 by 800 size. */
async function sideBySide(capture: Capture, image: Buffer): Promise<void> {
  if (!capture.frame) return;
  const frame = readFileSync(join(FRAMES, capture.frame)).toString("base64");
  const composite = await browser.newPage({ viewport: { width: 2 * 1280 + 24, height: 800 + 40 } });
  await composite.setContent(`<!doctype html><html><body style="margin:0;background:#20252b;font:14px system-ui;color:#fff">
    <div style="display:flex;gap:24px;height:40px;align-items:center">
      <span style="width:1280px;padding-left:8px">Canonical frame: ${capture.frame}</span>
      <span style="width:1280px;padding-left:8px">Build capture: ${capture.name}, 1586 by 992 scaled to 1280 by 800</span>
    </div>
    <div style="display:flex;gap:24px">
      <img style="width:1280px;height:800px" src="data:image/jpeg;base64,${frame}">
      <img style="width:1280px;height:800px" src="data:image/png;base64,${image.toString("base64")}">
    </div></body></html>`);
  await composite.waitForFunction("[...document.images].every((img) => img.complete && img.naturalWidth > 0)");
  writeFileSync(join(OUT, `${capture.name}-side-by-side.jpg`), await composite.screenshot({ type: "jpeg", quality: 82 }));
  await composite.close();
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  await placeOnScenarioClock(admin, scenario);
  baseUrl = await listen(app);
  mkdirSync(OUT, { recursive: true });

  browser = await launchBrowser({ coreRail: true });
  context = await browser.newContext({ viewport: VIEWPORT, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
  await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify(runtimeConfig())};`);
  page = await context.newPage();
  await page.clock.setFixedTime(scenario.clock);
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:") ? route.continue() : route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("jordan.lee@humboldt.example");
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}, 240_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("design fidelity captures of the North Coast Storm scenario", () => {
  it("places the seeded record of events on the scenario clock", async () => {
    const [latest] = await admin`select max(created_at) as at from audit_events`;
    expect(new Date(latest!.at as string).getTime()).toBeLessThanOrEqual(scenario.clock.getTime());
    const [incident] = await admin`select kind from incidents where id = ${scenario.incidentId}`;
    expect(incident!.kind).toBe("exercise");
  });

  it("captures each screen at the frames' viewport and writes it beside its frame", async () => {
    await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
    await page.getByLabel("Acting position").selectOption({ label: "Planning Section Chief" });
    await page.locator('select[aria-label="Acting position"] option:checked', { hasText: "Planning Section Chief" }).waitFor({ state: "attached" });
    for (const capture of CAPTURES) {
      await useTheme(capture.theme);
      if (capture.name.startsWith("overview")) await openOverview();
      else await openEnergy();
      await page.waitForLoadState("networkidle");
      if (capture.name.startsWith("overview")) await page.locator('[data-testid="cop-map"][data-map-idle]').waitFor();
      const image = await page.screenshot();
      writeFileSync(join(SHOTS, `${capture.name}.png`), image);
      await sideBySide(capture, image);
    }
    expect(pageErrors).toEqual([]);
  }, 240_000);

  it("shows the frames' twelve sections in the rail, and every section when the viewer asks", async () => {
    const rail = page.getByRole("navigation", { name: "Sections" });
    const sections = () => rail.locator(".eoc-shell-nav-scroll button").allInnerTexts();
    await openOverview();
    expect(await sections()).toEqual([
      "Overview", "Map", "ESFs & Lifelines", "SITREP", "Boards", "Resources", "Tasks", "Field Reports",
      "Operational Periods", "IAP", "Participants", "Messages",
    ]);
    await rail.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Show every section").check();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Chronology", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Chronology" }).waitFor();
    await rail.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Show every section").uncheck();
    await page.keyboard.press("Escape");
    // The section in view stays listed, so the viewer always sees where it is.
    expect(await sections()).toContain("Chronology");
    await openOverview();
    expect(await sections()).not.toContain("Chronology");
  }, 120_000);
});
