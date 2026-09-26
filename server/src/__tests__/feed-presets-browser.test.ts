import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The Map screen with every live feed preset loaded from recorded fixtures
 * (MP10). The test server serves the fixtures and each feed polls it over
 * loopback exactly as it would poll the public source; nothing leaves the
 * machine. Then the sources go dark and the map keeps the last snapshot,
 * grey and labeled with its age.
 */

const DIST = buildDir("feed-presets-app");
const SHOTS = shotDir("feed-presets");
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "feeds", "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const VIEWPORT = { width: 1586, height: 992 };

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl = "";
let token: string;
let incidentId: string;
/** The public sources' stand-ins stop answering, as they do with the connection gone. */
let offline = false;
const feedIds: string[] = [];

async function request(method: "POST" | "PUT", url: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method, url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

function runtimeConfig(): Record<string, string> {
  return existsSync(join(process.cwd(), "web", "public", "basemap", "california.pmtiles"))
    ? { OPENEOC_BASEMAP_PMTILES_URL: "/app/basemap/california.pmtiles" }
    : {};
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  // The sources' stand-ins. NWS alerts name their zones on the same host, as api.weather.gov does.
  app.get("/fixtures/nws/alerts", (_req, reply) => offline ? reply.status(503).send("offline")
    : reply.type("application/geo+json").send(fixture("nws-alerts-ca.json").replaceAll("https://api.weather.gov/zones", `${baseUrl}/fixtures/nws/zones`)));
  app.get("/fixtures/nws/zones/:type/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const zone = (JSON.parse(fixture("nws-zones.json")) as { features: Array<{ properties: { id: string } }> }).features
      .find((feature) => feature.properties.id === id);
    return offline || !zone ? reply.status(offline ? 503 : 404).send("unavailable") : reply.type("application/geo+json").send(zone);
  });
  app.get("/fixtures/:name", (req, reply) => {
    const { name } = req.params as { name: string };
    return offline || !/^[a-z0-9-]+\.json$/.test(name) ? reply.status(503).send("unavailable") : reply.type("application/json").send(fixture(name));
  });

  token = await login(app);
  const incident = await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "North Coast Storm" });
  incidentId = incident.incidentId as string;
  const now = Date.now();
  await request("PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
    expectedRevision: 0,
    geometry: { type: "Polygon", coordinates: [[[-125.3, 40.0], [-123.1, 40.0], [-123.1, 41.95], [-125.3, 41.95], [-125.3, 40.0]]] },
    operationalPeriod: { label: "OP 1", startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 21600000).toISOString() },
    reason: "Live feed preset walk",
  });

  baseUrl = await listen(app);
  const presets: Array<[string, string, string]> = [
    ["NWS watches, warnings and advisories (CA)", "nws_alerts", "/fixtures/nws/alerts"],
    ["NIFC wildfire perimeters (CA)", "wfigs_perimeters", "/fixtures/wfigs-perimeters.json"],
    ["NIFC wildfire incidents (CA)", "wfigs_incidents", "/fixtures/wfigs-incidents.json"],
    ["USGS earthquakes (past day)", "usgs_earthquakes", "/fixtures/usgs-all-day.json"],
    ["USGS ShakeMap intensity", "usgs_shakemap", "/fixtures/shakemap-cont-mmi.json"],
    ["NOAA river gauges", "nwps_gauges", "/fixtures/nwps-gauges.json"],
    ["Utility power outages", "utility_outages", "/fixtures/utility-outages.json"],
  ];
  for (const [name, kind, path] of presets) {
    const feed = await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/feeds`, { name, kind, url: `${baseUrl}${path}`, pollIntervalSeconds: 300, staleAfterSeconds: 900 });
    feedIds.push(feed.id as string);
    expect(await request("POST", `/api/v1/feeds/${feed.id as string}/poll`, {}), kind).toMatchObject({ ok: true });
  }
  browser = await launchBrowser();
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

/** Wait until the page has had no request in flight for a second, then let the last tiles paint. */
async function quiet(page: Page, inFlight: () => number): Promise<void> {
  let calm = 0;
  for (let waited = 0; waited < 30_000 && calm < 1_000; waited += 250) {
    await page.waitForTimeout(250);
    calm = inFlight() === 0 ? calm + 250 : 0;
  }
  // ponytail: the app exposes no map-idle signal; a short settle lets the last tiles paint.
  await page.waitForTimeout(1_500);
}

async function openMap(theme: "light" | "dark") {
  const pageErrors: string[] = [];
  const outside: string[] = [];
  const feedReads: number[] = [];
  let inFlight = 0;
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "en-US" });
  await context.addInitScript(`globalThis.OPENEOC = ${JSON.stringify(runtimeConfig())};
    try { localStorage.setItem("openeoc.theme", ${JSON.stringify(theme)}); } catch {}`);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && /Expected value to be of type/.test(message.text())) pageErrors.push(message.text());
  });
  page.on("request", () => { inFlight += 1; });
  page.on("requestfinished", () => { inFlight -= 1; });
  page.on("requestfailed", () => { inFlight -= 1; });
  page.on("response", (response) => {
    if (/\/api\/v1\/feeds\/[^/]+\/items/.test(response.url())) feedReads.push(response.status());
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html#/map?incident=${incidentId}`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".maplibregl-canvas").first().waitFor();
  await quiet(page, () => inFlight);
  return { context, page, pageErrors, outside, feedReads };
}

