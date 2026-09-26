import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { WEB_DIR, buildDir, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Real-browser proof of the vector tile path: a 5,000-record board is past
 * one GeoJSON page, so the COP mounts it from bearer-authorized PostGIS
 * tiles, clustered at low zoom and individual at street zoom, with feature
 * inspection, per-layer opacity and the USNG/MGRS readout.
 */

const DIST = buildDir("tiles-demo");
const SHOTS = shotDir("tiles");
const COUNT = 5000;
const CENTER: [number, number] = [-123.61, 41.29];

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let boardId: string;
let token: string;

interface MapHandle {
  getSource(id: string): { type: string } | undefined;
  getLayer(id: string): unknown;
  getZoom(): number;
  isMoving(): boolean;
  loaded(): boolean;
  jumpTo(options: { center: [number, number]; zoom: number }): void;
  project(lngLat: [number, number]): { x: number; y: number };
  getPaintProperty(layer: string, property: string): unknown;
  queryRenderedFeatures(options: { layers: string[] }): {
    geometry: { coordinates: [number, number] };
    properties: Record<string, unknown>;
    sourceLayer?: string;
  }[];
}

beforeAll(async () => {
  const vite = join(WEB_DIR, "node_modules", "vite", "bin", "vite.js");
  execFileSync(process.execPath, [vite, "build", "cop-demo", "--outDir", DIST, "--emptyOutDir", "--base", "./"], {
    cwd: WEB_DIR,
    stdio: "ignore",
  });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/demo", DIST);
  baseUrl = await listen(app);
  token = await login(app, "member@example.org", "another-good-password");
  const board = await post(app, await login(app), `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: "road_closures",
  });
  boardId = board.id as string;
  // A 100 x 50 grid, 0.001 degrees apart, centered on the demo map.
  await admin`
    insert into board_records (board_id, data, created_by, geom)
    select ${boardId}, jsonb_build_object(
        'road', 'Grid road ' || i, 'reason', 'Load',
        'status', (array['closed', 'one_lane', 'reopened'])[i % 3 + 1],
        'location', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(lng, lat))),
      ${seed.adminId}, ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    from (select i, (${CENTER[0] - 0.05} + (i % 100) * 0.001)::float8 as lng,
                 (${CENTER[1] - 0.025} + (i / 100) * 0.001)::float8 as lat
          from generate_series(0, ${COUNT - 1}) i) g`;
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

/** Records the map shows at the current zoom: cluster sizes plus single points. */
async function renderedRecords(page: Page, board: string): Promise<number> {
  return page.evaluate((id) => {
    const map = (globalThis as { __map?: MapHandle }).__map!;
    const layers = [`board-${id}-cluster`, `board-${id}-point`].filter((layer) => map.getLayer(layer));
    return map.queryRenderedFeatures({ layers })
      .reduce((sum, f) => sum + (f.sourceLayer === "clusters" ? Number(f.properties.point_count) : 1), 0);
  }, board);
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const map = (globalThis as { __map?: MapHandle }).__map;
    return map && !map.isMoving() && map.loaded();
  });
}

describe("operational vector tiles in a real browser", () => {
  it("renders a 5,000-record board from tiles with clusters, inspection, opacity and grid readout", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const pageErrors: string[] = [];
    const external: string[] = [];
    const tileRequests: { url: string; authorization: string | undefined }[] = [];
    const tileStatuses = new Set<number>();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("request", (request) => {
      if (request.url().includes(`/api/v1/tiles/boards/${boardId}/`)) {
        tileRequests.push({ url: request.url(), authorization: request.headers()["authorization"] });
      }
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/v1/tiles/")) tileStatuses.add(response.status());
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url);
      return route.abort();
    });

    await page.goto(`${baseUrl}/demo/index.html?token=${encodeURIComponent(token)}&board=${boardId}`);
    await page.waitForFunction(() => Boolean((globalThis as { __map?: unknown }).__map), undefined, { timeout: 30_000 });
    await page.waitForFunction(
      (id) => (globalThis as { __map?: MapHandle }).__map?.getSource(`board-${id}`)?.type === "vector",
      boardId,
      { timeout: 30_000 },
    );

    // Zoom 11: every record arrives, gathered into server-side clusters.
    await page.waitForFunction(
      ([id, count]) => {
        const map = (globalThis as { __map?: MapHandle }).__map!;
        if (!map.getLayer(`board-${id}-cluster`)) return false;
        const rendered = map.queryRenderedFeatures({ layers: [`board-${id}-cluster`, `board-${id}-point`] });
        return rendered.reduce((sum, f) => sum + (f.sourceLayer === "clusters" ? Number(f.properties.point_count) : 1), 0) === count;
      },
      [boardId, COUNT] as const,
      { timeout: 30_000 },
    );
    expect(await renderedRecords(page, boardId)).toBe(COUNT);
    expect(tileRequests.length).toBeGreaterThan(0);
    expect(tileRequests.every((request) => request.authorization === `Bearer ${token}`)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "tiles-clusters-light.png"), fullPage: false });

    // A cluster opens by zooming in.
    const canvas = (await page.locator('[data-testid="cop-map"] canvas').boundingBox())!;
    const cluster = await page.evaluate((id) => {
      const map = (globalThis as { __map?: MapHandle }).__map!;
      const [first] = map.queryRenderedFeatures({ layers: [`board-${id}-cluster`] });
      return map.project(first!.geometry.coordinates);
    }, boardId);
    const before = await page.evaluate(() => (globalThis as { __map?: MapHandle }).__map!.getZoom());
    await page.mouse.click(canvas.x + cluster.x, canvas.y + cluster.y);
    await page.waitForFunction((zoom) => (globalThis as { __map?: MapHandle }).__map!.getZoom() >= zoom + 1.9, before);

    // Street zoom: individual records with their readable fields.
    await page.evaluate((center) => (globalThis as { __map?: MapHandle }).__map!.jumpTo({ center, zoom: 14 }), CENTER);
    await settled(page);
    await page.waitForFunction(
      (id) => {
        const map = (globalThis as { __map?: MapHandle }).__map!;
        const points = map.queryRenderedFeatures({ layers: [`board-${id}-point`] });
        return points.length > 100 && points.every((f) => f.sourceLayer === "features"
          && String(f.properties.road).startsWith("Grid road ") && f.properties.location === undefined);
      },
      boardId,
      { timeout: 30_000 },
    );
    const readout = page.getByTestId("cop-readout");
    await expect.poll(() => readout.textContent()).toContain("USNG 10T DL 48923 71130 · MGRS 10TDL4892371130");
    await page.screenshot({ path: join(SHOTS, "tiles-features-light.png"), fullPage: false });

    // Clicking a tile feature opens the record inspector with its status.
    const target = await page.evaluate((id) => {
      const map = (globalThis as { __map?: MapHandle }).__map!;
      const hit = map.queryRenderedFeatures({ layers: [`board-${id}-point`] })
        .find((f) => f.properties.status === "closed")!;
      return { ...map.project(hit.geometry.coordinates), road: String(hit.properties.road) };
    }, boardId);
    await page.mouse.click(canvas.x + target.x, canvas.y + target.y);
    const inspector = page.getByTestId("cop-feature-inspector");
    await inspector.waitFor();
    const inspected = await inspector.textContent();
    expect(inspected).toContain("Road Closures");
    expect(inspected).toContain("Critical");
    await page.getByRole("button", { name: "Close selected map feature" }).click();

    // Per-layer opacity scales every layer of the board.
    await page.getByTestId("operational-layer-group").getByLabel("Opacity").fill("40");
    await page.waitForFunction(
      (id) => (globalThis as { __map?: MapHandle }).__map!.getPaintProperty(`board-${id}-point`, "circle-opacity") === 0.4,
      boardId,
    );
    // The fill's own translucency rides in its color, so its opacity is the operator's setting alone.
    expect(await page.evaluate(
      (id) => (globalThis as { __map?: MapHandle }).__map!.getPaintProperty(`board-${id}-fill`, "fill-opacity"),
      boardId,
    )).toBeCloseTo(0.4);
    await settled(page);
    await page.screenshot({ path: join(SHOTS, "tiles-opacity-light.png"), fullPage: false });

    expect([...tileStatuses]).toEqual([200]);
    expect(pageErrors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  }, 120_000);
});
