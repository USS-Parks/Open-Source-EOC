import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 3, a request crosses a handoff. On the North Coast
 * Storm exercise the CA Energy Commission's utility liaison asks the county
 * for something; the county's Planning Section Chief accepts it, sources it
 * and hands it to the Operations Section Chief. The liaison then finds the
 * same request by its number and can tell who owns the next action, and
 * receipt and acceptance stay distinguishable throughout. Run at the frames'
 * size and at a 125%-scaled laptop's.
 */

const DIST = buildDir("request-handoff-app");
const SHOTS = shotDir("request-handoff");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const pageErrors: string[] = [];
const outside: string[] = [];

async function signIn(email: string, viewport: { width: number; height: number }): Promise<Page> {
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
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Resources", exact: true }).click();
  await page.getByRole("heading", { name: "Resource coordination" }).waitFor();
  return page;
}

async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
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

describe("scenario 3: a request crosses a handoff", () => {
  for (const viewport of VIEWPORTS) {
    it(`keeps the request findable with its owner and next action at ${viewport.width} by ${viewport.height}`, async () => {
      const item = `Fuel trailer for substation generators (${viewport.width})`;

      // The liaison asks the incident's owner and gets a receipt, not an acceptance.
      const liaison = await signIn("a.brooks@cec.example", viewport);
      await liaison.getByLabel("Request from").selectOption({ label: "Humboldt County OES (incident owner)" });
      await liaison.getByLabel("Requested item").fill(item);
      await liaison.getByRole("button", { name: "Submit request" }).click();
      const receipt = liaison.getByRole("status", { name: "Request receipt" });
      const heading = await receipt.getByText(/^REQ-\d+ received .* by Humboldt County OES$/).textContent();
      const number = /^REQ-(\d+)/.exec(heading ?? "")![1]!;
      await receipt.getByText(/Receipt is not acceptance/).waitFor();
      const mine = liaison.getByRole("listitem", { name: `REQ-${number} ${item}` });
      await mine.getByText("Received", { exact: true }).waitFor();
      await mine.getByText("Owner: No one yet · Humboldt County OES has not accepted it").waitFor();
      await noSidewaysScroll(liaison);
      await liaison.screenshot({ path: join(SHOTS, `receipt-${viewport.width}.png`) });

      // The county accepts it, which names the owner, sources it and hands it to Operations.
      const planning = await signIn("jordan.lee@humboldt.example", viewport);
      await planning.getByLabel("Acting position").selectOption({ label: "Planning Section Chief" });
      await planning.locator('select[aria-label="Acting position"] option:checked', { hasText: "Planning Section Chief" }).waitFor({ state: "attached" });
      const theirs = planning.getByRole("listitem", { name: `REQ-${number} ${item}` });
      await theirs.getByRole("button", { name: `Accept REQ-${number}` }).click();
      await theirs.getByText("Accepted", { exact: true }).waitFor();
      await theirs.getByText(/^Owner: Jordan Lee, Planning Section Chief · Humboldt County OES$/).waitFor();
      await theirs.getByRole("button", { name: `Start sourcing REQ-${number}` }).click();
      await theirs.getByText("Sourcing", { exact: true }).waitFor();
      await theirs.getByLabel(`Assignment for ${item}`).selectOption({ label: "Operations Section Chief" });
      await theirs.getByRole("button", { name: "Assign and advance" }).click();
      await theirs.getByText("Assigned", { exact: true }).waitFor();
      await planning.context().close();

      // The liaison finds the same request by its number after the handoff.
      await liaison.reload({ waitUntil: "load" });
      await liaison.getByRole("heading", { name: "Resource coordination" }).waitFor();
      await liaison.getByRole("searchbox").fill(`REQ-${number}`);
      await liaison.getByRole("button", { name: "Find" }).click();
      await liaison.getByText(`Showing 1 request: matching "REQ-${number}".`).waitFor();
      const found = liaison.getByRole("listitem", { name: `REQ-${number} ${item}` });
      await found.getByText("Assigned", { exact: true }).waitFor();
      await found.getByText(/^Owner: Operations Section Chief · Humboldt County OES$/).waitFor();
      await found.getByText("Next: The assignee deploys the resource").waitFor();
      await found.getByRole("button", { name: `Open REQ-${number}` }).click();
      const detail = liaison.getByRole("region", { name: `REQ-${number} ${item}` });
      await detail.getByText(/from A\. Brooks$/).waitFor();
      await detail.getByText(/by Jordan Lee, Planning Section Chief$/).waitFor();
      const steps = await detail.locator(".resources-history strong").allTextContents();
      expect(steps).toEqual(["Received", "Received → Accepted", "Accepted → Sourcing", "Sourcing → Assigned"]);
      await noSidewaysScroll(liaison);
      await liaison.screenshot({ path: join(SHOTS, `found-${viewport.width}.png`) });
      await liaison.context().close();

      const [stored] = await admin`
        select r.state, acceptor.email as accepted_by from resource_requests r
        join persons acceptor on acceptor.id = r.accepted_by where r.number = ${Number(number)}`;
      expect(stored).toMatchObject({ state: "assigned", accepted_by: "jordan.lee@humboldt.example" });
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
