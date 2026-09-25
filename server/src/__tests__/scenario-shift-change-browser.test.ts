import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 4, a shift change. Taylor Kim ended a shift on the
 * North Coast Storm exercise by signing out; while Kim was away, Jordan Lee
 * accepted a request. Kim signs back in and opens the briefing view: the
 * shift handoff states the reporting period and when Kim's last shift ended,
 * lists that change and nothing from before it, and lists the unresolved
 * requests with their owners. Kim opens the change and reaches the request's
 * full history. Run at the frames' size and at a 125%-scaled laptop's.
 */

const DIST = buildDir("shift-change-app");
const SHOTS = shotDir("shift-change");
const RUNS = [
  { viewport: { width: 1586, height: 992 }, item: "Tarps for roof repairs", note: "Public Works has 200 in the yard" },
  { viewport: { width: 1534, height: 790 }, item: "Light towers for the Fernbridge inspection", note: "Two towers from the county fleet" },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const pageErrors: string[] = [];
const outside: string[] = [];

async function token(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: NORTH_COAST_PASSWORD } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
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

describe("scenario 4: a shift change", () => {
  for (const run of RUNS) {
    it(`briefs the incoming operator on what changed at ${run.viewport.width} by ${run.viewport.height}`, async () => {
      // Kim's last shift ends with a sign-out; Lee then accepts a request.
      const kim = await token("taylor.kim@humboldt.example");
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { authorization: `Bearer ${kim}` } })).statusCode).toBe(200);
      const [request] = await admin`select id, number from resource_requests where item = ${run.item}`;
      const number = Number(request!.number);
      const lee = await token("jordan.lee@humboldt.example");
      const accepted = await app.inject({
        method: "POST", url: `/api/v1/resource-requests/${request!.id as string}/transition`,
        headers: { authorization: `Bearer ${lee}` }, payload: { toState: "accepted", note: run.note },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);

      const context = await browser.newContext({ viewport: run.viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        outside.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("taylor.kim@humboldt.example");
      await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
      await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Overview", exact: true }).click();
      await page.getByRole("button", { name: "Briefing view" }).click();

      const handoff = page.getByRole("region", { name: "Shift handoff" });
      await handoff.getByText(/Changes since .*, your last sign-out\.$/).waitFor();
      const changes = handoff.getByRole("region", { name: "Changes since your last shift" });
      await changes.getByRole("heading", { name: "Changes since your last shift (1)" }).waitFor();
      const change = changes.getByRole("button", { name: new RegExp(`REQ-${number} ${run.item}: Received → Accepted`) });
      await change.getByText(/^Jordan Lee/).waitFor();
      const unresolved = handoff.getByRole("region", { name: "Unresolved requests" });
      await unresolved.getByRole("button", { name: new RegExp(`^REQ-${number} ${run.item}`) }).getByText(/Owner: Jordan Lee/).waitFor();
      await handoff.getByRole("region", { name: "Overdue work" }).waitFor();
      await handoff.getByRole("region", { name: "Decisions awaiting action" }).waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `handoff-${run.viewport.width}.png`) });

      // The change opens its source record, where the full history stays.
      await change.click();
      const detail = page.getByRole("region", { name: `REQ-${number} ${run.item}` });
      await detail.getByText(run.note).waitFor();
      const steps = await detail.locator(".resources-history strong").allTextContents();
      expect(steps).toContain("Received → Accepted");
      await page.screenshot({ path: join(SHOTS, `source-${run.viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
