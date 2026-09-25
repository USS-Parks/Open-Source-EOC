import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 1, an occasional operator returns. D. Nguyen holds the
 * Operations Section Chief position on the North Coast Storm exercise but has
 * not signed into it. Nguyen signs in, sees which incident is open, opens
 * Tasks, acts as the position from the prompt there, finds the requests the
 * position owns, and records a routine update in one click with a note. Run
 * at the frames' size and at a 125%-scaled laptop's.
 */

const DIST = buildDir("occasional-operator-app");
const SHOTS = shotDir("occasional-operator");
const RUNS = [
  { viewport: { width: 1586, height: 992 }, item: "Check access on Westhaven Drive (Trinidad)", note: "Westhaven Drive open; no debris" },
  { viewport: { width: 1534, height: 790 }, item: "Increase shelter capacity in Eureka", note: "Second room open at the auditorium" },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const pageErrors: string[] = [];
const outside: string[] = [];

async function signIn(viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("d.nguyen@humboldt.example");
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  await seedNorthCoast(app, admin);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("scenario 1: an occasional operator returns", () => {
  for (const run of RUNS) {
    it(`finds assigned work and updates it at ${run.viewport.width} by ${run.viewport.height}`, async () => {
      const page = await signIn(run.viewport);
      // The incident in play is named in the command bar.
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
      await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Tasks", exact: true }).click();

      // Work held by a position shows once the person acts as it, from a prompt on the page.
      const work = page.getByRole("region", { name: "My work" });
      await work.getByRole("button", { name: "Act as Operations Section Chief" }).click();
      await page.locator('select[aria-label="Acting position"] option:checked', { hasText: "Operations Section Chief" }).waitFor({ state: "attached" });
      await work.getByText(/assigned to you as Operations Section Chief/).waitFor();

      const assigned = work.getByRole("region", { name: "Assigned to you" });
      const row = assigned.getByRole("listitem", { name: new RegExp(`^REQ-\\d+ ${run.item.replace(/[()]/g, "\\$&")}$`) });
      await row.getByText("In progress", { exact: true }).waitFor();
      await row.getByText("Next: The assignee confirms it is fulfilled").waitFor();
      await row.getByLabel("Note (optional)").fill(run.note);
      await row.getByRole("button", { name: /^Mark fulfilled REQ-/ }).click();
      await row.getByText("Fulfilled", { exact: true }).waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `my-work-${run.viewport.width}.png`) });
      await page.context().close();

      const [stored] = await admin`
        select r.state, e.note, p.email from resource_requests r
        join lateral (select note, actor_person from rr_events where request_id = r.id order by at desc, id desc limit 1) e on true
        join persons p on p.id = e.actor_person where r.item = ${run.item}`;
      expect(stored).toMatchObject({ state: "fulfilled", note: run.note, email: "d.nguyen@humboldt.example" });
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
