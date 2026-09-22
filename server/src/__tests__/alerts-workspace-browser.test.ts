import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "alerts-workspace-app-dist")
  : "/tmp/openeoc-alerts-workspace-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-alerts-workspace-shots";
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".pmtiles": "application/octet-stream",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let adminToken: string;
let incidentId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  for (const candidate of [process.env.OPENEOC_CHROMIUM, "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

function sendFile(reply: FastifyReply, path: string, range?: string) {
  if (!existsSync(path)) return reply.status(404).send("missing");
  const buffer = readFileSync(path);
  const extension = path.slice(path.lastIndexOf("."));
  const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : buffer.length - 1;
    const slice = buffer.subarray(start, Math.min(end, buffer.length - 1) + 1);
    return reply.status(206)
      .header("content-type", TYPES[extension] ?? "application/octet-stream")
      .header("accept-ranges", "bytes")
      .header("content-range", `bytes ${start}-${start + slice.length - 1}/${buffer.length}`)
      .send(slice);
  }
  return reply.header("content-type", TYPES[extension] ?? "application/octet-stream")
    .header("accept-ranges", "bytes").send(buffer);
}

async function request(method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const response = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    ...(payload ? { payload } : {}),
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
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
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  app.get("/app/*", (incoming, reply) => {
    const relative = (incoming.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    if (existsSync(built)) return sendFile(reply, built, incoming.headers.range);
    return sendFile(reply, join(publicDir, safe), incoming.headers.range);
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin@example.org", password: "correct-horse-battery" } });
  adminToken = login.json().accessToken as string;
  const incident = await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "Synthetic D28 Alert Exercise" });
  incidentId = incident.incidentId as string;
  await request("POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`, {
    incidentId,
    alert: {
      sender: "duty@example.org", status: "Draft", msgType: "Alert", scope: "Public",
      info: [{ language: "en-US", category: ["Safety"], event: "Shelter opening", urgency: "Expected", severity: "Moderate", certainty: "Likely", headline: "High school shelter open", description: "Synthetic exercise shelter information for interface review." }],
    },
  });
  await admin`
    insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
    values (${seed.jurisdictionId}, ${seed.adminId}, 'workflow', 'Shelter approval requested',
      'Review the synthetic shelter request before the next operational briefing.', 'delivered',
      ${admin.json({ incidentId, urgency: "Expected" } as never)})`;

  browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
});

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn() {
  await page.goto(`${baseUrl}/app/index.html`);
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).waitFor({ state: "visible", timeout: 20000 });
}

async function openCenter() {
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  await page.getByRole("button", { name: "Open center" }).click();
  await page.getByRole("heading", { name: "Alerts and notifications" }).waitFor({ state: "visible", timeout: 20000 });
}

describe("D28 real alert workspace", () => {
  it("keeps read, acknowledgement, local review, and external delivery visibly separate", async () => {
    await signIn();
    await openCenter();
    await page.getByRole("button", { name: /Shelter approval requested/ }).click();
    await page.getByText("Not acknowledged", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Acknowledge notification" }).click();
    await page.getByText(/by Admin/).waitFor({ state: "visible", timeout: 20000 });
    await page.screenshot({ path: join(SHOTS, "alerts-wide-light.png"), fullPage: false });

    await page.getByRole("tab", { name: /Alert records/ }).click();
    await page.getByRole("button", { name: /High school shelter open/ }).click();
    await page.getByRole("heading", { name: "High school shelter open" }).waitFor({ state: "visible" });
    await page.getByText("No workspace outbound attempt recorded", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Submit for local review" }).click();
    await page.getByRole("button", { name: "Approve local alert" }).waitFor({ state: "visible", timeout: 20000 });

    const compose = page.getByRole("button", { name: "Compose local alert" });
    await compose.focus();
    await compose.press("Enter");
    await page.getByLabel("Record type").selectOption("Exercise");
    await page.getByLabel("Event").fill("Evacuation drill");
    await page.getByLabel("Headline").fill("Synthetic evacuation exercise");
    await page.getByLabel("Description").fill("Exercise content only. No public warning is sent.");
    await page.getByRole("button", { name: "Review local draft" }).press("Enter");
    await page.getByText("Local workspace only", { exact: true }).waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "External send unavailable" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Save local draft" }).press("Enter");
    await page.getByText("Synthetic evacuation exercise", { exact: true }).waitFor({ state: "visible", timeout: 20000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(SHOTS, "alerts-narrow-light.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "alerts-wide-dark.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(SHOTS, "alerts-narrow-dark.png"), fullPage: false });
    const contained = await page.evaluate("(() => { const node = document.querySelector('.notification-workspace'); return !!node && node.scrollWidth <= node.clientWidth; })()");
    expect(contained).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120000);
});
