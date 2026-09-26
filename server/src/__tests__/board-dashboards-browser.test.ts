import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  NORTH_COAST_DIRECTOR,
  NORTH_COAST_PASSWORD,
  NORTH_COAST_TIME_ZONE,
  placeOnScenarioClock,
  seedNorthCoast,
  type NorthCoastScenario,
} from "../demo/north-coast.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The Dashboard tabs of Tasks, IAP and Resources on the North Coast Storm,
 * as the exercise director, at the frames' 1586 by 992 and a 125%-scaled
 * laptop's 1534 by 790, in light and dark. Each chart, chip and tile is
 * clicked, and the list beside it must then hold exactly the count the chart
 * showed; nothing scrolls sideways and the page raises no error. North Coast
 * has no plans, so the walk has its sections prepare six through the API.
 */

const DIST = buildDir("board-dashboards");
const SHOTS = shotDir("board-dashboards");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const THEMES = ["light", "dark"] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];
const outside: string[] = [];

async function call(token: string, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const response = await app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

/** A token for `email`, signed in to the named position when one is given. */
async function signIn(email: string, positionKey?: string): Promise<string> {
  const token = await login(app, email, NORTH_COAST_PASSWORD);
  if (positionKey) {
    const { positions } = await call(token, "GET", `/api/v1/jurisdictions/${scenario.jurisdictionId}/positions`) as { positions: { id: string; key: string }[] };
    await call(token, "POST", `/api/v1/positions/${positions.find((position) => position.key === positionKey)!.id}/sign-in`);
  }
  return token;
}

const FORMS = ["ICS-202", "ICS-203", "ICS-204", "ICS-205", "ICS-206", "ICS-207", "ICS-208"];

/** Six plans across the three periods and three sections, one in each display state and two in progress. */
async function preparePlans(): Promise<void> {
  const planning = await signIn(NORTH_COAST_DIRECTOR, "planning_section_chief");
  const operations = await signIn("d.nguyen@humboldt.example", "operations_section_chief");
  const shelter = await signIn("s.patel@redcross.example");
  const plan = async (token: string, period: number, forms: number) =>
    (await call(token, "POST", `/api/v1/incidents/${scenario.incidentId}/iap`, {
      operationalPeriod: `OP 0${period}`, periodRevision: period, formIds: FORMS.slice(0, forms),
    })).id as string;
  const first = await plan(planning, 1, 7);
  await call(planning, "POST", `/api/v1/iap/${first}/approve`);
  await call(planning, "POST", `/api/v1/iap/${first}/complete`);
  await call(planning, "POST", `/api/v1/iap/${await plan(planning, 2, 7)}/approve`);
  await call(planning, "POST", `/api/v1/iap/${await plan(planning, 3, 7)}/submit`);
  await plan(operations, 3, 4);
  await plan(planning, 3, 2);
  await plan(shelter, 3, 0);
}

async function useTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  if (await page.locator(".eoc-theme").first().getAttribute("data-theme") === theme) return;
  const menu = page.getByRole("button", { name: "Account menu" });
  if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
  await page.getByRole("button", { name: theme === "dark" ? "Use dark theme" : "Use light theme" }).click();
  await expect.poll(() => page.locator(".eoc-theme").first().getAttribute("data-theme")).toBe(theme);
  if (await menu.getAttribute("aria-expanded") === "true") await menu.click();
}

