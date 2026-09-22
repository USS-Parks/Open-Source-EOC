import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = process.env.OPENEOC_TEST_BUILD_ROOT
  ? join(process.env.OPENEOC_TEST_BUILD_ROOT, "boards-workspace-app-dist")
  : "/tmp/openeoc-boards-workspace-app-dist";
const SHOTS = process.env.OPENEOC_SHOT_DIR ?? "/tmp/openeoc-boards-workspace-shots";
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
let incidentId: string;
let referenceId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function chromiumPath(): string {
  for (const candidate of [
    process.env.OPENEOC_CHROMIUM,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ]) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("no Chromium found; set OPENEOC_CHROMIUM");
}

async function request(
  token: string,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
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
    .header("accept-ranges", "bytes")
    .send(buffer);
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
  mkdirSync(SHOTS, { recursive: true });

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const template = {
    key: "synthetic_operations_workspace",
    version: 1,
    title: "Synthetic Operations Board",
    fields: [
      { key: "summary", label: "Summary", type: "text", required: true },
      { key: "status", label: "Status", type: "enum", values: ["open", "closed"], required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "related", label: "Related record", type: "record_ref",
        targetBoardKey: "synthetic_operations_workspace", labelField: "summary" },
      { key: "evidence", label: "Evidence", type: "attachment" },
    ],
    views: [
      { key: "active", title: "Active", columns: ["summary", "status", "quantity"],
        filter: [{ field: "status", op: "eq", value: "open" }] },
      { key: "all", title: "All activity", columns: ["summary", "status", "quantity"] },
    ],
    inputLayout: { sections: [
      { key: "request", title: "Request", fields: ["summary", "status", "quantity", "related"] },
      { key: "supporting", title: "Supporting material", fields: ["evidence"] },
    ] },
    detailLayout: { sections: [
      { key: "summary", title: "Operational summary", fields: ["summary", "status", "quantity"] },
      { key: "links", title: "Related information", fields: ["related", "evidence"] },
    ] },
  };
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
  await request(token, "POST", "/api/v1/templates", template);
  boardId = (await request(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: template.key,
  })).id as string;
  incidentId = (await request(token, "POST", `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "daily_ops",
    name: "Synthetic Board Workspace Exercise",
  })).incidentId as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  referenceId = (await request(token, "POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, {
    summary: "Support staging",
    status: "open",
    quantity: 0,
  })).id as string;

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

describe("P-BOARDS-1 operational board workspace", () => {
  it("uses layouts, scoped references, detail history, editing, filters and responsive themes", async () => {
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?incident=${incidentId}&view=active`);
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Synthetic Operations Board", exact: true }).waitFor();
    await page.getByText("Support staging", { exact: true }).waitFor();
    await page.getByText("0", { exact: true }).waitFor();

    await page.getByRole("button", { name: "New record", exact: true }).click();
    const create = page.getByRole("dialog", { name: "New Synthetic Operations Board record" });
    await create.getByRole("group", { name: "Request" }).waitFor({ state: "visible" });
    await create.getByRole("group", { name: "Supporting material" }).waitFor({ state: "visible" });
    await create.getByLabel("Summary", { exact: true }).fill("Bridge inspection");
    await create.getByRole("combobox", { name: /^Status/ }).selectOption("open");
    await create.getByLabel("Quantity", { exact: true }).fill("0");
    await create.getByRole("combobox", { name: /^Related record/ }).selectOption(referenceId);
    await create.getByLabel("Evidence", { exact: true }).setInputFiles({
      name: "inspection-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic bridge inspection evidence."),
    });
    await create.getByText("Attached", { exact: true }).waitFor();
    const createdResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes(`/api/v1/boards/${boardId}/records`) && response.status() === 201);
    const detailResponse = page.waitForResponse((response) => response.request().method() === "GET"
      && response.url().includes(`/api/v1/boards/${boardId}/records/`) && response.url().includes("/detail"));
    await create.getByRole("button", { name: "Save record", exact: true }).click();
    const createdId = ((await (await createdResponse).json()) as { id: string }).id;
    await create.waitFor({ state: "hidden" });
    await page.getByRole("main").getByText("Bridge inspection", { exact: true }).waitFor();
    const createdSelection = page.getByLabel(`Select record ${createdId}`);
    if (!await createdSelection.isChecked()) await createdSelection.check();
    await page.waitForURL((url) => url.hash.includes(`record=${createdId}`));
    expect((await detailResponse).status()).toBe(200);
    const openContext = page.getByRole("button", { name: "Open context" });
    if (await openContext.isVisible()) await openContext.click();

    const selected = page.getByRole("region", { name: "Selected record" });
    await selected.getByRole("heading", { name: "Operational summary" }).waitFor();
    expect(await selected.textContent()).toContain("Bridge inspection");
    expect(await selected.textContent()).toContain("Related information");
    expect(await selected.textContent()).toContain("Support staging");
    expect(await selected.textContent()).toContain("inspection-note.txt");
    expect(await selected.textContent()).toContain("Created record");
    await page.screenshot({ path: join(SHOTS, "boards-workspace-wide-light.png"), fullPage: false });

    await selected.getByRole("button", { name: "Edit record" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Synthetic Operations Board record" });
    try {
      await edit.waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      throw new Error(`Edit dialog did not open. hash=${new URL(page.url()).hash}; dialogs=${JSON.stringify(await page.getByRole("dialog").allTextContents())}; pageErrors=${JSON.stringify(pageErrors)}`);
    }
    const summary = edit.getByRole("textbox", { name: /^Summary/ });
    try {
      await summary.waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      throw new Error(`Edit Summary control was not available. hash=${new URL(page.url()).hash}; dialog=${JSON.stringify(await edit.allTextContents())}; labels=${JSON.stringify(await edit.locator("label").allTextContents())}; controls=${await edit.locator("input, textarea, select, button").count()}; pageErrors=${JSON.stringify(pageErrors)}`);
    }
    await summary.fill("Bridge inspection complete");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await edit.waitFor({ state: "hidden" });
    await selected.getByText("Bridge inspection complete", { exact: true }).waitFor();
    expect(await selected.textContent()).toMatch(/Updated record: [^]*Summary/);

    await page.getByRole("tab", { name: "All activity" }).click();
    const filter = page.getByPlaceholder("Filter Summary");
    await filter.fill("Support");
    await page.getByRole("main").getByText("Support staging", { exact: true }).waitFor({ state: "visible" });
    expect(await page.getByRole("main").getByText("Bridge inspection complete", { exact: true }).count()).toBe(0);
    expect(page.url()).toContain("filter=");
    await page.reload();
    await page.getByRole("main").getByText("Support staging", { exact: true }).waitFor();
    expect(await filter.inputValue()).toBe("Support");
    await page.getByLabel(`Select record ${referenceId}`).click();
    await selected.getByText("Support staging", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "boards-workspace-wide-dark.png"), fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    const closeContext = page.getByRole("button", { name: "Close context drawer" });
    if (await closeContext.isVisible()) await closeContext.click();
    await page.getByRole("main").getByText("Support staging", { exact: true }).waitFor();
    const geometry = await page.evaluate(`({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    })`) as { documentWidth: number; viewportWidth: number };
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    await page.screenshot({ path: join(SHOTS, "boards-workspace-narrow-dark.png"), fullPage: false });
    await page.getByRole("button", { name: "Open context" }).click();
    await page.getByRole("dialog", { name: "Context" }).getByText("Support staging", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "boards-workspace-narrow-detail-dark.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
