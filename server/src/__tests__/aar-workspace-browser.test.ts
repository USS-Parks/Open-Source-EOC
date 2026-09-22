import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/** Real-browser proof for period-scoped AAR observations, improvement actions, analytics, and exact PDF export. */
const DIST = process.env["OPENEOC_TEST_BUILD_ROOT"]
  ? join(process.env["OPENEOC_TEST_BUILD_ROOT"], "p-aar-app-dist")
  : "/tmp/openeoc-p-aar-app-dist";
const SHOTS = process.env["OPENEOC_SHOT_DIR"] ?? "/tmp/openeoc-p-aar-shots";
const PUBLIC = join(process.cwd(), "web", "public");
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".mjs": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let jurisdictionId: string;
let planningObservationId: string;
let planningActionId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  const candidates = [
    process.env["OPENEOC_CHROMIUM"],
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

async function post(token: string, url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await app.inject({ method: "POST", url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as Record<string, unknown>;
}

function serveApp(): void {
  app.get("/aar-app/*", (request, reply) => {
    const relative = (request.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    let path = join(DIST, safe);
    if (!existsSync(path)) path = join(PUBLIC, safe);
    if (!existsSync(path)) return reply.status(404).send("missing");
    const body = readFileSync(path);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    const range = request.headers.range;
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : body.length - 1;
      const slice = body.subarray(start, Math.min(end, body.length - 1) + 1);
      return reply.status(206).header("content-type", type).header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${start + slice.length - 1}/${body.length}`).send(slice);
    }
    return reply.header("content-type", type).header("accept-ranges", "bytes").send(body);
  });
}

async function useDarkTheme(): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use light theme" }).waitFor({ state: "hidden" });
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({
    root: webDir,
    base: "./",
    publicDir: false,
    logLevel: "silent",
    build: { outDir: DIST, emptyOutDir: true },
  });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);
  mkdirSync(SHOTS, { recursive: true });

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveApp();

  const token = await login("admin@example.org", "correct-horse-battery");
  const incident = await post(token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire",
    name: "P-AAR Accountability Exercise",
  });
  incidentId = incident.incidentId as string;
  const now = Date.now();
  const periods = [
    { label: "Operational Period 1", startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString() },
    { label: "Operational Period 2", startsAt: new Date(now + 3_600_000).toISOString(), endsAt: new Date(now + 7_200_000).toISOString() },
  ];
  for (const [index, operationalPeriod] of periods.entries()) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/incidents/${incidentId}/operational-area`,
      headers: auth(token),
      payload: {
        expectedRevision: index,
        geometry: null,
        operationalPeriod,
        reason: `P-AAR browser acceptance period ${index + 1}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  const planningObservation = await post(token, `/api/v1/incidents/${incidentId}/aar/observations`, {
    capability: "planning",
    capabilityElement: "training",
    kind: "improvement",
    observation: "The written handoff checklist was missing at shift change.",
    recommendation: "Publish the revised handoff checklist.",
    periodRevision: 1,
  });
  planningObservationId = planningObservation.id as string;
  await post(token, `/api/v1/incidents/${incidentId}/aar/observations`, {
    capability: "public_information_and_warning",
    capabilityElement: "none",
    kind: "strength",
    observation: "The second-period partner briefing started on time.",
    periodRevision: 2,
  });
  const [position] = await admin`
    select id from positions where jurisdiction_id = ${jurisdictionId}
      and key = 'planning_section_chief'`;
  const planningAction = await post(token, `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
    incidentId,
    capability: "planning",
    capabilityElement: "training",
    recommendation: "Run a checklist handoff drill.",
    priority: "high",
    dueDate: "2026-10-15",
    periodRevision: 1,
    assignment: { kind: "position", positionId: position!.id },
  });
  planningActionId = planningAction.id as string;
  await post(token, `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`, {
    incidentId,
    capability: "public_information_and_warning",
    capabilityElement: "none",
    recommendation: "Retain the briefing distribution list.",
    priority: "low",
    periodRevision: 2,
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/aar-app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "AAR", exact: true }).click();
  await page.getByRole("heading", { name: "After-action review" }).waitFor({ state: "visible" });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("P-AAR real incident improvement workspace", () => {
  it("reconciles period analytics to records and completes the observation-to-action-to-PDF workflow", async () => {
    const workspace = page.getByRole("region", { name: "After-action review" });
    await workspace.waitFor({ state: "visible" });
    const analytics = workspace.getByRole("region", { name: "Review coverage and progress" });
    await analytics.getByRole("button", { name: /4 Total records Drill into records/ }).waitFor();
    await workspace.locator("[data-record-id]").nth(3).waitFor({ state: "visible" });
    expect(await workspace.locator("[data-record-id]").count()).toBe(4);

    await workspace.getByLabel("Operational period").selectOption("1");
    await analytics.getByRole("button", { name: /2 Total records Drill into records/ }).waitFor();
    expect(await workspace.locator("[data-record-id]").count()).toBe(2);
    await analytics.getByRole("button", { name: /2 Planning Drill into records/ }).click();
    await workspace.locator(`[data-record-id="${planningObservationId}"]`).waitFor({ state: "visible" });
    await workspace.locator(`[data-record-id="${planningActionId}"]`).waitFor({ state: "visible" });

    const observationForm = workspace.getByRole("form", { name: "Record an observation" });
    await observationForm.getByLabel("Core capability").selectOption("planning");
    await observationForm.getByLabel("Capability element").selectOption("training");
    await observationForm.getByLabel("Observation").fill("A facilitator captured the improvement decision in the hotwash.");
    await observationForm.getByLabel("Recommendation").fill("Add a facilitator checkpoint to the handoff checklist.");
    await observationForm.getByRole("button", { name: "Record observation" }).click();
    await workspace.getByText("Observation recorded with incident and period provenance.").waitFor();

    await workspace.locator(`[data-record-id="${planningObservationId}"]`)
      .getByRole("button", { name: "Create action from this observation" }).click();
    const actionForm = workspace.getByRole("form", { name: "Create a corrective action" });
    await actionForm.getByLabel("Priority").selectOption("critical");
    await actionForm.getByLabel("Owner").selectOption({ label: "Position: Planning Section Chief" });
    await actionForm.getByLabel("Due date").fill("2026-10-20");
    await actionForm.getByRole("button", { name: "Create corrective action" }).click();
    await workspace.getByText(`Corrective action created; source observation ${planningObservationId} remains in evidence.`).waitFor();

    const existingAction = workspace.locator(`[data-record-id="${planningActionId}"]`);
    await existingAction.getByLabel("Status").selectOption("in_progress");
    const updateResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/corrective-actions/${planningActionId}`)
      && response.request().method() === "PATCH" && response.status() === 200);
    await existingAction.getByRole("button", { name: "Save progress" }).click();
    const updatedActionResponse = await updateResponse;
    expect(updatedActionResponse.request().postDataJSON()).toMatchObject({ expectedRevision: 0, status: "in_progress" });
    expect(await updatedActionResponse.json()).toMatchObject({ id: planningActionId, revision: 1, status: "in_progress" });
    await workspace.getByText("Corrective action progress saved.").waitFor();
    await existingAction.locator("header").getByText("In Progress", { exact: true }).waitFor();
    await existingAction.getByText("Revision 1", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "p-aar-light-1440.png"), fullPage: false });

    const pdfForm = workspace.getByRole("form", { name: "Compile the after-action report" });
    await pdfForm.getByLabel("Incident overview").fill("A two-period exercise tested planning handoffs and partner warning coordination.");
    await pdfForm.getByLabel("Objectives, one per line").fill("Improve shift handoffs\nRetain timely partner briefings");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      pdfForm.getByRole("button", { name: "Compile and download PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("after-action-review.pdf");

    await useDarkTheme();
    await page.screenshot({ path: join(SHOTS, "p-aar-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await analytics.getByRole("button", { name: /All records/ }).click();
    const critical = analytics.getByRole("button", { name: /Critical Drill into records/ });
    await critical.focus();
    expect(await page.locator(":focus").textContent()).toContain("Critical");
    await page.keyboard.press("Enter");
    await workspace.getByRole("heading", { name: "Priority: Critical" }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "p-aar-narrow-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
