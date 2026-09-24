import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("load-retry-browser");
const SHOTS = shotDir("load-retry-browser");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("a screen that fails to load", () => {
  it("shows an error with a reload, keeps the console usable, and opens the screen after the reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // The Reports module is lost, as when the network drops before the console has fetched it.
    let reportsReachable = false;
    let reportsRequests = 0;
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith(baseUrl)) return route.abort();
      if (/\/ReportsSurface-[^/]*\.js$/.test(url)) {
        reportsRequests += 1;
        if (!reportsReachable) return route.abort("internetdisconnected");
      }
      return route.continue();
    });
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    const rail = page.getByRole("navigation", { name: "Sections" });
    const failed = page.getByRole("region", { name: "Reports did not load" });
    const note = failed.getByRole("alert").filter({ hasText: "Reports could not be loaded. Check the network connection, then reload the page." });
    await rail.getByRole("button", { name: "Reports", exact: true }).click();
    await note.waitFor();

    // The rest of the console works: another screen opens, and Reports fails the same way again.
    await rail.getByRole("button", { name: "Boards", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Boards", exact: true }).waitFor();
    expect(await failed.count()).toBe(0);
    await rail.getByRole("button", { name: "Reports", exact: true }).click();
    await note.waitFor();
    // The browser keeps the failed import: opening Reports again fetched nothing, which is why the way back is a reload.
    expect(reportsRequests).toBe(1);
    await page.screenshot({ path: join(SHOTS, "load-retry-light-1440.png"), fullPage: false });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.locator('.eoc-theme[data-theme="dark"]').waitFor();
    await page.screenshot({ path: join(SHOTS, "load-retry-dark-1440.png"), fullPage: false });

    reportsReachable = true;
    await failed.getByRole("button", { name: "Reload page" }).click();
    await page.getByRole("heading", { level: 2, name: "Reports", exact: true }).waitFor();
    expect(await failed.count()).toBe(0);
    expect(errors).toEqual([]);
  }, 120_000);
});
