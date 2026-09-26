import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * The offline device PIN on a shared device (VC-27), at 1586 by 992 and 1534
 * by 790, on the real build with its service worker. Without a PIN, as before:
 * a member signs in and is offered a PIN, queues a field report with no
 * connection, which the device keeps readable, restarts offline straight
 * into the console with the report queued, and sends it when the connection
 * returns. With a PIN, set from the offer: the clear copy goes; a second
 * report queued offline is ciphertext at rest; the app
 * restarts offline and asks for the PIN; wrong PINs are refused and then held
 * off by a wait that a reload does not clear; the right PIN opens the console
 * from the sealed copy with the report still queued, and it sends when the
 * connection returns. A third report waits while an administrator signs in on
 * the same device, is offered a PIN, answers Not now and finds nothing of the
 * member's; the member's password alone does not open it, their PIN does.
 */

const DIST = buildDir("device-pin");
const SHOTS = shotDir("device-pin");
const APP = "/device-pin";
const PIN = "480913";
const VIEWPORTS = [
  { width: 1586, height: 992 },
  { width: 1534, height: 790 },
] as const;

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let baseUrl: string;
let seed: SeedResult;
let incidentId: string;
let boardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, APP, DIST);
  const token = await login(app);
  incidentId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "Shared tablet exercise",
  })).incidentId as string;
  boardId = (await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, {
    templateKey: "field_reports", title: "Shared tablet reports",
  })).id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/forms`, {
    key: "tablet_field_report", version: 1, title: "Tablet field report", boardTemplate: "field_reports",
    nodes: [
      { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
      { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
        choices: [{ name: "hazard", label: "Hazard" }] },
    ],
  });
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openIncident(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).waitFor();
  await page.getByLabel("Selected incident").selectOption(incidentId);
}

/** Queue a report on Smart Forms with the network down; the page stays offline. */
async function queueOffline(page: Page, summary: string): Promise<void> {
  // Opened afresh with the connection up, so its form list is read from the server.
  await page.evaluate("window.location.hash = '#/boards'");
  await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
  const form = page.getByRole("form", { name: "Field report form" });
  await form.waitFor();
  await page.context().setOffline(true);
  await page.getByText("Offline capture").waitFor();
  await form.getByLabel("Summary *").fill(summary);
  await form.getByLabel("Category *").selectOption("hazard");
  await form.getByRole("button", { name: "Queue field report" }).click();
  await page.getByText(/queued on this device/i).first().waitFor();
}

/** Everything this origin keeps in IndexedDB and localStorage, as text, bytes read one per character. */
function everythingKept(page: Page): Promise<{ text: string; tokens: string | null; profile: string | null; sealed: boolean }> {
  return page.evaluate(`(async () => {
    const parts = [];
    let sealed = false;
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of db.objectStoreNames) {
        const values = await new Promise((resolve) => {
          const request = db.transaction(store, "readonly").objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
        });
        for (const value of values) {
          if (store === "vaults") sealed = sealed || value.session === true;
          parts.push(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? String.fromCharCode(...item) : item));
        }
      }
      db.close();
    }
    return { text: parts.join("\\n"), tokens: localStorage.getItem("openeoc.tokens"), profile: localStorage.getItem("openeoc.me"), sealed };
  })()`);
}

describe("offline device PIN on a shared device", () => {
  for (const viewport of VIEWPORTS) {
    const w = viewport.width;
    it(`keeps work unprotected without a PIN, seals it under one, asks for it offline, holds off wrong PINs and keeps it from the next person, at ${w} by ${viewport.height}`, async () => {
      const unprotected = `Culvert washed out on Weitchpec Road (${w})`;
      const first = `Downed line on Bald Hills Road (${w})`;
      const second = `Slide blocking Tulley Creek Road (${w})`;
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await page.goto(`${baseUrl}${APP}/index.html`, { waitUntil: "load" });
      // The restart below is offline, so the app's own files must be in the worker's cache first.
      await page.waitForFunction("navigator.serviceWorker.controller !== null", undefined, { timeout: 60_000 }).catch(async (error: unknown) => {
        const state = await page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => JSON.stringify({
          registered: Boolean(r), installing: r?.installing?.state ?? null, waiting: r?.waiting?.state ?? null, active: r?.active?.state ?? null }))`);
        throw new Error(`The service worker did not take over: ${String(state)}`, { cause: error });
      });

      // Without a PIN the member works as before, and is offered one.
      await signIn(page, "member@example.org", "another-good-password");
      await openIncident(page);
      const offer = page.getByRole("region", { name: "Device PIN" });
      const device = page.getByRole("region", { name: "This device" });
      await offer.getByText("This device keeps your work unprotected.").waitFor();
      await device.getByRole("heading", { name: "Kept unprotected" }).waitFor();
      const continuity = page.getByRole("region", { name: "Offline continuity" });
      await queueOffline(page, unprotected);
      await continuity.getByText("1 board draft saved locally.").waitFor();
      // Unprotected, as the notice says: readable by anyone using the device.
      expect((await everythingKept(page)).text).toContain(unprotected);
      await page.screenshot({ path: join(SHOTS, `unprotected-offer-${w}.png`) });

      // A restart with no connection opens straight into the console, the report still queued.
      await page.reload({ waitUntil: "load" });
      await page.getByText("No connection · working offline").waitFor();
      await continuity.getByText("1 board draft saved locally.").waitFor();
      await offer.getByText("This device keeps your work unprotected.").waitFor();
      await page.context().setOffline(false);
      await continuity.getByRole("button", { name: "Reconnect and reconcile" }).click();
      await continuity.locator("header").getByText("No queued work", { exact: true }).waitFor();
      expect(await admin`select created_by from board_records where board_id = ${boardId} and data->>'summary' = ${unprotected}`)
        .toEqual([{ created_by: seed.memberId }]);

      // The member sets a PIN from the offer: what the device kept moves under it, and the clear copy goes.
      await offer.getByRole("button", { name: "Set device PIN" }).click();
      await offer.getByLabel("New device PIN").fill(PIN);
      await offer.getByLabel("Repeat the PIN").fill(PIN);
      await offer.getByRole("button", { name: "Set device PIN" }).click();
      await device.getByRole("heading", { name: "Kept under your device PIN" }).waitFor();
      expect(await offer.count()).toBe(0);
      await expect.poll(async () => (await everythingKept(page)).sealed).toBe(true);
      await expect.poll(async () => (await everythingKept(page)).text.includes(unprotected)).toBe(false);

      await queueOffline(page, first);
      await continuity.getByText("1 board draft saved locally.").waitFor();
      // At rest: ciphertext, and no session, profile or report in the clear.
      const kept = await everythingKept(page);
      expect(kept.tokens).toBeNull();
      expect(kept.profile).toBeNull();
      for (const secret of [first, "member@example.org", PIN, "accessToken", "Bald Hills"]) expect(kept.text).not.toContain(secret);

      // The app restarts with no connection and asks for the PIN first.
      await page.reload({ waitUntil: "load" });
      const unlock = page.getByRole("region", { name: "Unlock this device" });
      await unlock.getByText("This device keeps work for Member. Enter the device PIN to open it.").waitFor();
      expect(await page.getByRole("region", { name: "Offline continuity" }).count()).toBe(0);
      for (const [pin, left] of [["000000", 9], ["000001", 8]] as const) {
        await unlock.getByLabel("Device PIN").fill(pin);
        await unlock.getByRole("button", { name: "Unlock" }).click();
        await unlock.getByText(`That PIN is not right. ${left} tries left before this device erases the work it keeps for Member, including work not yet sent.`).waitFor();
      }
      await unlock.getByLabel("Device PIN").fill("000002");
      await unlock.getByRole("button", { name: "Unlock" }).click();
      await unlock.getByText(/^That PIN is not right\. Too many wrong PINs: try again in (29|30) seconds\. 7 tries left/).waitFor();
      await unlock.getByLabel("Device PIN").fill(PIN);
      expect(await unlock.getByRole("button", { name: "Unlock" }).isDisabled()).toBe(true);
      await page.screenshot({ path: join(SHOTS, `pin-wait-${w}.png`) });

      // A reload does not clear the wait.
      await page.reload({ waitUntil: "load" });
      await unlock.getByText(/^Too many wrong PINs: try again in \d+ seconds\. 7 tries left/).waitFor();
      await unlock.getByLabel("Device PIN").fill(PIN);
      expect(await unlock.getByRole("button", { name: "Unlock" }).isDisabled()).toBe(true);
      await expect.poll(() => unlock.getByRole("button", { name: "Unlock" }).isEnabled(), { timeout: 45_000 }).toBe(true);
      await unlock.getByRole("button", { name: "Unlock" }).click();

      // The right PIN opens the console from the sealed copy, still offline, with the report queued.
      await page.getByText("No connection · working offline").waitFor();
      await continuity.getByText("1 board draft saved locally.").waitFor();
      await device.getByRole("heading", { name: "Kept under your device PIN" }).waitFor();
      await page.screenshot({ path: join(SHOTS, `offline-open-${w}.png`) });
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);

      // It sends when the connection returns.
      await page.context().setOffline(false);
      await continuity.getByRole("button", { name: "Reconnect and reconcile" }).click();
      await continuity.locator("header").getByText("No queued work", { exact: true }).waitFor();
      expect(await admin`select created_by from board_records where board_id = ${boardId} and data->>'summary' = ${first}`)
        .toEqual([{ created_by: seed.memberId }]);

      // A second report waits on the device while someone else uses it.
      await queueOffline(page, second);
      await page.context().setOffline(false);
      await continuity.getByText("1 board draft saved locally.").waitFor();
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("button", { name: "Sign out" }).click();
      await signIn(page, "admin@example.org", "correct-horse-battery");
      await openIncident(page);
      await continuity.getByText("No local changes are awaiting delivery.").waitFor();
      await device.getByRole("heading", { name: "Kept unprotected" }).waitFor();
      // The offer never holds anyone up: Not now, and it goes.
      await offer.getByRole("button", { name: "Not now" }).click();
      expect(await offer.count()).toBe(0);
      expect(await device.count()).toBe(0);
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("button", { name: "Sign out" }).click();

      // The member's password alone does not open the device copy; the PIN does.
      await signIn(page, "member@example.org", "another-good-password");
      await unlock.getByRole("button", { name: "Sign in as someone else" }).waitFor();
      await unlock.getByLabel("Device PIN").fill(PIN);
      await unlock.getByRole("button", { name: "Unlock" }).click();
      await openIncident(page);
      await continuity.getByText("1 board draft saved locally.").waitFor();
      await continuity.getByRole("button", { name: "Reconnect and reconcile" }).click();
      await continuity.locator("header").getByText("No queued work", { exact: true }).waitFor();
      expect(await admin`select created_by from board_records where board_id = ${boardId} and data->>'summary' = ${second}`)
        .toEqual([{ created_by: seed.memberId }]);
      await page.screenshot({ path: join(SHOTS, `sealed-console-${w}.png`) });
      await context.close();
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    }, 240_000);
  }
});
