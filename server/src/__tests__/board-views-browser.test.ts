import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/** Real-browser proof of the board's kanban, calendar and chart modes and their dashboard widgets. */
const DIST = buildDir("board-views-app");
const SHOTS = shotDir("board-views");
const TIME_ZONE = "America/Los_Angeles";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let adminToken: string;
let jurisdictionId: string;
let incidentId: string;
let boardId: string;
let dashboardId: string;
let midMonthDay: string;
let nextDay: string;
const ids: Record<string, string> = {};
const dues: Record<string, string> = {};
const pageErrors: string[] = [];
const externalRequests: string[] = [];
const pages: Page[] = [];

const template = {
  key: "synthetic_view_ops",
  version: 1,
  title: "Synthetic View Operations",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["open", "in_progress", "closed"], required: true },
    { key: "due", label: "Due", type: "datetime" },
  ],
  views: [{ key: "all", title: "All work", columns: ["summary", "status", "due"] }],
};

/** The calendar day an instant falls on in the page's timezone. */
function localDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function openPage(hash: string, width = 1440): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: TIME_ZONE });
  pages.push(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html${hash}`);
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  const switcher = page.getByRole("button", { name: theme === "light" ? "Use light theme" : "Use dark theme" });
  if (await switcher.count()) await switcher.click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

async function narrow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(`(() => {
    const closeContext = document.querySelector('button[aria-label="Close context drawer"]');
    if (closeContext?.getClientRects().length) closeContext.click();
  })()`);
  expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
}

async function attributes(locator: Locator, name: string): Promise<(string | null)[]> {
  return Promise.all((await locator.all()).map((item) => item.getAttribute(name)));
}

async function statusCounts(): Promise<Record<string, number>> {
  const rows = await admin`
    select data ->> 'status' as status, count(*)::int as n from board_records
    where board_id = ${boardId} and archived_at is null group by 1`;
  return Object.fromEntries(rows.map((row) => [row.status as string, row.n as number]));
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  adminToken = await login(app);
  await post(app, adminToken, "/api/v1/templates", template);
  boardId = (await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/boards`, { templateKey: template.key })).id as string;
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Synthetic Board Views Exercise",
  })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;

  // 03:30 UTC on the 16th is the evening of the 15th on the Pacific coast, so
  // the calendar must place it by the viewer's timezone, not by UTC.
  const [year, month] = localDay(new Date().toISOString()).split("-").map(Number) as [number, number];
  const midMonth = new Date(Date.UTC(year, month - 1, 16, 3, 30)).toISOString();
  midMonthDay = localDay(midMonth);
  nextDay = midMonth.slice(0, 10);
  const day = 86_400_000;
  for (const [summary, status, due] of [
    ["Culvert survey", "open", midMonth],
    ["Bridge inspection", "open", new Date(Date.now() + 2 * day).toISOString()],
    ["Generator refuel", "open", null],
    ["Debris removal", "in_progress", new Date(Date.now() - 40 * day).toISOString()],
    ["Sandbag delivery", "closed", null],
  ] as const) {
    ids[summary] = (await post(app, adminToken, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`,
      { summary, status, ...(due ? { due } : {}) })).id as string;
    if (due) dues[summary] = due;
  }

  await post(app, adminToken, "/api/v1/dashboard-templates", {
    key: "synthetic_board_views", version: 1, title: "Board views",
    widgets: [
      { kind: "kanban", key: "work_by_status", title: "Work by status", board: template.key, field: "status" },
      { kind: "calendar", key: "work_due", title: "Work due", board: template.key, field: "due", labelField: "summary", limit: 5 },
      { kind: "chart", key: "work_counts", title: "Work counts", board: template.key, groupBy: "status", display: "bar" },
    ],
  });
  dashboardId = (await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/dashboards`, {
    templateKey: "synthetic_board_views",
  })).id as string;

  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  for (const page of pages) await page.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("board view modes in a real browser", () => {
  it("drags a card between kanban columns, places dated records by day and charts the counts", async () => {
    const page = await openPage(`#/board/${boardId}?incident=${incidentId}&view=all`);
    await page.getByRole("main").getByText("Sandbag delivery", { exact: true }).waitFor();
    const modes = page.getByRole("group", { name: "Show records as" });

    const grouped = page.waitForResponse((response) => response.url().includes(`/api/v1/boards/${boardId}/views/all?`)
      && response.url().includes("groupBy=status"));
    await modes.getByRole("button", { name: "Kanban" }).click();
    await grouped;
    const column = (value: string) => page.locator(`section.board-kanban__column[data-value="${value}"]`);
    await expect.poll(() => column("open").locator(".board-kanban__count").textContent()).toBe("3");
    expect(await column("in_progress").locator(".board-kanban__count").textContent()).toBe("1");
    const card = column("open").locator(".board-kanban__card", { hasText: "Culvert survey" });
    const moved = page.waitForResponse((response) => response.request().method() === "PATCH"
      && response.url().includes(`/records/${ids["Culvert survey"]}`));
    await card.dragTo(column("in_progress"));
    expect((await moved).status()).toBe(200);
    await column("in_progress").getByRole("button", { name: "Culvert survey" }).waitFor();
    expect(await column("open").locator(".board-kanban__count").textContent()).toBe("2");
    expect(await column("in_progress").locator(".board-kanban__count").textContent()).toBe("2");
    const persisted = await app.inject({ method: "GET", headers: auth(adminToken),
      url: `/api/v1/boards/${boardId}/records/${ids["Culvert survey"]}/detail?incidentId=${incidentId}` });
    expect(persisted.json().data.status).toBe("in_progress");
    await page.screenshot({ path: join(SHOTS, "board-views-kanban-light-1440.png"), fullPage: false });

    await modes.getByRole("button", { name: "Calendar" }).click();
    const calendarDay = page.locator(`li[data-day="${midMonthDay}"]`);
    await calendarDay.getByRole("button", { name: /Culvert survey$/ }).waitFor();
    expect(midMonthDay).not.toBe(nextDay);
    expect(await page.locator(`li[data-day="${nextDay}"]`).getByText("Culvert survey").count()).toBe(0);
    expect(await calendarDay.locator("time").getAttribute("datetime")).toBe(dues["Culvert survey"]);
    await page.screenshot({ path: join(SHOTS, "board-views-calendar-light-1440.png"), fullPage: false });
    const paged = page.waitForResponse((response) => response.url().includes(`/api/v1/boards/${boardId}/views/all?`)
      && decodeURIComponent(response.url()).includes('"op":"between"'));
    await page.getByRole("button", { name: "Next month" }).click();
    await paged;
    await expect.poll(() => page.getByRole("button", { name: /Culvert survey$/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Today" }).click();
    await calendarDay.getByRole("button", { name: /Culvert survey$/ }).waitFor();

    await modes.getByRole("button", { name: "Chart" }).click();
    const chart = page.getByRole("figure", { name: "Records by Status" });
    await chart.waitFor();
    const counts = await statusCounts();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const title = (label: string, n: number) => `${label}: ${n} records, ${Math.round((n / total) * 100)}%`;
    expect(await attributes(chart.locator(".board-chart__bars li"), "title"))
      .toEqual([title("Open", counts.open!), title("In progress", counts.in_progress!), title("Closed", counts.closed!)]);
    expect(counts).toEqual({ open: 2, in_progress: 2, closed: 1 });
    await setTheme(page, "dark");
    await page.screenshot({ path: join(SHOTS, "board-views-chart-dark-1440.png"), fullPage: false });

    await narrow(page);
    await page.screenshot({ path: join(SHOTS, "board-views-chart-dark-390.png"), fullPage: false });
    await modes.getByRole("button", { name: "Kanban" }).click();
    await column("in_progress").getByRole("button", { name: "Culvert survey" }).waitFor();
    await narrow(page);
    await page.screenshot({ path: join(SHOTS, "board-views-kanban-dark-390.png"), fullPage: false });
    await modes.getByRole("button", { name: "Calendar" }).click();
    await calendarDay.getByRole("button", { name: /Culvert survey$/ }).waitFor();
    await narrow(page);
    await page.screenshot({ path: join(SHOTS, "board-views-calendar-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);

  it("adds the kanban, calendar and count chart widgets to a saved dashboard", async () => {
    const refused = await app.inject({
      method: "PUT", url: `/api/v1/incidents/${incidentId}/dashboard-configs/refused`, headers: auth(adminToken),
      payload: { expectedRevision: 0, composition: { title: "Refused", panels: [
        { key: "k", source: "dashboard", dashboardId, widgetKey: "work_by_status", presentation: "tile" },
      ] } },
    });
    expect(refused.statusCode).toBe(400);

    const page = await openPage(`#/dashboard/${dashboardId}?incident=${incidentId}`);
    const legacy = page.getByRole("region", { name: "Legacy dashboard fallback" });
    await legacy.getByTestId("widget-work_by_status").waitFor();
    await page.getByRole("button", { name: "Create saved view" }).first().click();
    const editor = page.getByRole("region", { name: "Configure saved dashboard" });
    for (const name of ["Work by status", "Work due", "Work counts"]) {
      await editor.getByRole("checkbox", { name }).check();
    }
    expect(await editor.getByLabel("Work by status presentation").inputValue()).toBe("chart");
    expect(await editor.getByLabel("Work due presentation").inputValue()).toBe("list");
    const saved = page.waitForResponse((response) => response.request().method() === "PUT"
      && response.url().includes("/dashboard-configs/"));
    await editor.getByRole("button", { name: "Save view" }).click();
    expect((await saved).status()).toBe(201);

    const composed = page.locator(".p-dash-composition");
    const kanban = composed.getByTestId("widget-work_by_status");
    await kanban.waitFor();
    const counts = await statusCounts();
    expect(await kanban.locator("li").allTextContents())
      .toEqual([`Open${counts.open}`, `In progress${counts.in_progress}`, `Closed${counts.closed}`]);
    const due = composed.getByTestId("widget-work_due");
    const upcoming = Object.entries(dues).filter(([, at]) => Date.parse(at) >= Date.now())
      .sort(([, left], [, right]) => Date.parse(left) - Date.parse(right)).map(([summary]) => summary);
    expect(upcoming).toContain("Bridge inspection");
    expect(await due.locator("li > span").allTextContents()).toEqual(upcoming);
    const bars = composed.getByTestId("widget-work_counts");
    expect(await attributes(bars.locator('[role="img"]'), "aria-label"))
      .toEqual([`closed: ${counts.closed}`, `in_progress: ${counts.in_progress}`, `open: ${counts.open}`]);
    // The first walk left this person's theme preference dark.
    await setTheme(page, "light");
    await page.screenshot({ path: join(SHOTS, "board-views-dashboard-light-1440.png"), fullPage: false });
    await setTheme(page, "dark");
    await narrow(page);
    await page.screenshot({ path: join(SHOTS, "board-views-dashboard-dark-390.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
