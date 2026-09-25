import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The console's clock notice, at the frames' 1586 by 992 and at 1534 by 790.
 * The server's clock is moved by rewriting the Date header it sends, as a
 * host that drifted through a long isolation would: the notice appears past
 * 30 seconds either way, says which way, goes when dismissed, returns when
 * the clocks drift further, and clears itself when they agree again.
 */

const DIST = buildDir("clock-notice");
const SHOTS = shotDir("clock-notice");
const MINUTE = 60_000;
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
/** How far the server's clock is ahead of this computer's, in milliseconds. */
let serverAhead = 0;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  app.addHook("onSend", async (_req, reply) => {
    if (serverAhead !== 0) reply.header("date", new Date(Date.now() + serverAhead).toUTCString());
  });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the clock notice", () => {
  for (const viewport of VIEWPORTS) {
    it(`warns when the device's clock and the server's differ by more than 30 seconds, at ${viewport.width} by ${viewport.height}`, async () => {
      serverAhead = 0;
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("admin@example.org");
      await page.getByLabel("Password").fill("correct-horse-battery");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("button", { name: "Account menu" }).waitFor();
      const notice = page.locator(".eoc-clock-notice");
      const rail = page.getByRole("navigation", { name: "Sections" });
      await rail.getByRole("button", { name: "Boards", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Boards" }).waitFor();
      expect(await notice.count()).toBe(0);

      // The server falls three minutes behind: this device reads as ahead.
      serverAhead = -3 * MINUTE;
      await rail.getByRole("button", { name: "Overview", exact: true }).click();
      await notice.getByText("This device's clock is 3 minutes ahead of the server's.").waitFor();
      await notice.getByText(/Two-step sign-in codes can be refused/).waitFor();
      expect(await notice.getAttribute("role")).toBe("status");
      await page.screenshot({ path: join(SHOTS, `clock-ahead-${viewport.width}.png`) });
      await notice.getByRole("button", { name: "Dismiss" }).click();
      expect(await notice.count()).toBe(0);

      // It drifts on to two minutes ahead of this device: the notice returns, the other way round.
      serverAhead = 2 * MINUTE;
      await rail.getByRole("button", { name: "Boards", exact: true }).click();
      await notice.getByText("This device's clock is 2 minutes behind the server's.").waitFor();
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("button", { name: "Use dark theme" }).click();
      await page.getByRole("button", { name: "Account menu" }).click();
      await notice.waitFor();
      await page.screenshot({ path: join(SHOTS, `clock-behind-dark-${viewport.width}.png`) });

      // Set right, the clocks agree and the notice clears itself.
      serverAhead = 0;
      await rail.getByRole("button", { name: "Overview", exact: true }).click();
      await notice.waitFor({ state: "detached" });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    });
  }
});
