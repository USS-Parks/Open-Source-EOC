import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 7, an incident closes. Jordan Lee closes the North
 * Coast Storm exercise with what stays running in view: open requests and
 * tasks stay readable and stop taking steps, participant grants keep their
 * read, datasets keep updating. Closed, the incident reads as closed wherever
 * it is chosen, its requests are still found by number, and the other open
 * incident is one choice away. Lee then reopens it with a reason, which the
 * record of events keeps. Run at the frames' size and at a 125%-scaled
 * laptop's.
 */

const DIST = buildDir("incident-close-app");
const SHOTS = shotDir("incident-close");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];
const outside: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  // A second open incident, the next context once the storm closes.
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "jordan.lee@humboldt.example", password: NORTH_COAST_PASSWORD } });
  const activated = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${scenario.jurisdictionId}/incidents`,
    headers: { authorization: `Bearer ${login.json().accessToken as string}` },
    payload: { templateKey: "daily_ops", name: "Winter Storm Watch", kind: "daily_ops" },
  });
  expect(activated.statusCode, activated.body).toBeLessThan(300);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

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
  await page.goto(`${baseUrl}/app/index.html#/incidents?incident=${scenario.incidentId}`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("jordan.lee@humboldt.example");
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
  return page;
}

describe("scenario 7: an incident closes", () => {
  for (const viewport of VIEWPORTS) {
    it(`closes with what stays running in view, and reopens with a reason at ${viewport.width} by ${viewport.height}`, async () => {
      const page = await signIn(viewport);
      const storm = page.locator(".incidents-item").filter({ hasText: "North Coast Storm" });
      await storm.getByRole("button", { name: "Close incident" }).click();
      const summary = page.getByRole("region", { name: "What closing leaves running" });
      await summary.getByText(/^Open resource requests \(\d+\) stay readable and stop taking steps: REQ-/).waitFor();
      await summary.getByText(/^Tasks not completed \(\d+\) stay readable and stop taking steps/).waitFor();
      await summary.getByText(/^Participant grants in force \(\d+\) keep their read until revoked or expired: .*End them under Participants/).waitFor();
      await summary.getByText("Datasets registered for the incident (0) keep updating.").waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `closeout-${viewport.width}.png`) });
      await page.getByRole("button", { name: "Confirm closeout" }).click();
      await page.getByText("North Coast Storm is closed. Its records stay readable; an administrator can reopen it.").waitFor();

      // Closed, it reads as closed where it is chosen, and its requests are still found by number.
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm · Exercise (closed)" }).waitFor({ state: "attached" });
      const [request] = await admin`select number from resource_requests where incident_id = ${scenario.incidentId} order by number limit 1`;
      await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Resources", exact: true }).click();
      await page.getByText("This incident is closed. Request history remains available.").waitFor();
      await page.getByRole("searchbox").fill(`REQ-${request!.number as number}`);
      await page.getByRole("button", { name: "Find" }).click();
      await page.getByText(`Showing 1 request: matching "REQ-${request!.number as number}".`).waitFor();
      // The other open incident is one choice away.
      await page.getByLabel("Selected incident").selectOption({ label: "Winter Storm Watch · Daily operations" });
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "Winter Storm Watch" }).waitFor({ state: "attached" });

      // Reopened with a reason, which the record of events keeps.
      await page.evaluate(`location.hash = ${JSON.stringify(`#/incidents?incident=${scenario.incidentId}`)}`);
      await storm.getByRole("button", { name: "Reopen incident" }).click();
      const reason = `Aftershock damage reported at Fernbridge (${viewport.width})`;
      await page.getByLabel("Reason for reopening").fill(reason);
      await page.getByRole("button", { name: "Confirm reopen" }).click();
      await page.getByText("North Coast Storm is open again.").waitFor();
      await storm.getByRole("button", { name: "Close incident" }).waitFor();
      await page.screenshot({ path: join(SHOTS, `reopened-${viewport.width}.png`) });
      const [audit] = await admin`
        select payload from audit_events where incident_id = ${scenario.incidentId} and category = 'incident.reopened'
        order by seq desc limit 1`;
      expect((audit!.payload as { reason: string }).reason).toBe(reason);
      await page.context().close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
