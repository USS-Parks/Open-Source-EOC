import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("staffing-browser");
const SHOTS = shotDir("staffing-browser");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;

/** A datetime-local value for a moment `days` from now, on the hour. */
function localInput(days: number, hour: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(hour)}:00`;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const positions = `/api/v1/jurisdictions/${seed.jurisdictionId}/positions`;
  await post(app, token, positions, { key: "operations_section_chief", title: "Operations Section Chief" });
  const planning = await post(app, token, positions, { key: "planning_section_chief", title: "Planning Section Chief" });
  await post(app, token, positions, { key: "logistics_section_chief", title: "Logistics Section Chief" });
  const startsAt = new Date(Date.now() + 3_600_000);
  await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/shifts`, {
    positionId: planning.id, personId: seed.memberId,
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 12 * 3_600_000).toISOString(),
  });
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("staffing in a real browser", () => {
  it("issues a badge, checks its holder in by typed code, prints the ICS-211, checks out and schedules shifts", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const external: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url); return route.abort();
    });
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Staffing", exact: true }).click();
    await page.locator(".eoc-staffing").getByRole("heading", { name: "Staffing", level: 1 }).waitFor();
    const panel = page.locator(".eoc-staffing-panel:not([hidden])");

    // A badge carries the person's name and the position printed on it.
    await page.getByRole("tab", { name: "Badges" }).click();
    await panel.getByLabel("Person", { exact: true }).locator("option", { hasText: "Member" }).waitFor({ state: "attached" });
    await panel.getByLabel("Person", { exact: true }).selectOption({ label: "Member" });
    await panel.getByLabel("Position printed on the badge").selectOption({ label: "Operations Section Chief" });
    await panel.getByRole("button", { name: "Issue badge" }).click();
    const badge = panel.getByRole("article", { name: "Badge for Member" });
    await badge.getByRole("heading", { name: "Member" }).waitFor();
    await badge.getByText("Operations Section Chief").waitFor();
    const printedCode = (await badge.locator(".eoc-staffing-badge-code").textContent())!;
    expect(printedCode).toMatch(/^(\S{4} )+\S{1,4}$/);
    await page.screenshot({ path: join(SHOTS, "staffing-badge-light.png"), fullPage: true });

    // Manual code entry: type the printed code, spaces and all.
    await page.getByRole("tab", { name: "Check-in and on duty" }).click();
    await panel.getByLabel("Position", { exact: true }).selectOption({ label: "Operations Section Chief" });
    await panel.getByLabel("Badge code, optional").fill(printedCode);
    await panel.getByRole("button", { name: "Check in badge holder" }).click();
    await page.getByRole("status").filter({ hasText: "Member checked in as Operations Section Chief." }).waitFor();
    const onDuty = panel.getByRole("region", { name: "On duty" });
    const memberRow = onDuty.getByRole("row").filter({ hasText: "Member" });
    await memberRow.filter({ hasText: "Operations Section Chief" }).filter({ hasText: "Badge scan" }).waitFor();
    const vacant = panel.getByRole("region", { name: "Vacant positions" });
    await vacant.getByText("Planning Section Chief").waitFor();
    await vacant.getByText("Logistics Section Chief").waitFor();
    expect(await vacant.getByText("Operations Section Chief").count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "staffing-on-duty-light.png"), fullPage: true });

    await page.getByRole("tab", { name: "ICS-211 check-in list" }).click();
    const form = panel.getByRole("region", { name: "ICS-211 Incident Check-In List" });
    await form.getByRole("row").filter({ hasText: "Member" }).filter({ hasText: "Operations Section Chief" })
      .filter({ hasText: "Badge scan" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "staffing-ics211-light.png"), fullPage: true });
    // Printing shows only the check-in list, outside the console shell.
    await page.emulateMedia({ media: "print" });
    expect(await page.locator("#root").isVisible()).toBe(false);
    await page.locator(".eoc-staffing-print-sheet").getByRole("row").filter({ hasText: "Member" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "staffing-ics211-print.png"), fullPage: true });
    await page.emulateMedia({ media: "screen" });

    await page.getByRole("tab", { name: "Check-in and on duty" }).click();
    await memberRow.getByRole("button", { name: "Check out" }).click();
    await page.getByRole("status").filter({ hasText: "Member checked out of Operations Section Chief." }).waitFor();
    await onDuty.getByText("No one is checked in").waitFor();
    await vacant.getByText("Operations Section Chief").waitFor();

    await page.getByRole("tab", { name: "Shifts" }).click();
    const shifts = panel.getByRole("region", { name: "Upcoming shifts" });
    await shifts.getByRole("row").filter({ hasText: "Planning Section Chief" }).filter({ hasText: "Member" }).waitFor();
    await panel.getByLabel("Position", { exact: true }).selectOption({ label: "Logistics Section Chief" });
    await panel.getByLabel("Assigned to").selectOption({ label: "Myself" });
    await panel.getByLabel("Starts").fill(localInput(2, 8));
    await panel.getByLabel("Ends").fill(localInput(2, 20));
    await panel.getByRole("button", { name: "Schedule shift" }).click();
    await page.getByRole("status").filter({ hasText: "Shift scheduled for Logistics Section Chief." }).waitFor();
    await shifts.getByRole("row").filter({ hasText: "Logistics Section Chief" }).filter({ hasText: "Admin" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "staffing-shifts-light.png"), fullPage: true });

    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Check-in and on duty" }).click();
    await vacant.getByText("Operations Section Chief").waitFor();
    await page.screenshot({ path: join(SHOTS, "staffing-on-duty-dark-390.png"), fullPage: true });
    expect(await page.evaluate("document.querySelector('.eoc-staffing').scrollWidth <= document.querySelector('.eoc-staffing').clientWidth")).toBe(true);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 90_000);
});
