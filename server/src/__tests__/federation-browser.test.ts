import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * The federation screen, walked against two real instances: the county runs
 * the web app, the state is a second app with its own database. The county
 * registers the state, sees its token once, links it, copies its own public
 * key for the state and records the state's, shares a board with a receiving
 * board, watches a signed update wait in the outbox and then deliver; the
 * state pushes back with the token the county issued, and the county sees it
 * arrive. Revoking the share on screen then stops the board both ways. The key
 * and revoke controls are shot at 1586 by 992 and 1534 by 790.
 */

const DIST = buildDir("federation-app");
const SHOTS = shotDir("federation");

interface Instance {
  admin: Sql;
  runtime: Sql;
  app: FastifyInstance;
  baseUrl: string;
  adminToken: string;
  boardId: string;
}

let county: Instance;
let state: Instance;
let browser: Browser;
let page: Page;
let priorKey: string | undefined;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function standUp(serveWeb: boolean): Promise<Instance> {
  const { admin, runtime } = await freshDb();
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  const app = buildApp(runtime, { oidc: null });
  if (serveWeb) serveStatic(app, "/app", DIST);
  const baseUrl = await listen(app);
  const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: "activity_log" },
  });
  return { admin, runtime, app, baseUrl, adminToken, boardId: board.json().id as string };
}

