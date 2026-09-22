import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "p-life-1-app-dist")
  : "/tmp/openeoc-p-life-1-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-p-life-1-shots";
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  const candidates = [
    process.env.OPENEOC_CHROMIUM,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function request(
  token: string,
  method: "POST" | "PUT",
  url: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await app.inject({ method, url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

function assessment(
  lifeline: string,
  condition: "stable" | "stabilizing" | "unstable",
  assessedAt: string,
  operationalPeriod: string,
  impactStatement: string,
  extra: Record<string, unknown> = {},
) {
  return {
    lifeline,
    condition,
    assessedAt,
    confidence: "confirmed",
    impactStatement,
    operationalPeriod,
    stabilizationOutlook: `Synthetic ${lifeline} stabilization outlook`,
    components: [],
    evidence: [{ kind: "reported", description: `Synthetic ${lifeline} source report` }],
    responsibleOrganizationIds: [],
    actions: [],
    ...extra,
  };
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const publicDir = join(webDir, "public");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({
    root: webDir,
    base: "./",
    publicDir: false,
    logLevel: "silent",
    build: { outDir: DIST, emptyOutDir: true },
  });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  const sendFile = (reply: FastifyReply, path: string) => {
    if (!existsSync(path)) return reply.status(404).send("missing");
    return reply.header("content-type", TYPES[extname(path)] ?? "application/octet-stream")
      .send(readFileSync(path));
  };
  app.get("/app/*", (httpRequest, reply) => {
    const relative = (httpRequest.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    return sendFile(reply, existsSync(built) ? built : join(publicDir, safe));
  });
  const token = await login("admin@example.org", "correct-horse-battery");
  const incident = await request(
    token,
    "POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "daily_ops", name: "Synthetic Lifelines Exercise" },
  );
  incidentId = incident.incidentId as string;

  const now = Date.now();
  const currentStart = new Date(now - 60 * 60 * 1000).toISOString();
  const currentEnd = new Date(now + 5 * 60 * 60 * 1000).toISOString();
  await request(token, "PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
    expectedRevision: 0,
    geometry: null,
    operationalPeriod: { label: "OP Current", startsAt: currentStart, endsAt: currentEnd },
    reason: "Synthetic current period for P-LIFE-1 browser acceptance",
  });

  const current = new Date(now - 10 * 60 * 1000).toISOString();
  const stale = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const payloads = [
    assessment("safety_security", "stable", current, "OP Current", "Patrol coverage maintained"),
    assessment("food_hydration_shelter", "stabilizing", current, "OP Current", "Shelter demand is stabilizing"),
    assessment("health_medical", "stable", current, "OP Current", "Emergency services remain available"),
    assessment("energy", "stable", stale, "OP Previous", "Two substations restored in the previous period", {
      components: [
        { key: "electricity", label: "Electricity", condition: "stable", affectedGeography: "North district" },
        { key: "fuel", label: "Fuel", condition: "stable" },
      ],
      actions: [{ key: "inspect", title: "Inspect substation", status: "in_progress" }],
    }),
    assessment("communications", "stabilizing", current, "OP Current", "Backup links remain in use"),
    assessment("transportation", "unstable", current, "OP Current", "Three access routes remain closed"),
    assessment("water_systems", "stabilizing", current, "OP Current", "Treatment continues on backup power"),
  ];
  for (const payload of payloads) {
    await request(token, "POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, payload);
  }

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "ESFs & Lifelines" }).click();
  await page.locator(".eoc-lifeline-card").first().waitFor({ state: "visible" });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("P-LIFE-1 real incident Lifelines presentation", () => {
  it("shows all eight icons and keeps an old Stable assessment visibly stale in all layouts", async () => {
    mkdirSync(SHOTS, { recursive: true });
    const cards = page.locator(".eoc-lifeline-card");
    await page.waitForFunction(`document.querySelectorAll(".eoc-lifeline-card").length === 8`);
    expect(await cards.count()).toBe(8);
    const iconNodes = cards.locator('svg[data-category="lifeline"]');
    expect(await iconNodes.count()).toBe(8);
    const icons: Array<string | null> = [];
    for (let index = 0; index < 8; index += 1) icons.push(await iconNodes.nth(index).getAttribute("data-icon"));
    expect(new Set(icons).size).toBe(8);

    const energy = page.locator('[data-lifeline="energy"]');
    expect(await energy.getAttribute("data-condition")).toBe("stable");
    expect(await energy.getAttribute("data-freshness")).toBe("stale");
    expect(await energy.getByText("Stable", { exact: true }).isVisible()).toBe(true);
    expect(await energy.getByText("Outside OP Current", { exact: true }).isVisible()).toBe(true);

    const hazardous = page.locator('[data-lifeline="hazardous_materials"]');
    expect(await hazardous.getAttribute("data-condition")).toBe("unknown");
    expect(await hazardous.locator(".eoc-lifeline-impact").textContent()).toBe("No current assessment");

    await page.getByRole("button", { name: "Open Energy details" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(`location.hash.startsWith("#/lifeline/energy?") && location.hash.includes("incident=")`);
    expect(await page.evaluate(`location.hash.startsWith("#/lifeline/energy?")`)).toBe(true);
    const energyDetails = page.getByRole("complementary", { name: "Energy" });
    await energyDetails.waitFor({ state: "visible" });
    await energyDetails.getByText("North district", { exact: true }).waitFor({ state: "visible" });
    await page.screenshot({ path: join(SHOTS, "p-life-1-light.png"), fullPage: false });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "p-life-1-dark.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Close Energy details" }).click();
    await page.waitForFunction(`location.hash.startsWith("#/lifelines?") && location.hash.includes("incident=")`);
    expect(await page.evaluate(`location.hash.startsWith("#/lifelines?")`)).toBe(true);
    await page.waitForFunction(`document.activeElement === document.querySelector('[data-lifeline="energy"] .eoc-lifeline-open')`);
    expect(await page.evaluate(`document.activeElement === document.querySelector('[data-lifeline="energy"] .eoc-lifeline-open')`)).toBe(true);
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "p-life-1-narrow-dark.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});







