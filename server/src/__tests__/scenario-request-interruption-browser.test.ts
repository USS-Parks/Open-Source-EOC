import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 2, a request survives an interruption. On the North
 * Coast Storm exercise L. Moreno starts a resource request, leaves for the
 * map as a phone call would pull them away, and finds the draft kept on
 * return; the send meets a dropped connection and fails with the reason, the
 * work kept and a retry offered; before the retry the session lapses and the
 * console returns to sign-in saying the work is kept; after signing in again
 * the draft is still there and is received by the server with its number. A
 * shelter record edited in a draft while someone else changed it on the
 * server comes back with the conflict named. Run at the frames' size and at a
 * 125%-scaled laptop's.
 */

const DIST = buildDir("request-interruption-app");
const SHOTS = shotDir("request-interruption");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];
const outside: string[] = [];

async function signIn(page: Page): Promise<void> {
  await page.getByLabel("Email").fill("l.moreno@humboldt.example");
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
}

const rail = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("scenario 2: a request survives an interruption", () => {
  for (const viewport of VIEWPORTS) {
    it(`keeps the draft through leaving and a lapsed session at ${viewport.width} by ${viewport.height}`, async () => {
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
      await signIn(page);
      const item = `Cots for the Fortuna shelter (${viewport.width})`;

      // Half a request, then a phone call: off to the map and back.
      await rail(page, "Resources");
      const intake = page.getByRole("region", { name: "Request intake" });
      await intake.getByLabel("Requested item").fill(item);
      await intake.getByLabel("Quantity").fill("40");
      await intake.getByLabel("Request notes").fill("Veterans building is over capacity");
      await intake.getByText(/^Draft saved on this device at .*\. Not sent yet\.$/).waitFor();
      await rail(page, "Map");
      await page.getByTestId("cop-map").waitFor();
      await rail(page, "Resources");
      await intake.getByText(/^Draft restored from this device, saved .*\. Not sent yet\.$/).waitFor();
      expect(await intake.getByLabel("Requested item").inputValue()).toBe(item);
      expect(await intake.getByLabel("Quantity").inputValue()).toBe("40");

      // The send meets a dropped connection: the reason is named and the work stays for a retry.
      let dropped = false;
      await page.route((url) => url.pathname.endsWith("/resource-requests"), (route) => {
        if (dropped || route.request().method() !== "POST") return route.fallback();
        dropped = true;
        return route.abort("internetdisconnected");
      });
      await intake.getByRole("button", { name: "Submit request" }).click();
      await intake.getByText(/^Not sent: No connection to the server\..* Your work is kept on this device\./).waitFor();
      await page.screenshot({ path: join(SHOTS, `failed-${viewport.width}.png`) });

      // Before the retry the session lapses: the console returns to sign-in and says the work is kept.
      // Signed out elsewhere, as a password change on another device would.
      const tokens = JSON.parse(await page.evaluate("localStorage.getItem('openeoc.tokens')") as string) as { accessToken: string };
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { authorization: `Bearer ${tokens.accessToken}` } })).statusCode).toBe(200);
      await intake.getByRole("button", { name: "Retry" }).click();
      await page.getByText("Your session has ended. Sign in again to continue; work saved on this device is kept.").waitFor();
      await page.screenshot({ path: join(SHOTS, `session-ended-${viewport.width}.png`) });

      // Signed in again, the draft is where it was, and sending it gives a receipt.
      await signIn(page);
      await rail(page, "Resources");
      await intake.getByText(/^Draft restored from this device/).waitFor();
      expect(await intake.getByLabel("Requested item").inputValue()).toBe(item);
      await intake.getByRole("button", { name: "Submit request" }).click();
      const receipt = page.getByRole("status", { name: "Request receipt" });
      await receipt.getByText(/^REQ-\d+ received .* by Humboldt County OES$/).waitFor();
      expect(await intake.getByLabel("Requested item").inputValue()).toBe("");
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      const [stored] = await admin`select quantity, notes from resource_requests where item = ${item}`;
      expect(stored).toMatchObject({ quantity: 40, notes: "Veterans building is over capacity" });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }

  it("names the fields a colleague changed on the server since a record draft began", async () => {
    const context = await browser.newContext({ viewport: VIEWPORTS[1], timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await signIn(page);
    const [shelter] = await admin`
      select r.id, r.board_id from board_records r join boards b on b.id = r.board_id
      where b.template_key = 'shelters' and r.data->>'name' = 'Eureka Municipal Auditorium'`;
    await page.evaluate(`location.hash = ${JSON.stringify(`#/board/${shelter!.board_id as string}?incident=${scenario.incidentId}&record=${shelter!.id as string}`)}`);
    const form = page.locator("form.eoc-form");
    await page.getByRole("button", { name: "Edit record" }).click();
    await form.getByLabel(/^Occupancy/).fill("55");
    await form.getByText(/^Draft saved on this device/).waitFor();
    await page.goBack();

    // Meanwhile a colleague records a new occupancy and a note on the server.
    await admin`update board_records set data = data || '{"occupancy": 61, "status": "compromised"}'::jsonb where id = ${shelter!.id as string}`;

    await page.goForward();
    await page.getByRole("button", { name: "Edit record" }).click();
    await form.getByText(/^Draft restored from this device/).waitFor();
    const conflict = form.getByRole("alert", { name: "Changed on the server" });
    await conflict.getByText(/Occupancy: yours 55, now on the server 61/).waitFor();
    // A field only the colleague changed takes the server's value; the draft does not revert it.
    expect(await conflict.textContent()).not.toContain("Status");
    await page.screenshot({ path: join(SHOTS, "record-conflict.png") });
    await context.close();
    expect(pageErrors).toEqual([]);
  }, 120_000);
});
