import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("resource-typing-app");
const SHOTS = shotDir("resource-typing");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let requestId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const { jurisdictionId } = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Typing Exercise", kind: "incident",
  });
  incidentId = incident.incidentId as string;
  const request = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
    origin: "eoc", item: "Engine strike team", resourceKind: "engine", resourceType: 3, incidentId,
  });
  requestId = request.id as string;
  for (const toState of ["accepted", "sourcing"]) {
    await post(app, token, `/api/v1/resource-requests/${requestId}/transition`, { toState }, 200);
  }
  await post(app, token, `/api/v1/resource-requests/${requestId}/costs`, { category: "equipment", amountCents: 540_000 });
  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("real-browser resource typing, pool and cost rollup", () => {
  it("imports RTLT definitions, pools a typed engine, assigns it, demobilizes it and totals the costs", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Selected incident").selectOption(incidentId);
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await page.getByText("Kind: Engine, Type 3").waitFor();

    const catalog = page.getByRole("region", { name: "Resource typing catalog" });
    await catalog.getByText("Show the 5 kinds").click();
    await catalog.getByRole("cell", { name: "Water Tender" }).waitFor();
    await catalog.getByLabel("RTLT export (CSV)").setInputFiles({
      name: "rtlt-export.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "RTLT ID,Resource Typing Definition,Resource Category,Type Level,Capability",
        "1-508-1001,Swiftwater Rescue Team,Search and Rescue,Type I,Largest team",
        "1-508-1001,Swiftwater Rescue Team,Search and Rescue,Type II,Smaller team",
        "3-509-1002,Shelter Manager,Mass Care Services,Single Type,Runs a shelter",
      ].join("\n")),
    });
    await catalog.getByLabel("Where the file came from").fill("RTLT export for the exercise");
    await catalog.getByRole("button", { name: "Import definitions" }).click();
    await catalog.getByText("Imported 2 definitions from the RTLT export.").waitFor();
    await catalog.getByText("Show the 7 kinds").waitFor();
    await catalog.getByRole("cell", { name: "Type 1: Largest team; Type 2: Smaller team" }).waitFor();

    const pool = page.getByRole("region", { name: "Resource pool" });
    await pool.getByLabel("Resource name").fill("Engine 41");
    await pool.getByLabel("Resource kind").selectOption("engine");
    await pool.getByLabel("Resource type").selectOption("2");
    const added = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/resources"));
    await pool.getByRole("button", { name: "Add to pool" }).click();
    expect((await added).status()).toBe(201);
    const engine = pool.getByRole("listitem").filter({ hasText: "Engine 41" });
    await engine.getByText("Available", { exact: true }).waitFor();
    await engine.getByLabel("Request for Engine 41").selectOption(requestId);
    await engine.getByRole("button", { name: "Update status" }).click();
    await engine.getByText("Assigned to request: Engine strike team").waitFor();
    await engine.getByText("Assigned", { exact: true }).waitFor();

    const rollup = page.getByRole("region", { name: "Cost rollup" });
    await rollup.getByRole("row", { name: "Engine total $5,400.00" }).waitFor();
    await pool.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resource-typing-light-1440.png"), fullPage: false });

    await engine.getByLabel("Next status for Engine 41").selectOption("demobilized");
    await engine.getByLabel("Return condition for Engine 41").selectOption("needs_service");
    await engine.getByLabel("Equipment and supplies returned").check();
    await engine.getByLabel("Communications equipment returned").check();
    await engine.getByLabel("Time and cost records submitted").check();
    await engine.getByRole("button", { name: "Update status" }).click();
    await engine.getByText("Demobilized", { exact: true }).waitFor();
    await engine.getByText(/Returned needs service\. Checks made: Equipment and supplies returned; Communications equipment returned; Time and cost records submitted\./).waitFor();
    expect(await engine.getByRole("button", { name: "Update status" }).count()).toBe(0);

    const [row] = await admin`
      select status, request_id, return_condition, demobilization_checks from resources where name = 'Engine 41'`;
    expect(row).toMatchObject({
      status: "demobilized", request_id: null, return_condition: "needs_service",
      demobilization_checks: ["equipment_returned", "communications_returned", "records_submitted"],
    });
    const moves = await admin`
      select payload->>'to' as to from audit_events where category = 'resource.status' order by seq`;
    expect(moves.map((m) => m.to)).toEqual(["assigned", "demobilized"]);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await rollup.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resource-typing-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await engine.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resource-typing-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
