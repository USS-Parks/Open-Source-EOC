import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "d31-console-app-dist")
  : "/tmp/openeoc-d31-console-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-d31-console-shots";
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
let otherIncidentId: string;
let boardId: string;
let adminId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  const candidates = [
    process.env.OPENEOC_CHROMIUM,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

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
  app.get("/d31-app/*", (request, reply) => {
    const relative = (request.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    let path = join(DIST, safe);
    if (!existsSync(path)) path = join(PUBLIC, safe);
    if (!existsSync(path)) return reply.status(404).send("missing");
    const body = readFileSync(path);
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    return reply.header("content-type", type).header("accept-ranges", "bytes").send(body);
  });
}

async function signIn(email = "admin@example.org", password = "correct-horse-battery"): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("region", { name: "Offline continuity" }).waitFor();
}

async function queueOfflineReport(summary: string): Promise<void> {
  await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
  const form = page.getByRole("form", { name: "Field report form" });
  await form.waitFor();
  await page.context().setOffline(true);
  await page.getByText("Offline capture").waitFor();
  await form.getByLabel("Summary *").fill(summary);
  await form.getByLabel("Category *").selectOption("hazard");
  await form.getByRole("button", { name: "Queue field report" }).click();
  await page.getByText(/durably queued on this device/i).waitFor();
  await page.context().setOffline(false);
}

async function persistedMeta(): Promise<string> {
  return page.evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("openeoc-field");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await new Promise((resolve, reject) => {
      const request = db.transaction("meta", "readonly").objectStore("meta").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return JSON.stringify(values);
  })()`) as Promise<string>;
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
  adminId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveApp();
  const token = await login("admin@example.org", "correct-horse-battery");
  incidentId = (await post(token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "D31 continuity exercise",
  })).incidentId as string;
  otherIncidentId = (await post(token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "D31 isolated incident",
  })).incidentId as string;
  boardId = (await post(token, `/api/v1/jurisdictions/${jurisdictionId}/boards`, {
    templateKey: "field_reports", title: "D31 field reports",
  })).id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  await post(token, `/api/v1/jurisdictions/${jurisdictionId}/forms`, {
    key: "d31_field_report", version: 1, title: "D31 field report", boardTemplate: "field_reports",
    nodes: [
      { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
      { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
        choices: [{ name: "hazard", label: "Hazard" }] },
    ],
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/d31-app/index.html`, { waitUntil: "load" });
  await signIn();
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("D31 Console continuity panel", () => {
  it("retains offline work through reload, reconciles it once, isolates scopes, and routes invalid recovery to sign-in without persisting credentials", async () => {
    const continuity = page.getByRole("region", { name: "Offline continuity" });
    await queueOfflineReport("D31 retained during network loss");
    await continuity.locator("header").getByText("Stored locally", { exact: true }).waitFor();
    await continuity.getByText("1 board draft saved locally.").waitFor();
    const storedTokens = await page.evaluate(() => localStorage.getItem("openeoc.tokens"));
    const meta = await persistedMeta();
    expect(meta).not.toContain("accessToken");
    expect(meta).not.toContain("resumeToken");
    expect(meta).not.toContain(JSON.parse(storedTokens!).accessToken);
    expect(meta).not.toContain(JSON.parse(storedTokens!).resumeToken);

    await page.reload({ waitUntil: "load" });
    await continuity.locator("header").getByText("Stored locally", { exact: true }).waitFor();
    await continuity.getByText("1 board draft saved locally.").waitFor();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByText("Sign in to the operations console.").waitFor();
    await signIn("member@example.org", "another-good-password");
    await continuity.getByText("No local changes are awaiting delivery.").waitFor();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByText("Sign in to the operations console.").waitFor();
    await signIn();
    await continuity.locator("header").getByText("Stored locally", { exact: true }).waitFor();
    await continuity.getByRole("button", { name: "Reconnect and reconcile" }).click();
    await continuity.locator("header").getByText("No queued work", { exact: true }).waitFor();
    await page.getByText("Ready for a durable field submission.").waitFor();
    expect(await page.getByRole("button", { name: "Sync 1 queued" }).count()).toBe(0);
    expect(await admin`select id from board_records where board_id = ${boardId} and incident_id = ${incidentId}`).toHaveLength(1);
    expect(await admin`select count(*)::int as count from sync_updates where board_id = ${boardId}`).toEqual([{ count: 1 }]);

    await page.getByLabel("Selected incident").selectOption(otherIncidentId);
    await continuity.getByText("No local changes are awaiting delivery.").waitFor();
    await page.getByLabel("Selected incident").selectOption(incidentId);
    await continuity.locator("header").getByText("No queued work", { exact: true }).waitFor();

    await queueOfflineReport("D31 retained after expired session");
    await page.reload({ waitUntil: "load" });
    await continuity.locator("header").getByText("Stored locally", { exact: true }).waitFor();
    const expiredToken = JSON.parse((await page.evaluate(() => localStorage.getItem("openeoc.tokens")))!) as { accessToken: string };
    await page.evaluate(async (accessToken) => {
      await fetch("/api/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    }, expiredToken.accessToken);
    await continuity.getByRole("button", { name: "Reconnect and reconcile" }).click();
    await continuity.locator("header").getByText("Session recovery required", { exact: true }).waitFor();
    await continuity.getByRole("button", { name: "Restore session" }).click();
    await page.getByText("Sign in to the operations console.").waitFor();
    expect(await persistedMeta()).not.toContain(expiredToken.accessToken);

    await signIn();
    await continuity.locator("header").getByText("Session recovery required", { exact: true }).waitFor();
    await continuity.getByRole("button", { name: "Restore session" }).click();
    await continuity.locator("header").getByText("No queued work", { exact: true }).waitFor();
    const records = await admin`select data, created_by from board_records where board_id = ${boardId} and incident_id = ${incidentId} order by created_at`;
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.created_by === adminId)).toBe(true);
    expect(records.map((record) => (record.data as { summary: string }).summary)).toEqual([
      "D31 retained during network loss", "D31 retained after expired session",
    ]);
    await page.screenshot({ path: join(SHOTS, "d31-continuity-light-1440.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
