import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { GAZETTEER_HEADER } from "../geocode/normalize.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Real-browser address search: the command bar box searches the server's
 * offline gazetteer, and choosing a result opens the map centred on it with
 * a marker, from the map itself or from any other screen.
 */

const DIST = buildDir("place-search-app");
const SHOTS = shotDir("place-search");

// kind, name, class, context, lon, lat, key, addresses
const FIXTURE = [
  "place\tEureka\tcity\t\t-124.17076\t40.80188\teureka\t",
  "place\tArcata\ttown\t\t-124.08284\t40.86652\tarcata\t",
  "street\t3rd Street\ttertiary\tEureka\t-124.15693\t40.80493\t3rd street\t816,-124.16261,40.80401",
  "street\tEureka Way\tminor\tWeed\t-122.38562\t41.42291\teureka way\t55,-122.38631,41.42235",
  "poi\tHumboldt County Courthouse\tcourthouse\tEureka\t-124.1624\t40.80294\thumboldt county courthouse\t",
];

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let dir: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

/**
 * Resolves once the map has settled on the place (the corner readout shows
 * its centre and zoom after each move) and the search marker's point sits
 * within a few pixels of the canvas centre.
 */
async function atPlace(target: Page, lon: number, lat: number, zoom: number): Promise<void> {
  await target.getByTestId("cop-readout")
    .filter({ hasText: `${lat.toFixed(4)}, ${lon.toFixed(4)} · z${zoom.toFixed(1)}` })
    .waitFor({ timeout: 20_000 });
  await target.waitForFunction(`(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const markers = document.querySelectorAll(".maplibregl-marker");
    if (!canvas || markers.length !== 1) return false;
    const c = canvas.getBoundingClientRect();
    const m = markers[0].getBoundingClientRect();
    // The default marker is centre-anchored and drawn 14 px above its point.
    return Math.abs(m.left + m.width / 2 - (c.left + c.width / 2)) < 6
      && Math.abs(m.top + m.height / 2 + 14 - (c.top + c.height / 2)) < 6;
  })()`, undefined, { timeout: 20_000 });
}

async function choose(target: Page, query: string, option: RegExp): Promise<void> {
  const box = target.getByRole("combobox", { name: "Search addresses and places" });
  await box.fill(query);
  await target.getByRole("option", { name: option }).waitFor();
  await box.press("Enter");
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  dir = mkdtempSync(join(tmpdir(), "place-search-"));
  writeFileSync(join(dir, "gazetteer.tsv"), `${GAZETTEER_HEADER}\t2026-09-23T00:00:00Z\n${FIXTURE.join("\n")}\n`);
  app = buildApp(runtime, { oidc: null, gazetteerPath: join(dir, "gazetteer.tsv") });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("real-browser address and place search", () => {
  it("moves the map to a chosen address and to a chosen place from the map's search", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Map", exact: true }).click();
    await page.waitForSelector('[data-testid="cop-map"]');
    const box = page.getByRole("combobox", { name: "Search addresses and places" });
    await box.waitFor();

    // An address, first.
    await box.fill("816 3rd street eureka");
    const options = page.getByRole("listbox", { name: "Addresses and places" }).getByRole("option");
    await options.first().waitFor();
    expect(await options.first().textContent()).toBe("816 3rd StreetAddress · Eureka");
    await page.screenshot({ path: join(SHOTS, "place-search-address-light.png"), fullPage: false });
    await box.press("Enter");
    await atPlace(page, -124.16261, 40.80401, 18);

    // On the map: the city of Eureka ranks above Eureka Way, and the map moves to it.
    await box.fill("Eureka");
    await page.getByRole("option", { name: /Eureka Way/ }).waitFor();
    expect(await options.first().textContent()).toBe("EurekaPlace · city");
    await page.screenshot({ path: join(SHOTS, "place-search-map-light.png"), fullPage: false });
    await box.press("Enter");
    await atPlace(page, -124.17076, 40.80188, 12);

    // The chosen place holds when the theme change rebuilds the map.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await atPlace(page, -124.17076, 40.80188, 12);
    await choose(page, "courthouse", /Humboldt County Courthouse/);
    await atPlace(page, -124.1624, 40.80294, 17);
    await box.fill("3rd");
    await options.first().waitFor();
    await page.screenshot({ path: join(SHOTS, "place-search-map-dark.png"), fullPage: false });
    await box.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await box.fill("arcata");
    await page.getByRole("option", { name: /Arcata/ }).waitFor();
    expect(await page.evaluate(`(() => {
      const r = document.querySelector(".eoc-shell-search-popup").getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    })()`)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "place-search-narrow-dark.png"), fullPage: false });
    await box.press("Enter");
    await atPlace(page, -124.08284, 40.86652, 13);

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);

  it("tells what is at a point on the map from the offline gazetteer", async () => {
    await page.setViewportSize({ width: 1586, height: 992 });
    await choose(page, "816 3rd street eureka", /816 3rd Street/);
    await atPlace(page, -124.16261, 40.80401, 18);
    const tools = page.getByText("Map tools and saved views", { exact: true });
    if (await tools.isVisible()) await tools.click();
    await page.getByRole("button", { name: "What is here?" }).click();
    await page.getByRole("button", { name: "Click a point on the map…" }).waitFor();
    const canvas = await page.locator("canvas.maplibregl-canvas").boundingBox();
    // Just below the search marker, which sits over the address itself.
    await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2 + 12);
    const answer = page.locator(".eoc-cop-identify");
    await answer.getByText("Near this point").waitFor();
    await answer.getByText(/^816 3rd Street, Eureka \(\d+ m\)$/).waitFor();
    await answer.getByText(/^Eureka, city \(\d+ m\)$/).waitFor();
    await page.getByRole("button", { name: "What is here?" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "place-search-what-is-here-1586.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
