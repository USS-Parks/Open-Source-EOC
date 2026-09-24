import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The facilities surface in a real browser with the facilities integration
 * on: a member registers a hospital and a shelter, reports their status,
 * watches the board mark a facility stale against its own window, reads
 * the hospital's HAVE beds and the shelter's occupancy, and finds both on
 * the map with their NAPSG symbols. With the integration off the console
 * offers no Facilities entry at all.
 */
const DIST = buildDir("facilities-app");
const SHOTS = shotDir("facilities");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let plainApp: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let plainUrl: string;
let memberId: string;

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  memberId = (await seedIdentity(admin)).memberId;
  app = buildApp(runtime, { oidc: null, integrations: ["facilities"] });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  plainApp = buildApp(runtime, { oidc: null });
  serveStatic(plainApp, "/app", DIST);
  plainUrl = await listen(plainApp);
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await plainApp?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn(url: string): Promise<{ page: Page; errors: string[]; external: string[]; symbols: Set<string> }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors: string[] = [];
  const external: string[] = [];
  const symbols = new Set<string>();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() === 200 && response.url().includes("/napsg/")) symbols.add(response.url().slice(response.url().lastIndexOf("/") + 1));
  });
  await page.route("**/*", (route) => {
    const target = route.request().url();
    if (target.startsWith(url) || target.startsWith("data:") || target.startsWith("blob:")) return route.continue();
    external.push(target);
    return route.abort();
  });
  await page.goto(`${url}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("member@example.org");
  await page.getByLabel("Password").fill("another-good-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
  return { page, errors, external, symbols };
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: theme === "light" ? "Use light theme" : "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
}

describe("facilities surface", () => {
  it("registers, reports, flags staleness per window, shows HAVE beds and shelter occupancy, and maps both", async () => {
    const { page, errors, external, symbols } = await signIn(baseUrl);
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
    await page.getByRole("heading", { name: "Facilities and shelters", level: 2, exact: true }).waitFor();
    await page.getByText("No facilities are registered yet. Register one under Registry.").waitFor();

    // Register a hospital and a shelter, each with its own reporting window.
    const register = async (name: string, kind: string, window: string, lon: string, lat: string, contact = "") => {
      await page.getByLabel("Facility name").fill(name);
      await page.getByLabel("Facility type").selectOption(kind);
      await page.getByLabel("Contact", { exact: true }).fill(contact);
      await page.getByLabel("Report expected every (minutes)").fill(window);
      await page.getByLabel("Longitude").fill(lon);
      await page.getByLabel("Latitude").fill(lat);
      await page.getByRole("button", { name: "Register facility" }).click();
      await page.getByText(new RegExp(`^${name} registered as`)).waitFor();
    };
    await register("Klamath General", "hospital", "60", "-124.02", "41.52", "Charge nurse 555-0142");
    await register("Weitchpec Gym", "shelter", "120", "-123.71", "41.19");
    const registered = await admin`
      select name, kind, contact, stale_after_seconds, ST_X(geom) as lon from facilities order by name`;
    expect(registered).toEqual([
      { name: "Klamath General", kind: "hospital", contact: "Charge nurse 555-0142", stale_after_seconds: 3600, lon: -124.02 },
      { name: "Weitchpec Gym", kind: "shelter", contact: null, stale_after_seconds: 7200, lon: -123.71 },
    ]);
    const registry = page.getByRole("table", { name: "Registered facilities" });
    await registry.getByRole("row", { name: /Klamath General Hospital Charge nurse 555-0142 41\.5200, -124\.0200 Every hour/ }).waitFor();
    await registry.getByRole("row", { name: /Weitchpec Gym Shelter None given .* Every 2 hours/ }).waitFor();
    const board = page.getByRole("table", { name: "Current status by facility" });
    await board.getByRole("row", { name: /Weitchpec Gym Shelter No report .* Never No report yet/ }).waitFor();

    // Report the hospital's beds and the shelter's spaces.
    await page.getByLabel("Facility", { exact: true }).selectOption({ label: "Klamath General" });
    await page.getByLabel("Operating status", { exact: true }).selectOption("compromised");
    await page.getByLabel("EMS traffic", { exact: true }).selectOption("divert");
    await page.getByLabel("Adult ICU available").fill("4");
    await page.getByLabel("Adult ICU baseline").fill("12");
    await page.getByLabel("Medical and surgical available").fill("20");
    await page.getByLabel("Medical and surgical baseline").fill("60");
    await page.getByRole("button", { name: "Report status" }).click();
    await page.getByText("Status for Klamath General reported as compromised.").waitFor();
    await page.getByLabel("Facility", { exact: true }).selectOption({ label: "Weitchpec Gym" });
    await page.getByLabel("Operating status", { exact: true }).selectOption("normal");
    await page.getByLabel("EMS traffic", { exact: true }).selectOption("");
    expect(await page.getByLabel("Adult ICU available").count()).toBe(0);
    await page.getByLabel("Shelter spaces open").fill("40");
    await page.getByLabel("Shelter spaces capacity").fill("120");
    await page.getByRole("button", { name: "Report status" }).click();
    await page.getByText("Status for Weitchpec Gym reported as normal.").waitFor();
    const reports = await admin`
      select f.name, r.operating_status, r.ems_traffic, r.beds, r.reported_by
      from facility_status_reports r join facilities f on f.id = r.facility_id order by f.name`;
    expect(reports).toEqual([
      { name: "Klamath General", operating_status: "compromised", ems_traffic: "divert", reported_by: memberId,
        beds: [{ bedType: "adult_icu", available: 4, baseline: 12 }, { bedType: "medical_surgical", available: 20, baseline: 60 }] },
      { name: "Weitchpec Gym", operating_status: "normal", ems_traffic: null, reported_by: memberId,
        beds: [{ bedType: "other", available: 40, baseline: 120 }] },
    ]);
    await board.getByRole("row", { name: /Klamath General Hospital Compromised On divert .* Current/ }).waitFor();
    await board.getByRole("row", { name: /Weitchpec Gym Shelter Normal Not reported .* Current/ }).waitFor();

    // Ninety minutes without a report: stale for the hourly hospital, current for the two-hour shelter.
    await admin`update facility_status_reports set reported_at = now() - interval '90 minutes'`;
    await page.getByRole("button", { name: "Refresh" }).click();
    await board.getByRole("row", { name: /Klamath General .* Stale$/ }).waitFor();
    await board.getByRole("row", { name: /Weitchpec Gym .* Current$/ }).waitFor();
    await page.getByText("2 facilities, 1 stale or not yet reported.").waitFor();

    // HAVE beds for the hospital, and the standard document behind them.
    const hospital = page.getByRole("listitem", { name: "Klamath General" });
    const beds = hospital.getByRole("table", { name: "Beds at Klamath General" });
    await beds.getByRole("row", { name: "Adult ICU 4 12" }).waitFor();
    await beds.getByRole("row", { name: "Medical and surgical 20 60" }).waitFor();
    expect(await hospital.textContent()).toContain("EMS trafficOn divert");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download EDXL-HAVE" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^have-hospitals-\d{4}-\d{2}-\d{2}\.xml$/);
    const xml = readFileSync((await download.path())!, "utf8");
    for (const part of ["<OrganizationName>Klamath General</OrganizationName>", "<BedType>adult_icu</BedType>",
      "<AvailableCount>4</AvailableCount>", "<EMSTrafficStatus>divert</EMSTrafficStatus>", "<Stale>true</Stale>"])
      expect(xml).toContain(part);
    expect(xml).not.toContain("Weitchpec Gym");

    // Shelter occupancy from capacity and open spaces.
    await page.getByRole("table", { name: "Shelter capacity and occupancy" })
      .getByRole("row", { name: /^Weitchpec Gym Normal 120 80 40 / }).waitFor();

    // Both on the map, each with its NAPSG facility symbol.
    await page.getByText("2 facilities are on the map. Hospitals and shelters show their NAPSG symbol.").waitFor();
    const find = page.getByLabel("Find on map");
    const inspect = async (name: string, type: string, status: string) => {
      const hit = page.getByRole("button", { name: new RegExp(`^${name}`) });
      const inspector = page.getByTestId("cop-feature-inspector");
      const close = inspector.getByRole("button", { name: "Close selected map feature" });
      // The map reads its layer on a poll, so the search repeats until the
      // layer carries the latest status report, not just the facility.
      await expect.poll(async () => {
        if (await close.count()) await close.click();
        await find.fill(name);
        await find.press("Enter");
        if (await hit.count() !== 1) return "";
        await hit.click();
        await inspector.getByRole("heading", { name }).waitFor();
        return (await inspector.textContent()) ?? "";
      }, { timeout: 60_000 }).toContain(`Operational status${status}`);
      const text = await inspector.textContent();
      expect(text).toContain("Operational facility");
      expect(text).toContain(`Facility type${type}`);
      await close.click();
    };
    await inspect("Klamath General", "Hospital", "Warning");
    await inspect("Weitchpec Gym", "Shelter", "Normal");
    expect(symbols).toContain("hospitals.png");
    expect(symbols).toContain("national-shelter-system-facilities.png");
    await find.fill("");
    await find.press("Enter");
    await page.getByText("Map tools and saved views").click();
    await page.getByRole("button", { name: "Zoom to extent" }).click();

    const show = async (name: string) => {
      await page.getByRole("region", { name, exact: true }).evaluate((element) => (element as unknown as { scrollIntoView(): void }).scrollIntoView());
      await page.waitForTimeout(800);
    };
    await show("Status board");
    await page.screenshot({ path: join(SHOTS, "facilities-board-light-1440.png") });
    await show("Facilities on the map");
    await page.screenshot({ path: join(SHOTS, "facilities-map-light-1440.png") });
    await setTheme(page, "dark");
    await show("Hospital bed availability (HAVE)");
    await page.screenshot({ path: join(SHOTS, "facilities-have-dark-1440.png") });
    await show("Facilities on the map");
    await page.screenshot({ path: join(SHOTS, "facilities-map-dark-1440.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Facilities and shelters", level: 2, exact: true }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await show("Status board");
    await page.screenshot({ path: join(SHOTS, "facilities-board-dark-390.png") });
    await setTheme(page, "light");
    await show("Shelters");
    await page.screenshot({ path: join(SHOTS, "facilities-shelters-light-390.png") });

    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 180_000);

  it("offers no Facilities entry when the integration is off", async () => {
    const { page, errors, external } = await signIn(plainUrl);
    // The rail is complete once Damage Assessment shows; Facilities never joins it.
    await page.getByRole("button", { name: "Damage Assessment", exact: true }).waitFor();
    await page.waitForTimeout(500);
    expect(await page.getByRole("button", { name: "Facilities", exact: true }).count()).toBe(0);
    await page.goto(`${plainUrl}/app/index.html#/facilities`);
    await page.getByRole("heading", { name: "Page not found" }).waitFor();
    expect(await page.getByRole("heading", { name: "Facilities and shelters" }).count()).toBe(0);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 90_000);
});
