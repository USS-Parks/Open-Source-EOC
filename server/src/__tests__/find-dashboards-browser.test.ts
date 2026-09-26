import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  NORTH_COAST_DIRECTOR, NORTH_COAST_INCIDENT, NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, placeOnScenarioClock, seedNorthCoast,
} from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * An evaluator opening the desktop demonstration finds every dashboard
 * without the Settings dialog: the demo signs in by itself, the rail lists
 * every section, the Dashboards section links to each screen's Dashboard tab,
 * each screen reaches its Dashboard in one click, and a screen left on its
 * Dashboard reopens there. The page carries the runtime config the demo
 * launcher writes, and nothing in local storage asks for every section.
 */

const DIST = buildDir("find-dashboards-app");
const SHOTS = shotDir("find-dashboards");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const pageErrors: string[] = [];
const outside: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const scenario = await seedNorthCoast(app, admin);
  await placeOnScenarioClock(admin, scenario);
  baseUrl = await listen(app);
  // The rail's default, as a fresh install has it: no stored choice.
  browser = await launchBrowser({ coreRail: true });
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

/** Each screen with a Dashboard tab: its label, the page title it opens, and the list tab beside the Dashboard. */
const SCREENS = [
  { link: "Tasks", title: "Tasks", list: "My Tasks" },
  { link: "IAP", title: "IAP", list: "Plans" },
  { link: "Resources", title: "Resources", list: "Requests" },
  { link: "AAR", title: "AAR", list: "Records" },
  { link: "Shelters", title: "Board detail", list: null },
  { link: "Damage Assessment", title: "Damage Assessment", list: "Assessment" },
] as const;

const dashboardOpen = (page: Page) => page.getByRole("tab", { name: "Dashboard", selected: true }).waitFor();

async function openScreen(page: Page, rail: Locator, screen: (typeof SCREENS)[number]): Promise<void> {
  if (screen.link === "Shelters") {
    await rail.getByRole("button", { name: "Boards", exact: true }).click();
    const row = page.getByRole("row").filter({ has: page.getByText("shelters", { exact: true }) });
    await row.getByRole("button", { name: /^Open / }).click();
  } else {
    await rail.getByRole("button", { name: screen.link, exact: true }).click();
  }
  await page.getByRole("heading", { level: 1, name: screen.title }).waitFor();
  await page.getByRole("tab", { name: "Dashboard" }).waitFor();
}

describe("finding the dashboards in the desktop demonstration", () => {
  for (const viewport of VIEWPORTS) {
    it(`reaches every Dashboard tab from a fresh demo sign-in at ${viewport.width} by ${viewport.height}`, async () => {
      const context = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
      await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify({
        OPENEOC_SYNTHETIC_DATA: "1",
        OPENEOC_DEMO_EMAIL: NORTH_COAST_DIRECTOR,
        OPENEOC_DEMO_PASSWORD: NORTH_COAST_PASSWORD,
        OPENEOC_DEMO_INCIDENT: NORTH_COAST_INCIDENT,
        OPENEOC_DEMO_ALL_SECTIONS: "1",
      })};`);
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        outside.push(url);
        return route.abort();
      });
      // No sign-in step: the demonstration signs in as its director.
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Account menu" }).waitFor();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: NORTH_COAST_INCIDENT }).waitFor({ state: "attached" });
      expect(await page.evaluate(`localStorage.getItem("openeoc.navigation.allSections")`)).toBeNull();

      const rail = page.getByRole("navigation", { name: "Sections" });
      const sections = await rail.locator(".eoc-shell-nav-scroll button").allInnerTexts();
      for (const name of ["Dashboards", "AAR", "Reports", "Damage Assessment", "Chronology"]) expect(sections).toContain(name);

      // The Dashboards section lists the saved dashboards and links to each screen's Dashboard tab.
      for (const screen of SCREENS) {
        await rail.getByRole("button", { name: "Dashboards", exact: true }).click();
        const links = page.getByRole("navigation", { name: "Screen dashboards" });
        await links.waitFor();
        await page.getByLabel("Saved dashboard").waitFor();
        if (screen === SCREENS[0]) await page.screenshot({ path: join(SHOTS, `dashboards-${viewport.width}.png`) });
        await links.getByRole("button", { name: `${screen.link} dashboard` }).click();
        await page.getByRole("heading", { level: 1, name: screen.title }).waitFor();
        await dashboardOpen(page);
        await page.screenshot({ path: join(SHOTS, `${screen.link.replaceAll(" ", "-").toLowerCase()}-${viewport.width}.png`) });
      }

      // From each screen: one click reaches the Dashboard, and leaving and returning reopens it.
      for (const screen of SCREENS) {
        await openScreen(page, rail, screen);
        await dashboardOpen(page);
        const list = screen.list ? page.getByRole("tab", { name: screen.list, exact: true })
          : page.getByRole("tablist", { name: "Board views" }).getByRole("tab").first();
        await list.click();
        await rail.getByRole("button", { name: "Overview", exact: true }).click();
        await openScreen(page, rail, screen);
        expect(await page.getByRole("tab", { name: "Dashboard" }).getAttribute("aria-selected")).toBe("false");
        await page.getByRole("tab", { name: "Dashboard" }).click();
        await dashboardOpen(page);
        await rail.getByRole("button", { name: "Overview", exact: true }).click();
        await openScreen(page, rail, screen);
        await dashboardOpen(page);
      }
      expect(await page.getByRole("dialog", { name: "Settings" }).count()).toBe(0);
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 240_000);
  }
});