describe("the live feed presets on the Map screen", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`draws every preset from its recorded fixture (${theme})`, async () => {
      const { context, page, pageErrors, outside, feedReads } = await openMap(theme);
      await page.screenshot({ path: join(SHOTS, `feed-presets-${theme}-1586.png`) });
      await context.close();
      expect(feedReads.length).toBeGreaterThanOrEqual(feedIds.length);
      expect(feedReads.every((status) => status === 200)).toBe(true);
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 120_000);
  }

  it("keeps the last snapshot, grey and labeled with its age, when the sources go dark", async () => {
    offline = true;
    for (const id of feedIds) {
      expect(await request("POST", `/api/v1/feeds/${id}/poll`, {})).toMatchObject({ ok: false });
    }
    // Three hours without an answer.
    await admin`update feeds set last_success_at = last_success_at - interval '3 hours'`;
    const { context, page, pageErrors, outside } = await openMap("light");
    await page.screenshot({ path: join(SHOTS, "feed-presets-stale-light-1586.png") });
    await context.close();
    const [row] = await admin`select count(*)::integer as items from feed_items`;
    expect(row!.items).toBeGreaterThan(30);
    expect(pageErrors).toEqual([]);
    expect(outside).toEqual([]);
  }, 120_000);

  it("adds a preset in one step from the Feeds screen, showing its source, terms and schedule", async () => {
    const context = await browser.newContext({ viewport: VIEWPORT, locale: "en-US" });
    const page = await context.newPage();
    const outside: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      outside.push(url);
      return route.abort();
    });
    await page.goto(`${baseUrl}/app/index.html#/feeds`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Feeds", level: 2, exact: true }).waitFor();
    await page.getByLabel("Preset", { exact: true }).selectOption("usgs_earthquakes");
    await page.getByLabel("Period", { exact: true }).selectOption("week");
    const source = page.getByRole("definition").filter({ hasText: "Earthquake Hazards Program" });
    await source.waitFor();
    await page.getByText("Every 5 minutes").waitFor();
    await page.screenshot({ path: join(SHOTS, "feed-presets-setup-light-1586.png") });
    await page.getByRole("button", { name: "Add preset" }).click();
    await page.locator(".d21-readiness-row", { hasText: "USGS earthquakes (Past week, magnitude 2.5 and over)" }).waitFor();
    const [feed] = await admin`select kind, url, poll_interval_seconds from feeds where name like 'USGS earthquakes (Past week%'`;
    expect(feed).toEqual({
      kind: "usgs_earthquakes",
      url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
      poll_interval_seconds: 300,
    });
    await context.close();
    expect(outside).toEqual([]);
  }, 120_000);
});
