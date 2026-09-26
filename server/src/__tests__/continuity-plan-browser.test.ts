import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * A continuity of operations plan on screen (Veoci and air gap VA27), at the
 * frames' 1586 by 992 and at 1534 by 790: an administrator starts from the
 * continuity template, sets how fast the EOC must come back, saves and
 * activates it, and finds each essential function as a task in the new
 * incident, with the plan's functions, succession and delegations beside it.
 */

const DIST = buildDir("continuity-plan");
const SHOTS = shotDir("continuity-plan");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("continuity plans on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`starts from the template, activates it and opens each essential function, at ${viewport.width} by ${viewport.height}`, async () => {
      const title = `Continuity Plan ${viewport.width}`;
      const incidentName = `Offices Flooded ${viewport.width}`;
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
      await page.goto(`${baseUrl}/app/index.html#/incidents`, { waitUntil: "load" });

      const panel = page.getByRole("region", { name: "Plans" });
      await panel.getByRole("button", { name: "Start from the continuity template" }).click();
      const editor = panel.getByRole("form", { name: "New plan" });
      await editor.getByLabel("Plan title").fill(title);
      const eoc = editor.getByRole("group", { name: "Essential function 1" });
      await eoc.getByLabel("Function 1 restore within (hours)").fill("8");
      await eoc.getByLabel("Function 1 restored by").selectOption({ label: "Incident Commander" });
      await page.screenshot({ path: join(SHOTS, `continuity-editor-${viewport.width}.png`) });
      await editor.getByRole("button", { name: "Save plan" }).click();
      await panel.getByText(`Saved ${title} as version 1.`).waitFor();

      await panel.getByRole("button", { name: `Activate ${title}` }).click();
      const activation = panel.getByRole("form", { name: `Activate ${title}` });
      await activation.getByLabel("Incident name").fill(incidentName);
      await activation.getByRole("button", { name: "Activate the plan" }).click();
      const report = `${incidentName} is activated from ${title}, version 1: 8 tasks released now, 0 tasks waiting for their time.`;
      await panel.getByText(report).waitFor();
      await panel.getByRole("button", { name: `Switch to ${incidentName}` }).click();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: incidentName })
        .waitFor({ state: "attached" });
      const setup = page.getByRole("region", { name: `${incidentName}: incident setup` });
      await setup.getByRole("listitem", { name: "Restore essential function: Emergency management and the EOC" }).waitFor();
      const plan = setup.getByRole("region", { name: "Incident plan" });
      const functions = plan.getByRole("table", { name: "Essential functions" });
      await functions.getByRole("row", { name: /Emergency management and the EOC.*8 hours/ }).waitFor();
      await plan.getByText("Emergency manager: Deputy emergency manager, then Planning section chief").waitFor();
      await functions.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `continuity-activated-${viewport.width}.png`) });

      const [incident] = await admin`select id from incidents where name = ${incidentName}`;
      const [first] = await admin`
        select item, due_at, created_at from checklist_items
        where incident_id = ${incident!.id as string} and category = 'continuity' order by sort_order limit 1`;
      expect(first!.item).toBe("Restore essential function: Emergency management and the EOC");
      const hours = (new Date(first!.due_at as string).getTime() - new Date(first!.created_at as string).getTime()) / 3_600_000;
      expect(Math.round(hours)).toBe(8);
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
