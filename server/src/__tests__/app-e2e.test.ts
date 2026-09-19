import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { dictionaryValues } from "@openeoc/shared";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Real-browser proof of the M1 app shell: the built SPA is served next to
 * the live API, a member signs in, the map-first console renders with the
 * COP and the boards dock, and the dashboard surface renders its widgets.
 * All non-local network is blocked, so this also proves the app runs with
 * no external dependency. Screenshots are written for manual review.
 */

const DIST = "/tmp/openeoc-app-dist";
const SHOTS = process.env["OPENEOC_SHOT_DIR"] ?? "/tmp/openeoc-app-shots";

function chromiumPath(): string {
  const candidates = [
    process.env["OPENEOC_CHROMIUM"],
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json().accessToken as string;
}

async function createBoard(templateKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey },
  });
  if (res.statusCode !== 201) throw new Error(`board create failed: ${res.body}`);
  return res.json().id as string;
}

async function addRecord(boardId: string, data: Record<string, unknown>): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/records`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: data,
  });
  if (res.statusCode !== 201) throw new Error(`record create failed: ${res.body}`);
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const vite = join(webDir, "node_modules", "vite", "bin", "vite.js");
  execFileSync(
    process.execPath,
    [vite, "build", "--outDir", DIST, "--emptyOutDir", "--base", "./"],
    { cwd: webDir, stdio: "ignore" },
  );
  expect(existsSync(join(DIST, "index.html"))).toBe(true);
  mkdirSync(SHOTS, { recursive: true });

  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  app = buildApp(runtime, { oidc: null });

  app.get("/app/*", (req, reply) => {
    const rel = (req.params as { "*": string })["*"] || "index.html";
    const path = join(DIST, rel.replaceAll("..", ""));
    if (!existsSync(path)) return reply.status(404).send("missing");
    const ext = path.slice(path.lastIndexOf("."));
    return reply
      .header("content-type", TYPES[ext] ?? "application/octet-stream")
      .send(readFileSync(path));
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");

  const roads = await createBoard("road_closures");
  await createBoard("shelters");
  const lifelines = await createBoard("lifelines");
  await createBoard("significant_events");
  await createBoard("resource_request");
  await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "eoc_status" },
  });

  await addRecord(roads, {
    road: "SR-169 at Pecwan",
    reason: "Active fire",
    status: "closed",
    location: { type: "Point", coordinates: [-123.61, 41.29] },
  });
  await addRecord(roads, {
    road: "Bald Hills Rd",
    reason: "Downed lines",
    status: "one_lane",
    location: { type: "Point", coordinates: [-123.79, 41.15] },
  });

  const lifelineValues = dictionaryValues("lifelines.lifelines") ?? [];
  const statusValues = dictionaryValues("lifelines.status") ?? [];
  if (lifelineValues[0] && statusValues[0])
    await addRecord(lifelines, { lifeline: lifelineValues[0], status: statusValues[0] });
  if (lifelineValues[1] && statusValues[statusValues.length - 1])
    await addRecord(lifelines, {
      lifeline: lifelineValues[1],
      status: statusValues[statusValues.length - 1],
    });

  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("the operations console in a real browser, offline", () => {
  it("signs in and renders the map-first console and the dashboard", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => console.error("browser pageerror:", String(e).slice(0, 300)));
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
        return route.continue();
      }
      external.push(url);
      return route.abort();
    });

    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });

    // Sign in.
    await page.getByLabel("Email").fill("member@example.org");
    await page.getByLabel("Password").fill("another-good-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Console-only markers: the live COP, its controls and legend, the dock.
    await page.waitForSelector('[data-testid="cop-map"]', { timeout: 20000 });
    await page.waitForSelector(".maplibregl-ctrl-zoom-in", { timeout: 20000 });
    await page.getByText("Status", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
    await page
      .getByRole("button", { name: /road closures/i })
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, "app-map-light.png"), fullPage: false });

    // Open a board from the dock: its live view renders as a data table.
    await page.getByRole("button", { name: "Road Closures" }).first().click();
    await page.getByText("SR-169 at Pecwan").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "app-board-light.png"), fullPage: false });

    // The dashboard surface renders its widgets.
    await page.getByRole("button", { name: "Dashboard" }).click();
    await page.getByText("EOC Status").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByText("Closed roads").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, "app-dashboard-light.png"), fullPage: false });

    // Dark theme, for the night-shift EOC.
    await page.getByRole("button", { name: "Dark" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, "app-dashboard-dark.png"), fullPage: false });

    expect(external).toEqual([]);
    await page.close();
  }, 90000);
});
