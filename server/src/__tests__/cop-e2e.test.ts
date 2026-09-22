import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Real-browser COP test (VEOC-17 acceptance): MapLibre renders the board
 * layer in headless Chromium with all non-local network blocked, and a
 * field edit reaches the rendered map inside the latency budget. This is
 * also the regression guard for the bundled-worker defect: MapLibre v6
 * resolves its worker from a sibling URL of the bundle, so a broken worker
 * setup shows up here as a map that never loads a tile.
 */

const DIST = process.env["OPENEOC_TEST_BUILD_ROOT"]
  ? join(process.env["OPENEOC_TEST_BUILD_ROOT"], "cop-demo-dist")
  : "/tmp/cop-demo-dist";
const LATENCY_BUDGET_MS = 5000;
const SHOTS = process.env["OPENEOC_SHOT_DIR"] ?? "/tmp/openeoc-cop-shots";

/** The sandbox pre-installs Chromium; CI runners ship Chrome. */
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

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let boardId: string;
let memberToken: string;

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
};

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const vite = join(webDir, "node_modules", "vite", "bin", "vite.js");
  execFileSync(process.execPath, [vite, "build", "cop-demo", "--outDir", DIST,
    "--emptyOutDir", "--base", "./"], {
    cwd: webDir,
    stdio: "ignore",
  });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);

  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  app.get("/demo/*", (req, reply) => {
    const rel = (req.params as { "*": string })["*"] || "index.html";
    const path = join(DIST, rel.replaceAll("..", ""));
    if (!existsSync(path)) return reply.status(404).send("missing");
    const ext = path.slice(path.lastIndexOf("."));
    return reply.header("content-type", TYPES[ext] ?? "application/octet-stream")
      .send(readFileSync(path));
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "member@example.org", password: "another-good-password" },
  });
  memberToken = login.json().accessToken as string;
  const adminLogin = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "admin@example.org", password: "correct-horse-battery" },
  });
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminLogin.json().accessToken as string}` },
    payload: { templateKey: "road_closures" },
  });
  boardId = board.json().id as string;
  await postClosure("SR-169 at Pecwan", [-123.61, 41.29]);

  browser = await chromium.launch({ executablePath: chromiumPath() });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await app.close();
  await runtime.end();
  await admin.end();
});

async function postClosure(road: string, coords: [number, number]): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/boards/${boardId}/records`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: {
      road,
      reason: "E2E",
      status: "closed",
      location: { type: "Point", coordinates: coords },
    },
  });
  if (res.statusCode !== 201) throw new Error(`closure post failed: ${res.body}`);
}

