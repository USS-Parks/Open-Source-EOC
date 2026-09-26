import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir, waitForSignIn, watchPage } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * Esri JSON import on screen (VC-26), at the frames' 1586 by 992 and at
 * 1534 by 790: an administrator chooses a county GIS layer saved as Esri
 * JSON in Web Mercator on a hazard board, sees its geometry column mapped to
 * the board's Area field and a clean check, imports it, and finds both
 * features on the board and the multipart slide area drawn on the map.
 */

const DIST = buildDir("esri-import-app");
const SHOTS = shotDir("esri-import");
const VIEWPORTS = [{ width: 1586, height: 992 }, { width: 1534, height: 790 }] as const;
const R = 6_378_137;
const mercator = ([lon, lat]: [number, number]) =>
  [lon * (Math.PI / 180) * R, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
/** A ring in Web Mercator, from lon, lat corners given clockwise (an Esri outer ring) or not (a hole). */
const ring = (corners: Array<[number, number]>) => [...corners, corners[0]!].map(mercator);

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let adminToken: string;
let incidentId: string;
const hazardTemplate = {
  key: "county_hazards", version: 1, title: "County Hazard Areas",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "status", label: "Status", type: "enum", values: ["active", "cleared"], required: true },
    { key: "area", label: "Area", type: "geometry", geometryKind: "any" },
  ],
  views: [{ key: "all", title: "All hazards", columns: ["name", "status"] }],
};
const pageErrors: string[] = [];
const outside: string[] = [];

/** What an ArcGIS layer's query?f=json answers for two hazards, one of them a slide in two parts. */
function countyLayer(suffix: string): Buffer {
  return Buffer.from(JSON.stringify({
    objectIdFieldName: "OBJECTID",
    geometryType: "esriGeometryPolygon",
    spatialReference: { wkid: 102100, latestWkid: 3857 },
    fields: [
      { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
      { name: "name", type: "esriFieldTypeString", alias: "Name" },
      { name: "status", type: "esriFieldTypeString", alias: "Status" },
    ],
    features: [
      { attributes: { OBJECTID: 1, name: `Slide area ${suffix}`, status: "active" },
        geometry: { rings: [
          ring([[-123.66, 41.27], [-123.66, 41.3], [-123.62, 41.3], [-123.62, 41.27]]),
          ring([[-123.65, 41.28], [-123.63, 41.28], [-123.63, 41.29], [-123.65, 41.29]]),
          ring([[-123.6, 41.31], [-123.6, 41.33], [-123.58, 41.33], [-123.58, 41.31]]),
        ] } },
      { attributes: { OBJECTID: 2, name: `Bluff Creek bridge ${suffix}`, status: "active" },
        geometry: { x: mercator([-123.64, 41.24])[0], y: mercator([-123.64, 41.24])[1] } },
    ],
  }));
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  // Registering the hazard template is an instance administrator's act.
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  adminToken = await login(app);
  await post(app, adminToken, "/api/v1/templates", hazardTemplate);
  incidentId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Klamath River Slides",
  })).incidentId as string;
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("Esri JSON import on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`imports a county layer into a board and shows it on the board and the map at ${viewport.width} by ${viewport.height}`, async () => {
      const suffix = String(viewport.width);
      const boardId = (await post(app, adminToken, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
        { templateKey: hazardTemplate.key })).id as string;
      await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const report = watchPage(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        outside.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?incident=${incidentId}&view=all`);
      await waitForSignIn(page, report);
      await page.getByLabel("Email").fill("admin@example.org");
      await page.getByLabel("Password").fill("correct-horse-battery");
      await page.getByRole("button", { name: "Sign in" }).click();

      // The layer file is read at once: the geometry column goes to Area and the check is clean.
      await page.getByRole("button", { name: "Import records" }).click();
      const drawer = page.getByRole("dialog", { name: "Import County Hazard Areas records" });
      await drawer.getByLabel("File to import").setInputFiles({
        name: "county-hazards.json", mimeType: "application/json", buffer: countyLayer(suffix),
      });
      const geometry = drawer.getByLabel("Field for column geometry");
      await geometry.waitFor();
      expect(await geometry.inputValue()).toBe("area");
      expect(await drawer.getByLabel("Field for column name").inputValue()).toBe("name");
      expect(await drawer.getByLabel("Field for column OBJECTID").inputValue()).toBe("");
      await drawer.getByText("2 rows read. No errors: ready to import.").waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `import-check-${viewport.width}.png`) });

      const committed = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().includes(`/api/v1/boards/${boardId}/import?`) && response.url().includes("dryRun=false"));
      await drawer.getByRole("button", { name: "Import 2 records" }).click();
      expect((await committed).status()).toBe(201);
      await page.getByText("Imported 2 records.").waitFor();
      const main = page.getByRole("main");
      await main.getByText(`Slide area ${suffix}`, { exact: true }).waitFor();
      await main.getByText(`Bluff Creek bridge ${suffix}`, { exact: true }).waitFor();
      await page.screenshot({ path: join(SHOTS, `board-${viewport.width}.png`) });
      const stored = await admin`
        select data ->> 'name' as name, GeometryType(geom) as kind, ST_NumGeometries(geom) as parts,
          round(ST_X(ST_Centroid(geom))::numeric, 2)::float8 as lon
        from board_records where board_id = ${boardId} order by 1`;
      expect(stored.map((r) => [r.name, r.kind, r.parts, r.lon])).toEqual([
        [`Bluff Creek bridge ${suffix}`, "POINT", 1, -123.64],
        [`Slide area ${suffix}`, "MULTIPOLYGON", 2, -123.63],
      ]);

      // On the map, the slide is found by name and opens beside the map.
      await page.evaluate((hash) => { (globalThis as unknown as { location: { hash: string } }).location.hash = hash; },
        `#/map?incident=${incidentId}`);
      await page.getByTestId("cop-map").waitFor();
      const find = page.getByLabel("Find on map", { exact: true });
      const result = page.getByRole("button", { name: new RegExp(`Slide area ${suffix}`) });
      await expect.poll(async () => {
        await find.fill(`Slide area ${suffix}`);
        await find.press("Enter");
        return result.count();
      }, { timeout: 60_000 }).toBeGreaterThan(0);
      await result.first().click();
      const inspector = page.getByRole("complementary", { name: "Selected map feature" });
      await inspector.getByText(`Slide area ${suffix}`).first().waitFor();
      await inspector.getByText("County Hazard Areas").first().waitFor();
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
      await page.screenshot({ path: join(SHOTS, `map-inspector-${viewport.width}.png`) });
      // Closed, the inspector leaves the map with both parts of the slide and the bridge drawn.
      await page.getByRole("button", { name: "Close selected map feature" }).click();
      await inspector.waitFor({ state: "detached" });
      await page.screenshot({ path: join(SHOTS, `map-${viewport.width}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(outside).toEqual([]);
    }, 180_000);
  }
});
