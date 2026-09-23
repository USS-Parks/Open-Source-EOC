import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD_DASHBOARDS, STANDARD_TEMPLATES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

const DIST = buildDir("export-import-app");
const SHOTS = shotDir("export-import");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let fileSha: string;
const dirs: string[] = [];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  process.env.OPENEOC_DATA_DIR = mkdtempSync(join(tmpdir(), "openeoc-blobs-"));
  dirs.push(process.env.OPENEOC_DATA_DIR);
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  // Board templates and dashboard templates are published by an instance administrator.
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  const board = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, { templateKey: "road_closures" });
  await post(app, token, `/api/v1/boards/${board.id as string}/records`, {
    road: "SR-169 at Pecwan", reason: "Active fire", status: "closed",
    location: { type: "Point", coordinates: [-123.61, 41.29] },
  });
  const upload = await multipartUpload({ name: "evacuation-plan.txt" }, "Evacuation plan, operational period 1", "text/plain");
  const stored = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files`,
    headers: { ...auth(token), ...upload.headers }, payload: upload.payload,
  });
  expect(stored.statusCode, stored.body).toBe(201);
  fileSha = stored.json().sha256 as string;

  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("jurisdiction export and definition import", () => {
  it("exports the jurisdiction from the admin screen and imports definitions in the designer", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    // The export downloads from the Records tab and unpacks with the system tar.
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Records" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export jurisdiction" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("jurisdiction-export.tar.gz");
    await page.getByText("Jurisdiction export downloaded.").waitFor();
    const unpacked = mkdtempSync(join(tmpdir(), "openeoc-export-browser-"));
    dirs.push(unpacked);
    execFileSync("tar", ["-xzf", "-"], { cwd: unpacked, input: readFileSync((await download.path())!) });
    const doc = JSON.parse(readFileSync(join(unpacked, "export.json"), "utf8")) as Record<string, unknown>;
    expect(doc.schemaVersion).toBe(2);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining([
      "boards", "sitreps", "lifelines", "incidents", "iaps", "aars", "aarObservations", "correctiveActions",
      "resourceRequests", "tasks", "assessments", "assessmentDecisions", "files",
    ]));
    expect(JSON.stringify(doc.boards)).toContain("SR-169 at Pecwan");
    expect(doc.files).toMatchObject([{ name: "evacuation-plan.txt", archive_path: `files/${fileSha}` }]);
    const bytes = readFileSync(join(unpacked, "files", fileSha));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fileSha);
    await page.getByRole("button", { name: "Export jurisdiction" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "export-records-light-1440.png"), fullPage: false });

    // The designer imports a board template, an XLSForm workbook and a dashboard template.
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByRole("button", { name: "Create template" }).click();
    await page.getByRole("heading", { name: "Create board template" }).waitFor();
    await page.getByRole("tab", { name: "Import" }).click();
    const template = { ...STANDARD_TEMPLATES.find((item) => item.key === "road_closures")!,
      key: "x_generator_log", title: "Generator log", version: 1 };
    await page.getByLabel("Board template file", { exact: true }).setInputFiles({
      name: "generator-log.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(template)),
    });
    const listed = page.getByRole("list", { name: "Imported definitions" });
    await listed.getByText("Board template Generator log (x_generator_log), version 1").waitFor();
    await page.getByLabel("Form file").setInputFiles(join(import.meta.dirname, "fixtures", "xlsform-road-closure.xlsx"));
    await listed.getByText("Form xlsform_road_closure, version 1").waitFor();
    const dashboard = { ...STANDARD_DASHBOARDS[0]!, key: "x_ops_overview", title: "Operations overview", version: 1 };
    await page.getByLabel("Dashboard template file").setInputFiles({
      name: "ops-overview.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(dashboard)),
    });
    await listed.getByText("Dashboard template Operations overview (x_ops_overview), version 1").waitFor();
    await page.screenshot({ path: join(SHOTS, "designer-import-light-1440.png"), fullPage: false });

    // Importing the same dashboard version again shows the server's refusal as it answers.
    await page.getByLabel("Dashboard template file").setInputFiles({
      name: "ops-overview.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(dashboard)),
    });
    await page.getByRole("alert").getByText("ops-overview.json: dashboard template version already exists").waitFor();

    expect((await admin`select version from board_templates where key = 'x_generator_log'`).map((r) => r.version)).toEqual([1]);
    expect((await admin`select title from form_definitions where key = 'xlsform_road_closure'`).map((r) => r.title))
      .toEqual(["Road Closure Report"]);
    expect((await admin`select version from dashboard_templates where key = 'x_ops_overview'`).map((r) => r.version)).toEqual([1]);

    await page.setViewportSize({ width: 390, height: 844 });
    await listed.scrollIntoViewIfNeeded();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "designer-import-light-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);
});
