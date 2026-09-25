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

  it("caps a request at its quantity, edits a pool resource with its history, and edits and deletes a local kind", async () => {
    await page.setViewportSize({ width: 1586, height: 992 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    const pool = page.getByRole("region", { name: "Resource pool" });
    const add = async (name: string) => {
      await pool.getByLabel("Resource name").first().fill(name);
      await pool.getByLabel("Resource kind").first().selectOption("engine");
      await pool.getByLabel("Resource type").first().selectOption("3");
      await pool.getByRole("button", { name: "Add to pool" }).click();
      await pool.getByRole("listitem").filter({ hasText: name }).getByText("Available", { exact: true }).waitFor();
    };
    await add("Engine 42");
    await add("Engine 43");
    const engine42 = pool.getByRole("listitem").filter({ hasText: "Engine 42" });
    const engine43 = pool.getByRole("listitem").filter({ hasText: "Engine 43" });
    await engine42.getByLabel("Request for Engine 42").selectOption(requestId);
    await engine42.getByRole("button", { name: "Update status" }).click();
    await engine42.getByText("Assigned to request: Engine strike team").waitFor();
    // The request asked for one engine, and has it.
    await engine43.getByLabel("Request for Engine 43").selectOption(requestId);
    await engine43.getByRole("button", { name: "Update status" }).click();
    await pool.getByRole("alert").filter({ hasText: "the request already has the 1 resource it asked for" }).waitFor();
    await engine43.getByText("Available", { exact: true }).waitFor();

    await engine43.getByRole("button", { name: "Edit Engine 43" }).click();
    const editor = engine43.getByRole("group", { name: "Edit Engine 43" });
    await editor.getByLabel("Resource name").fill("Engine 43B");
    await editor.getByLabel("Resource type").selectOption("2");
    await editor.getByRole("button", { name: "Save changes" }).click();
    const edited = pool.getByRole("listitem").filter({ hasText: "Engine 43B" });
    await edited.getByText("Engine, Type 2").waitFor();
    await edited.getByText("History of Engine 43B").click();
    const history = edited.getByRole("list", { name: "History of Engine 43B" });
    await history.getByText(/Admin · Added as Engine, Type 3/).waitFor();
    await history.getByText(/Admin · Edited: renamed from Engine 43; changed from Engine, Type 3 to Engine, Type 2/).waitFor();
    // An assigned resource keeps its kind and type.
    await engine42.getByRole("button", { name: "Edit Engine 42" }).click();
    await engine42.getByText("Its kind and type change once it is no longer assigned.").waitFor();
    expect(await engine42.getByLabel("Resource kind").count()).toBe(0);
    await engine42.getByRole("button", { name: "Cancel" }).click();
    await page.screenshot({ path: join(SHOTS, "resource-pool-history-1586.png"), fullPage: false });

    const catalog = page.getByRole("region", { name: "Resource typing catalog" });
    await catalog.getByLabel("Kind name").fill("Drone team");
    await catalog.getByLabel("Type levels (blank for a single type)").fill("2");
    await catalog.getByRole("button", { name: "Add kind" }).click();
    await catalog.getByText("Added Drone team to the catalog.").waitFor();
    await catalog.getByRole("button", { name: "Edit Drone team" }).click();
    const kindEditor = catalog.getByRole("region", { name: "Edit Drone team" });
    await kindEditor.getByLabel("Kind name").fill("Drone team (UAS)");
    await kindEditor.getByLabel("Type levels (blank for a single type)").fill("3");
    await kindEditor.getByRole("button", { name: "Save kind" }).click();
    await catalog.getByText("Saved Drone team (UAS).").waitFor();
    await catalog.getByRole("row").filter({ hasText: "Drone team (UAS)" }).getByText("Type 1; Type 2; Type 3").waitFor();
    expect(await catalog.getByRole("button", { name: "Edit Engine" }).count()).toBe(0);
    await page.setViewportSize({ width: 1534, height: 790 });
    await catalog.getByRole("button", { name: "Delete Drone team (UAS)" }).click();
    await catalog.getByText("Deleted Drone team (UAS) from the catalog.").waitFor();
    expect(await catalog.getByRole("row").filter({ hasText: "Drone team" }).count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "resource-kinds-1534.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
