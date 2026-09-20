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
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
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
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });

  app.get("/app/*", (req, reply) => {
    const rel = (req.params as { "*": string })["*"] || "index.html";
    const path = join(DIST, rel.replaceAll("..", ""));
    if (!existsSync(path)) return reply.status(404).send("missing");
    const ext = path.slice(path.lastIndexOf("."));
    const type = TYPES[ext] ?? "application/octet-stream";
    const buf = readFileSync(path);
    // Honor HTTP Range so the PMTiles basemap (which reads byte ranges) loads,
    // as any real static host must (see deploy/basemap/README.md).
    const range = req.headers.range;
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : buf.length - 1;
      const slice = buf.subarray(start, Math.min(end, buf.length - 1) + 1);
      return reply
        .status(206)
        .header("content-type", type)
        .header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${start + slice.length - 1}/${buf.length}`)
        .send(slice);
    }
    return reply.header("content-type", type).header("accept-ranges", "bytes").send(buf);
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  adminToken = await login("admin@example.org", "correct-horse-battery");
  memberToken = await login("member@example.org", "another-good-password");

  const roads = await createBoard("road_closures");
  const shelters = await createBoard("shelters");
  const lifelines = await createBoard("lifelines");
  await createBoard("significant_events");
  await createBoard("resource_request");
  await createBoard("field_reports");
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

  // Shelter postures, so the shelters-by-status donut shows segments.
  await addRecord(shelters, { name: "Hoopa High Gym", status: "normal", capacity: 200, occupancy: 84 });
  await addRecord(shelters, { name: "Weitchpec Center", status: "evacuating", capacity: 60, occupancy: 12 });
  await addRecord(shelters, { name: "Klamath Hall", status: "closed", capacity: 40, occupancy: 0 });

  // ESF conditions, so the dashboard shows the ESF status cards.
  const esfBoard = await createBoard("esf_status");
  await addRecord(esfBoard, { esf: "esf_8_public_health_medical", status: "stressed" });
  await addRecord(esfBoard, { esf: "esf_1_transportation", status: "normal" });

  // Activate an incident so the Forms/IAP screen has one to build from.
  const activation = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "wildfire", name: "Bald Hills Fire" },
  });
  if (activation.statusCode !== 201) throw new Error(`activation failed: ${activation.body}`);

  // A push feed with one point, so the COP shows a live external feed layer.
  const feed = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/feeds`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "NWS Alerts", kind: "geojson", push: true, staleAfterSeconds: 3600 },
  });
  if (feed.statusCode === 201) {
    const feedId = feed.json().id as string;
    const feedToken = feed.json().ingestToken as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${feedId}/ingest`,
      headers: { "x-feed-token": feedToken },
      payload: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-123.7, 41.4] },
            properties: { title: "Flood Warning", severity: "critical" },
          },
        ],
      },
    });
  }

  // A stored smart form (JSON path) that maps to the field-reports board.
  await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      key: "rapid_needs",
      version: 1,
      title: "Rapid Needs Survey",
      boardTemplate: "field_reports",
      nodes: [
        { kind: "field", name: "summary", type: "text", required: true, label: "Summary" },
        {
          kind: "field",
          name: "category",
          type: "select_one",
          label: "Category",
          choices: [
            { name: "hazard", label: "Hazard" },
            { name: "damage", label: "Damage" },
            { name: "resource", label: "Resource" },
            { name: "other", label: "Other" },
          ],
        },
      ],
    },
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
    // The external feed appears as its own togglable COP layer group.
    await page.getByText("Feeds", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByText("NWS Alerts").first().waitFor({ state: "visible", timeout: 20000 });
    // The seeded incident is open, so the jurisdiction is in lockdown: the
    // banner is visible and guest/public read is suspended.
    await page
      .getByText(/Incident lockdown active/)
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
    await page
      .getByText("Emergency Support Functions")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, "app-dashboard-light.png"), fullPage: false });

    // The Forms surface previews an ICS form and assembles an IAP from the
    // live incident, all through the browser.
    await page.getByRole("button", { name: "Forms", exact: true }).click();
    await page.getByRole("button", { name: "Assemble IAP" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Preview form" }).click();
    await page.getByText("ICS-201 Incident Briefing").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Assemble IAP" }).click();
    await page.getByText("Incident Action Plan").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByText("ICS-202 Incident Objectives").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Download PDF" }).first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "app-forms-light.png"), fullPage: false });

    // The IAP working list: the assembled plan shows as In Progress with a full
    // progress bar, then advances through submit and command approval. Status
    // assertions are scoped to the working list so they do not match the
    // always-present KPI count chips above it.
    await page.getByRole("button", { name: "IAP", exact: true }).click();
    await page.getByText("Incident Action Plans").waitFor({ state: "visible", timeout: 20000 });
    const iapList = page.getByRole("region", { name: "Working list" });
    await iapList.getByText("In Progress", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
    await iapList.getByText(/7 \/ 7 forms/).first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, "app-iap-light.png"), fullPage: false });
    // The member (a writer, not an admin) can submit the plan for approval;
    // approval and completion are admin-only and covered by the server tests.
    await page.getByRole("button", { name: "Submit for approval" }).first().click();
    await iapList.getByText("In Approval", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });

    // Field capture: drop a point on the map and save it as a road-closure
    // record, the Field Maps gesture, entirely in the browser.
    await page.getByRole("button", { name: "Map" }).click();
    await page.waitForSelector('[data-testid="cop-map"]', { timeout: 20000 });

    // Map operator tools: the cursor/zoom readout, zoom-to-extent, home,
    // distance and area measure, find-on-map, and bookmarks.
    await page.waitForSelector('[data-testid="cop-readout"]', { timeout: 20000 });
    await page.getByRole("button", { name: "Zoom to extent" }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Measure", exact: true }).click();
    await page.getByRole("button", { name: "Measuring…" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Measuring…" }).click();
    await page.getByRole("button", { name: "Measure", exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Measure area", exact: true }).click();
    await page.getByRole("button", { name: "Measuring area…" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Measuring area…" }).click();
    // Find a seeded road closure by its reason and a typed coordinate, and
    // jump to each.
    await page.getByLabel("Find on map").fill("Downed lines");
    await page.getByLabel("Find on map").press("Enter");
    await page.getByRole("button", { name: /Downed lines/ }).click();
    await page.getByLabel("Find on map").fill("41.3, -123.5");
    await page.getByLabel("Find on map").press("Enter");
    await page.getByRole("button", { name: /Go to 41.3000, -123.5000/ }).click();
    // Bookmark the view and confirm it lists.
    await page.getByLabel("Bookmark name").fill("Weitchpec");
    await page.getByRole("button", { name: "Save view" }).click();
    await page.getByRole("button", { name: "Weitchpec", exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(SHOTS, "app-map-tools.png"), fullPage: false });

    await page.getByRole("button", { name: "Add point" }).click();
    await page.locator("select").first().selectOption({ label: "Road Closures" });
    await page
      .locator('[data-testid="cop-map"] canvas')
      .first()
      .click({ position: { x: 320, y: 300 } });
    await page.getByText("New map record").waitFor({ state: "visible", timeout: 20000 });
    const recordPanel = page.getByRole("region", { name: "New map record" });
    await recordPanel.getByLabel("Road").fill("SR-96 at Weitchpec");
    await recordPanel.getByLabel("Reason").fill("Rockslide");
    await recordPanel.getByLabel("Status").selectOption("closed");
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, "app-map-add.png"), fullPage: false });
    await recordPanel.getByRole("button", { name: "Save record" }).click();
    await page.getByText("New map record").waitFor({ state: "hidden", timeout: 20000 });

    // A geotagged field report with a photo attachment, dropped on the map.
    await page.getByRole("button", { name: "Add point" }).click();
    await page.locator("select").first().selectOption({ label: "Field Reports" });
    await page
      .locator('[data-testid="cop-map"] canvas')
      .first()
      .click({ position: { x: 360, y: 340 } });
    const reportPanel = page.getByRole("region", { name: "New map record" });
    await reportPanel.getByLabel("Summary").fill("Culvert washout on Bald Hills Rd");
    await reportPanel.getByLabel("Category").selectOption("damage");
    await reportPanel.getByLabel("Photo").setInputFiles({
      name: "washout.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    await reportPanel.getByText("attached", { exact: false }).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, "app-map-photo.png"), fullPage: false });
    await reportPanel.getByRole("button", { name: "Save record" }).click();
    await page.getByText("New map record").waitFor({ state: "hidden", timeout: 20000 });

    // Files: upload a document and find it through platform search.
    await page.getByRole("button", { name: "Files" }).click();
    await page.getByText("Files & Search").waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("File to upload").setInputFiles({
      name: "sitrep-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Evacuation staging at the rodeo grounds."),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByText(/Uploaded sitrep-note\.txt/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Query").fill("sitrep");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByText("sitrep-note.txt").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, "app-files-light.png"), fullPage: false });

    // Incidents: the activated incident is listed.
    await page.getByRole("button", { name: "Incidents" }).click();
    await page
      .getByText("Bald Hills Fire", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    // Resource requests (213RR): submit one and advance its lifecycle state.
    await page.getByRole("button", { name: "Resources" }).click();
    await page.getByText("Resource Requests (213RR)").waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Requested item").fill("Sandbags, 500 ct");
    await page.getByRole("button", { name: "Submit request" }).click();
    await page.getByText("Sandbags, 500 ct").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Advance" }).first().click();
    // The row's state badge flips to "triaged" (the first allowed transition).
    await page.getByText("triaged", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });

    // After-action review: record an observation against a Core Capability.
    await page.getByRole("button", { name: "AAR" }).click();
    await page.getByText("After-Action Review").waitFor({ state: "visible", timeout: 20000 });
    const obsPanel = page.getByRole("region", { name: "Record an observation" });
    await obsPanel.getByLabel("Core Capability").selectOption("mass_care_services");
    await obsPanel.getByLabel("Capability element").selectOption("training");
    await page.getByLabel("Observation", { exact: true }).fill("Shelter stood up within two hours.");
    await page.getByRole("button", { name: "Add observation" }).click();
    await page
      .getByText("Shelter stood up within two hours.")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    // The observation renders the capability's proper label (scoped to the
    // Observations list so it does not match the select's hidden <option>).
    await page
      .getByRole("region", { name: "Observations" })
      .getByText("Mass Care Services")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });
    // A corrective action in the improvement plan, against a Core Capability.
    const caPanel = page.getByRole("region", { name: "Corrective actions (improvement plan)" });
    await caPanel.getByLabel("Core Capability").selectOption("operational_communications");
    await caPanel.getByLabel("Capability element").selectOption("equipment");
    await page.getByLabel("Recommended action").fill("Add a backup repeater at the EOC.");
    await page.getByRole("button", { name: "Add action" }).click();
    await page
      .getByText("Add a backup repeater at the EOC.")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    // Feeds: the seeded push feed is listed on the Feeds admin screen.
    await page.getByRole("button", { name: "Feeds" }).click();
    await page.getByText("Live Feeds").waitFor({ state: "visible", timeout: 20000 });
    await page.getByText("NWS Alerts").first().waitFor({ state: "visible", timeout: 20000 });

    // Smart Forms: render an imported XLSForm and submit it to a board.
    await page.getByRole("button", { name: "Smart Forms" }).click();
    await page.getByRole("heading", { name: "Rapid Needs Survey" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Summary", { exact: true }).fill("Two homes flooded on the flat");
    await page.getByLabel("Category", { exact: true }).selectOption("damage");
    await page.getByRole("button", { name: "Submit form" }).click();
    await page.getByText("Form submitted to the board.").waitFor({ state: "visible", timeout: 20000 });

    // Tracking & Reunification: register an object and find it by name.
    await page.getByRole("button", { name: "Tracking" }).click();
    await page.getByText("Tracking & Reunification").waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Label", { exact: true }).fill("Jane Doe");
    await page.getByRole("button", { name: "Register" }).click();
    await page.getByText(/Registered "Jane Doe"/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Name, or #tag").fill("Jane");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByText("Jane Doe").first().waitFor({ state: "visible", timeout: 20000 });

    // Messages: start a position-addressed thread and post to it.
    await page.getByRole("button", { name: "Messages" }).click();
    await page.getByText("New thread").waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Title", { exact: true }).fill("Ops coordination");
    await page.getByRole("button", { name: "Start thread" }).click();
    await page.getByText("Ops coordination").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByLabel("Message", { exact: true }).fill("Staging established at rodeo grounds.");
    await page.getByRole("button", { name: "Send" }).click();
    await page
      .getByText("Staging established at rodeo grounds.")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    // Gallery: every side tab, in light and then in dark (the night-shift EOC).
    // This is the visual sample set; content is proven by the assertions above.
    const TABS: ReadonlyArray<readonly [string, string]> = [
      ["Map", "map"],
      ["Dashboard", "dashboard"],
      ["Incidents", "incidents"],
      ["Boards", "boards"],
      ["SITREP", "sitreps"],
      ["Forms", "forms"],
      ["IAP", "iap"],
      ["Smart Forms", "smartforms"],
      ["Resources", "resources"],
      ["Tracking", "tracking"],
      ["AAR", "aar"],
      ["Feeds", "feeds"],
      ["Messages", "messages"],
      ["Files", "files"],
      ["Alerts", "alerts"],
    ];
    const gallery = async (theme: string) => {
      for (const [label, key] of TABS) {
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.waitForTimeout(label === "Map" ? 1600 : 800);
        await page.screenshot({ path: join(SHOTS, `tab-${key}-${theme}.png`), fullPage: false });
      }
    };
    await gallery("light");
    // The header toggle reads "Dark" in the light theme; flip it and sweep again.
    await page.getByRole("button", { name: "Dark" }).click();
    await page.waitForTimeout(500);
    await gallery("dark");

    expect(external).toEqual([]);
    await page.close();
  }, 180000);
});
