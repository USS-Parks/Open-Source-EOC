import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * VA9 in a real browser: a jurisdiction adds a section chief's approval
 * signature to its ICS 213RR board, and the approver signs a request by
 * drawing on the pad. The record keeps the drawn image as a stored file with
 * who signed and when, and shows the signature where the record is read.
 */

const DIST = buildDir("signature-app");
const SHOTS = shotDir("signature");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let browser: Browser;
let page: Page;
let baseUrl: string;
let boardId: string;
let recordId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const board = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, headers: auth(token),
    payload: { templateKey: "resource_request" },
  });
  expect(board.statusCode, board.body).toBe(201);
  boardId = board.json().id as string;
  const field = await app.inject({
    method: "POST", url: `/api/v1/boards/${boardId}/local-fields`, headers: auth(token),
    payload: { key: "x_section_chief_approval", label: "Section chief approval", type: "signature" },
  });
  expect(field.statusCode, field.body).toBe(201);
  const record = await app.inject({
    method: "POST", url: `/api/v1/boards/${boardId}/records`, headers: auth(token),
    payload: { item: "Potable water, 500 gallons", quantity: 500, priority: "immediate", state: "submitted" },
  });
  expect(record.statusCode, record.body).toBe(201);
  recordId = record.json().id as string;

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1586, height: 992 } });
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

describe("signature field", () => {
  it("signs a 213RR's section chief approval on the pad and shows the signature on the record", async () => {
    await page.goto(`${baseUrl}/app/index.html#/board/${boardId}?record=${recordId}`);
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    const openContext = page.getByRole("button", { name: "Open context" });
    const selected = page.getByRole("region", { name: "Selected record" });
    await selected.or(openContext).first().waitFor();
    if (await openContext.isVisible()) await openContext.click();
    await selected.getByRole("button", { name: "Edit record" }).click();
    const edit = page.getByRole("dialog", { name: /^Edit .* record$/ });
    const approval = edit.getByRole("group", { name: "Section chief approval" });
    await approval.waitFor();

    // Signing with nothing drawn is refused with the reason.
    await approval.getByLabel("Signed by").fill("Morgan Chief");
    await approval.getByRole("button", { name: "Sign", exact: true }).click();
    await approval.getByRole("alert").getByText("Draw a signature").waitFor();

    const pad = approval.getByRole("img", { name: /^Section chief approval: draw/ });
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
    await page.mouse.down();
    for (const [dx, dy] of [[60, -30], [110, 20], [170, -25], [230, 15], [290, -10]] as const)
      await page.mouse.move(box.x + 30 + dx, box.y + box.height * 0.6 + dy, { steps: 6 });
    await page.mouse.up();
    await page.screenshot({ path: join(SHOTS, "signature-pad-1586.png"), fullPage: false });
    const stored = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes("/files") && response.status() < 300);
    await approval.getByRole("button", { name: "Sign", exact: true }).click();
    await stored;
    await approval.getByRole("status").getByText(/^Signed by Morgan Chief, /).waitFor();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await edit.waitFor({ state: "hidden" });

    const signature = selected.getByRole("img", { name: "Signature of Morgan Chief" });
    await signature.waitFor();
    expect(await selected.textContent()).toMatch(/Signed by Morgan Chief, /);
    // The drawn image is a PNG with ink on it, stored as a file of this jurisdiction.
    expect(await signature.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(100);
    const [row] = await admin`select data from board_records where id = ${recordId}`;
    const value = (row!.data as Record<string, { fileId: string; signer: string; signedAt: string }>).x_section_chief_approval!;
    expect(value).toMatchObject({ signer: "Morgan Chief" });
    const [file] = await admin`select jurisdiction_id, content_type from files where id = ${value.fileId}`;
    expect(file).toMatchObject({ jurisdiction_id: seed.jurisdictionId, content_type: "image/png" });
    await selected.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "signature-record-1586.png"), fullPage: false });

    await page.setViewportSize({ width: 1534, height: 790 });
    await page.screenshot({ path: join(SHOTS, "signature-record-1534.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);
});