describe("the COP in a real browser, offline", () => {
  it("renders the closure layer with no external network and meets the field-to-COP budget", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const pageErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") console.error("browser console:", m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
        return route.continue();
      }
      external.push(url);
      return route.abort();
    });

    await page.goto(
      `${baseUrl}/demo/index.html?token=${encodeURIComponent(memberToken)}&board=${boardId}`,
    );
    await page.waitForFunction(() => Boolean((globalThis as {__map?: unknown}).__map), undefined, { timeout: 30000 });
    await page.waitForFunction(
      (board) => {
        const map = (globalThis as {__map?: unknown}).__map as {
          loaded(): boolean;
          getLayer(id: string): unknown;
          queryRenderedFeatures(opts: { layers: string[] }): {
            properties?: Record<string, unknown>;
          }[];
        };
        if (!map.getLayer(`board-${board}-point`)) return false;
        const feats = map.queryRenderedFeatures({ layers: [`board-${board}-point`] });
        return (
          map.loaded() &&
          feats.some((f) => f.properties?.["_symbolStatus"] === "critical")
        );
      },
      boardId,
      { timeout: 30000 },
    );

    await page.getByRole("heading", { name: "Map layers" }).waitFor();
    await page.getByTestId("operational-layer-group").waitFor();
    await page.getByTestId("reference-layer-group").waitFor();
    await page.getByTestId("map-legends").waitFor();
    const layerFilter = page.getByLabel("Filter layer groups");
    await layerFilter.fill("Road Closures");
    await page.getByLabel("Road Closures").waitFor();
    await layerFilter.fill("No such configured layer");
    await page.getByText("No map layers match this filter.").waitFor();
    await layerFilter.fill("");

    const find = page.getByLabel("Find on map");
    await find.fill("SR-169 at Pecwan");
    await find.press("Enter");
    await page.getByRole("button", { name: /SR-169 at Pecwan/ }).click();
    const inspector = page.getByTestId("cop-feature-inspector");
    await inspector.waitFor();
    expect(await inspector.textContent()).toContain("Road Closures");
    expect(await inspector.textContent()).toContain("Critical");
    await page.waitForFunction(() => {
      const map = (globalThis as {__map?: { isMoving(): boolean }}).__map;
      return map && !map.isMoving();
    });
    const selectedBounds = await page.evaluate(() => {
      const map = (globalThis as {__map?: { getBounds(): { toArray(): unknown } }}).__map;
      return map?.getBounds().toArray();
    });
    await page.getByRole("button", { name: "Close selected map feature" }).click();
    await inspector.waitFor({ state: "hidden" });
    const returnedBounds = await page.evaluate(() => {
      const map = (globalThis as {__map?: { getBounds(): { toArray(): unknown } }}).__map;
      return map?.getBounds().toArray();
    });
    expect(returnedBounds).toEqual(selectedBounds);

    // Field-to-COP latency: a new closure must appear on the map within budget.
    const t0 = Date.now();
    await postClosure("SR-96 at Orleans", [-123.59, 41.3]);
    await page.waitForFunction(
      (board) => {
        const map = (globalThis as {__map?: unknown}).__map as {
          queryRenderedFeatures(opts: { layers: string[] }): {
            properties?: Record<string, unknown>;
          }[];
        };
        const roads = new Set(
          map
            .queryRenderedFeatures({ layers: [`board-${board}-point`] })
            .map((f) => f.properties?.["road"]),
        );
        return roads.has("SR-169 at Pecwan") && roads.has("SR-96 at Orleans");
      },
      boardId,
      { timeout: LATENCY_BUDGET_MS },
    );
    const latency = Date.now() - t0;
    expect(latency).toBeLessThanOrEqual(LATENCY_BUDGET_MS);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, "pcop-workspace-light.png"), fullPage: false });

    const darkPage = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const darkErrors: string[] = [];
    darkPage.on("pageerror", (error) => darkErrors.push(String(error)));
    await darkPage.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
        return route.continue();
      }
      external.push(url);
      return route.abort();
    });
    await darkPage.goto(
      `${baseUrl}/demo/index.html?token=${encodeURIComponent(memberToken)}&board=${boardId}&theme=dark`,
    );
    await darkPage.waitForFunction(() => Boolean((globalThis as {__map?: unknown}).__map), undefined, { timeout: 30000 });
    await darkPage.waitForFunction(
      (board) => {
        const map = (globalThis as {__map?: { loaded(): boolean; getLayer(id: string): unknown }}).__map;
        return map?.loaded() && Boolean(map.getLayer(`board-${board}-point`));
      },
      boardId,
      { timeout: 30000 },
    );
    await darkPage.getByTestId("cop-workspace").waitFor();
    await darkPage.getByRole("heading", { name: "Map layers" }).waitFor();
    const horizontalOverflow = await darkPage.evaluate(
      "document.documentElement.scrollWidth > document.documentElement.clientWidth",
    );
    expect(horizontalOverflow).toBe(false);
    await darkPage.screenshot({ path: join(SHOTS, "pcop-workspace-dark-narrow.png"), fullPage: true });
    expect(darkErrors).toEqual([]);
    await darkPage.close();

    expect(pageErrors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 90000);
});