function update(entry: string): string {
  const doc = new Y.Doc();
  doc.transact(() => doc.getMap("records").set(`${randomUUID()}/entry`, entry));
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

async function entriesOn(inst: Instance): Promise<string[]> {
  const rows = await inst.admin`select data ->> 'entry' as entry from board_records where board_id = ${inst.boardId}`;
  return rows.map((r) => r.entry as string);
}

beforeAll(async () => {
  // Push links store the partner's token encrypted under the server key.
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-federation-browser-key";
  await buildWeb(DIST);
  county = await standUp(true);
  state = await standUp(false);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: county.baseUrl });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(county.baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
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

async function signIn(target: Page, email: string, password: string): Promise<void> {
  await target.goto(`${county.baseUrl}/app/index.html`, { waitUntil: "load" });
  await target.getByLabel("Email").fill(email);
  await target.getByLabel("Password").fill(password);
  await target.getByRole("button", { name: "Sign in" }).click();
  await target.getByRole("button", { name: "Account menu" }).waitFor();
}

describe("federation screen", () => {
  it("registers, links and shares with a partner, then shows the outbox deliver and a batch arrive", async () => {
    // The state has registered the county already and shares its board back.
    const [stateJurisdiction] = await state.admin`select id from jurisdictions`;
    const intoState = await state.app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${stateJurisdiction!.id as string}/peers`,
      headers: auth(state.adminToken),
      payload: { name: "County OES" },
    });
    const stateSidePeer = intoState.json().id as string;
    const tokenIntoState = intoState.json().token as string;
    const back = await state.app.inject({
      method: "POST",
      url: `/api/v1/peers/${stateSidePeer}/agreements`,
      headers: auth(state.adminToken),
      payload: { boardId: state.boardId, canRead: true, canWrite: true, remoteBoardId: county.boardId },
    });
    expect(back.statusCode).toBe(201);
    const [countyBoard] = await county.admin`select title from boards where id = ${county.boardId}`;
    const boardTitle = countyBoard!.title as string;

    await signIn(page, "admin@example.org", "correct-horse-battery");
    await page.getByRole("button", { name: "Federation", exact: true }).click();
    await page.getByRole("heading", { name: "Federation", level: 2, exact: true }).waitFor();
    await page.getByText("No partners registered yet.").waitFor();

    // Register the state; its token is shown once, copyable, then gone.
    await page.getByLabel("Partner name").fill("State OES");
    await page.getByRole("button", { name: "Register partner" }).click();
    const issued = page.getByRole("region", { name: "New partner token" });
    await issued.getByText("Token for State OES, shown once").waitFor();
    const tokenIntoCounty = (await issued.locator("code").textContent())!.trim();
    expect(tokenIntoCounty.length).toBeGreaterThan(20);
    await issued.getByRole("button", { name: "Copy token" }).click();
    await issued.getByText("Token copied.").waitFor();
    expect(await page.evaluate("navigator.clipboard.readText()")).toBe(tokenIntoCounty);
    const [registered] = await county.admin`select id, token_hash from peers where name = 'State OES'`;
    expect(registered!.token_hash).not.toBe(tokenIntoCounty);
    await issued.getByRole("button", { name: "I have saved the token" }).click();
    expect(await page.getByText(tokenIntoCounty).count()).toBe(0);

    // Link it for push delivery. The token is typed once and never shown.
    const partner = page.getByRole("listitem", { name: "Partner State OES" });
    await partner.getByText("Not linked", { exact: true }).waitFor();
    await partner.getByText("Set push link").click();
    await partner.getByLabel("Partner address").fill(state.baseUrl);
    await partner.getByLabel("Token issued by the partner").fill(tokenIntoState);
    await partner.getByRole("button", { name: "Save push link" }).click();
    await page.getByText("Push link saved for State OES.").waitFor();
    await partner.getByText(`Pushing to ${state.baseUrl}`).waitFor();
    const [stored] = await county.admin`select outbound_token from peers where id = ${registered!.id as string}`;
    expect(stored!.outbound_token).not.toContain(tokenIntoState);
    expect(await page.content()).not.toContain(tokenIntoState);

    // Keys: the county copies its public key for the state, and records the state's.
    const own = page.getByRole("region", { name: "This instance's key" });
    await own.getByRole("button", { name: "Copy public key" }).click();
    await own.getByText("Public key copied.").waitFor();
    const countyKey = String(await page.evaluate("navigator.clipboard.readText()"));
    expect(countyKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    const recorded = await state.app.inject({
      method: "PUT", url: `/api/v1/peers/${stateSidePeer}/key`, headers: auth(state.adminToken), payload: { publicKey: countyKey },
    });
    expect(recorded.statusCode, recorded.body).toBe(200);
    const [countyIdentity] = await county.admin`select private_key_envelope from federation_identity`;
    expect(await page.content()).not.toContain(countyIdentity!.private_key_envelope as string);
    await partner.getByText("Not recorded", { exact: true }).waitFor();
    await partner.getByText(/Batches from State OES are refused until its public key is recorded/).waitFor();
    const stateIdentity = (await state.app.inject({
      method: "GET", url: `/api/v1/jurisdictions/${stateJurisdiction!.id as string}/federation`, headers: auth(state.adminToken),
    })).json().identity as { publicKey: string; fingerprint: string };
    await partner.getByText("Set partner key", { exact: true }).click();
    await partner.getByLabel("Partner's public key").fill(stateIdentity.publicKey);
    await partner.getByRole("button", { name: "Save partner key" }).click();
    await page.getByText(`Key recorded for State OES, fingerprint ${stateIdentity.fingerprint}.`).waitFor();
    await partner.getByText("Recorded", { exact: true }).waitFor();
    await partner.getByText(stateIdentity.fingerprint).waitFor();
    await page.setViewportSize({ width: 1586, height: 992 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await own.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "federation-keys-1586.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Share the county board, writable, into the state's board.
    await partner.getByText("Share a board").click();
    await partner.getByLabel("Board", { exact: true }).selectOption({ label: boardTitle });
    await partner.getByLabel("Partner access").selectOption("write");
    await partner.getByLabel("Receiving board ID on the partner").fill(state.boardId);
    await partner.getByRole("button", { name: "Share board" }).click();
    await page.getByText(`${boardTitle} shared with State OES.`).waitFor();
    const shared = partner.getByRole("listitem", { name: `${boardTitle} shared with State OES` });
    await shared.getByText("Partner reads and writes").waitFor();
    await shared.getByText(state.boardId).waitFor();

    // An update queues for the partner and waits in the outbox.
    const queued = await county.app.inject({
      method: "POST",
      url: `/api/v1/peers/${registered!.id as string}/queue`,
      headers: auth(county.adminToken),
      payload: { boardId: county.boardId, update: update("county: bridge closed") },
    });
    expect(queued.json()).toEqual({ queued: 1 });
    await page.getByRole("button", { name: "Refresh status" }).click();
    await partner.getByText("1 waiting").waitFor();
    await shared.getByText("Never", { exact: true }).waitFor();
    await page.screenshot({ path: join(SHOTS, "federation-waiting-light-1440.png"), fullPage: false });

    // The delivery worker pushes it to the state.
    expect((await new DeliveryWorker(county.runtime).drain()).federated).toBe(1);
    expect(await entriesOn(state)).toContain("county: bridge closed");
    await page.getByRole("button", { name: "Refresh status" }).click();
    await partner.getByText("Up to date").waitFor();
    await shared.getByText("Nothing waiting").waitFor();
    expect(await shared.getByText("Never", { exact: true }).count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, "federation-delivered-light-1440.png"), fullPage: false });

    // The state links back with the token the county issued and pushes an update.
    const link = await state.app.inject({
      method: "PUT",
      url: `/api/v1/peers/${stateSidePeer}/link`,
      headers: auth(state.adminToken),
      payload: { endpointUrl: county.baseUrl, token: tokenIntoCounty },
    });
    expect(link.statusCode).toBe(200);
    await state.app.inject({
      method: "POST",
      url: `/api/v1/peers/${stateSidePeer}/queue`,
      headers: auth(state.adminToken),
      payload: { boardId: state.boardId, update: update("state: task force en route") },
    });
    expect((await new DeliveryWorker(state.runtime).drain()).federated).toBe(1);
    expect(await entriesOn(county)).toContain("state: task force en route");
    await page.getByRole("button", { name: "Refresh status" }).click();
    const received = page.getByRole("listitem", { name: "Received from State OES" });
    await received.getByText(boardTitle).waitFor();
    await received.getByText("1 update").waitFor();

    // Revoking the share asks first, then stops the board both ways.
    await page.setViewportSize({ width: 1534, height: 790 });
    await shared.getByRole("button", { name: "Revoke sharing" }).click();
    const confirm = shared.getByRole("group", { name: "Confirm revoke" });
    await confirm.getByText(`Revoke sharing ${boardTitle} with State OES?`, { exact: false }).waitFor();
    await confirm.scrollIntoViewIfNeeded();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "federation-revoke-1534.png"), fullPage: false });
    await confirm.getByRole("button", { name: "Revoke agreement" }).click();
    await page.getByText(`${boardTitle} is no longer shared with State OES.`).waitFor();
    await shared.waitFor({ state: "detached" });
    const after = await county.app.inject({
      method: "POST",
      url: `/api/v1/peers/${registered!.id as string}/queue`,
      headers: auth(county.adminToken),
      payload: { boardId: county.boardId, update: update("county: after revocation") },
    });
    expect(after.json()).toEqual({ queued: 0 });
    await state.app.inject({
      method: "POST",
      url: `/api/v1/peers/${stateSidePeer}/queue`,
      headers: auth(state.adminToken),
      payload: { boardId: state.boardId, update: update("state: after revocation") },
    });
    expect((await new DeliveryWorker(state.runtime).drain()).federated).toBe(0);
    expect(await entriesOn(county)).not.toContain("state: after revocation");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await received.scrollIntoViewIfNeeded();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "federation-received-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);

  it("hides Federation from an account that administers nothing", async () => {
    const member = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await signIn(member, "member@example.org", "another-good-password");
      await member.getByRole("button", { name: "Feeds", exact: true }).waitFor();
      expect(await member.getByRole("button", { name: "Federation", exact: true }).count()).toBe(0);
      await member.goto(`${county.baseUrl}/app/index.html#/federation`, { waitUntil: "load" });
      await member.getByText("Federation is available to administrators.").waitFor();
    } finally {
      await member.close();
    }
  }, 60_000);
});
