import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The IAP assembled from the period's ICS forms, on screen at the frames'
 * 1586 by 992 and at 1534 by 790 (VA37 part two). Acting as Planning Section
 * Chief, the administrator writes the 202 objectives, a 205 channel and the
 * 208 safety message, assembles the period's IAP from them, submits and
 * approves it, then changes the 205 and finds the plan's revision 2 waiting
 * as a draft with the new 205, and prints it.
 */

const DIST = buildDir("iap-components");
const SHOTS = shotDir("iap-components");
const RUNS = [
  { viewport: { width: 1586, height: 992 }, incident: "Klamath River Flood 1586" },
  { viewport: { width: 1534, height: 790 }, incident: "Klamath River Flood 1534" },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
const incidents = new Map<string, string>();
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function call(token: string, method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>) {
  const res = await app.inject({ method, url, headers: auth(token), ...(payload === undefined ? {} : { payload }) });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  const now = Date.now();
  for (const run of RUNS) {
    const { incidentId } = await call(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      { templateKey: "wildfire", name: run.incident });
    await call(token, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
      expectedRevision: 0,
      geometry: null,
      operationalPeriod: {
        label: "OP 1 Day",
        startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now + 11 * 60 * 60 * 1000).toISOString(),
      },
      reason: "First operational period",
    });
    incidents.set(run.incident, incidentId as string);
  }
  // The administrator also holds the jurisdiction's Planning Section Chief position.
  const detail = await call(token, "GET", `/api/v1/incidents/${incidents.get(RUNS[0].incident)}`);
  const planning = detail.positions.find((p: { key: string }) => p.key === "planning_section_chief") as { id: string };
  await call(token, "POST", `/api/v1/positions/${planning.id}/assignments`, { personId: seed.adminId });
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn(viewport: { width: number; height: number }, incidentId: string): Promise<Page> {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html#/forms?incident=${incidentId}&period=1`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "ICS Forms and IAP Assembly", exact: true }).waitFor();
  return page;
}

const fits = (page: Page) => page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1") as Promise<boolean>;

async function writeForm(panel: Locator, formId: string, title: string, fill: (form: Locator) => Promise<void>): Promise<void> {
  await panel.getByLabel("Form to start").selectOption(formId);
  await panel.getByRole("button", { name: "Start form" }).click();
  const form = panel.getByRole("form", { name: `Edit ${formId.replace("-", " ")}: ${title}` });
  await fill(form);
  await form.getByRole("button", { name: "Save and mark ready" }).click();
  await panel.getByText(`Saved ${formId.replace("-", " ")}: ${title} as version 2, ready.`).waitFor();
}

