import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The damage assessment surface in a real browser: public reports arrive in
 * the intake queue, a member moderates them and records a field assessment,
 * and the loss summary, declaration indicators, download and map follow the
 * counted reports only. Public Assistance line items move the per-capita
 * indicators onto PA cost, and the download carries the PA categories and the
 * shelter census from the facilities integration.
 */
const DIST = buildDir("damage-app");
const SHOTS = shotDir("damage");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let jurisdictionId: string;
let memberId: string;
let intakeToken: string;

async function publicReport(token: string, payload: Record<string, unknown>): Promise<number> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/damage/report`,
    headers: { "x-intake-token": token },
    payload,
  });
  return response.statusCode;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  memberId = seed.memberId;
  // The facilities integration runs so the declaration summary carries a shelter census.
  app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const adminToken = await login(app);
  const shelter = await post(app, adminToken, `/api/v1/jurisdictions/${jurisdictionId}/facilities`, { name: "Klamath Gym", kind: "shelter" });
  await post(app, adminToken, `/api/v1/facilities/${shelter.id as string}/status`,
    { operatingStatus: "normal", beds: [{ bedType: "other", available: 40, baseline: 120 }] });
  const enabled = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/damage/intake/enable`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  intakeToken = enabled.json().token as string;
  expect(await publicReport(intakeToken, {
    address: "12 Oak St", structureType: "single_family", degree: "destroyed", estimatedLoss: 180000,
    reporterContact: "resident@example.org", location: { lon: -123.84, lat: 41.21 },
  })).toBe(202);
  expect(await publicReport(intakeToken, {
    address: "40 Pine Rd", structureType: "mobile_home", degree: "minor", estimatedLoss: 15000,
    location: { lon: -123.8, lat: 41.25 },
  })).toBe(202);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function openDamage(email: string, password: string): Promise<{ page: Page; errors: string[]; external: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors: string[] = [];
  const external: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
  await page.getByRole("button", { name: "Damage Assessment", exact: true }).click();
  await page.getByRole("heading", { name: "Damage assessment", level: 2, exact: true }).waitFor();
  return { page, errors, external };
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: theme === "light" ? "Use light theme" : "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

describe("damage assessment surface", () => {
  it("moderates intake, records a field assessment and follows only counted reports", async () => {
    const { page, errors, external } = await openDamage("member@example.org", "another-good-password");
    const kpi = (label: string) => page.getByLabel("Loss summary").locator("article", { hasText: label }).locator(".eoc-kit-kpi-value strong");
    const indicator = (title: string) => page.getByRole("listitem", { name: title });

    // Seeded public reports wait in the intake queue.
    await page.getByRole("button", { name: "Accept report for 12 Oak St" }).waitFor();
    await page.getByRole("button", { name: "Reject report for 40 Pine Rd" }).waitFor();
    expect(await page.getByText("resident@example.org").count()).toBe(1);
    // A member moderates but does not manage the intake token.
    expect(await page.getByRole("region", { name: "Public report intake" }).count()).toBe(0);

    // Nothing counts before moderation.
    await page.getByLabel("County population").fill("5000");
    await page.getByLabel("IA residence threshold").fill("2");
    await kpi("Estimated loss").filter({ hasText: "$0.00" }).waitFor();
    await indicator("Individual Assistance residences").getByText("Threshold not met").waitFor();

    await page.getByRole("button", { name: "Accept report for 12 Oak St" }).click();
    await page.getByText("Accepted the report for 12 Oak St. It now counts toward the summary and the map.").waitFor();
    await page.getByRole("button", { name: "Reject report for 40 Pine Rd" }).click();
    await page.getByText("Rejected the report for 40 Pine Rd. It will not count.").waitFor();
    await page.getByText("No reports waiting").waitFor();
    const moderated = await admin`
      select address, status, moderated_by from damage_assessments where source = 'public' order by address`;
    expect(moderated.map((r) => `${r.address as string}:${r.status as string}`)).toEqual(["12 Oak St:approved", "40 Pine Rd:rejected"]);
    expect(moderated.every((r) => r.moderated_by === memberId)).toBe(true);

    // A field assessment sets the verified degree and counts at once.
    await page.getByLabel("Address", { exact: true }).fill("7 Elm Ct");
    await page.getByLabel("Degree of damage", { exact: true }).selectOption("major");
    await page.getByLabel("Structure type", { exact: true }).selectOption("mobile_home");
    await page.getByLabel("Insurance", { exact: true }).selectOption("uninsured");
    await page.getByLabel("Estimated loss (USD)").fill("60000");
    await page.getByLabel("Longitude", { exact: true }).fill("-123.78");
    await page.getByLabel("Latitude", { exact: true }).fill("41.23");
    await page.getByRole("button", { name: "Record assessment" }).click();
    await page.getByText("Field assessment for 7 Elm Ct recorded as major damage. It counts now.").waitFor();
    const [official] = await admin`select degree, source, status, insured from damage_assessments where address = '7 Elm Ct'`;
    expect(official).toEqual({ degree: "major", source: "official", status: "approved", insured: false });

    // The summary and both indicators follow the counted reports.
    await kpi("Estimated loss").filter({ hasText: "$240,000.00" }).waitFor();
    expect(await kpi("Destroyed").textContent()).toBe("1");
    expect(await kpi("Major damage").textContent()).toBe("1");
    expect(await kpi("Minor damage").textContent()).toBe("0");
    expect(await kpi("Uninsured loss").textContent()).toBe("$60,000.00");
    const pa = indicator("Public Assistance county per-capita indicator");
    await pa.getByText("Threshold met", { exact: true }).waitFor();
    expect(await pa.textContent()).toContain("$48.00 per resident");
    // With no Public Assistance line item the basis says so: structure loss, not PA cost.
    expect(await pa.textContent()).toContain(
      "Basis: Structure loss, not Public Assistance cost: $240,000.00 estimated loss of counted structures, divided by an operator-entered county population of 5,000.");
    const ia = indicator("Individual Assistance residences");
    await ia.getByText("Threshold met", { exact: true }).waitFor();
    expect(await ia.textContent()).toContain("Basis: 1 destroyed plus 1 with major damage.");

    // The declaration summary downloads from the same numbers.
    await page.getByLabel("Incident name for the download").fill("Winter Storms 2026");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download declaration summary" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^declaration-support-\d{4}-\d{2}-\d{2}\.md$/);
    const document = readFileSync((await download.path())!, "utf8");
    for (const line of [
      "# Disaster Declaration Support Summary", "Jurisdiction: Yurok Tribe OES", "Incident: Winter Storms 2026",
      "- Destroyed: 1", "- Major: 1", "- Minor: 0", "- Destroyed or major (IA basis): 2",
      "- Total estimated loss: $240,000.00", "- Uninsured loss: $60,000.00", "- County population (operator-entered): 5,000",
      "- Basis: structure loss of counted structures; no Public Assistance cost is counted",
      "- County threshold met: YES", "- IA residence threshold (2, operator-entered) met: YES",
    ]) expect(document.split("\n")).toContain(line);
    await page.getByText(
      /Declaration summary downloaded as declaration-support-.*, built from 2 counted structures and 0 counted Public Assistance line items\./).waitFor();

    // The map carries the accepted report and the field assessment, never the rejected one.
    await page.getByText("2 accepted reports are on the map.").waitFor();
    expect(await page.getByRole("checkbox", { name: "Accepted damage reports" }).isChecked()).toBe(true);
    // The map reads its layer on a two-second poll, so the search repeats until it catches up.
    const find = page.getByLabel("Find on map");
    const found = async (text: string, label: RegExp) => {
      await find.fill(text);
      await find.press("Enter");
      return page.getByRole("button", { name: label }).count();
    };
    await expect.poll(() => found("12 Oak", /^12 Oak St/), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => found("7 Elm", /^7 Elm Ct/), { timeout: 15_000 }).toBe(1);
    await page.getByText("Map tools and saved views").click();
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await find.fill("40 Pine");
    await find.press("Enter");
    await page.waitForTimeout(300);
    expect(await page.getByRole("button", { name: /^40 Pine Rd/ }).count()).toBe(0);
    await find.fill("");
    await find.press("Enter");

    await page.getByRole("tab", { name: "Accepted" }).click();
    await page.locator("#damage-approved-panel").getByText("7 Elm Ct").waitFor();
    expect(await page.locator("#damage-approved-panel").getByText("12 Oak St").count()).toBe(1);
    await page.getByRole("tab", { name: "Rejected" }).click();
    await page.locator("#damage-rejected-panel").getByText("40 Pine Rd").waitFor();
    await page.getByRole("tab", { name: "Intake queue" }).click();

    const show = async (name: string) => {
      await page.getByRole("region", { name, exact: true }).evaluate((element) => (element as unknown as { scrollIntoView(): void }).scrollIntoView());
      await page.waitForTimeout(800);
    };
    await show("Loss summary and declaration indicators");
    await page.screenshot({ path: join(SHOTS, "damage-summary-light-1440.png") });
    await show("Counted reports on the map");
    await page.screenshot({ path: join(SHOTS, "damage-map-light-1440.png") });
    await setTheme(page, "dark");
    await show("Loss summary and declaration indicators");
    await page.screenshot({ path: join(SHOTS, "damage-summary-dark-1440.png") });
    await show("Reports and Public Assistance");
    await page.screenshot({ path: join(SHOTS, "damage-reports-dark-1440.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Damage assessment", level: 2, exact: true }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await show("Loss summary and declaration indicators");
    await page.screenshot({ path: join(SHOTS, "damage-summary-dark-390.png") });
    await setTheme(page, "light");
    await show("Counted reports on the map");
    await page.screenshot({ path: join(SHOTS, "damage-map-light-390.png") });

    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 180_000);

  it("lets an administrator issue a new intake token that replaces the old one", async () => {
    const { page, errors, external } = await openDamage("admin@example.org", "correct-horse-battery");
    const intake = page.getByRole("region", { name: "Public report intake" });
    await intake.getByRole("button", { name: "Issue intake token" }).click();
    await intake.getByText("A new token replaces the current one; reports sent with the old token are refused.").waitFor();
    await intake.getByRole("button", { name: "Issue new token" }).click();
    await intake.getByText("Public intake is on. Copy the token now; it is not shown again.").waitFor();
    const token = (await intake.getByLabel("Intake token").textContent())!.trim();
    expect(token.length).toBeGreaterThan(20);
    expect(await publicReport(intakeToken, { address: "1 Old Token Ln", structureType: "other", degree: "minor" })).toBe(401);
    expect(await publicReport(token, { address: "3 Cedar Way", structureType: "other", degree: "affected" })).toBe(202);
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("button", { name: "Accept report for 3 Cedar Way" }).waitFor();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 90_000);

  it("records Public Assistance line items that move the indicators onto PA cost and into the download", async () => {
    const { page, errors, external } = await openDamage("member@example.org", "another-good-password");
    await page.getByLabel("County population").fill("5000");
    await page.getByRole("tab", { name: "Public Assistance" }).click();
    const tab = page.locator("#damage-pa-panel");
    const county = tab.getByRole("listitem", { name: "Public Assistance county per-capita indicator" });
    await county.getByText("Basis: Structure loss, not Public Assistance cost: $240,000.00", { exact: false }).waitFor();
    await tab.getByText("No Public Assistance line items").waitFor();

    const form = () => tab.locator("section.damage-pa-form");
    const record = async (fields: { applicant: string; category: string; cost: string; status?: string; site?: string; lon?: string; lat?: string }) => {
      await form().getByLabel("Applicant").fill(fields.applicant);
      await form().getByLabel("Work category").selectOption(fields.category);
      await form().getByLabel("Estimated cost (USD)").fill(fields.cost);
      if (fields.site) await form().getByLabel("Site").fill(fields.site);
      if (fields.lon && fields.lat) {
        await form().getByLabel("Longitude").fill(fields.lon);
        await form().getByLabel("Latitude").fill(fields.lat);
      }
      await form().getByLabel("Status").selectOption(fields.status ?? "submitted");
      await form().getByRole("button", { name: "Record line item" }).click();
    };
    await record({ applicant: "Yurok Tribe Public Works", category: "a_debris_removal", cost: "1250000", site: "Klamath River Road", lon: "-123.9", lat: "41.5" });
    await tab.getByText("Recorded the Category A: Debris removal line item for Yurok Tribe Public Works.").waitFor();
    await record({ applicant: "Del Norte County Roads", category: "c_roads_and_bridges", cost: "30000.05", status: "reviewed" });
    await tab.getByText("Recorded the Category C: Roads and bridges line item for Del Norte County Roads.").waitFor();
    await record({ applicant: "Klamath Community Services District", category: "f_utilities", cost: "20000", status: "draft" });
    await tab.getByText("It is a draft and does not count yet.", { exact: false }).waitFor();

    // Totals by category count the submitted and reviewed items; the draft waits.
    const total = (label: string) => tab.getByLabel("Public Assistance totals").locator("article", { hasText: label }).locator(".eoc-kit-kpi-value strong");
    await total("Total, categories A to G").filter({ hasText: "$1,280,000.05" }).waitFor();
    expect(await total("Category A: Debris removal").textContent()).toBe("$1,250,000.00");
    expect(await total("Category C: Roads and bridges").textContent()).toBe("$30,000.05");
    expect(await total("Category F: Utilities").textContent()).toBe("$0.00");

    // Editing the draft to submitted counts it.
    await tab.getByRole("button", { name: "Edit Category F: Utilities line item for Klamath Community Services District" }).click();
    await tab.getByRole("region", { name: "Edit a Public Assistance line item" }).waitFor();
    expect(await form().getByLabel("Estimated cost (USD)").inputValue()).toBe("20000.00");
    await form().getByLabel("Status").selectOption("submitted");
    await form().getByRole("button", { name: "Save changes" }).click();
    await tab.getByText("Saved the Category F: Utilities line item for Klamath Community Services District.").waitFor();
    await total("Total, categories A to G").filter({ hasText: "$1,300,000.05" }).waitFor();
    expect(await total("Category F: Utilities").textContent()).toBe("$20,000.00");
    const rows = await admin`
      select applicant, category, estimated_cost_cents::int as cents, status, ST_X(geom) as lon from damage_pa_items order by category`;
    expect(rows).toEqual([
      { applicant: "Yurok Tribe Public Works", category: "a_debris_removal", cents: 125000000, status: "submitted", lon: -123.9 },
      { applicant: "Del Norte County Roads", category: "c_roads_and_bridges", cents: 3000005, status: "reviewed", lon: null },
      { applicant: "Klamath Community Services District", category: "f_utilities", cents: 2000000, status: "submitted", lon: null },
    ]);

    // The indicator now divides PA cost and says so; the statewide pair adds its own indicator.
    await county.getByText(
      "Basis: Public Assistance cost: $1,300,000.05 in 3 counted line items, categories A to G, divided by an operator-entered county population of 5,000.").waitFor();
    expect(await county.textContent()).toContain("$260.00 per resident");
    await page.getByLabel("State population").fill("1000000");
    await page.getByLabel("Statewide PA per-capita indicator (USD)").fill("1.5");
    const statewide = tab.getByRole("listitem", { name: "Public Assistance statewide per-capita indicator" });
    await statewide.getByText("Threshold not met", { exact: true }).waitFor();
    expect(await statewide.textContent()).toContain("$1.30 per resident");

    // The download carries the PA categories, the basis and the shelter census.
    await page.getByLabel("Incident name for the download").fill("Winter Storms 2026");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download declaration summary" }).click(),
    ]);
    const document = readFileSync((await download.path())!, "utf8").split("\n");
    for (const line of [
      "## Public Assistance: estimated cost by work category",
      "- Category A: Debris removal: $1,250,000.00",
      "- Category C: Roads and bridges: $30,000.05",
      "- Category F: Utilities: $20,000.00",
      "- Total, categories A to G: $1,300,000.05",
      "- Basis: Public Assistance cost, categories A to G",
      "- County per-capita impact: $260.00",
      "- Statewide per-capita indicator (operator-entered): $1.50",
      "## Shelter census",
      "- Shelters: 1, 1 reporting",
      "- Capacity: 120",
      "- Occupied: 80",
      "- Open spaces: 40",
    ]) expect(document).toContain(line);
    await page.getByText(/built from 2 counted structures and 3 counted Public Assistance line items\./).waitFor();

    const show = async (locator: ReturnType<Page["locator"]>) => {
      await locator.evaluate((element) => (element as unknown as { scrollIntoView(): void }).scrollIntoView());
      await page.waitForTimeout(800);
    };
    await show(tab);
    await page.screenshot({ path: join(SHOTS, "damage-pa-light-1440.png") });
    await show(form());
    await page.screenshot({ path: join(SHOTS, "damage-pa-form-light-1440.png") });
    await setTheme(page, "dark");
    await show(tab);
    await page.screenshot({ path: join(SHOTS, "damage-pa-dark-1440.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Damage assessment", level: 2, exact: true }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await show(tab);
    await page.screenshot({ path: join(SHOTS, "damage-pa-dark-390.png") });
    await setTheme(page, "light");
    await show(form());
    await page.screenshot({ path: join(SHOTS, "damage-pa-form-light-390.png") });

    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 180_000);
});
