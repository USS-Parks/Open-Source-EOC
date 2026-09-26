import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { NORTH_COAST_PASSWORD, NORTH_COAST_TIME_ZONE, placeOnScenarioClock, seedNorthCoast, type NorthCoastScenario } from "../demo/north-coast.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The After Action, Shelters and Damage Assessment Dashboard tabs on the
 * North Coast Storm exercise, with the records they count written through
 * the API here: observations and corrective actions on the storm and on a
 * second Humboldt incident, shelter changes during the morning, field
 * assessments, public reports and Public Assistance line items. Another
 * county's incident and its corrective action exist beside them and must
 * never appear. Walked at the frames' size and at a 125%-scaled laptop's,
 * in light and dark, clicking a chart to filter each list.
 */

const DIST = buildDir("incident-dashboards-app");
const SHOTS = shotDir("incident-dashboards");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const DIRECTOR = "jordan.lee@humboldt.example";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let scenario: NorthCoastScenario;
let sheltersBoard: string;
const pageErrors: string[] = [];
const outside: string[] = [];

/** A calendar date `days` from today in the scenario's time zone, as a due date is entered. */
function dateFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: NORTH_COAST_TIME_ZONE });
}

async function patch(token: string, url: string, payload: Record<string, unknown>): Promise<void> {
  const response = await app.inject({ method: "PATCH", url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBe(200);
}

async function seedDashboards(): Promise<void> {
  const token = await login(app, DIRECTOR, NORTH_COAST_PASSWORD);
  const { incidentId, jurisdictionId } = scenario;
  const [position] = await admin`select id from positions where jurisdiction_id = ${jurisdictionId} and key = 'planning_section_chief'`;
  const [liaison] = await admin`select id from incident_participants where incident_id = ${incidentId} and incident_position_title = 'Shelter liaison'`;

  // After action: observations and corrective actions on the storm.
  for (const [capability, capabilityElement, kind, observation] of [
    ["mass_care_services", "equipment", "improvement", "Cots ran short at the Arcata shelter by 02:00."],
    ["mass_care_services", "training", "improvement", "Shelter intake staff had not practiced the reunification form."],
    ["operational_communications", "equipment", "improvement", "The Fortuna repeater dropped for forty minutes."],
    ["public_information_and_warning", "none", "strength", "Evacuation warnings went out in English and Spanish within ten minutes."],
    ["critical_transportation", "planning", "improvement", "No detour plan existed for the US-101 closure at Fields Landing."],
    ["situational_assessment", "organization", "strength", "Field report triage kept the Planning Section current."],
  ] as const) {
    await post(app, token, `/api/v1/incidents/${incidentId}/aar/observations`, { capability, capabilityElement, kind, observation });
  }
  const action = async (body: Record<string, unknown>, status?: "in_progress" | "complete", on = incidentId) => {
    const created = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, { incidentId: on, ...body });
    if (status) await patch(token, `/api/v1/corrective-actions/${created.id as string}`, { expectedRevision: 0, status });
  };
  await action({ capability: "mass_care_services", capabilityElement: "equipment", recommendation: "Pre-stage 300 cots at the Arcata Community Center.",
    priority: "high", dueDate: dateFromToday(-10), assignment: { kind: "incident_participant", incidentId, participantId: liaison!.id } });
  await action({ capability: "mass_care_services", capabilityElement: "training", recommendation: "Train intake staff on the reunification form.",
    priority: "medium", dueDate: dateFromToday(30), assignment: { kind: "position", positionId: position!.id } }, "in_progress");
  await action({ capability: "operational_communications", capabilityElement: "equipment", recommendation: "Add battery backup to the Fortuna repeater.",
    priority: "critical", dueDate: dateFromToday(14) });
  await action({ capability: "critical_transportation", capabilityElement: "planning", recommendation: "Write a US-101 detour annex with Caltrans District 1.",
    priority: "high", assignment: { kind: "position", positionId: position!.id } });
  await action({ capability: "public_information_and_warning", capabilityElement: "none", recommendation: "Keep the bilingual warning templates current.",
    priority: "low", dueDate: dateFromToday(-3) }, "complete");
  await action({ capability: "planning", capabilityElement: "exercises", recommendation: "Exercise the shelter surge plan before the next storm season.",
    priority: "unspecified" });

  // A second Humboldt incident for the all-incidents rollup.
  const winter = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, { templateKey: "severe_storm", name: "Winter Storm Exercise" });
  await action({ capability: "planning", capabilityElement: "planning", recommendation: "Revise the winter storm annex.",
    priority: "medium", dueDate: dateFromToday(-20), assignment: { kind: "position", positionId: position!.id } }, undefined, winter.incidentId as string);
  await action({ capability: "logistics_and_supply_chain_management", capabilityElement: "equipment", recommendation: "Contract a second generator vendor.",
    priority: "high" }, "complete", winter.incidentId as string);

  // Another county's incident and corrective action, which Humboldt may not read.
  const farId = await createJurisdiction(admin, "far-county", "Far County OES");
  const farAdmin = await createPerson(admin, { email: "admin@far-county.example", displayName: "Far Admin", password: "far-county-good-password" });
  await addMembership(admin, farAdmin, farId, "admin");
  const farToken = await login(app, "admin@far-county.example", "far-county-good-password");
  const far = await post(app, farToken, `/api/v1/jurisdictions/${farId}/incidents`, { templateKey: "severe_storm", name: "Far County Flood" });
  await post(app, farToken, `/api/v1/jurisdictions/${farId}/corrective-actions`, {
    incidentId: far.incidentId, capability: "planning", recommendation: "Far County's own follow-up.", priority: "critical",
  });

  // Shelters: the morning's changes.
  [{ id: sheltersBoard }] = await admin`
    select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = 'shelters'` as unknown as [{ id: string }];
  const shelter = async (name: string, data: Record<string, unknown>) => {
    const [row] = await admin`select id from board_records where board_id = ${sheltersBoard} and data->>'name' = ${name}`;
    await patch(token, `/api/v1/boards/${sheltersBoard}/records/${row!.id as string}?incidentId=${incidentId}`, data);
  };
  await shelter("Eureka Municipal Auditorium", { status: "compromised", occupancy: 96 });
  await shelter("Wendy's Shelter", { occupancy: 57 });
  await shelter("Ferndale Community Church", { status: "closed", occupancy: 0 });

  // Damage assessment: field assessments, public reports in intake, Public Assistance line items.
  const assessments: [string, string, string, number][] = [
    ["1402 Spring St, Eureka", "destroyed", "single_family", 385_000],
    ["88 Jacoby Creek Rd, Bayside", "major", "single_family", 142_000],
    ["2210 Walnut Dr, Eureka", "major", "mobile_home", 61_000],
    ["615 Bayshore Way, Eureka", "major", "business", 220_000],
    ["19 Dows Prairie Rd, McKinleyville", "minor", "single_family", 18_500],
    ["301 Main St, Ferndale", "minor", "business", 26_000],
    ["44 Loleta Dr, Loleta", "minor", "multi_family", 33_000],
    ["1200 Fairhaven Rd, Samoa", "affected", "single_family", 4_200],
    ["730 Elk River Rd, Eureka", "affected", "single_family", 3_100],
    ["12 Trinidad Head Rd, Trinidad", "affected", "other", 2_500],
    ["5 Fernbridge Dr, Fernbridge", "inaccessible", "single_family", 0],
  ];
  for (const [address, degree, structureType, estimatedLoss] of assessments) {
    await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/damage/assessments`, { address, degree, structureType, estimatedLoss });
  }
  const intake = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/damage/intake/enable`, {});
  for (const [address, degree] of [["77 Pickett Rd, Eureka", "minor"], ["410 G St, Arcata", "affected"], ["9 Old Arcata Rd, Bayside", "major"]]) {
    const response = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/damage/report`,
      headers: { "x-intake-token": intake.token as string },
      payload: { address, degree, structureType: "single_family", estimatedLoss: 9_000, reporterContact: "resident@example.org" },
    });
    expect(response.statusCode, response.body).toBe(202);
  }
  const [duplicate] = await admin`select id from damage_assessments where address = '410 G St, Arcata'`;
  const rejected = await app.inject({ method: "POST", url: `/api/v1/damage/assessments/${duplicate!.id as string}/moderate`, headers: auth(token), payload: { decision: "rejected" } });
  expect(rejected.statusCode, rejected.body).toBeLessThan(300);
  for (const [applicant, category, dollars, status] of [
    ["City of Eureka", "a_debris_removal", 184_000, "submitted"],
    ["Humboldt County Public Works", "a_debris_removal", 96_500, "reviewed"],
    ["Humboldt County Sheriff", "b_emergency_protective_measures", 58_200, "submitted"],
    ["Caltrans District 1", "c_roads_and_bridges", 412_000, "draft"],
    ["Humboldt Bay Harbor District", "d_water_control_facilities", 77_000, "submitted"],
    ["Arcata Fire District", "e_buildings_and_equipment", 31_400, "reviewed"],
    ["Humboldt Bay Municipal Water", "f_utilities", 128_000, "submitted"],
  ] as const) {
    await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/damage/pa-items`, {
      incidentId, applicant, category, estimatedCostCents: dollars * 100, status, percentComplete: status === "reviewed" ? 40 : 0,
    });
  }
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  scenario = await seedNorthCoast(app, admin);
  await placeOnScenarioClock(admin, scenario);
  await seedDashboards();
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function useTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const current = () => page.locator(".eoc-theme[data-theme]").first().getAttribute("data-theme");
  if (await current() === theme) return;
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: `Use ${theme} theme` }).click();
  await expect.poll(current).toBe(theme);
  if (await page.getByRole("group", { name: "Account" }).count()) await page.getByRole("button", { name: "Account menu" }).click();
}

