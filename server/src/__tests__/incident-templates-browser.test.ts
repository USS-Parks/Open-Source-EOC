import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Incident templates authored on screen, at the frames' 1586 by 992 and at
 * 1534 by 790: an instance administrator writes a template with a position of
 * its own, saves a second version, reads the versions, opens an incident from
 * it, and adds a task of the incident's own on the Tasks screen.
 */

const DIST = buildDir("incident-templates");
const SHOTS = shotDir("incident-templates");
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

async function signIn(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
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

describe("incident templates on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`authors a template, saves a second version, activates it and adds a task, at ${viewport.width} by ${viewport.height}`, async () => {
      const title = `Tsunami Warning ${viewport.width}`;
      const key = `tsunami_warning_${viewport.width}`;
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
      await signIn(page);
      await page.goto(`${baseUrl}/app/index.html#/incidents`, { waitUntil: "load" });

      // Write the template.
      const panel = page.getByRole("region", { name: "Incident templates" });
      await panel.getByRole("list", { name: "Incident templates" }).getByText("Wildfire", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "New template" }).click();
      const editor = panel.getByRole("form", { name: "New incident template" });
      await editor.getByLabel("Template title").fill(title);
      expect(await editor.getByLabel("Template key").inputValue()).toBe(key);
      await editor.getByRole("checkbox", { name: "Operations Section Chief" }).check();
      await editor.getByLabel("Another position").fill("Tribal Liaison");
      await editor.getByRole("button", { name: "Add position" }).click();
      await editor.getByRole("checkbox", { name: "Tribal Liaison" }).waitFor();
      expect(await editor.getByRole("checkbox", { name: "Tribal Liaison" }).isChecked()).toBe(true);
      await editor.getByRole("checkbox", { name: "Significant Events" }).check();
      await editor.getByRole("checkbox", { name: "Activity Log" }).check();
      await editor.getByLabel("Checklist for Incident Commander").fill("Sound the tsunami warning\nConfirm the evacuation routes are open");
      await editor.getByLabel("Checklist for Tribal Liaison").fill("Call the village representatives");
      await page.screenshot({ path: join(SHOTS, `template-new-${viewport.width}.png`) });
      await editor.getByRole("button", { name: "Save template" }).click();
      await panel.getByText(`Saved ${title} as version 1.`).waitFor();

      // A second version: one more item for the Incident Commander.
      await panel.getByRole("button", { name: `Edit ${title}` }).click();
      const edit = panel.getByRole("form", { name: `Edit ${title}` });
      await edit.getByRole("heading", { name: `Edit ${title}, version 1` }).waitFor();
      const ic = edit.getByLabel("Checklist for Incident Commander");
      await ic.fill(`${await ic.inputValue()}\nOpen the high-ground shelter`);
      await edit.getByRole("button", { name: "Save template" }).click();
      await panel.getByText(`Saved ${title} as version 2.`).waitFor();
      await panel.getByRole("button", { name: `Versions of ${title}` }).click();
      const versions = panel.getByRole("region", { name: `Versions of ${title}` });
      await versions.getByText(`Version 2: ${title}`).waitFor();
      await versions.getByText(`Version 1: ${title}`).waitFor();
      expect(await versions.getByText(/by Admin$/).count()).toBe(2);
      await page.screenshot({ path: join(SHOTS, `template-versions-${viewport.width}.png`) });

      // Open an incident from it.
      const activate = page.getByRole("region", { name: "Activate an incident" });
      await activate.getByLabel("Scenario template").selectOption({ label: title });
      await activate.getByLabel("Incident name").fill(`Klamath tsunami ${viewport.width}`);
      await activate.getByRole("button", { name: "Activate" }).click();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: `Klamath tsunami ${viewport.width}` })
        .waitFor({ state: "attached" });
      const [incident] = await admin`
        select id, template_version from incidents where name = ${`Klamath tsunami ${viewport.width}`}`;
      expect(incident!.template_version).toBe(2);

      // The template's tasks are there, and the incident takes one of its own.
      await page.goto(`${baseUrl}/app/index.html#/tasks`, { waitUntil: "load" });
      // The administrator acts in no position, so the template's tasks are the team's, not theirs.
      await page.getByRole("tab", { name: "Team Tasks" }).click();
      await page.getByText("Open the high-ground shelter").first().waitFor();
      await page.getByRole("button", { name: "New task" }).click();
      await page.getByLabel("Task name").fill("Check the tide gauge at the river mouth");
      await page.getByRole("button", { name: "Add task" }).click();
      await page.getByText("Check the tide gauge at the river mouth").first().waitFor();
      const [counted] = await admin`select count(*)::int as n from checklist_items where incident_id = ${incident!.id as string}`;
      expect(counted!.n).toBe(5);
      await page.screenshot({ path: join(SHOTS, `tasks-${viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
