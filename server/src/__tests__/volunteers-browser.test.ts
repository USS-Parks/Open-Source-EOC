import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * The volunteer and CERT roster on screen (Veoci and air gap VA28), at the
 * frames' 1586 by 992 and at 1534 by 790, in the Pacific time zone: an
 * administrator opens Volunteers from the rail, adds a CERT member with an
 * expired CPR card, deploys them to the selected incident in a role that
 * needs CPR (warned, then deployed anyway), deploys them again in an
 * overlapping role, and reads six and a half hours on the day, not eight and
 * a half.
 */

const DIST = buildDir("volunteers");
const SHOTS = shotDir("volunteers");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let adminToken: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  adminToken = await login(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("volunteer roster on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`adds a volunteer, deploys them with a warning, and reads merged hours, at ${viewport.width} by ${viewport.height}`, async () => {
      const incidentName = `River Flood ${viewport.width}`;
      const name = `Ana Reyes ${viewport.width}`;
      await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: incidentName });
      const context = await browser.newContext({ viewport, timezoneId: "America/Los_Angeles" });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await page.getByLabel("Email").fill("admin@example.org");
      await page.getByLabel("Password").fill("correct-horse-battery");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("button", { name: "Account menu" }).waitFor();
      await page.locator('select[aria-label="Selected incident"]').selectOption({ label: incidentName });
      await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Volunteers" }).click();
      const screen = page.getByRole("region", { name: "Volunteers", exact: true });
      await screen.getByText(incidentName).first().waitFor();

      // A CERT member with a current basic training and an expired CPR card.
      const form = screen.getByRole("form", { name: "Add a volunteer" });
      await form.getByLabel("Name", { exact: true }).fill(name);
      await form.getByLabel("Team, group or organization").fill("Klamath CERT");
      await form.getByLabel("Phone").fill("707-555-0101");
      await form.getByLabel("Skills, separated by commas").fill("First aid, Radio");
      await form.getByRole("button", { name: "Add a credential" }).click();
      await form.getByLabel("Credential 1 Name").fill("CERT Basic Training");
      await form.getByLabel("Credential 1 Issuer").fill("Klamath OES");
      await form.getByRole("button", { name: "Add a credential" }).click();
      await form.getByLabel("Credential 2 Name").fill("CPR");
      await form.getByLabel("Credential 2 Issued").fill("2018-03-01");
      await form.getByLabel("Credential 2 Expires").fill("2020-03-01");
      await form.getByRole("button", { name: "Add volunteer" }).click();
      await screen.getByText(`Added ${name} to the roster.`).waitFor();
      const row = screen.getByRole("row", { name: new RegExp(name) });
      await row.getByText("Expired").waitFor();
      await row.getByText("707-555-0101").waitFor();
      await page.screenshot({ path: join(SHOTS, `roster-${viewport.width}.png`) });

      // Shelter support needs CPR: 08:00 to 12:00 on the 20th, warned and deployed anyway.
      await row.getByRole("button", { name: `Deploy ${name}` }).click();
      const deploy = screen.getByRole("form", { name: "Deploy a volunteer" });
      await deploy.getByLabel("Role").fill("Shelter support");
      await deploy.getByLabel("Starts").fill("2026-09-20T08:00");
      await deploy.getByLabel("Ends, blank while under way").fill("2026-09-20T12:00");
      await deploy.getByRole("group", { name: "Credentials the role needs" }).getByRole("checkbox", { name: "CPR" }).check();
      await deploy.getByRole("button", { name: "Deploy", exact: true }).click();
      await deploy.getByRole("alert").getByText(`${name} does not have what the role needs: CPR expired 2020-03-01.`, { exact: false }).waitFor();
      await page.screenshot({ path: join(SHOTS, `deploy-warning-${viewport.width}.png`) });
      await deploy.getByRole("button", { name: "Deploy anyway" }).click();
      await screen.getByText(`Deployed ${name} as Shelter support. Warning: CPR expired 2020-03-01.`).waitFor();

      // Radio operator from 10:00 to 14:30 overlaps it; nothing it needs is missing.
      await deploy.getByLabel("Volunteer").selectOption({ label: name });
      await deploy.getByLabel("Role").fill("Radio operator");
      await deploy.getByLabel("Starts").fill("2026-09-20T10:00");
      await deploy.getByLabel("Ends, blank while under way").fill("2026-09-20T14:30");
      await deploy.getByRole("button", { name: "Deploy", exact: true }).click();
      await screen.getByText(`Deployed ${name} as Radio operator.`).waitFor();
      const deployments = screen.getByRole("region", { name: "Deployments" });
      await deployments.getByRole("row", { name: /Shelter support/ }).getByText("CPR expired 2020-03-01").waitFor();
      await page.screenshot({ path: join(SHOTS, `deployments-${viewport.width}.png`) });

      // 08:00 to 14:30 is six and a half hours, counted once.
      await screen.getByRole("tab", { name: "Hours" }).click();
      const byDay = screen.getByRole("table", { name: "Hours by day" });
      await byDay.getByRole("row", { name: `${name} 2026-09-20 6:30` }).waitFor();
      await page.screenshot({ path: join(SHOTS, `hours-${viewport.width}.png`) });

      const [stored] = await admin`
        select count(*)::int as n, min(d.starts_at) as s, max(d.ends_at) as e
        from volunteer_deployments d join volunteers v on v.id = d.volunteer_id where v.name = ${name}`;
      expect(stored).toMatchObject({ n: 2, s: new Date("2026-09-20T15:00:00Z"), e: new Date("2026-09-20T21:30:00Z") });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