async function open(page: Page, hash: string, tab: string): Promise<void> {
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await page.getByRole("article", { name: tab }).first().waitFor();
}

/** The count a legend row or tile states, e.g. "High 2 (33%)" or "1 Compromised". */
const stated = async (page: Page, name: RegExp) => Number(/(\d+)/.exec((await page.getByRole("button", { name }).first().textContent())!)![1]);

const listItems = (page: Page) => page.locator(".eoc-dash-list .eoc-dash-row");

describe("incident dashboards on North Coast Storm", () => {
  for (const viewport of VIEWPORTS) {
    it(`counts, draws and filters the AAR, shelter and damage dashboards at ${viewport.width} by ${viewport.height}`, async () => {
      const context = await browser.newContext({ viewport, timezoneId: NORTH_COAST_TIME_ZONE, locale: "en-US" });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        outside.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html#/overview?incident=${scenario.incidentId}`, { waitUntil: "load" });
      await page.getByLabel("Email").fill(DIRECTOR);
      await page.getByLabel("Password").fill(NORTH_COAST_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("button", { name: "Account menu" }).waitFor();
      await page.getByRole("region", { name: "Device PIN" }).getByRole("button", { name: "Not now" }).click({ timeout: 5_000 }).catch(() => undefined);
      const incident = `?incident=${scenario.incidentId}`;

      for (const theme of ["light", "dark"] as const) {
        await useTheme(page, theme);
        const tag = `${viewport.width}-${theme}`;

        // After action: this incident, then every incident Humboldt may read.
        await open(page, `#/aar${incident}`, "Actions by priority");
        await page.getByRole("article", { name: "Core capability" }).getByRole("button", { name: "Mass Care Services: 4" }).waitFor();
        await page.screenshot({ path: join(SHOTS, `aar-${tag}.png`) });
        const high = await stated(page, /^High \d+/);
        expect(high).toBe(2);
        await page.getByRole("article", { name: "Actions by priority" }).getByRole("button", { name: /^High \d+/ }).click();
        await expect.poll(() => listItems(page).count()).toBe(high);
        await page.getByRole("button", { name: "Open in the records list" }).click();
        await page.getByRole("heading", { name: "Priority: High" }).waitFor();
        expect(await page.locator(".eoc-aar-action[data-record-id]").count()).toBe(high);
        await page.getByRole("tab", { name: "Dashboard" }).click();
        await page.getByRole("radio", { name: "All incidents" }).check();
        await page.getByText("8 corrective actions across 2 incidents you can read, active in this range.").waitFor();
        await page.getByRole("article", { name: "Responsible organization" }).getByRole("button", { name: /^American Red Cross: 1$/ }).click();
        await expect.poll(() => listItems(page).count()).toBe(1);
        await page.screenshot({ path: join(SHOTS, `aar-all-${tag}.png`) });
        await page.getByRole("button", { name: "Clear filter" }).click();
        await expect.poll(() => listItems(page).count()).toBe(8);
        expect(await page.locator("body").innerText()).not.toContain("Far County");

        // Shelters: the Dashboard tab beside the board's views.
        await open(page, `#/board/${sheltersBoard}${incident}`, "Occupancy against capacity");
        await page.getByRole("article", { name: "Occupancy by operational period" }).getByRole("img", { name: /^(OP 03 \(now\)|Now): \d+$/ }).waitFor();
        await page.screenshot({ path: join(SHOTS, `shelters-${tag}.png`) });
        expect(await stated(page, /^\d+ Compromised$/)).toBe(1);
        await page.getByRole("button", { name: /^\d+ Compromised$/ }).click();
        await expect.poll(() => listItems(page).count()).toBe(1);
        await page.getByRole("button", { name: "Eureka Municipal Auditorium" }).click();
        const [eureka] = await admin`select id from board_records where board_id = ${sheltersBoard} and data->>'name' = 'Eureka Municipal Auditorium'`;
        await expect.poll(() => page.url()).toContain(`record=${eureka!.id as string}`);

        // Damage assessment.
        await open(page, `#/damage${incident}`, "Counted structures by degree");
        await page.screenshot({ path: join(SHOTS, `damage-${tag}.png`) });
        expect(await stated(page, /^Major damage \d+/)).toBe(3);
        await page.getByRole("button", { name: "View Major damage" }).click();
        await expect.poll(() => listItems(page).count()).toBe(3);
        await page.getByRole("article", { name: "Public Assistance line items by category" }).getByRole("button", { name: "A: Debris removal: 2" }).click();
        await expect.poll(() => listItems(page).count()).toBe(2);
        await page.getByRole("button", { name: /^2 In the intake queue$/ }).waitFor();
        expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      }
      // With the context drawer closed a dashboard takes the workspace's full width, as WebEOC's do.
      for (const [name, hash, card] of [["aar", `#/aar${incident}`, "Actions by priority"], ["damage", `#/damage${incident}`, "Counted structures by degree"]]) {
        await open(page, hash!, card!);
        if (await page.locator(".eoc-shell-drawer[data-open]").count()) await page.locator(".eoc-shell-drawer-header button").click();
        await expect.poll(() => page.locator(".eoc-shell-drawer[data-open]").count()).toBe(0);
        await page.screenshot({ path: join(SHOTS, `${name}-wide-${viewport.width}-dark.png`) });
      }
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
