import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("chronology-browser");
const SHOTS = shotDir("chronology-browser");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let incidentId: string;
let positionId: string;
let positionTitle: string;

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Chronology exercise", kind: "incident",
  });
  incidentId = incident.incidentId as string;
  const [position] = await admin`
    select p.id, p.title from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = ${incidentId} order by p.key limit 1`;
  positionId = position!.id as string;
  positionTitle = position!.title as string;
  await post(app, token, `/api/v1/positions/${positionId}/assignments`, { personId: seed.adminId });
  // Routine board activity past one page, then one resource request milestone.
  await admin`
    insert into audit_events (jurisdiction_id, incident_id, person_id, category, subject_table, payload)
    select ${seed.jurisdictionId}, ${incidentId}, ${seed.adminId}, 'board.record.created', 'board_records',
           jsonb_build_object('board', 'activity_log', 'data', jsonb_build_object('summary', 'Road report ' || n))
    from generate_series(1, 105) n`;
  await admin`
    insert into audit_events (jurisdiction_id, incident_id, person_id, category, subject_table, payload)
    values (${seed.jurisdictionId}, ${incidentId}, ${seed.adminId}, 'rr.submitted', 'resource_requests',
            ${admin.json({ summary: "Two water tenders" })})`;
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("audit chronology in a real browser", () => {
  it("filters significant events, loads more, records an attributed correction and exports CSV", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
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
    const selectedIncident = page.getByLabel("Selected incident", { exact: true });
    await selectedIncident.locator(`option[value="${incidentId}"]`).waitFor({ state: "attached" });
    await selectedIncident.selectOption(incidentId);
    const actingPosition = page.getByLabel("Acting position", { exact: true });
    await actingPosition.locator(`option[value="${positionId}"]`).waitFor({ state: "attached" });
    const positionRefresh = page.waitForResponse((response) => response.url().endsWith("/api/v1/me") && response.status() === 200);
    await actingPosition.selectOption(positionId);
    await positionRefresh;

    await page.getByRole("button", { name: "Chronology", exact: true }).click();
    const surface = page.locator(".eoc-chronology");
    await surface.getByRole("heading", { name: "Chronology" }).waitFor();
    const table = page.locator("[data-table-id='audit-chronology']");
    const rows = table.locator("tbody tr");
    // Significant events: the activation and the resource request, no routine board activity.
    await rows.filter({ hasText: "Resource request submitted" }).waitFor();
    await rows.filter({ hasText: "Incident activated" }).waitFor();
    expect(await rows.filter({ hasText: "Board record created" }).count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "chronology-significant-light.png"), fullPage: true });

    await page.getByLabel("Event type").selectOption("rr.submitted");
    await rows.filter({ hasText: "Incident activated" }).waitFor({ state: "detached" });
    await rows.filter({ hasText: "Two water tenders" }).waitFor();
    expect(await rows.count()).toBe(1);

    await page.getByLabel("Event type").selectOption("all");
    await page.getByRole("tab", { name: "All events" }).click();
    await table.getByText("100 loaded; total unknown").waitFor();
    const [count] = await admin`select count(*)::int as n from audit_events where incident_id = ${incidentId}`;
    const incidentEvents = count!.n as number;
    expect(incidentEvents).toBeGreaterThan(100);
    expect(incidentEvents).toBeLessThanOrEqual(200);
    await table.getByRole("button", { name: "Load more records" }).click();
    await table.getByText(`${incidentEvents} loaded; total unknown`).waitFor();
    await rows.filter({ hasText: "Road report 105" }).waitFor();

    await page.getByRole("tab", { name: "Significant events" }).click();
    const activated = rows.filter({ hasText: "Incident activated" });
    await activated.waitFor();
    const activatedSeq = (await activated.locator("td").nth(5).textContent())!.trim();
    await activated.getByRole("button", { name: "Add correction" }).click();
    await page.getByLabel("Correction note").fill("Activation time was logged late; the EOC opened at 06:40.");
    await page.getByRole("button", { name: "Record correction" }).click();
    await page.getByText(`Correction to event ${activatedSeq} recorded as a new entry.`).waitFor();
    const correction = rows.filter({ hasText: "EOC opened at 06:40" });
    await correction.waitFor();
    await correction.getByText(`Corrects event ${activatedSeq}`).waitFor();
    await correction.getByText(`Admin (${positionTitle})`).waitFor();
    await page.screenshot({ path: join(SHOTS, "chronology-correction-light.png"), fullPage: true });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("audit-trail.csv");
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.startsWith("seq,id,at,person,")).toBe(true);
    expect(csv.match(/^seq,/gm)).toHaveLength(1);
    expect(csv).toContain("Activation time was logged late");
    await page.getByText("Audit trail exported as CSV.").waitFor();

    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await rows.filter({ hasText: "Incident activated" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "chronology-dark-390.png"), fullPage: true });
    expect(await page.evaluate("document.querySelector('.eoc-chronology').scrollWidth <= document.querySelector('.eoc-chronology').clientWidth")).toBe(true);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 90_000);
});
