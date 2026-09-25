import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * VA9 in a real browser: pool resources get printed labels whose QR code links
 * to the resource in this console. A printed label scanned at the console
 * finds its resource, and the label's link, opened as a phone would, signs in
 * to the pool with that resource found.
 */

const DIST = buildDir("resource-labels-app");
const SHOTS = shotDir("resource-labels");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const ids: Record<string, string> = {};

async function openPage(width: number, height: number, hash: string, blindDetector = false): Promise<{ page: Page; errors: string[]; external: string[] }> {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  // A browser with its own barcode detector that reads nothing from the image,
  // as macOS Chrome's did from a printed label: the bundled decoder must read it.
  if (blindDetector) await page.addInitScript(() => {
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class { async detect() { return []; } };
  });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html${hash}`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  return { page, errors, external };
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const { jurisdictionId } = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  for (const [name, kind, type] of [["Engine 41", "engine", 3], ["Engine 42", "engine", 4], ["Tender 7", "water_tender", 1]] as const) {
    ids[name] = (await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/resources`, { name, kind, type })).id as string;
  }
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("pool resource labels", () => {
  it("prints a label for each resource, and a printed label scanned at the console finds its resource", async () => {
    const { page, errors, external } = await openPage(1586, 992, "#/resources", true);
    const pool = page.getByRole("region", { name: "Resource pool" });
    await pool.getByText("Label code " + ids["Tender 7"]!.slice(0, 8).toUpperCase()).waitFor();
    await pool.getByRole("button", { name: "Show labels for 3 resources" }).click();
    const labels = pool.getByRole("region", { name: "Labels to print" });
    const engine = labels.getByRole("article", { name: "Label for Engine 41" });
    await engine.getByRole("img", { name: "QR code linking to Engine 41 in the resource pool" }).waitFor();
    expect(await engine.textContent()).toContain("Engine, Type 3");
    // This test's console is open at 127.0.0.1, which a phone cannot reach, and the screen says so.
    await labels.getByText(/open at this computer's own address/).waitFor();
    await labels.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resource-labels-1586.png"), fullPage: false });

    // Printed, the sheet holds the labels alone; one label's image is what a scanner sees.
    await page.emulateMedia({ media: "print" });
    expect(await page.locator("#root").isVisible()).toBe(false);
    const sheet = page.locator(".resources-tag-sheet");
    expect(await sheet.getByRole("article").count()).toBe(3);
    const printed = sheet.getByRole("article", { name: "Label for Engine 41" });
    await printed.getByRole("img").waitFor();
    const photo = await printed.screenshot();
    await page.screenshot({ path: join(SHOTS, "resource-labels-print.png"), fullPage: true });
    await page.emulateMedia({ media: "screen" });
    await labels.getByRole("button", { name: "Close labels" }).click();
    await labels.waitFor({ state: "detached" });

    await pool.getByLabel("Scan a resource label").setInputFiles({ name: "label.png", mimeType: "image/png", buffer: photo });
    await pool.getByText("Found by label: Engine 41.").waitFor();
    expect(await pool.getByRole("listitem").filter({ has: page.locator("strong") }).allTextContents())
      .toEqual([expect.stringContaining("Engine 41")]);
    expect(await pool.getByRole("searchbox").inputValue()).toBe(ids["Engine 41"]!.slice(0, 8).toUpperCase());
    // The scan puts the resource in the address, so it can be shared or reopened.
    expect(new URL(page.url()).hash).toMatch(new RegExp(`^#/resources/pool/${ids["Engine 41"]}(\\?|$)`));
    await pool.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resource-label-found-1586.png"), fullPage: false });

    await pool.getByRole("button", { name: "Show every resource" }).click();
    await pool.getByText("Tender 7", { exact: true }).waitFor();
    expect(new URL(page.url()).hash).toMatch(/^#\/resources(\?|$)/);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 120_000);

  it("opens a label's link, as a phone camera does, to the pool with that resource found", async () => {
    const { page, errors, external } = await openPage(1534, 790, `#/resources/pool/${ids["Tender 7"]}`);
    const pool = page.getByRole("region", { name: "Resource pool" });
    await pool.getByText("Found by label: Tender 7.").waitFor();
    expect(await pool.getByText("Engine 41").count()).toBe(0);
    // The pool sits below the requests; the found resource is brought into view.
    await expect.poll(async () => {
      const box = await pool.getByText("Found by label: Tender 7.").boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height <= 790;
    }).toBe(true);
    await page.screenshot({ path: join(SHOTS, "resource-label-link-1534.png"), fullPage: false });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 120_000);
});
