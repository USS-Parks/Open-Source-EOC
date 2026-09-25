import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * Acceptance scenario 5, a partner follows a link. On the North Coast Storm
 * exercise Jordan Lee adds a Red Cross shelter lead to the incident; the
 * grant sends an invitation that names the organization, the incident and the
 * access, and shows whether it was read. Lee previews what the grant reads
 * and sees what ending it does not recall. The shelter lead opens a link to
 * one of the county's requests while signed out, signs in and lands on that
 * request; a link to an incident not open to them says so and whom to ask,
 * without saying what it is. Run at the frames' size and at a 125%-scaled
 * laptop's.
 */

const DIST = buildDir("partner-link-app");
const SHOTS = shotDir("partner-link");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const ITEM = "Generator support for Wendy's Shelter";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
const pageErrors: string[] = [];
const outside: string[] = [];

async function open(viewport: { width: number; height: number }, hash = ""): Promise<Page> {
  const context = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html${hash}`, { waitUntil: "load" });
  return page;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  const [redCross] = await admin`select id from jurisdictions where slug = 'red-cross'`;
  for (const viewport of VIEWPORTS) {
    const id = await createPerson(admin, { email: `e.park.${viewport.width}@redcross.example`, displayName: `E. Park ${viewport.width}`, password: NORTH_COAST_PASSWORD });
    await addMembership(admin, id, redCross!.id as string, "member");
  }
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("scenario 5: a partner follows a link", () => {
  for (const viewport of VIEWPORTS) {
    it(`invites, previews and lets the partner land where the link points at ${viewport.width} by ${viewport.height}`, async () => {
      const email = `e.park.${viewport.width}@redcross.example`;
      const name = `E. Park ${viewport.width}`;

      // The county adds the shelter lead; the grant sends an invitation.
      const county = await open(viewport);
      await signIn(county, "jordan.lee@humboldt.example");
      await county.locator('select[aria-label="Selected incident"] option:checked', { hasText: "North Coast Storm" }).waitFor({ state: "attached" });
      await county.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Participants", exact: true }).click();
      await county.getByLabel("Organization code").fill("red-cross");
      await county.getByLabel("Participant email").fill(email);
      await county.getByLabel("Incident position").fill("Shelter operations lead");
      await county.getByLabel("Incident role").selectOption("contributor");
      await county.getByLabel("Participation expires").fill("2026-12-31T18:00");
      await county.getByLabel("Participation reason").fill("Second shelter opening in Fortuna");
      await county.getByRole("button", { name: "Add participant" }).click();
      await county.getByText(/^Participant added\. Their notifications hold an invitation/).waitFor();
      const grant = county.getByRole("listitem").filter({ hasText: name });
      await grant.getByText("Can read what the incident shares and add records, requests and messages.").waitFor();
      await grant.getByText(/^Invitation delivered .*; not read yet\.$/).waitFor();

      // The preview reads the incident as the grant's person and names what it cannot read.
      await grant.getByRole("button", { name: `Preview what ${name} can read` }).click();
      const preview = grant.getByRole("region", { name: "What this partner can read" });
      await preview.getByRole("heading", { name: `What ${name} (American Red Cross) can read` }).waitFor();
      await preview.getByText(/This is read with the partner's own access, not a model of it\.$/).waitFor();
      await preview.getByText(/^Reads \d+: .*North Coast Storm: Shelters(;|$)/).waitFor();
      await county.screenshot({ path: join(SHOTS, `preview-${viewport.width}.png`) });
      await grant.getByRole("button", { name: `End participation for ${name}` }).click();
      await grant.getByText(/It does not recall what was already delivered: exports, printed forms and notifications stay with whoever received them\.$/).waitFor();
      await grant.getByRole("button", { name: "Cancel" }).click();

      // The shelter lead follows a link to a county request while signed out, and lands on it.
      const [request] = await admin`select id, number from resource_requests where item = ${ITEM}`;
      const partner = await open(viewport, `#/resources/${request!.id as string}?incident=${scenario.incidentId}`);
      await signIn(partner, email);
      await partner.getByRole("region", { name: `REQ-${request!.number as number} ${ITEM}` }).waitFor();
      expect(await partner.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await partner.screenshot({ path: join(SHOTS, `landed-${viewport.width}.png`) });

      // The invitation names the organization, the incident and the access; reading it shows on the county's list.
      await partner.evaluate("location.hash = '#/alerts'");
      await partner.getByRole("button", { name: /Humboldt County OES invites you to North Coast Storm/ }).first().click();
      await partner.getByText(/^Humboldt County OES added you to the North Coast Storm incident for American Red Cross, as Shelter operations lead\. You can read what the incident shares and add records, requests and messages, until 2027-01-01 02:00 UTC\./).waitFor();
      await county.getByRole("button", { name: "Refresh participants" }).click();
      await grant.getByText(/^Invitation delivered .*; read .*\.$/).waitFor();

      // A link to an incident not open to them says so, and whom to ask.
      await partner.evaluate(`location.hash = ${JSON.stringify(`#/overview?incident=${randomUUID()}`)}`);
      await partner.reload({ waitUntil: "load" });
      await partner.getByRole("alert").filter({ hasText: "The linked incident is not open to your account. If a link brought you here, ask whoever sent it, or an administrator of the organization running the incident, for access." }).waitFor();
      expect(await partner.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await partner.screenshot({ path: join(SHOTS, `refused-${viewport.width}.png`) });
      await partner.context().close();
      await county.context().close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 240_000);
  }
});
