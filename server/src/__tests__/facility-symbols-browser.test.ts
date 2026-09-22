import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "h13-app-dist")
  : "/tmp/openeoc-h13-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-h13-shots";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pmtiles": "application/octet-stream",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];
const facilityImageResponses = new Set<string>();

function chromiumPath(): string {
  const candidates = [
    process.env.OPENEOC_CHROMIUM,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function post(token: string, url: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function stableCanvasShot(): Promise<Buffer> {
  const canvas = page.locator('[data-testid="cop-map"] canvas');
  let previous = await canvas.screenshot();
  for (let frame = 0; frame < 12; frame += 1) {
    await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const current = await canvas.screenshot();
    if (current.equals(previous)) return current;
    previous = current;
  }
  throw new Error("map canvas did not settle within 12 animation samples");
}

async function inspectRecord(name: string, expectedType: string, expectedStatus: string): Promise<void> {
  const input = page.getByLabel("Find on map");
  await input.fill(name);
  await input.press("Enter");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  const popup = page.locator(".maplibregl-popup-content");
  await popup.waitFor({ state: "visible" });
  const text = await popup.textContent();
  expect(text).toContain("Facility type");
  expect(text).toContain(expectedType);
  expect(text).toContain("Operational status");
  expect(text).toContain(expectedStatus);
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
  const facilityTemplate = {
    key: "synthetic_facilities",
    version: 1,
    title: "Synthetic Facility Symbols",
    description: "Synthetic point fixtures for H13 licensed-symbol browser verification.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "facility_type", label: "Facility type", type: "enum", enumId: "symbology.facilityType", required: true },
      { key: "status", label: "Operational status", type: "enum", enumId: "symbology.status" },
      { key: "location", label: "Location", type: "geometry", geometryKind: "point", required: true },
    ],
    views: [{ key: "all", title: "All facilities", columns: ["name", "facility_type", "status"] }],
  };
  await admin`
    insert into board_templates (key, version, title, definition)
    values ('synthetic_facilities', 1, 'Synthetic Facility Symbols', ${admin.json(facilityTemplate)})`;

  app = buildApp(runtime, { oidc: null });
  const sendFile = (reply: FastifyReply, path: string, range?: string) => {
    if (!existsSync(path)) return reply.status(404).send("missing");
    const extension = path.slice(path.lastIndexOf("."));
    const buffer = readFileSync(path);
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : buffer.length - 1;
      const slice = buffer.subarray(start, Math.min(end, buffer.length - 1) + 1);
      return reply.status(206)
        .header("content-type", TYPES[extension] ?? "application/octet-stream")
        .header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${start + slice.length - 1}/${buffer.length}`)
        .send(slice);
    }
    return reply.header("content-type", TYPES[extension] ?? "application/octet-stream")
      .header("accept-ranges", "bytes")
      .send(buffer);
  };
  app.get("/app/*", (request, reply) => {
    const relative = (request.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    return sendFile(reply, existsSync(built) ? built : join(publicDir, safe), request.headers.range);
  });
  app.get("/napsg/*", (request, reply) => {
    const relative = (request.params as { "*": string })["*"].replaceAll("..", "");
    return sendFile(reply, join(publicDir, "napsg", relative), request.headers.range);
  });

  const token = await login("admin@example.org", "correct-horse-battery");
  const board = await post(token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: "synthetic_facilities",
  });
  boardId = board.id as string;
  const incident = await post(token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops",
    name: "Synthetic H13 Facility Exercise",
  });
  const incidentId = incident.incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;

  const records = [
    ["Synthetic Hospital", "hospital", "critical", -124.00, 40.90],
    ["Synthetic Urgent Care", "urgent-care", "warning", -124.16, 40.85],
    ["Synthetic Fire Station", "fire-station", "normal", -123.84, 40.85],
    ["Synthetic Law Enforcement", "law-enforcement", "unknown", -124.16, 40.95],
    ["Synthetic School", "school", undefined, -123.84, 40.95],
    ["Synthetic Shelter", "shelter", "warning", -124.10, 40.80],
    ["Synthetic Local EOC", "local-eoc", "critical", -123.90, 40.80],
    ["Synthetic Commercial Airport", "commercial-airport", "normal", -124.10, 41.00],
    ["Synthetic Heliport", "heliport", "unknown", -123.90, 41.00],
  ] as const;
  for (const [name, facilityType, status, lng, lat] of records) {
    await post(token, `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
      name,
      facility_type: facilityType,
      ...(status ? { status } : {}),
      location: { type: "Point", coordinates: [lng, lat] },
    });
  }

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() === 200 && response.url().includes("/napsg/") && response.url().endsWith(".png")) {
      facilityImageResponses.add(response.url().slice(response.url().lastIndexOf("/") + 1));
    }
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  const boardItems = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/ogc/collections/${boardId}/items`) && response.status() === 200);
  await page.getByRole("button", { name: "Sign in" }).click();
  await boardItems;
  await page.waitForSelector('[data-testid="cop-map"] canvas', { timeout: 20_000 });
  await page.waitForFunction(`document.querySelector('.maplibregl-ctrl-attrib')?.textContent?.includes('NAPSG Foundation')`);
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("H13 real-map licensed facility presentation", () => {
  it("renders type icons and independent status with matching legend and inspection in both themes", async () => {
    mkdirSync(SHOTS, { recursive: true });
    const legend = page.getByTestId("facility-legend");
    await legend.locator("summary").click();
    for (const title of ["Hospital", "Urgent-care facility", "Fire station", "Law enforcement", "School", "Shelter", "Local EOC", "Commercial airport", "Heliport"]) {
      expect(await legend.textContent()).toContain(title);
    }
    await page.waitForFunction(`
      [...document.querySelectorAll('[data-testid="facility-legend"] img')]
        .every(image => image.complete && image.naturalWidth === 128)
    `);
    expect(facilityImageResponses.size).toBe(9);

    await page.getByRole("button", { name: "Zoom to extent" }).click();
    const lightVisible = await stableCanvasShot();
    const toggle = page.getByLabel("Synthetic Facility Symbols");
    await toggle.uncheck();
    const lightHidden = await stableCanvasShot();
    expect(lightHidden.equals(lightVisible)).toBe(false);
    await toggle.check();
    expect((await stableCanvasShot()).equals(lightHidden)).toBe(false);
    await inspectRecord("Synthetic Hospital", "Hospital", "critical");
    await inspectRecord("Synthetic School", "School", "unknown");
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await stableCanvasShot();
    await page.screenshot({ path: join(SHOTS, "h13-facilities-light.png"), fullPage: false });

    const oldCanvas = await page.locator('[data-testid="cop-map"] canvas').elementHandle();
    const darkItems = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/ogc/collections/${boardId}/items`) && response.status() === 200);
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.waitForFunction("old => !old.isConnected", oldCanvas);
    await darkItems;
    await page.waitForSelector('[data-testid="cop-map"] canvas', { timeout: 20_000 });
    const darkLegend = page.getByTestId("facility-legend");
    await darkLegend.locator("summary").click();
    await page.waitForFunction(`
      [...document.querySelectorAll('[data-testid="facility-legend"] img')]
        .every(image => image.complete && image.naturalWidth === 128)
    `);
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    const darkVisible = await stableCanvasShot();
    const darkToggle = page.getByLabel("Synthetic Facility Symbols");
    await darkToggle.uncheck();
    const darkHidden = await stableCanvasShot();
    expect(darkHidden.equals(darkVisible)).toBe(false);
    await darkToggle.check();
    expect((await stableCanvasShot()).equals(darkHidden)).toBe(false);
    await inspectRecord("Synthetic School", "School", "unknown");
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await stableCanvasShot();
    await page.screenshot({ path: join(SHOTS, "h13-facilities-dark.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
