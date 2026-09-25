import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * The force account on the damage assessment screen (Veoci and air gap
 * VA14), at the frames' 1586 by 992 and at 1534 by 790: an administrator
 * imports FEMA's schedule from its CSV file, sets the labor rates of the
 * people with hours, records a pool truck's hours, downloads the labor
 * summary and rolls the account into the incident's Public Assistance line
 * item. A shift's hours and the truck's hours reconcile with the total.
 */

const DIST = buildDir("force-account");
const SHOTS = shotDir("force-account");
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

const FEMA_CSV = [
  "Cost Code,Equipment ,Specifications,Capacity or Size,HP,Notes,Unit, 2025 Rates ",
  "8010,Air Compressor,Air Delivery,41 CFM,to 10,Hoses included.,hour,$1.80 ",
  "8072,\"Truck, Dump\",Capacity,12 CY,to 400,,hour,$58.19 ",
].join("\r\n");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let adminToken: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  adminToken = await login(app);
  await admin`
    insert into resources (jurisdiction_id, name, resource_kind, created_by, updated_by)
    values (${seed.jurisdictionId}, 'Dump truck 12', 'local:dump_truck', ${seed.adminId}, ${seed.adminId})`;
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

/** An incident with the member's 11.5-hour check-in on the 20th and the admin's 4-hour shift on the 19th, and a line item. */
async function incidentWithHours(name: string): Promise<{ incidentId: string; paItemId: string }> {
  const opened = await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name });
  const incidentId = opened.incidentId as string;
  const [position] = await admin`select id from positions where jurisdiction_id = ${seed.jurisdictionId} limit 1`;
  await admin`
    insert into staff_checkins (jurisdiction_id, incident_id, person_id, position_id, method, checked_in_at, checked_out_at, checked_in_by)
    values (${seed.jurisdictionId}, ${incidentId}, ${seed.memberId}, ${position!.id as string}, 'manual',
      '2026-09-20T15:00:00Z', '2026-09-21T02:30:00Z', ${seed.adminId})`;
  await admin`
    insert into shifts (jurisdiction_id, incident_id, position_id, person_id, starts_at, ends_at, created_by)
    values (${seed.jurisdictionId}, ${incidentId}, ${position!.id as string}, ${seed.adminId},
      '2026-09-19T16:00:00Z', '2026-09-19T20:00:00Z', ${seed.adminId})`;
  const item = await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/damage/pa-items`, {
    incidentId, applicant: "Yurok Tribe", category: "b_emergency_protective_measures", description: `${name} flood fight`,
    estimatedCostCents: 0, percentComplete: 0, status: "submitted",
  });
  return { incidentId, paItemId: item.id as string };
}

describe("force account on screen", () => {
  for (const [index, viewport] of VIEWPORTS.entries()) {
    it(`costs the incident's labor and equipment and rolls them into a line item, at ${viewport.width} by ${viewport.height}`, async () => {
      const name = `River Flood ${viewport.width}`;
      const { paItemId } = await incidentWithHours(name);
      const context = await browser.newContext({ viewport, acceptDownloads: true, timezoneId: "America/Los_Angeles" });
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
      await page.locator('select[aria-label="Selected incident"]').selectOption({ label: name });
      await page.goto(`${baseUrl}/app/index.html#/damage`, { waitUntil: "load" });
      const panel = page.getByRole("region", { name: "Force account" });
      const labor = panel.getByRole("table", { name: "Labor" });
      await labor.getByRole("row", { name: /Member.*2026-09-20.*8.*3\.5/ }).waitFor();

      // The schedule, from FEMA's CSV file.
      const rates = panel.getByRole("form", { name: "Import equipment rates" });
      await rates.getByLabel("Rate schedule (CSV)").setInputFiles({ name: "fema_schedule-equipment-rates_2025.csv", mimeType: "text/csv", buffer: Buffer.from(FEMA_CSV) });
      await rates.getByLabel("Edition").fill("FEMA 2025");
      await rates.getByRole("button", { name: "Import rates" }).click();
      await panel.getByText(index === 0 ? "2 rates added and 0 replaced from FEMA 2025." : "0 rates added and 2 replaced from FEMA 2025.").waitFor();

      // Labor rates for the two people with hours: set the first time, edited the second.
      const setRate = async (person: string, values: Record<string, string>) => {
        await panel.getByRole("button", { name: index === 0 ? `Set a labor rate for ${person}` : `Edit the labor rate for ${person}` }).click();
        const form = panel.getByRole("form", { name: `Labor rate for ${person}` });
        for (const [label, value] of Object.entries(values)) await form.getByLabel(label, { exact: true }).fill(value);
        await form.getByRole("button", { name: "Save labor rate" }).click();
        await panel.getByText(`Labor rate saved for ${person}.`).waitFor();
      };
      await setRate("Member", {
        "Job title": "Road crew lead", "Hourly rate (dollars)": "30", "Overtime rate (dollars, optional)": "45",
        "Fringe (percent)": "25", "Overtime fringe (percent, optional)": "10",
      });
      await setRate("Admin", { "Job title": "Emergency manager", "Hourly rate (dollars)": "40" });

      // The truck's hours.
      const hours = panel.getByRole("form", { name: "Record equipment hours" });
      await hours.getByLabel("Pool resource").selectOption({ label: "Dump truck 12" });
      await hours.getByLabel("Equipment rate code").selectOption("8072");
      await hours.getByLabel("Operator").selectOption({ label: "Member" });
      await hours.getByLabel("Date used").fill("2026-09-20");
      await hours.getByLabel("Hours used").fill("6");
      await hours.getByRole("button", { name: "Record hours" }).click();
      await panel.getByText("Equipment hours recorded.").waitFor();

      // Member: 8 h x $37.50 + 3.5 h x $49.50 = $473.25. Admin's shift: 4 h x $40 = $160. Truck: 6 h x $58.19 = $349.14.
      const totals = panel.getByLabel("Force account totals");
      await totals.getByText("$982.39").waitFor();
      await totals.getByText("$633.25").waitFor();
      await totals.getByText("$349.14").waitFor();
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `force-account-${viewport.width}.png`) });

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        panel.getByRole("button", { name: "Download labor summary" }).click(),
      ]);
      const csv = readFileSync(await download.path(), "utf8").trimEnd().split("\r\n");
      expect(csv).toContain("Member,Road crew lead,2026-09-20,Overtime,3.50,45.00,4.50,49.50,173.25");
      expect(csv.at(-1)).toBe("Total,,,,15.50,,,,633.25");

      const roll = panel.getByRole("form", { name: "Roll into a line item" });
      await roll.getByLabel("Line item").selectOption(paItemId);
      await roll.getByRole("button", { name: "Roll into line item" }).click();
      await panel.getByText("The line item's estimated cost is now $982.39, from the force account.").waitFor();
      const [item] = await admin`select estimated_cost_cents, force_account from damage_pa_items where id = ${paItemId}`;
      expect(Number(item!.estimated_cost_cents)).toBe(98239);
      expect(item!.force_account).toMatchObject({ timeZone: "America/Los_Angeles", laborRows: 2, equipmentRows: 1 });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 180_000);
  }
});