describe("the IAP assembled from the period's ICS forms, on screen", () => {
  for (const run of RUNS) {
    it(`assembles, approves and revises the plan from its forms at ${run.viewport.width} by ${run.viewport.height}`, async () => {
      const incidentId = incidents.get(run.incident)!;
      const page = await signIn(run.viewport, incidentId);
      const acting = page.getByLabel("Acting position");
      await acting.locator("option", { hasText: "Planning Section Chief" }).waitFor({ state: "attached" });
      await acting.selectOption({ label: "Planning Section Chief" });
      await page.locator('select[aria-label="Acting position"] option:checked', { hasText: "Planning Section Chief" })
        .waitFor({ state: "attached" });

      const panel = page.getByRole("region", { name: "ICS forms for this period" });
      await panel.getByText("No forms started for this period yet.").waitFor();
      await writeForm(panel, "ICS-202", "Incident Objectives", (form) =>
        form.getByLabel("3. Objective(s)").fill("Keep Highway 96 open to Weitchpec\nShelter evacuees at the school gym"));
      await writeForm(panel, "ICS-205", "Incident Radio Communications Plan", async (form) => {
        await form.getByRole("button", { name: "Add a row to Basic Radio Channel Use" }).click();
        await form.getByLabel("Basic Radio Channel Use, row 1, Channel Name/Trunked Radio System Talkgroup").fill("TAC-2");
        await form.getByLabel("Basic Radio Channel Use, row 1, Assignment").fill("Division A evacuation");
      });
      await writeForm(panel, "ICS-208", "Safety Message/Plan", (form) =>
        form.getByLabel("3. Safety Message/Expanded Safety Message, Safety Plan, Site Safety Plan").fill("Stay off the levee crown."));

      // The plan: the default set of the ready forms.
      const choice = panel.getByRole("group", { name: "Assemble the IAP from these forms" });
      await choice.getByRole("button", { name: "Assemble IAP from 3 forms" }).click();
      await panel.getByText("Assembled a draft IAP for OP 1 Day from 3 forms.").waitFor();
      expect(await fits(page)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `plan-choice-${run.viewport.width}.png`) });
      await choice.getByRole("button", { name: "Review it in the IAP workspace" }).click();
      await page.getByRole("heading", { name: "Incident Action Plans", exact: true }).waitFor();

      const plans = page.getByRole("region", { name: "Plans", exact: true });
      await plans.getByRole("button", { name: /OP 1 Day.*In progress/ }).click();
      const detail = page.getByRole("region", { name: "Plan detail", exact: true });
      const planForms = detail.getByRole("region", { name: "Forms in this plan" });
      await planForms.getByText("ICS 205: Incident Radio Communications Plan").waitFor();
      expect(await planForms.getByText("Current", { exact: true }).count()).toBe(3);
      await detail.getByText("This plan's 204 assignments are ICS forms of the period; change them under ICS Forms.").waitFor();
      expect(await detail.getByRole("region", { name: "ICS-204 planning" }).count()).toBe(0);
      await detail.getByRole("tab", { name: "ICS-205" }).click();
      await detail.getByText("TAC-2").first().waitFor();

      // Submitted and approved as a whole.
      await detail.getByRole("button", { name: "Submit for approval", exact: true }).click();
      await detail.getByText("In approval", { exact: true }).waitFor();
      await detail.getByRole("button", { name: "Approve revision", exact: true }).click();
      await detail.getByText("Approved", { exact: true }).waitFor();
      await page.screenshot({ path: join(SHOTS, `plan-approved-${run.viewport.width}.png`) });

      // The 205 changes: the approved plan stays, and revision 2 waits for approval.
      await page.getByRole("button", { name: "Open ICS forms", exact: true }).click();
      const forms = page.getByRole("region", { name: "ICS forms for this period" });
      await forms.getByRole("list", { name: "Forms for this period" })
        .getByRole("button", { name: /^ICS 205: Incident Radio Communications Plan/ }).click();
      const radio = forms.getByRole("form", { name: "Edit ICS 205: Incident Radio Communications Plan" });
      await radio.getByLabel("Basic Radio Channel Use, row 1, Channel Name/Trunked Radio System Talkgroup").fill("TAC-4");
      await radio.getByRole("button", { name: "Save and mark ready" }).click();
      await forms.getByText("Saved ICS 205: Incident Radio Communications Plan as version 3, ready."
        + " The IAP's revision 2 started from it, a draft for approval.").waitFor();
      await page.getByRole("button", { name: "Open IAP workspace", exact: true }).click();
      await page.getByRole("heading", { name: "Incident Action Plans", exact: true }).waitFor();
      await page.getByRole("region", { name: "Plans", exact: true }).getByRole("button", { name: /Revision 2/ }).click();
      const revised = page.getByRole("region", { name: "Plan detail", exact: true });
      await revised.getByText(/Revision 2, content revision 1/).waitFor();
      const revisedForms = revised.getByRole("region", { name: "Forms in this plan" });
      await revisedForms.getByText("version 3").waitFor();
      const history = revised.getByRole("region", { name: "Revision history" });
      await history.getByText("Revision 1", { exact: true }).waitFor();
      await history.getByText("Revision 2", { exact: true }).waitFor();
      expect(await fits(page)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `plan-revision-2-${run.viewport.width}.png`) });

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        revised.getByRole("button", { name: "Download revision 2 PDF" }).click(),
      ]);
      expect(download.suggestedFilename()).toBe("iap-op-1-day-revision-2.pdf");
      const pdf = await readFile((await download.path())!, "latin1");
      expect(pdf).toContain("(Contents:) Tj");
      expect(pdf).toContain("(  ICS 208 Safety Message/Plan, version 2) Tj");
      expect(pdf).toContain("(Approval: not approved) Tj");
      expect(pdf).toContain("TAC-4");

      const stored = await admin`
        select revision_number, status from iaps where incident_id = ${incidentId} order by revision_number`;
      expect(stored.map((row) => [row.revision_number, row.status])).toEqual([[1, "approved"], [2, "draft"]]);
      await page.context().close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