/** Nothing between the dashboard and the window scrolls sideways, and neither does the dashboard. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(`(() => {
    const wide = [];
    for (let element = document.querySelector(".eoc-board"); element; element = element.parentElement) {
      if (element.scrollWidth > element.clientWidth + 1) wide.push(element.tagName + "." + element.className + " " + element.scrollWidth + " > " + element.clientWidth);
    }
    return wide;
  })()`);
  expect(overflow).toEqual([]);
}

async function openTab(page: Page, section: string, tab: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section, exact: true }).click();
  await page.getByRole("tab", { name: tab }).click();
  await page.locator(".eoc-board").first().waitFor();
}

const rowsOf = (region: Locator) => region.getByRole("listitem");
function countIn(text: string, pattern: RegExp): number {
  expect(text).toMatch(pattern);
  return Number(pattern.exec(text)![1]);
}

/** Click a legend row, a chip or a tile, check the list holds its count, and clear it again. */
async function drill(page: Page, control: Locator, region: string, pattern: RegExp): Promise<number> {
  const expected = countIn((await control.getAttribute("aria-label")) ?? (await control.textContent())!, pattern);
  await control.click();
  await expect.poll(() => rowsOf(page.getByRole("region", { name: region, exact: true })).count()).toBe(expected);
  return expected;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null, requireAdminMfa: false });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  await placeOnScenarioClock(admin, scenario);
  await preparePlans();
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the Tasks, IAP and Resources dashboards on the North Coast Storm", () => {
  for (const viewport of VIEWPORTS) {
    it(`draws each dashboard and drills from its charts into its list at ${viewport.width} by ${viewport.height}`, async () => {
      const context: BrowserContext = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
      // The scenario is synthetic, as a demo profile's is.
      await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify({ OPENEOC_SYNTHETIC_DATA: "1" })};`);
      const page = await context.newPage();
      await page.clock.setFixedTime(scenario.clock);
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        outside.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.getByLabel("Email").fill(NORTH_COAST_DIRECTOR);
      await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("button", { name: "Account menu" }).waitFor();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
      const pin = page.getByRole("region", { name: "Device PIN" });
      if (await pin.isVisible()) await pin.getByRole("button", { name: "Not now" }).click();
      // The page's clock stands at the scenario's 09:42, so the console rightly says it is behind the server's.
      const skew = page.locator(".eoc-clock-notice");
      await skew.waitFor({ timeout: 10_000 }).then(() => skew.getByRole("button", { name: "Dismiss" }).click(), () => undefined);
      const shot = (name: string) => page.screenshot({ path: join(SHOTS, `${name}-${viewport.width}.png`) });

      for (const theme of THEMES) {
        await useTheme(page, theme);

        // Tasks: every legend row and chip filters the list to its count.
        await openTab(page, "Tasks", "Dashboard");
        const summary = (await page.locator(".eoc-board-filter").first().textContent())!;
        const [lists, tasks] = [countIn(summary, /(\d+) lists?/), countIn(summary, /(\d+) tasks?/)];
        expect(await rowsOf(page.getByRole("region", { name: "Checklists" })).count()).toBe(lists);
        await page.waitForLoadState("networkidle");
        await shot(`tasks-${theme}`);
        // With the context drawer closed the list and its charts take the whole workspace.
        await page.getByRole("button", { name: "Close context drawer" }).click();
        await expectNoSidewaysScroll(page);
        await shot(`tasks-${theme}-wide`);
        await page.getByRole("button", { name: "Open context" }).click();
        for (const [card, region] of [["Lists by status", "Checklists"], ["Pace", "Checklists"], ["Tasks by status", "Tasks"], ["Tasks by category", "Tasks"]] as const) {
          // A legend row's name carries its count; its VIEW button's does not.
          const legend = page.getByRole("list", { name: `${card} legend` }).getByRole("button", { name: /\d+ \(/ });
          let sum = 0;
          for (let index = 0; index < await legend.count(); index += 1) {
            sum += await drill(page, legend.nth(index), region, /(\d+) \(/);
            await legend.nth(index).click();
          }
          expect(sum, card).toBe(region === "Tasks" ? tasks : lists);
        }
        const chips = page.getByRole("list", { name: "Filter lists by status" });
        await drill(page, chips.getByRole("button", { name: /Past due/ }), "Checklists", /^(\d+)/);
        await expectNoSidewaysScroll(page);
        await shot(`tasks-${theme}-past-due`);
        await page.getByRole("button", { name: "Clear filter" }).click();

        // VIEW opens the team task list on the same tasks.
        const open = page.getByRole("list", { name: "Tasks by status legend" }).getByRole("button", { name: /^Open \d+/ });
        const opened = countIn((await open.textContent())!, /(\d+) \(/);
        await page.getByRole("button", { name: "View Open", exact: true }).click();
        await page.getByRole("group", { name: `Tasks: ${opened}` }).waitFor();
        expect(await page.getByRole("tab", { name: "Team Tasks" }).getAttribute("aria-selected")).toBe("true");
        await page.getByLabel("Status", { exact: true }).selectOption("all");
        await page.getByRole("group", { name: `Tasks: ${tasks}` }).waitFor();

        // IAP: the tiles count the plans, for OP 03 and then for every period.
        await openTab(page, "IAP", "Dashboard");
        const plans = page.getByRole("region", { name: "Plans", exact: true });
        // The plan filters stand above both tabs, so the dashboard counts what the Plans tab lists.
        const period = page.getByRole("region", { name: "Working and published plans" }).getByLabel("Operational period");
        await period.selectOption("3");
        await expect.poll(() => rowsOf(plans).count()).toBe(4);
        await period.selectOption("");
        await expect.poll(() => rowsOf(plans).count()).toBe(6);
        await page.waitForLoadState("networkidle");
        await expectNoSidewaysScroll(page);
        await shot(`iap-${theme}`);
        const tiles = page.getByRole("list", { name: "Plans by status" }).getByRole("button");
        let plansCounted = 0;
        for (let index = 0; index < await tiles.count(); index += 1) {
          plansCounted += await drill(page, tiles.nth(index), "Plans", /^(\d+)/);
          await tiles.nth(index).click();
        }
        expect(plansCounted).toBe(6);
        await drill(page, page.getByRole("list", { name: "Plans by status" }).getByRole("button", { name: /In progress/ }), "Plans", /^(\d+)/);
        await shot(`iap-${theme}-in-progress`);
        // A row opens its plan on the Plans tab.
        await plans.getByRole("button", { name: /^Open OP 03/ }).first().click();
        await page.getByRole("region", { name: "Plan detail" }).getByRole("heading", { name: "OP 03" }).waitFor();

        // Resources: each tile and stage bar filters the request list to its count.
        await openTab(page, "Resources", "Dashboard");
        const requests = page.getByRole("region", { name: "Requests", exact: true });
        const total = countIn((await page.getByRole("list", { name: "Requests by count" }).getByRole("button", { name: /Total requests/ }).textContent())!, /^(\d+)/);
        await expect.poll(() => rowsOf(requests).count()).toBe(total);
        await page.waitForLoadState("networkidle");
        await expectNoSidewaysScroll(page);
        await shot(`resources-${theme}`);
        const counted = page.getByRole("list", { name: "Requests by count" }).getByRole("button");
        for (let index = 0; index < await counted.count(); index += 1) {
          await drill(page, counted.nth(index), "Requests", /^(\d+)/);
          await counted.nth(index).click();
        }
        const bars = page.getByRole("article", { name: "Requests by stage" }).getByRole("button", { name: /: \d+$/ });
        let staged = 0;
        for (let index = 0; index < await bars.count(); index += 1) {
          staged += await drill(page, bars.nth(index), "Requests", /(\d+)$/);
          await bars.nth(index).click();
        }
        expect(staged).toBe(total);
        await drill(page, counted.filter({ hasText: "Deployed" }), "Requests", /^(\d+)/);
        await shot(`resources-${theme}-deployed`);
        // The request list on the Requests tab, with only open requests, holds the Active count.
        const active = countIn((await counted.filter({ hasText: "Active" }).textContent())!, /^(\d+)/);
        await page.getByRole("tab", { name: "Requests" }).click();
        await page.getByRole("combobox", { name: "Show" }).selectOption("open");
        await page.getByText(new RegExp(`^Showing ${active} requests?: open only\\.`)).waitFor();
        await page.getByRole("combobox", { name: "Show" }).selectOption("all");
      }
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
