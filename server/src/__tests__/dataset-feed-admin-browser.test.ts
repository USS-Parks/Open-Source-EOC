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
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "d21-data-admin-app-dist")
  : "/tmp/openeoc-d21-data-admin-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-d21-data-admin-shots";
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".mjs": "text/javascript", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let token: string;
let jurisdictionId: string;
let incidentId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  for (const candidate of [process.env.OPENEOC_CHROMIUM, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

function auth(value: string) { return { authorization: `Bearer ${value}` }; }

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

async function request(method: "POST" | "PUT", url: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method, url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function signIn(target: Page): Promise<void> {
  await target.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await target.getByLabel("Email").fill("admin@example.org");
  await target.getByLabel("Password").fill("correct-horse-battery");
  await target.getByRole("button", { name: "Sign in" }).click();
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const publicDir = join(webDir, "public");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({ root: webDir, base: "./", publicDir: false, logLevel: "silent", build: { outDir: DIST, emptyOutDir: true } });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  const sendFile = (reply: FastifyReply, path: string) => {
    if (!existsSync(path)) return reply.status(404).send("missing");
    return reply.header("content-type", TYPES[extname(path)] ?? "application/octet-stream").send(readFileSync(path));
  };
  app.get("/app/*", (httpRequest, reply) => {
    const relative = (httpRequest.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    return sendFile(reply, existsSync(built) ? built : join(publicDir, safe));
  });

  token = await login("admin@example.org", "correct-horse-battery");
  const incident = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "North Coast Storm" });
  incidentId = incident.incidentId as string;
  const now = Date.now();
  await request("PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
    expectedRevision: 0,
    geometry: { type: "Polygon", coordinates: [[[-124.2, 40.2], [-123.7, 40.2], [-123.7, 40.9], [-124.2, 40.9], [-124.2, 40.2]]] },
    operationalPeriod: { label: "OP D21", startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 21600000).toISOString() },
    reason: "D21 browser acceptance",
  });

  const loaded = await request("POST", `/api/v1/incidents/${incidentId}/data-packs`, {
    name: "County operations", organizationSlug: "yurok",
    datasets: [{ key: "road_status", name: "Road status", kind: "geojson", fieldMapping: { title: "properties.name", status: "properties.status", sourceId: "id", geometry: "geometry" }, staleAfterSeconds: 3600 }],
  });
  const loadedId = (await admin`select id from data_pack_datasets where pack_id = ${((loaded.pack as Record<string, unknown>).id as string)} and key = 'road_status'`)[0]!.id as string;
  await request("POST", `/api/v1/data-packs/datasets/${loadedId}/load`, { records: [
    { id: "a", properties: { name: "Route 1", status: "closed" }, geometry: { type: "Point", coordinates: [-124, 40.5] } },
    { id: "b", properties: { name: "Route 2", status: "open" }, geometry: { type: "Point", coordinates: [-123.9, 40.6] } },
    { id: "b", properties: { name: "Route 2 update", status: "restricted" }, geometry: { type: "Point", coordinates: [-123.9, 40.6] } },
  ] });
  await request("POST", `/api/v1/data-packs/datasets/${loadedId}/load`, { error: "upstream timed out after 10 seconds" });
  await request("POST", `/api/v1/incidents/${incidentId}/data-packs`, {
    name: "Registered only", organizationSlug: "yurok",
    datasets: [{ key: "registered_only", name: "Registered only", kind: "table", fieldMapping: { title: "name" }, staleAfterSeconds: 3600 }],
  });

  const feed = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/feeds`, { name: "Field positions", kind: "geojson", push: true, staleAfterSeconds: 900 });
  const pushed = await app.inject({
    method: "POST", url: `/api/v1/feeds/${feed.id as string}/ingest`, headers: { "x-feed-token": feed.ingestToken as string },
    payload: { type: "FeatureCollection", features: [{ type: "Feature", id: "unit-1", geometry: { type: "Point", coordinates: [-124, 40.5] }, properties: { name: "Unit 1" } }] },
  });
  expect(pushed.statusCode, pushed.body).toBe(202);
  const rejectedPush = await app.inject({
    method: "POST", url: `/api/v1/feeds/${feed.id as string}/ingest`,
    headers: { "x-feed-token": feed.ingestToken as string },
    payload: { type: "not-geojson" },
  });
  expect(rejectedPush.statusCode, rejectedPush.body).toBe(400);
  expect(rejectedPush.body).toContain("GeoJSON FeatureCollection");
  const [failedFeed] = await admin`
    select last_success_at, last_error, consecutive_failures,
      (select count(*)::integer from feed_items where feed_id = feeds.id) as item_count
    from feeds where id = ${feed.id as string}`;
  expect(failedFeed).toMatchObject({
    last_error: expect.stringContaining("GeoJSON FeatureCollection"),
    consecutive_failures: 1,
    item_count: 1,
  });
  expect(failedFeed!.last_success_at).toBeTruthy();

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url); return route.abort();
  });
  await signIn(page);
}, 120_000);

afterAll(async () => {
  await page?.close(); await browser?.close(); await app?.close(); await runtime?.end(); await admin?.end();
}, 30_000);

describe("D21 datasets and feed administration", () => {
  it("shows truthful readiness, mapping and recovery at wide and narrow widths", async () => {
    mkdirSync(SHOTS, { recursive: true });
    await page.goto(`${baseUrl}/app/index.html#/datasets?incident=${incidentId}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Datasets", level: 2, exact: true }).waitFor({ state: "visible" });
    await page.getByText("Registered · awaiting ingestion").waitFor({ state: "visible" });
    const road = page.locator(".d21-readiness-row", { hasText: "Road status" });
    await road.getByText("Last-good data").waitFor({ state: "visible" });
    expect(await road.locator("dt", { hasText: "Stored items" }).locator("..").locator("dd").textContent()).toBe("2");
    expect(await road.locator("dt", { hasText: "Last-good accepted" }).locator("..").locator("dd").textContent()).toBe("2");
    expect(await road.locator("dt", { hasText: "Last-good rejected" }).locator("..").locator("dd").textContent()).toBe("1");
    await road.getByText("upstream timed out after 10 seconds", { exact: false }).waitFor({ state: "visible" });
    const mapping = page.locator(".d21-card", { hasText: "Caltrans lane and road closures" });
    await mapping.getByText("Mapping preview").click();
    await mapping.getByText("properties.location").waitFor({ state: "visible" });
    const refresh = page.getByRole("button", { name: "Refresh readiness" });
    await refresh.focus();
    await page.keyboard.press("Enter");
    await page.screenshot({ path: join(SHOTS, "d21-datasets-light-1440.png"), fullPage: false });

    await page.goto(`${baseUrl}/app/index.html#/feeds?incident=${incidentId}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Feeds", level: 2, exact: true }).waitFor({ state: "visible" });
    const feed = page.locator(".d21-readiness-row", { hasText: "Field positions" });
    await feed.getByText("Last-good data").waitFor({ state: "visible" });
    await feed.getByText("feed is not a GeoJSON FeatureCollection", { exact: false }).waitFor({ state: "visible" });
    await feed.getByText("Unavailable", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "d21-feeds-dark-1440.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(`(() => {
      const workspace = document.querySelector('.d21-workspace');
      if (!workspace) return false;
      const parent = workspace.parentElement?.getBoundingClientRect();
      const bounds = workspace.getBoundingClientRect();
      return Boolean(parent) && bounds.left >= parent.left - 0.5 && bounds.right <= parent.right + 0.5
        && workspace.scrollWidth <= workspace.clientWidth;
    })()`)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d21-feeds-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
