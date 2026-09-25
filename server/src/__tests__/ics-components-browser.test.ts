import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * ICS forms as components of a period, on screen at the frames' 1586 by 992
 * and at 1534 by 790 (VA37). The Planning Section Chief writes the period's
 * 202 objectives, a 205 radio channel and the 208 safety message, marks each
 * ready, reads the versions and prints the 208.
 */

const DIST = buildDir("ics-components");
const SHOTS = shotDir("ics-components");
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
  // The member holds the jurisdiction's Planning Section Chief position.
  const detail = await call(token, "GET", `/api/v1/incidents/${incidents.get(RUNS[0].incident)}`);
  const planning = detail.positions.find((p: { key: string }) => p.key === "planning_section_chief") as { id: string };
  await call(token, "POST", `/api/v1/positions/${planning.id}/assignments`, { personId: seed.memberId });
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
  await page.getByLabel("Email").fill("member@example.org");
  await page.getByLabel("Password").fill("another-good-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "ICS Forms and IAP Assembly", exact: true }).waitFor();
  return page;
}

const fits = (page: Page) => page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1") as Promise<boolean>;

describe("ICS forms as components of a period, on screen", () => {
  for (const run of RUNS) {
    it(`writes the 202, 205 and 208, marks them ready and prints, at ${run.viewport.width} by ${run.viewport.height}`, async () => {
      const incidentId = incidents.get(run.incident)!;
      const page = await signIn(run.viewport, incidentId);
      const acting = page.getByLabel("Acting position");
      await acting.locator("option", { hasText: "Planning Section Chief" }).waitFor({ state: "attached" });
      await acting.selectOption({ label: "Planning Section Chief" });
      await page.locator('select[aria-label="Acting position"] option:checked', { hasText: "Planning Section Chief" })
        .waitFor({ state: "attached" });

      const panel = page.getByRole("region", { name: "ICS forms for this period" });
      await panel.getByText("No forms started for this period yet.").waitFor();

      // The 202: the period's objectives.
      await panel.getByLabel("Form to start").selectOption("ICS-202");
      await panel.getByRole("button", { name: "Start form" }).click();
      const objectives = panel.getByRole("form", { name: "Edit ICS 202: Incident Objectives" });
      await objectives.getByText("Version 1, draft").waitFor();
      expect(await objectives.getByText("Prepared by Member, Planning Section Chief", { exact: false }).count()).toBe(1);
      await objectives.getByLabel("3. Objective(s)").fill("Keep Highway 96 open to Weitchpec\nShelter evacuees at the school gym");
      await objectives.getByLabel("5. Site Safety Plan Required?").selectOption("Yes");
      await objectives.getByRole("checkbox", { name: "ICS 204" }).uncheck();
      await page.screenshot({ path: join(SHOTS, `ics-202-${run.viewport.width}.png`) });
      await objectives.getByRole("button", { name: "Save and mark ready" }).click();
      await panel.getByText("Saved ICS 202: Incident Objectives as version 2, ready.").waitFor();

      // The 205: a tactical channel added to the plan.
      await panel.getByLabel("Form to start").selectOption("ICS-205");
      await panel.getByRole("button", { name: "Start form" }).click();
      const radio = panel.getByRole("form", { name: "Edit ICS 205: Incident Radio Communications Plan" });
      await radio.getByRole("button", { name: "Add a row to Basic Radio Channel Use" }).click();
      await radio.getByLabel("Basic Radio Channel Use, row 1, Channel Name/Trunked Radio System Talkgroup").fill("TAC-2");
      await radio.getByLabel("Basic Radio Channel Use, row 1, Assignment").fill("Division A evacuation");
      await radio.getByLabel("Basic Radio Channel Use, row 1, RX Frequency (N or W)").fill("155.1450 N");
      await radio.getByLabel("5. Special Instructions").fill("Monitor TAC-2 while in Division A.");
      expect(await fits(page)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `ics-205-${run.viewport.width}.png`) });
      await radio.getByRole("button", { name: "Save and mark ready" }).click();
      await panel.getByText("Saved ICS 205: Incident Radio Communications Plan as version 2, ready.").waitFor();

      // The 208: the safety message.
      await panel.getByLabel("Form to start").selectOption("ICS-208");
      await panel.getByRole("button", { name: "Start form" }).click();
      const safety = panel.getByRole("form", { name: "Edit ICS 208: Safety Message/Plan" });
      await safety.getByLabel("3. Safety Message/Expanded Safety Message, Safety Plan, Site Safety Plan")
        .fill("Stay off the levee crown. Wear a PFD within 10 feet of moving water.");
      await safety.getByRole("button", { name: "Save and mark ready" }).click();
      await panel.getByText("Saved ICS 208: Safety Message/Plan as version 2, ready.").waitFor();

      // All three listed ready, the one-per-period 202 now opens rather than starts.
      const list = panel.getByRole("list", { name: "Forms for this period" });
      for (const name of ["ICS 202: Incident Objectives", "ICS 205: Incident Radio Communications Plan", "ICS 208: Safety Message/Plan"]) {
        await list.getByRole("button", { name: new RegExp(`^${name}\\s*Ready`) }).waitFor();
      }
      await panel.getByLabel("Form to start").selectOption("ICS-202");
      await panel.getByRole("button", { name: "Open the period's ICS 202" }).waitFor();

      // The versions, and the 208 printed.
      await safety.getByRole("button", { name: "Versions" }).click();
      const versions = panel.getByRole("region", { name: "Versions of ICS 208: Safety Message/Plan" });
      await versions.getByText("Version 2, ready").waitFor();
      await versions.getByText("Version 1, draft").waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        safety.getByRole("button", { name: "Print version 2" }).click(),
      ]);
      expect(download.suggestedFilename()).toBe("ics-208-v2.pdf");
      const pdf = await readFile((await download.path())!, "latin1");
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("Stay off the levee crown.");
      // The title wraps at the writer's line length before the incident's number.
      expect(pdf).toContain("(ICS 208 Safety Message/Plan: Klamath River Flood) Tj");
      expect(await fits(page)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `ics-forms-list-${run.viewport.width}.png`) });

      const stored = await admin`
        select form_id, status, version, prepared_role_label from ics_form_components
        where incident_id = ${incidentId} order by form_id`;
      expect(stored.map((row) => [row.form_id, row.status, row.version, row.prepared_role_label])).toEqual([
        ["ICS-202", "ready", 2, "Planning Section Chief"],
        ["ICS-205", "ready", 2, "Planning Section Chief"],
        ["ICS-208", "ready", 2, "Planning Section Chief"],
      ]);
      await page.context().close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
