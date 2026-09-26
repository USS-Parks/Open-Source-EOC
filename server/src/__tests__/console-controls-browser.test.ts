import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, placeOnScenarioClock, seedNorthCoast } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The console's command bar, Settings and page layouts on the North Coast
 * Storm scenario, at 1534 by 790: a 1920 by 1080 screen at Windows' 125%
 * scaling, the size most laptops give the browser. Every screen must fit or
 * scroll there, never press its parts together or cut them off.
 */

const DIST = buildDir("console-controls");
const VIEWPORT = { width: 1534, height: 790 };

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let baseUrl: string;
const pageErrors: string[] = [];

type Box = { x: number; y: number; width: number; height: number };
async function box(selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} has no box`);
  return found;
}
const rail = (name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null, requireAdminMfa: false });
  serveStatic(app, "/app", DIST);
  const scenario = await seedNorthCoast(app, admin);
  await placeOnScenarioClock(admin, scenario);
  baseUrl = await listen(app);
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: VIEWPORT, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
  page = await context.newPage();
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
  await page.getByRole("button", { name: "Account menu" }).waitFor();
  // The device PIN offer stands above every screen after sign-in until answered; these walks measure the screens.
  await page.getByRole("region", { name: "Device PIN" }).getByRole("button", { name: "Not now" }).click();
}, 240_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the console's command bar, settings and layouts at a laptop's size", () => {
  it("opens the notifications panel from the bell, flush under it, and opens a notification in the center", async () => {
    const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
    const unread = async () => Number(/(\d+) unread/.exec((await bell.getAttribute("aria-label"))!)![1]);
    await expect.poll(unread, { timeout: 20_000 }).toBeGreaterThan(0);
    const before = await unread();
    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await panel.waitFor();
    const bellBox = await box(".eoc-shell-bell");
    const panelBox = await box(".eoc-shell-bell-panel");
    const bar = await box(".eoc-shell-command");
    expect(Math.abs(panelBox.x + panelBox.width - (bellBox.x + bellBox.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(panelBox.y - (bar.y + bar.height))).toBeLessThanOrEqual(2);
    const first = panel.getByRole("list").getByRole("button").first();
    const title = (await first.locator("strong").textContent())!;
    await first.click();
    await page.waitForURL((url) => url.hash.startsWith("#/alerts/"));
    await expect.poll(() => panel.count()).toBe(0);
    await page.getByRole("heading", { name: title }).first().waitFor();
    await expect.poll(unread).toBe(before - 1);
  });

  it("hangs the account menu flush under its own column", async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    const column = await box(".eoc-shell-account");
    const menu = await box(".eoc-shell-account-menu");
    expect(Math.abs(menu.x - column.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(menu.width - column.width)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect.poll(() => page.locator(".eoc-shell-account-menu").count()).toBe(0);
  });

  it("keeps the theme at the foot of the rail and gives Settings working sections", async () => {
    await page.locator(".eoc-shell-rail-foot").getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.waitFor();
    expect(await settings.getByRole("radio", { name: "Dark" }).count()).toBe(0);
    for (const name of ["General", "Account", "Notifications", "Map", "This computer", "About"])
      await settings.getByRole("tab", { name }).waitFor();
    await settings.getByRole("tab", { name: "Account" }).click();
    await settings.getByLabel("Current password").waitFor();
    await settings.getByRole("tab", { name: "About" }).click();
    const { version } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
    await settings.getByText(version, { exact: false }).waitFor();
    await settings.getByRole("tab", { name: "Map" }).click();
    await settings.getByRole("radio", { name: "Kilometers and meters" }).check();
    await settings.getByRole("button", { name: "Close Settings" }).click();

    await rail("Map");
    await page.getByTestId("cop-map").waitFor();
    await expect.poll(() => page.locator(".maplibregl-ctrl-scale").textContent(), { timeout: 20_000 }).toMatch(/\d+\s*(km|m)$/);
  });

  it("lets the map fill its screen and opens the impact indicators over it on request", async () => {
    const workspace = await box(".eoc-shell-workspace");
    const map = await box('[data-testid="cop-map"]');
    expect(map.height).toBeGreaterThanOrEqual(workspace.height - 60);
    expect(await page.getByRole("region", { name: "Map impact indicators" }).count()).toBe(0);
    await page.getByRole("button", { name: "Impact in view" }).click();
    await page.getByRole("region", { name: "Map impact indicators" }).waitFor();
    await page.getByRole("button", { name: "Impact in view" }).click();
    await page.getByRole("button", { name: "Hide map layers" }).click();
    expect((await box('[data-testid="cop-map"]')).width).toBeGreaterThan(map.width + 200);
    await page.getByRole("button", { name: "Map layers" }).click();
  });

  it("scrolls the ESF coordination view to its last function", async () => {
    await rail("ESFs & Lifelines");
    await page.getByRole("button", { name: "ESF coordination" }).click();
    const last = page.getByText("California ESF 18: Cybersecurity");
    await last.waitFor({ state: "attached" });
    await last.scrollIntoViewIfNeeded();
    const shown = await last.boundingBox();
    expect(shown).not.toBeNull();
    expect(shown!.y + shown!.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("never presses the overview's lifeline rows together, in either theme", async () => {
    for (const theme of ["dark", "light"] as const) {
      await page.getByRole("button", { name: "Account menu" }).click();
      const toggle = page.getByRole("button", { name: theme === "dark" ? "Use dark theme" : "Use light theme" });
      if (await toggle.count()) await toggle.click();
      await page.getByRole("button", { name: "Account menu" }).click();
      await rail("Overview");
      const rows = page.locator(".eoc-overview-lifelines li");
      await expect.poll(() => rows.count()).toBe(8);
      // Measured with the assessments in: a dark row's impact runs to two lines.
      await expect.poll(() => page.locator(".eoc-overview-lifelines").innerText()).not.toContain("Loading…");
      type Rect = { top: number; bottom: number };
      type Row = { getBoundingClientRect(): Rect; scrollHeight: number; clientHeight: number };
      const boxes = await rows.evaluateAll((items) => items.map((raw) => {
        const item = raw as unknown as Row;
        const row = item.getBoundingClientRect();
        return { top: row.top, bottom: row.bottom, contentHeight: item.scrollHeight, height: item.clientHeight };
      }));
      for (const [index, row] of boxes.entries()) {
        expect(row.contentHeight, `${theme} row ${index} content`).toBeLessThanOrEqual(row.height + 1);
        if (index > 0) expect(row.top, `${theme} row ${index}`).toBeGreaterThanOrEqual(boxes[index - 1]!.bottom - 1);
      }
      // The map card keeps its legend inside the card.
      const card = await box(".eoc-overview-card.is-cop");
      const legend = await page.locator(".eoc-overview-card.is-cop .eoc-cop-card-legend, .eoc-overview-card.is-cop [class*='legend']").first().boundingBox();
      if (legend) expect(legend.y + legend.height).toBeLessThanOrEqual(card.y + card.height + 1);
    }
    expect(pageErrors).toEqual([]);
  });
});
