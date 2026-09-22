import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env["OPENEOC_TEST_BUILD_ROOT"]
  ? join(process.env["OPENEOC_TEST_BUILD_ROOT"], "d29-field-app-dist")
  : "/tmp/openeoc-d29-field-app-dist";
const SHOTS = process.env["OPENEOC_SHOT_DIR"] ?? "/tmp/openeoc-d29-field-shots";
const PUBLIC = join(process.cwd(), "web", "public");
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".mjs": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let jurisdictionId: string;
let incidentId: string;
let boardId: string;
let actorId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  const candidates = [
    process.env["OPENEOC_CHROMIUM"],
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

async function post(token: string, url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await app.inject({ method: "POST", url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as Record<string, unknown>;
}

function serveApp(): void {
  app.get("/d29-app/*", (request, reply) => {
    const relative = (request.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    let path = join(DIST, safe);
    if (!existsSync(path)) path = join(PUBLIC, safe);
    if (!existsSync(path)) return reply.status(404).send("missing");
    const body = readFileSync(path);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    const match = request.headers.range ? /^bytes=(\d+)-(\d*)$/.exec(request.headers.range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : body.length - 1;
      const slice = body.subarray(start, Math.min(end, body.length - 1) + 1);
      return reply.status(206).header("content-type", type).header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${start + slice.length - 1}/${body.length}`).send(slice);
    }
    return reply.header("content-type", type).header("accept-ranges", "bytes").send(body);
  });
}

async function useDarkTheme(): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Use light theme" }).waitFor({ state: "hidden" });
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({ root: webDir, base: "./", publicDir: false, logLevel: "silent",
    build: { outDir: DIST, emptyOutDir: true } });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);
  mkdirSync(SHOTS, { recursive: true });

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  actorId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveApp();
  const token = await login("admin@example.org", "correct-horse-battery");
  const incident = await post(token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "D29 Field Operations Exercise",
  });
  incidentId = incident.incidentId as string;
  const board = await post(token, `/api/v1/jurisdictions/${jurisdictionId}/boards`, {
    templateKey: "field_reports", title: "Field Reports",
  });
  boardId = board.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  await post(token, `/api/v1/jurisdictions/${jurisdictionId}/forms`, {
    key: "rapid_field_report", version: 1, title: "Rapid field report", boardTemplate: "field_reports",
    nodes: [
      { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
      { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
        choices: [{ name: "hazard", label: "Hazard" }, { name: "damage", label: "Damage" },
          { name: "resource", label: "Resource" }, { name: "other", label: "Other" }] },
      { kind: "field", name: "photo", type: "image", label: "Photo" },
      { kind: "field", name: "location", type: "geopoint", label: "Location" },
    ],
  });

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
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/d29-app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
  await page.getByRole("heading", { name: "Record once, synchronize with attribution" }).waitFor();
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("D29 field reporting and tracking workspace", () => {
  it("captures attachments, survives an offline queue, reuses map placement, and retains custody attribution", async () => {
    const workspace = page.getByRole("region", { name: "Field report capture" });
    const form = workspace.getByRole("form", { name: "Field report form" });
    await form.getByLabel("Summary *").fill("Utility pole leaning over the evacuation route");
    await form.getByLabel("Category *").selectOption("hazard");
    await form.getByLabel("Latitude and longitude").fill("40.802 -124.163");
    await form.getByLabel("Photo").setInputFiles({
      name: "field-photo.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl9sAAAAASUVORK5CYII=", "base64"),
    });
    await form.getByText("Attachment ready.").waitFor();
    await form.getByRole("button", { name: "Queue field report" }).click();
    await workspace.getByText("Report synchronized with retained server attribution.").waitFor();

    await page.context().setOffline(true);
    await workspace.getByText("Offline capture").waitFor();
    await form.getByLabel("Summary *").fill("Washout blocks the secondary access road");
    await form.getByLabel("Category *").selectOption("damage");
    await form.getByLabel("Latitude and longitude").fill("40.806 -124.171");
    await form.getByRole("button", { name: "Queue field report" }).click();
    await workspace.getByText(/1 field submission queued on this device/).waitFor();
    await expect(workspace.getByRole("button", { name: "Sync 1 queued" }).isDisabled()).resolves.toBe(true);

    const beforeReconnect = await admin`
      select id from board_records where board_id = ${boardId} and incident_id = ${incidentId}`;
    expect(beforeReconnect).toHaveLength(1);
    await page.context().setOffline(false);
    await workspace.getByRole("button", { name: "Sync 1 queued" }).click();
    await workspace.getByText(/All field submissions synchronized at receipt/).waitFor();

    const reports = await admin`
      select id, incident_id, data, created_by, st_astext(geom) as point
      from board_records where board_id = ${boardId} and incident_id = ${incidentId}
      order by created_at`;
    expect(reports).toHaveLength(2);
    expect(reports.every((row) => row.created_by === actorId)).toBe(true);
    expect(reports.map((row) => (row.data as { summary: string }).summary)).toEqual([
      "Utility pole leaning over the evacuation route", "Washout blocks the secondary access road",
    ]);
    expect(reports[0]!.point).toContain("POINT");
    expect(typeof (reports[0]!.data as { photo?: unknown }).photo).toBe("string");
    const syncAudits = await admin`
      select id from audit_events where category = 'board.record.created'
        and subject_id in (${reports[0]!.id}, ${reports[1]!.id})
        and payload ->> 'via' = 'sync'`;
    expect(syncAudits).toHaveLength(2);
    await page.screenshot({ path: join(SHOTS, "d29-smartforms-light-1440.png"), fullPage: false });

    await workspace.getByRole("button", { name: "Open map capture" }).click();
    await page.getByRole("button", { name: "Add point" }).click();
    await page.getByLabel("Map record board").selectOption(boardId);
    await page.getByLabel("Longitude").fill("-124.18");
    await page.getByLabel("Latitude").fill("40.81");
    await page.getByRole("button", { name: "Use coordinates" }).click();
    await page.getByText("New map record").waitFor();
    await page.getByLabel("Summary").fill("Map-placed staging observation");
    await page.getByLabel("Category").selectOption("resource");
    await page.getByRole("button", { name: "Save record" }).click();
    await page.getByText("New map record").waitFor({ state: "hidden" });
    const [mapPlaced] = await admin`
      select incident_id, st_x(geom) as longitude, st_y(geom) as latitude
      from board_records where board_id = ${boardId}
        and data ->> 'summary' = 'Map-placed staging observation'`;
    expect(mapPlaced!.incident_id).toBe(incidentId);
    expect(Number(mapPlaced!.longitude)).toBeCloseTo(-124.18);
    expect(Number(mapPlaced!.latitude)).toBeCloseTo(40.81);

    await page.getByRole("button", { name: "Tracking", exact: true }).click();
    const tracking = page.getByRole("region", { name: "Tracking and reunification" });
    await tracking.getByRole("tab", { name: "Register" }).click();
    await tracking.getByLabel("Tracked kind").selectOption("evacuee");
    await tracking.getByLabel("Field-safe label").fill("Family group 12");
    await tracking.getByLabel("Initial station").fill("North shelter intake");
    await tracking.getByLabel("Agency").fill("County Mass Care");
    await tracking.getByRole("button", { name: "Register tracked object" }).click();
    const registration = tracking.getByText(/Registered TRK-[A-Z0-9]+/);
    await registration.waitFor();
    const tag = (await registration.textContent())!.match(/TRK-[A-Z0-9]+/)![0];
    await tracking.getByLabel("Custody state").selectOption("transferred");
    await tracking.getByLabel("Agency").fill("County Transit");
    await tracking.getByLabel("Location").fill("South reception center");
    await tracking.getByLabel("Handoff note").fill("Bus 14 receipt confirmed");
    await tracking.getByRole("button", { name: "Record custody handoff" }).click();
    await tracking.getByText(`Custody receipt recorded for ${tag}: Transferred.`).waitFor();

    const [tracked] = await admin`select id, created_by, restricted from tracked_objects where tag = ${tag}`;
    expect(tracked!.created_by).toBe(actorId);
    expect(tracked!.restricted).toEqual({});
    const chain = await admin`
      select custody_state, recorded_by from tracking_events where object_id = ${tracked!.id} order by created_at`;
    expect(chain.map((row) => row.custody_state)).toEqual(["registered", "transferred"]);
    expect(chain.every((row) => row.recorded_by === actorId)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d29-tracking-light-1440.png"), fullPage: false });

    await useDarkTheme();
    await page.screenshot({ path: join(SHOTS, "d29-tracking-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await tracking.getByRole("tab", { name: "Find & reunify" }).click();
    await tracking.getByLabel("Name, field-safe label, or #tag").fill(`#${tag}`);
    const search = tracking.getByRole("button", { name: "Search" });
    await search.focus();
    await page.keyboard.press("Enter");
    await tracking.getByText("Family group 12").waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d29-tracking-narrow-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
