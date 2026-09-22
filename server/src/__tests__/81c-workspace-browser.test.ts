import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "81c-workspace-app-dist")
  : "/tmp/openeoc-81c-workspace-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-81c-workspace-shots";
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".geojson": "application/geo+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
  ".wasm": "application/wasm", ".pmtiles": "application/octet-stream",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let roadBoardId: string;
let roadBoardTitle: string;
let dashboardId: string;
let token: string;
let jurisdictionId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  for (const candidate of [
    process.env.OPENEOC_CHROMIUM,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

function serveFile(reply: FastifyReply, path: string, range?: string) {
  if (!existsSync(path)) return reply.status(404).send("missing");
  const body = readFileSync(path);
  const extension = path.slice(path.lastIndexOf("."));
  const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : body.length - 1;
    const slice = body.subarray(start, Math.min(end, body.length - 1) + 1);
    return reply.status(206).header("content-type", TYPES[extension] ?? "application/octet-stream")
      .header("accept-ranges", "bytes")
      .header("content-range", `bytes ${start}-${start + slice.length - 1}/${body.length}`).send(slice);
  }
  return reply.header("content-type", TYPES[extension] ?? "application/octet-stream")
    .header("accept-ranges", "bytes").send(body);
}

async function request(method: "POST" | "PUT", url: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

interface WorkspaceBounds {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly left: number;
  readonly right: number;
  readonly viewport: number;
}

async function expectContained(selector: string): Promise<void> {
  const bounds = await page.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error(${JSON.stringify(`workspace target missing: ${selector}`)});
    const rect = node.getBoundingClientRect();
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
    };
  })()`) as unknown as WorkspaceBounds;
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
}

async function openRoute(path: string): Promise<void> {
  const hash = path.startsWith("map?") ? `#/?${path.slice("map?".length)}` : `#/${path}`;
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const publicDir = join(webDir, "public");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({ root: webDir, base: "./", publicDir: false, logLevel: "silent", build: { outDir: DIST, emptyOutDir: true } });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);
  mkdirSync(SHOTS, { recursive: true });

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  app.get("/81c-app/*", (incoming, reply) => {
    const relative = (incoming.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    return serveFile(reply, existsSync(built) ? built : join(publicDir, safe), incoming.headers.range);
  });

  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: {
    email: "admin@example.org", password: "correct-horse-battery",
  } });
  expect(login.statusCode, login.body).toBe(200);
  token = login.json().accessToken as string;
  const incident = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "81C responsive workspace exercise",
  });
  incidentId = incident.incidentId as string;
  const [roads] = await admin`
    select b.id, b.title from incident_boards ib join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId} and b.template_key = 'road_closures'`;
  expect(roads).toBeTruthy();
  roadBoardId = roads!.id as string;
  roadBoardTitle = roads!.title as string;
  await request("POST", `/api/v1/boards/${roadBoardId}/records?incidentId=${incidentId}`, {
    road: "SR-96 at Weitchpec", reason: "Debris flow", status: "closed",
    location: { type: "Point", coordinates: [-123.7, 41.3] },
  });
  const dashboard = await request("POST", `/api/v1/jurisdictions/${jurisdictionId}/dashboards`, {
    templateKey: "eoc_status", title: "81C incident overview sources",
  });
  dashboardId = dashboard.id as string;
  await request("PUT", `/api/v1/incidents/${incidentId}/dashboard-configs/incident-overview`, {
    expectedRevision: 0,
    composition: {
      title: "81C incident overview",
      panels: [
        { key: "closed", source: "dashboard", dashboardId, widgetKey: "closed_roads", presentation: "tile" },
        { key: "activity", source: "dashboard", dashboardId, widgetKey: "active_closures", presentation: "list" },
      ],
    },
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, reducedMotion: "reduce" });
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

describe("VEOC-81C responsive workspace proof", () => {
  it("keeps the real COP, board, and dashboard usable across prescribed widths with keyboard and touch control", async () => {
    await page.goto(`${baseUrl}/81c-app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await openRoute(`map?incident=${incidentId}`);
    const map = page.getByRole("region", { name: "Common operating picture map" });
    await map.waitFor({ timeout: 30_000 });
    const mapTools = page.getByTestId("map-tools");
    await mapTools.locator("summary").focus();
    await page.keyboard.press("Enter");
    expect(await mapTools.getAttribute("open")).not.toBeNull();
    await expectContained('[aria-label="Common operating picture map"]');
    await page.screenshot({ path: join(SHOTS, "81c-cop-wide-1440.png"), fullPage: false });

    await page.setViewportSize({ width: 1280, height: 900 });
    await openRoute(`board/${roadBoardId}?incident=${incidentId}`);
    await page.getByRole("heading", { name: roadBoardTitle, exact: true, level: 2 }).waitFor();
    const newRecord = page.getByRole("button", { name: "New record", exact: true });
    await newRecord.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await expectContained("#main");
    await page.screenshot({ path: join(SHOTS, "81c-boards-laptop-1280.png"), fullPage: false });

    await page.setViewportSize({ width: 900, height: 900 });
    await openRoute(`dashboard/${dashboardId}?incident=${incidentId}&view=incident-overview`);
    const statistics = page.getByRole("region", { name: "Incident statistics" });
    await statistics.waitFor({ timeout: 30_000 });
    const editFilters = page.getByRole("button", { name: "Edit filters" });
    const box = await editFilters.boundingBox();
    expect(box).toBeTruthy();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.getByRole("button", { name: "Apply filters" }).waitFor();
    await page.keyboard.press("Escape");
    await expectContained('[aria-label="Incident statistics"]');
    await page.screenshot({ path: join(SHOTS, "81c-dashboard-tablet-900.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(`map?incident=${incidentId}`);
    try {
      await map.waitFor({ timeout: 30_000 });
    } catch (cause) {
      const rendered = await page.evaluate(`JSON.stringify({
        hash: location.hash,
        title: document.title,
        body: document.body?.innerText.slice(0, 4000) ?? "",
      })`);
      await page.screenshot({ path: join(SHOTS, "81c-map-phone-failure.png"), fullPage: false });
      throw new Error(`Narrow map did not render: ${rendered}; page errors: ${JSON.stringify(pageErrors)}`, { cause });
    }
    await expectContained('[aria-label="Common operating picture map"]');
    await openRoute(`board/${roadBoardId}?incident=${incidentId}`);
    await page.getByRole("heading", { name: roadBoardTitle, exact: true, level: 2 }).waitFor();
    await expectContained("#main");
    await openRoute(`dashboard/${dashboardId}?incident=${incidentId}&view=incident-overview`);
    await statistics.waitFor({ timeout: 30_000 });
    await expectContained('[aria-label="Incident statistics"]');
    await page.screenshot({ path: join(SHOTS, "81c-dashboard-phone-390.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
