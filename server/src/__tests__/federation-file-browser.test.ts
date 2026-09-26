import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Download, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Exchange by file on the Federation screen (AG-04). The county runs the web
 * app; the state is a second instance on its own database that never listens
 * and is never linked, so the only way between them is a file. On the
 * county's screen the administrator exports the waiting batch, imports the
 * state's batch file, exports the receipt for it and imports the state's
 * receipt, and each step says what it did; a repeated import says nothing
 * changed and a tampered file is refused. The state's side is driven through
 * its routes. Shot at 1586 by 992 and 1534 by 790.
 */

const DIST = buildDir("federation-file-app");
const SHOTS = shotDir("federation-file");

interface Instance {
  admin: Sql;
  app: FastifyInstance;
  runtime: Sql;
  jurisdictionId: string;
  adminToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let countyUrl: string;
let browser: Browser;
let page: Page;
let priorKey: string | undefined;
let stateAtCounty: string, countyAtState: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function standUp(serveWeb: boolean): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  if (serveWeb) serveStatic(app, "/app", DIST);
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const board = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken), payload: { templateKey: "activity_log" } });
  return { admin, runtime, app, jurisdictionId: seed.jurisdictionId, adminToken, boardId: board.json().id as string };
}

async function call(inst: Instance, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  const res = await inst.app.inject({ method, url, headers: auth(inst.adminToken), ...(payload !== undefined ? { payload: payload as object } : {}) });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

async function addEntry(inst: Instance, entry: string): Promise<string> {
  return (await call(inst, "POST", `/api/v1/boards/${inst.boardId}/records`, { entry })).id as string;
}

async function entriesOn(inst: Instance): Promise<string[]> {
  const rows = await inst.admin`
    select data ->> 'entry' as entry from board_records where board_id = ${inst.boardId} and deleted_at is null order by 1`;
  return rows.map((r) => r.entry as string);
}

async function saved(download: Promise<Download>): Promise<{ name: string; content: unknown }> {
  const file = await download;
  return { name: file.suggestedFilename(), content: JSON.parse(readFileSync((await file.path())!, "utf8")) };
}

function fileOf(name: string, content: unknown) {
  return { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(content)) };
}

