import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { runDuePlans } from "../plans/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * After-action corrective actions linked to plans, on screen (Veoci and air
 * gap VA30), at the frames' 1586 by 992 and at 1534 by 790: an administrator
 * records a corrective action against a section of the storm plan, finds it
 * among the changes the plan still owes when reading the plan, and, holding
 * the owning position, is reminded in the bell when its due date comes.
 */

const DIST = buildDir("plan-corrective-actions");
const SHOTS = shotDir("plan-corrective-actions");
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
  const token = await login(app);
  await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "severe_storm", name: "October Windstorm" });
  // The administrator holds Incident Commander, so an action that position owns reminds them in the bell.
  const [commander] = await admin`
    select id from positions where jurisdiction_id = ${seed.jurisdictionId} and key = 'incident_commander'`;
  await admin`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${commander!.id as string}, ${seed.adminId}, ${seed.adminId})`;
  await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/plans`, {
    title: "Severe Storm Plan", expectedVersion: 0,
    definition: {
      kind: "incident_response", templateKey: "severe_storm",
      sections: [
        { title: "Concept of operations", body: "Open the EOC at partial activation on a storm warning." },
        { title: "Public warning", body: "Warn the river road residents first." },
      ],
    },
  });
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("corrective actions linked to plans on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`links an action to a plan section, lists it on the plan and reminds its owner, at ${viewport.width} by ${viewport.height}`, async () => {
      const recommendation = `Add the river road siren to the warning order ${viewport.width}`;
      const context = await browser.newContext({ viewport });
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
      await page.getByRole("button", { name: "AAR", exact: true }).click();

      const workspace = page.getByRole("region", { name: "After-action review" });
      const form = workspace.getByRole("form", { name: "Create a corrective action" });
      await form.getByLabel("Action capability").selectOption("public_information_and_warning");
      await form.getByLabel("Corrective action").fill(recommendation);
      await form.getByLabel("Owner").selectOption({ label: "Position: Incident Commander" });
      await form.getByLabel("Due date").fill("2026-10-20");
      await form.getByLabel("Plan to update").selectOption({ label: "Severe Storm Plan" });
      await form.getByLabel("Plan section").locator("option", { hasText: "Public warning" }).waitFor({ state: "attached" });
      await form.getByLabel("Plan section").selectOption("Public warning");
      await form.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `action-form-${viewport.width}.png`) });
      await form.getByRole("button", { name: "Create corrective action" }).click();
      await workspace.getByText("Corrective action created.").waitFor();
      const row = workspace.locator("article.eoc-aar-action", { hasText: recommendation });
      await row.getByText("Severe Storm Plan, section Public warning").waitFor();

      await page.goto(`${baseUrl}/app/index.html#/incidents`, { waitUntil: "load" });
      const plans = page.getByRole("region", { name: "Plans" });
      await plans.getByRole("button", { name: "Read Severe Storm Plan" }).click();
      const owed = plans.getByRole("list", { name: "Open corrective actions for this plan" });
      await owed.getByText(recommendation).waitFor();
      expect(await owed.locator("li", { hasText: recommendation }).textContent())
        .toBe(`${recommendation} · section Public warning · Incident Commander · due 2026-10-20`);
      await owed.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `plan-owes-${viewport.width}.png`) });

      // Its due date comes: the scheduler reminds the position that owns it.
      const principal = await principalForPerson(runtime, seed.adminId);
      const result = await withPerson(runtime, seed.adminId, (tx) =>
        runDuePlans(tx, principal, seed.jurisdictionId, new Date("2026-10-20T00:00:01Z")));
      expect(result.actionsDue).toBe(1);
      await page.reload({ waitUntil: "load" });
      await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
      const bell = page.getByRole("dialog", { name: "Notifications" });
      await bell.getByText(`Corrective action due: ${recommendation}`).waitFor();
      await page.screenshot({ path: join(SHOTS, `reminder-${viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
