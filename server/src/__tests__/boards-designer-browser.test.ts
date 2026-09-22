import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "boards-designer-app-dist")
  : "/tmp/openeoc-boards-designer-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-boards-designer-shots";
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
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  for (const candidate of [process.env.OPENEOC_CHROMIUM, "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
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
    return reply.status(206).header("content-type", TYPES[extension] ?? "application/octet-stream")
      .header("accept-ranges", "bytes")
      .header("content-range", `bytes ${start}-${start + slice.length - 1}/${buffer.length}`).send(slice);
  }
  return reply.header("content-type", TYPES[extension] ?? "application/octet-stream")
    .header("accept-ranges", "bytes").send(buffer);
}

beforeAll(async () => {
  const webDir = join(process.cwd(), "web");
  const publicDir = join(webDir, "public");
  const { build } = await import("../../../web/node_modules/vite/dist/node/index.js");
  await build({ root: webDir, base: "./", publicDir: false, logLevel: "silent",
    build: { outDir: DIST, emptyOutDir: true } });
  mkdirSync(SHOTS, { recursive: true });

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  app.get("/app/*", (incoming, reply) => {
    const relative = (incoming.params as { "*": string })["*"] || "index.html";
    const safe = relative.replaceAll("..", "");
    const built = join(DIST, safe);
    return sendFile(reply, existsSync(built) ? built : join(publicDir, safe), incoming.headers.range);
  });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login",
    payload: { email: "admin@example.org", password: "correct-horse-battery" } });
  expect(login.statusCode, login.body).toBe(200);
  const token = login.json().accessToken as string;
  const created = await app.inject({ method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${token}` }, payload: { templateKey: "shelters" } });
  expect(created.statusCode, created.body).toBe(201);
  boardId = created.json().id as string;

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
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("P-BOARDS-2 no-code board authoring", () => {
  it("configures, previews, publishes and reapplies a board version in both themes and widths", async () => {
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}/design`);
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Customize Shelters" }).waitFor();

    const nameField = page.locator("details.board-designer__field").filter({ hasText: "name: text" });
    await nameField.locator("summary").click();
    await nameField.getByLabel("name label").fill("Shelter site");
    await page.screenshot({ path: join(SHOTS, "boards-designer-wide-light.png"), fullPage: false });

    await page.getByRole("tab", { name: "Fields" }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("tab", { name: "Layouts" }).getAttribute("aria-selected")).toBe("true");
    await page.getByRole("button", { name: "Add section" }).first().click();
    await page.getByRole("tab", { name: "Routing" }).click();
    await page.getByRole("button", { name: "Enable routing" }).click();
    await page.getByLabel("Assign during this transition").check();
    await page.getByLabel("Due rule").selectOption("relative");
    await page.getByLabel("Due after minutes").fill("90");
    await page.getByRole("button", { name: "Add approval" }).click();
    await page.getByRole("button", { name: "Add escalation" }).click();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("tab", { name: "Review & preview" }).click();
    await page.getByText("2 states and 1 transitions configured.").waitFor();
    await page.screenshot({ path: join(SHOTS, "boards-designer-wide-dark.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Routing" }).click();
    const geometry = await page.evaluate(`(() => {
      const node = document.querySelector('.board-designer');
      if (!node) throw new Error('board designer missing');
      const bounds = node.getBoundingClientRect();
      return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        left: bounds.left, right: bounds.right, viewport: document.documentElement.clientWidth };
    })()`) as { scrollWidth: number; clientWidth: number; left: number; right: number; viewport: number };
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({ path: join(SHOTS, "boards-designer-narrow-dark.png"), fullPage: false });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("tab", { name: "Review & preview" }).click();
    await page.getByRole("tab", { name: "List" }).click();
    await page.getByText("Shelter site", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "boards-designer-narrow-light.png"), fullPage: false });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const published = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/v1/templates") && response.status() === 201);
    const upgraded = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/boards/${boardId}/upgrade`) && response.status() === 200);
    await page.getByRole("button", { name: "Publish and apply version 2" }).click();
    await published;
    await upgraded;
    await page.waitForURL((url) => url.hash.startsWith(`#/board/${boardId}`) && !url.hash.includes("/design"));
    await page.evaluate(`location.hash = ${JSON.stringify(`#/board/${boardId}/design`)}`);
    await page.getByRole("heading", { name: "Customize Shelters" }).waitFor();
    await page.getByText("Version 2", { exact: true }).waitFor();

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
