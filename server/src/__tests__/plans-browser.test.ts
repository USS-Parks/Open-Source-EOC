import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { runDuePlans } from "../plans/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * Executable plans on screen (Veoci and air gap VA13), at the frames' 1586 by
 * 992 and at 1534 by 790: an administrator writes a plan with a section, two
 * timed tasks and a notice, activates it, and sees the incident open with the
 * first task released, the notice sent and the second task waiting; when the
 * scheduler's time comes, the second task is on the Tasks screen. At the
 * first width the jurisdiction has no open incident, so the console selects
 * the new one itself and remounts the screen; the report has to survive that.
 */

const DIST = buildDir("plans");
const SHOTS = shotDir("plans");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;
const MINUTE = 60_000;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
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
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  // The member holds Operations, so the plan's notice to that position reaches one person.
  const [position] = await admin`
    insert into positions (jurisdiction_id, key, title)
    values (${seed.jurisdictionId}, 'operations_section_chief', 'Operations Section Chief') returning id`;
  await admin`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${position!.id as string}, ${seed.memberId}, ${seed.adminId})`;
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

describe("executable plans on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`writes a plan, activates it and releases its tasks on schedule, at ${viewport.width} by ${viewport.height}`, async () => {
      const title = `Storm Plan ${viewport.width}`;
      const incidentName = `River Road Storm ${viewport.width}`;
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

      // Write the plan.
      const panel = page.getByRole("region", { name: "Plans" });
      await panel.getByRole("button", { name: "New plan" }).click();
      const editor = panel.getByRole("form", { name: "New plan" });
      await editor.getByLabel("Plan title").fill(title);
      await editor.getByLabel("Incident template it activates").selectOption({ label: "Severe Storm" });
      await editor.getByRole("button", { name: "Add a section" }).click();
      const section = editor.getByRole("group", { name: "Section 1" });
      await section.getByLabel("Section 1 title").fill("Concept of operations");
      await section.getByLabel("Section 1 text").fill("Partial activation on a storm warning. Operations stages the road crews.");
      await section.getByRole("checkbox", { name: "Operations Section Chief" }).check();
      await section.getByRole("checkbox", { name: "Road Closures" }).check();
      await editor.getByRole("button", { name: "Add a task" }).click();
      await editor.getByLabel("Task 1 position").selectOption({ label: "Operations Section Chief" });
      await editor.getByLabel("Task 1 description").fill("Stage the road crews");
      await editor.getByRole("button", { name: "Add a task" }).click();
      await editor.getByLabel("Task 2 position").selectOption({ label: "Operations Section Chief" });
      await editor.getByLabel("Task 2 description").fill("Check the culverts on the river road");
      await editor.getByLabel("Task 2 release (hours)").fill("1");
      await editor.getByLabel("Task 2 due within (hours)").fill("2");
      await editor.getByRole("checkbox", { name: "Notify people when the plan activates" }).check();
      await editor.getByRole("group", { name: "Holders of these positions" })
        .getByRole("checkbox", { name: "Operations Section Chief" }).check();
      const sendBy = editor.getByRole("group", { name: "Send by" });
      await sendBy.getByRole("checkbox", { name: "Email" }).uncheck();
      await sendBy.getByRole("checkbox", { name: "Text message" }).uncheck();
      await page.screenshot({ path: join(SHOTS, `plan-new-${viewport.width}.png`), fullPage: false });
      await editor.getByRole("button", { name: "Save plan" }).click();
      await panel.getByText(`Saved ${title} as version 1.`).waitFor();

      // Read it back as a reader sees it.
      await panel.getByRole("button", { name: `Read ${title}` }).click();
      const reading = panel.getByRole("region", { name: `${title}, version 1` });
      await reading.getByText("Carried out by: Operations Section Chief, Road Closures board.").waitFor();
      await reading.getByText("Check the culverts on the river road · Operations Section Chief · 1 hour after activation").waitFor();

      // Activate it.
      await panel.getByRole("button", { name: `Activate ${title}` }).click();
      const activation = panel.getByRole("form", { name: `Activate ${title}` });
      await activation.getByLabel("Incident name").fill(incidentName);
      await activation.getByRole("button", { name: "Activate the plan" }).click();
      const report = `${incidentName} is activated from ${title}, version 1: 1 task released now, 1 task waiting for their time; the notice reached 1 person.`;
      await panel.getByText(report).waitFor();
      // Switch the console to it, if it has not selected it itself; the report and the setup survive the remount.
      await panel.getByRole("button", { name: `Switch to ${incidentName}` }).click();
      await page.locator('select[aria-label="Selected incident"] option:checked', { hasText: incidentName })
        .waitFor({ state: "attached" });
      await panel.getByText(report).waitFor();
      const setup = page.getByRole("region", { name: `${incidentName}: incident setup` });
      const plan = setup.getByRole("region", { name: "Incident plan" });
      await plan.getByText(`Plan: ${title}, version 1`).waitFor();
      await plan.getByText(/Check the culverts on the river road · Operations Section Chief · releases/).waitFor();
      await setup.getByRole("listitem", { name: "Stage the road crews" }).waitFor();
      await plan.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `plan-activated-${viewport.width}.png`) });

      const [incident] = await admin`select id, plan_version from incidents where name = ${incidentName}`;
      expect(incident!.plan_version).toBe(1);
      const [notified] = await admin`
        select count(*)::int as n from notifications where incident_id = ${incident!.id as string} and person_id = ${seed.memberId}`;
      expect(notified!.n).toBe(1);

      // The scheduler's time comes: the waiting task goes to Operations.
      const principal = await principalForPerson(runtime, seed.adminId);
      await withPerson(runtime, seed.adminId, (tx) =>
        runDuePlans(tx, principal, seed.jurisdictionId, new Date(Date.now() + 61 * MINUTE)));
      const [culverts] = await admin`
        select r.released_at from plan_task_releases r
        where r.incident_id = ${incident!.id as string} and r.item = 'Check the culverts on the river road'`;
      expect(culverts!.released_at).not.toBeNull();
      await page.goto(`${baseUrl}/app/index.html#/tasks`, { waitUntil: "load" });
      await page.getByRole("tab", { name: "Team Tasks" }).click();
      await page.getByText("Check the culverts on the river road").first().waitFor();
      await page.screenshot({ path: join(SHOTS, `plan-released-${viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
