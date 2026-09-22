import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "d27-app-dist")
  : "/tmp/openeoc-d27-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-d27-shots";
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let incidentId: string;
let contextIncidentId: string;
let boardId: string;
let recordId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  for (const candidate of [
    process.env.OPENEOC_CHROMIUM,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().accessToken as string;
}

async function request(
  token: string,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({
    method,
    url,
    headers: auth(token),
    ...(payload === undefined ? {} : { payload }),
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response;
}

async function waitForSelectedIncident(target: Page, expectedIncidentId: string): Promise<void> {
  await target.waitForFunction(
    `document.querySelector('select[aria-label="Selected incident"]')?.value === ${JSON.stringify(expectedIncidentId)}`,
  );
}

async function workspaceFits(target: Page): Promise<boolean> {
  return target.evaluate(`(() => {
    const element = document.querySelector(".d27-workspace");
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    const parent = element.parentElement?.getBoundingClientRect();
    return Boolean(parent)
      && element.scrollWidth <= element.clientWidth
      && bounds.left >= parent.left - 0.5
      && bounds.right <= parent.right + 0.5;
  })()`) as Promise<boolean>;
}

async function workspaceWidthDiagnostic(target: Page): Promise<string> {
  return target.evaluate(`(() => {
    const workspace = document.querySelector(".d27-workspace");
    if (!workspace) return "workspace missing";
    const bounds = workspace.getBoundingClientRect();
    const metric = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: typeof element.className === "string" ? element.className : "",
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || "",
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
      };
    };
    const overflowing = Array.from(workspace.querySelectorAll("*")).filter((element) => {
      const rect = element.getBoundingClientRect();
      return element.scrollWidth > element.clientWidth + 1
        || rect.left < bounds.left - 0.5
        || rect.right > bounds.right + 0.5;
    }).slice(0, 12).map(metric);
    return JSON.stringify({
      viewportWidth: window.innerWidth,
      workspace: metric(workspace),
      parent: workspace.parentElement ? metric(workspace.parentElement) : null,
      overflowing,
    });
  })()`) as Promise<string>;
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const publicDir = join(webDir, "public");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({
    root: webDir,
    base: "./",
    publicDir: false,
    logLevel: "silent",
    build: { outDir: DIST, emptyOutDir: true },
  });
  expect(existsSync(join(DIST, "index.html"))).toBe(true);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  const sendFile = (reply: FastifyReply, path: string) => {
    if (!existsSync(path)) return reply.status(404).send("missing");
    return reply.header("content-type", TYPES[extname(path)] ?? "application/octet-stream")
      .send(readFileSync(path));
  };
  app.get("/app/*", (httpRequest, reply) => {
    const relative = (httpRequest.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    return sendFile(reply, existsSync(built) ? built : join(publicDir, safe));
  });

  const token = await login("admin@example.org", "correct-horse-battery");
  const incident = await request(
    token,
    "POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "wildfire", name: "Synthetic D27 Communications Exercise" },
  );
  incidentId = incident.json().incidentId as string;
  const contextIncident = await request(
    token,
    "POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
    { templateKey: "wildfire", name: "Synthetic D27 Current Context" },
  );
  contextIncidentId = contextIncident.json().incidentId as string;

  const board = await request(
    token,
    "POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    { templateKey: "significant_events" },
  );
  boardId = board.json().id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  const record = await request(token, "POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
    summary: "D27 evacuation route record",
    occurred_at: "2026-09-21T18:00:00.000Z",
    severity: "critical",
  });
  recordId = record.json().id as string;

  const [operations] = await admin`
    select id from positions
    where jurisdiction_id = ${seed.jurisdictionId} and key = 'operations_section_chief'`;
  expect(operations?.id).toEqual(expect.any(String));
  await request(token, "POST", `/api/v1/positions/${operations!.id as string}/assignments`, {
    personId: seed.memberId,
  });
  const thread = await request(
    token,
    "POST",
    `/api/v1/jurisdictions/${seed.jurisdictionId}/threads`,
    {
      kind: "group",
      title: "D27 evacuation coordination",
      incidentId,
      members: [{ kind: "position", id: operations!.id as string }],
    },
  );
  await request(token, "POST", `/api/v1/threads/${thread.json().id as string}/messages`, {
    body: "Accessible transport route is ready for review.",
  });
  await request(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/files`, {
    name: "d27-evacuation-route.txt",
    contentType: "text/plain",
    dataBase64: Buffer.from("Route 96 staging and accessible transport notes.").toString("base64"),
    attachedKind: "record",
    attachedId: recordId,
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html#/messages?incident=${incidentId}`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Messages", exact: true, level: 2 }).waitFor();
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("D27 messages and files in operational context", () => {
  it("preserves recipient and record context across light, dark, narrow, and keyboard workflows", async () => {
    mkdirSync(SHOTS, { recursive: true });

    const thread = page.getByRole("button", { name: /D27 evacuation coordination/ });
    await thread.waitFor();
    expect(await thread.getAttribute("aria-current")).toBe("true");
    await page.getByText(/Operations Section Chief \(current: Member\)/).first().waitFor();
    await page.getByText(/Delivery, read, and acknowledgement receipts are not available/).waitFor();
    await page.getByText("Accessible transport route is ready for review.", { exact: true }).waitFor();
    const storedResponse = page.waitForResponse((response) =>
      response.url().includes("/messages") && response.request().method() === "POST" && response.status() === 201);
    await page.getByLabel("Message", { exact: true }).fill("Route reviewed from the message workspace.");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await send.focus();
    await page.keyboard.press("Enter");
    await storedResponse;
    await page.getByRole("status").getByText("Message stored in the thread.").waitFor();
    await page.screenshot({ path: join(SHOTS, "d27-messages-light-1440.png"), fullPage: false });

    const returnHash = encodeURIComponent(`#/board/${boardId}?incident=${incidentId}&record=${recordId}`);
    const filesUrl = `${baseUrl}/app/index.html#/files?incident=${contextIncidentId}&board=${boardId}&record=${recordId}&return=${returnHash}`;
    await page.goto(filesUrl, { waitUntil: "load" });
    await waitForSelectedIncident(page, contextIncidentId);
    await page.getByRole("heading", { name: "Files", exact: true, level: 2 }).waitFor();
    await page.getByLabel("File scope").selectOption("record");
    const fileButton = page.getByRole("button", { name: /d27-evacuation-route\.txt/ });
    await fileButton.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Route 96 staging and accessible transport notes.", { exact: true }).waitFor();
    await page.getByText(/Context: Board record/).waitFor();

    const source = page.getByRole("button", { name: "Open source record", exact: true });
    await source.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      `location.hash.startsWith("#/board/${boardId}?") && location.hash.includes("incident=${incidentId}") && location.hash.includes("record=${recordId}")`,
    );
    await waitForSelectedIncident(page, incidentId);
    await page.getByText("D27 evacuation route record", { exact: true }).first().waitFor();

    await page.goto(filesUrl, { waitUntil: "load" });
    await waitForSelectedIncident(page, contextIncidentId);
    await page.getByRole("heading", { name: "Files", exact: true, level: 2 }).waitFor();
    await page.getByLabel("Attach to").selectOption("record");
    await page.getByLabel("File", { exact: true }).setInputFiles({
      name: "d27-follow-up.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Follow-up route confirmation."),
    });
    const uploadResponse = page.waitForResponse((response) =>
      response.url().includes("/files") && response.request().method() === "POST" && response.status() === 201);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await uploadResponse;
    await page.getByRole("status").getByText(/Stored d27-follow-up\.txt/).waitFor();

    await page.getByLabel("Search records and files").fill("evacuation");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const result = page.getByText("D27 evacuation route record", { exact: true });
    await result.waitFor();
    const searchOpen = result.locator("..").getByRole("button", { name: "Open record" });
    expect(await searchOpen.isVisible()).toBe(true);
    await searchOpen.click();
    await page.waitForFunction(
      `location.hash.startsWith("#/board/${boardId}?") && location.hash.includes("incident=${incidentId}") && location.hash.includes("record=${recordId}")`,
    );
    await waitForSelectedIncident(page, incidentId);
    await page.getByText("D27 evacuation route record", { exact: true }).first().waitFor();
    await page.goto(filesUrl, { waitUntil: "load" });
    await waitForSelectedIncident(page, contextIncidentId);
    await page.getByRole("heading", { name: "Files", exact: true, level: 2 }).waitFor();
    await page.screenshot({ path: join(SHOTS, "d27-files-light-1440.png"), fullPage: false });

    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.screenshot({ path: join(SHOTS, "d27-files-dark-1440.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Files", exact: true, level: 2 }).waitFor();
    expect(await workspaceFits(page)).toBe(true);
    await fileButton.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.includes('d27-evacuation-route.txt')")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d27-files-dark-390.png"), fullPage: true });

    await page.evaluate(`location.hash = "#/messages?incident=${incidentId}"`);
    await waitForSelectedIncident(page, incidentId);
    try {
      await page.getByRole("heading", { name: "Messages", exact: true, level: 2 }).waitFor();
    } catch (error) {
      await page.screenshot({ path: join(SHOTS, "d27-messages-transition-failure.png"), fullPage: true });
      const state = await page.evaluate(`(() => JSON.stringify({
        hash: location.hash,
        selectedIncident: document.querySelector('select[aria-label="Selected incident"]')?.value ?? null,
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((heading) => heading.textContent?.trim()).filter(Boolean),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((alert) => alert.textContent?.trim()).filter(Boolean),
        body: document.body.innerText.slice(0, 2400),
      }))()`);
      throw new Error(`Messages transition failed: page=${state}; pageErrors=${JSON.stringify(pageErrors)}`, { cause: error });
    }
    await page.screenshot({ path: join(SHOTS, "d27-messages-dark-390.png"), fullPage: true });
    const messagesFit = await workspaceFits(page);
    expect(messagesFit, await workspaceWidthDiagnostic(page)).toBe(true);

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
