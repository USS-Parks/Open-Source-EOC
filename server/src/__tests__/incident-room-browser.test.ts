import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardIncidentTemplates, IncidentTemplateSchema } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The incident room on screen (VC-12), at the frames' 1586 by 992 and at
 * 1534 by 790: an administrator activates an incident from a template that
 * names a dashboard, two message threads, a contact group and two file
 * folders, and finds each part in its own screen: the incident's dashboard
 * first on Dashboards, both threads on Messages, the group on Contacts, and
 * the folders on Files, where a file is filed into one and listed by it.
 */

const DIST = buildDir("incident-room");
const SHOTS = shotDir("incident-room");
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
  process.env.OPENEOC_DATA_DIR = mkdtempSync(join(tmpdir(), "openeoc-room-browser-"));
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await ensureStandardDashboards(admin);
  const room = IncidentTemplateSchema.parse({
    key: "river_flood",
    title: "River Flood",
    positions: ["incident_commander", "operations_section_chief"],
    boards: ["activity_log", "significant_events", "shelters", "road_closures"],
    checklists: [{ position: "incident_commander", items: ["Set the first operational period"] }],
    contactGroups: [{ name: "Flood command", positions: ["incident_commander", "operations_section_chief"] }],
    dashboards: ["eoc_status"],
    threads: [{ title: "EOC coordination" }, { title: "Field operations", positions: ["operations_section_chief"] }],
    fileFolders: ["Situation reports", "Maps"],
  });
  await admin`insert into incident_templates (key, title, definition) values (${room.key}, ${room.title}, ${admin.json(room as never)})`;
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

describe("the incident room on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`activates an incident and finds its dashboard, threads, contact group and folders, at ${viewport.width} by ${viewport.height}`, async () => {
      const incidentName = `Klamath Flood ${viewport.width}`;
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
      const activate = page.getByRole("region", { name: "Activate an incident" });
      await activate.getByLabel("Scenario template").selectOption({ label: "River Flood" });
      await activate.getByLabel("Incident name").fill(incidentName);
      await activate.getByRole("button", { name: "Activate" }).click();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: incidentName })
        .waitFor({ state: "attached" });

      // Dashboards: the incident's own dashboard is the one shown, and first in the list.
      await page.goto(`${baseUrl}/app/index.html#/dashboard`, { waitUntil: "load" });
      await page.getByRole("heading", { name: `${incidentName}: EOC Status` }).waitFor();
      const listed = page.getByRole("list", { name: "Jurisdiction dashboards" }).getByRole("listitem");
      await expect.poll(() => listed.first().getAttribute("aria-label")).toBe(`${incidentName}: EOC Status`);
      expect(await listed.count()).toBe(1);
      await page.screenshot({ path: join(SHOTS, `dashboard-${viewport.width}.png`) });

      // Messages: the incident-wide thread and the Operations thread.
      await page.goto(`${baseUrl}/app/index.html#/messages`, { waitUntil: "load" });
      await page.getByRole("button", { name: /EOC coordination/ }).waitFor();
      await page.getByRole("button", { name: /Field operations/ }).waitFor();
      await page.screenshot({ path: join(SHOTS, `messages-${viewport.width}.png`) });

      // Contacts: the group the template names.
      await page.goto(`${baseUrl}/app/index.html#/contacts`, { waitUntil: "load" });
      await page.getByRole("listitem", { name: "Group Flood command" }).waitFor();

      // Files: the folders, an upload filed into one, and that folder's list.
      await page.goto(`${baseUrl}/app/index.html#/files`, { waitUntil: "load" });
      const shown = page.getByLabel("Show folder", { exact: true });
      await expect.poll(async () => (await shown.locator("option").allTextContents()))
        .toEqual(["All folders", "Situation reports (0)", "Maps (0)"]);
      await page.getByLabel("File into folder", { exact: true }).selectOption({ label: "Maps" });
      await page.getByLabel("File", { exact: true }).setInputFiles({
        name: "levee-map.txt", mimeType: "text/plain", buffer: Buffer.from("Levee breach at mile 4"),
      });
      await page.getByRole("button", { name: "Upload" }).click();
      await page.getByText("Stored levee-map.txt in Maps as version 1.").waitFor();
      await shown.selectOption({ label: "Maps (1)" });
      const library = page.getByRole("region", { name: "File library" });
      await library.getByRole("button", { name: /levee-map\.txt/ }).waitFor();
      expect(await library.getByRole("button", { name: /levee-map\.txt/ }).textContent()).toContain("Incident - Maps");
      await page.screenshot({ path: join(SHOTS, `files-${viewport.width}.png`) });

      const [incident] = await admin`select id from incidents where name = ${incidentName}`;
      const [filed] = await admin`
        select f.attached_id, folder.name from files f join file_folders folder on folder.id = f.folder_id
        where f.name = 'levee-map.txt' and folder.incident_id = ${incident!.id as string}`;
      expect(filed).toMatchObject({ attached_id: incident!.id, name: "Maps" });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