async function noSideScroll(): Promise<void> {
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-federation-file-browser-key";
  await buildWeb(DIST);
  county = await standUp(true);
  state = await standUp(false);
  countyUrl = await listen(county.app);

  // Keys exchanged and a board shared each way, readable and writable; no push link on either side.
  stateAtCounty = (await call(county, "POST", `/api/v1/jurisdictions/${county.jurisdictionId}/peers`, { name: "State OES" })).id as string;
  countyAtState = (await call(state, "POST", `/api/v1/jurisdictions/${state.jurisdictionId}/peers`, { name: "County OES" })).id as string;
  const countyKey = (await call(county, "GET", `/api/v1/jurisdictions/${county.jurisdictionId}/federation`)).identity.publicKey as string;
  const stateKey = (await call(state, "GET", `/api/v1/jurisdictions/${state.jurisdictionId}/federation`)).identity.publicKey as string;
  await call(county, "PUT", `/api/v1/peers/${stateAtCounty}/key`, { publicKey: stateKey });
  await call(state, "PUT", `/api/v1/peers/${countyAtState}/key`, { publicKey: countyKey });
  await call(county, "POST", `/api/v1/peers/${stateAtCounty}/agreements`,
    { boardId: county.boardId, canRead: true, canWrite: true, remoteBoardId: state.boardId });
  await call(state, "POST", `/api/v1/peers/${countyAtState}/agreements`,
    { boardId: state.boardId, canRead: true, canWrite: true, remoteBoardId: county.boardId });

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1586, height: 992 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(countyUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  for (const inst of [county, state]) {
    if (!inst) continue;
    await inst.app.close();
    await inst.runtime.end();
    await inst.admin.end();
  }
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("exchange by file on the federation screen", () => {
  it("exports the waiting batch, imports the partner's file, exports its receipt and imports the partner's receipt", async () => {
    expect(state.app.server.listening).toBe(false);
    // Edits and a delete wait on the county; an edit waits on the state, which exports it.
    const gone = await addEntry(county, "county: shelter open");
    await addEntry(county, "county: levee watch");
    await call(county, "DELETE", `/api/v1/boards/${county.boardId}/records/${gone}`);
    await addEntry(state, "state: task force staged");
    const stateFile = await call(state, "POST", `/api/v1/peers/${countyAtState}/exchange/export`);

    await page.goto(`${countyUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    await page.getByRole("button", { name: "Federation", exact: true }).click();
    const partner = page.getByRole("listitem", { name: "Partner State OES" });
    await partner.getByText("Not linked; updates wait in the outbox or go by file").waitFor();
    await partner.getByText("Exchange by file", { exact: true }).click();
    await partner.getByText(/^\d+ updates waiting for State OES\.$/).waitFor();

    // Export: the file downloads, and the notice says where it goes.
    const exported = saved(page.waitForEvent("download"));
    await partner.getByRole("button", { name: "Export waiting updates" }).click();
    const countyFile = await exported;
    expect(countyFile.name).toMatch(/^openeoc-batches-for-state-oes-.*\.json$/);
    await page.getByText(/^Exported \d+ updates for State OES as openeoc-batches-for-state-oes-.*Carry it to State OES and import it there\.$/).waitFor();
    await partner.getByRole("button", { name: "Export waiting updates" }).scrollIntoViewIfNeeded();
    await noSideScroll();
    await page.screenshot({ path: join(SHOTS, "federation-file-export-1586.png"), fullPage: false });

    // The state imports it and gives back its receipt.
    const atState = await call(state, "POST", `/api/v1/peers/${countyAtState}/exchange/import`, countyFile.content);
    expect(await entriesOn(state)).toEqual(["county: levee watch", "state: task force staged"]);

    // Import the state's file on screen, then export the receipt for it.
    await partner.getByLabel("Batch file from State OES").setInputFiles(fileOf("state-batches.json", stateFile.file));
    await partner.getByRole("button", { name: "Import batch file" }).click();
    await page.getByText("Imported 1 batch from State OES: 1 update. Export the receipt and carry it back to State OES.").waitFor();
    expect(await entriesOn(county)).toEqual(["county: levee watch", "state: task force staged"]);
    const receiptOut = saved(page.waitForEvent("download"));
    await partner.getByRole("button", { name: "Export receipt" }).click();
    const countyReceipt = await receiptOut;
    expect(countyReceipt.name).toMatch(/^openeoc-receipt-for-state-oes-.*\.json$/);
    await page.getByText(/^Receipt saved as openeoc-receipt-for-state-oes-/).waitFor();
    expect(await call(state, "POST", `/api/v1/peers/${countyAtState}/exchange/receipt`, countyReceipt.content))
      .toMatchObject({ delivered: stateFile.entries });

    // Import the state's receipt: the county's updates are delivered.
    await partner.getByLabel("Receipt from State OES").setInputFiles(fileOf("state-receipt.json", atState.receipt));
    await partner.getByRole("button", { name: "Import receipt" }).click();
    await page.getByText(/^Receipt from State OES imported: \d+ updates marked delivered\.$/).waitFor();
    await partner.getByText("0 updates waiting for State OES.").waitFor();

    // A repeated import changes nothing and says so; a tampered file is refused whole.
    await partner.getByLabel("Batch file from State OES").setInputFiles(fileOf("state-batches.json", stateFile.file));
    await partner.getByRole("button", { name: "Import batch file" }).click();
    await page.getByText("This file from State OES was imported before; nothing changed. Export the receipt again if State OES did not get it.").waitFor();
    const file = stateFile.file as { batches: Array<{ updates: string[] }> };
    const tampered = { ...file, batches: [{ ...file.batches[0]!, updates: [...file.batches[0]!.updates, file.batches[0]!.updates[0]!] }] };
    await partner.getByLabel("Batch file from State OES").setInputFiles(fileOf("tampered.json", tampered));
    await partner.getByRole("button", { name: "Import batch file" }).click();
    await page.getByRole("alert").getByText("Nothing was imported: the batch signature does not verify under this peer's key.").waitFor();
    expect(await entriesOn(county)).toEqual(["county: levee watch", "state: task force staged"]);

    await page.setViewportSize({ width: 1534, height: 790 });
    await partner.getByRole("button", { name: "Import receipt" }).scrollIntoViewIfNeeded();
    await noSideScroll();
    await page.screenshot({ path: join(SHOTS, "federation-file-import-1534.png"), fullPage: false });

    await page.getByRole("button", { name: "Refresh status" }).click();
    await page.getByRole("listitem", { name: "Received from State OES" }).getByText(/^From State OES by file/).waitFor();
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);
});
