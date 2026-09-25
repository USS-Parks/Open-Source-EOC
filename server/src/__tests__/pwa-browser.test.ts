import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page, Response } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, PUBLIC_DIR, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The installed web app on the real build: the service worker installs and
 * controls the page, the manifest makes the app installable, an offline reload
 * still shows the shell with every chunk and map asset served from the cache,
 * byte-range reads keep working, and a newly published build waits behind the
 * update notice until the operator chooses Reload.
 */

const DIST = buildDir("pwa-app");
const SHOTS = shotDir("pwa");
const APP = "/pwa-app";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let precache: { version: string; files: string[] };
const pageErrors: string[] = [];
const assetResponses: Response[] = [];

function readPrecache(): { version: string; files: string[] } {
  return JSON.parse(/const PRECACHE = (\{.*?\});/.exec(readFileSync(join(DIST, "sw.js"), "utf8"))![1]!);
}

async function signIn(): Promise<void> {
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("region", { name: "Offline continuity" }).waitFor();
}

const cacheNames = () => page.evaluate("caches.keys()") as Promise<string[]>;

beforeAll(async () => {
  await buildWeb(DIST);
  precache = readPrecache();
  // A large archive the build does not precache, read by byte range like the street basemap.
  mkdirSync(join(DIST, "basemap"), { recursive: true });
  writeFileSync(join(DIST, "basemap", "field-archive.pmtiles"), Buffer.from(Array.from({ length: 65_536 }, (_, i) => i % 251)));
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, APP, DIST);
  await post(app, await login(app), `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, {
    templateKey: "wildfire", name: "Installed app exercise",
  });
  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes(`${APP}/assets/`)) assetResponses.push(response);
  });
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("installable web app", () => {
  it("installs a worker that controls the page, precaches the build and passes an installability check", async () => {
    await page.goto(`${baseUrl}${APP}/`, { waitUntil: "load" });
    await page.waitForFunction("navigator.serviceWorker.controller !== null", undefined, { timeout: 60_000 });
    expect(precache.files).toEqual(expect.arrayContaining(["index.html", "manifest.webmanifest", "basemap/basemap.pmtiles"]));
    expect(await cacheNames()).toContain(`openeoc-precache-${precache.version}`);
    // The first install takes over with the console's own files; the page then has the map files copied.
    await expect.poll(() => page.evaluate(`caches.open("openeoc-precache-${precache.version}").then((cache) => cache.keys()).then((keys) => keys.length)`),
      { timeout: 60_000 }).toBe(precache.files.length);

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("./manifest.webmanifest");
    const icons = await page.evaluate(`(async () => {
      const url = new URL(${JSON.stringify(manifestHref)}, location.href);
      const manifest = await (await fetch(url)).json();
      return Promise.all(manifest.icons.map(async (icon) => {
        const response = await fetch(new URL(icon.src, url));
        return [icon.src, response.status, response.headers.get("content-type")];
      }));
    })()`);
    expect(icons).toEqual([
      ["icons/icon-192.png", 200, "image/png"],
      ["icons/icon-512.png", 200, "image/png"],
      ["icons/maskable-512.png", 200, "image/png"],
    ]);
    const cdp = await page.context().newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest") as { errors: unknown[]; url: string };
    expect(manifest.errors).toEqual([]);
    expect(manifest.url).toBe(`${baseUrl}${APP}/manifest.webmanifest`);
    // A test browser profile is incognito, which only blocks the install prompt itself.
    const installability = await cdp.send("Page.getInstallabilityErrors") as { installabilityErrors: Array<{ errorId: string }> };
    expect(installability.installabilityErrors.filter((error) => error.errorId !== "in-incognito")).toEqual([]);

    // Signed in, the code-split surfaces load through the worker from the precache.
    assetResponses.length = 0;
    await signIn();
    await page.getByRole("button", { name: "Smart Forms", exact: true }).click();
    await page.getByText("No field forms available").waitFor();
    await page.waitForLoadState("networkidle");
    expect(assetResponses.length).toBeGreaterThan(10);
    expect(assetResponses.filter((response) => !response.fromServiceWorker()).map((response) => response.url())).toEqual([]);
  }, 120_000);

  it("reloads offline to the shell with every chunk and map asset served from the cache", async () => {
    await page.context().setOffline(true);
    const shell = await page.reload({ waitUntil: "load" });
    expect(shell?.fromServiceWorker()).toBe(true);
    // The saved session needs the API to resume; meanwhile the console opens
    // from the profile this computer saved and says it is working offline.
    await page.getByText("No connection · working offline").waitFor();
    await page.getByRole("navigation", { name: "Sections" }).waitFor();
    expect(await page.evaluate("localStorage.getItem('openeoc.tokens') !== null")).toBe(true);
    const offline = await page.evaluate(`(async () => {
      const files = ${JSON.stringify(precache.files)};
      const statuses = await Promise.all(files.map((file) => fetch(file).then((r) => r.status, () => "failed")));
      const notCached = await fetch("not-in-the-precache.txt").then((r) => r.status, () => "failed");
      const api = await fetch("/api/v1/me").then((r) => r.status, () => "failed");
      const surface = files.find((file) => /^assets\\/SmartFormsSurface-[^/]+\\.js$/.test(file));
      const module = await import("./" + surface);
      return { failed: files.filter((_, i) => statuses[i] !== 200), notCached, api, surface: Object.values(module).some((value) => typeof value === "function") };
    })()`);
    // Nothing outside the precache and no API call can reach the network, so the 200s came from the cache.
    expect(offline).toEqual({ failed: [], notCached: "failed", api: "failed", surface: true });
  }, 60_000);

  it("keeps byte-range reads exact, serving the bundled basemap from the cache only when offline", async () => {
    const readRange = (file: string) => page.evaluate(`fetch(${JSON.stringify(file)}, { headers: { range: "bytes=100-163" } })
      .then(async (r) => [r.status, r.headers.get("content-range"), Array.from(new Uint8Array(await r.arrayBuffer()))], () => "failed")`);
    const basemap = readFileSync(join(PUBLIC_DIR, "basemap", "basemap.pmtiles"));
    const archive = readFileSync(join(DIST, "basemap", "field-archive.pmtiles"));
    const expected = (bytes: Buffer) => [206, `bytes 100-163/${bytes.length}`, Array.from(bytes.subarray(100, 164))];

    await page.context().setOffline(false);
    const passThrough = page.waitForResponse((response) => response.url().endsWith("/field-archive.pmtiles"));
    expect(await readRange("basemap/field-archive.pmtiles")).toEqual(expected(archive));
    expect((await passThrough).fromServiceWorker()).toBe(false);
    expect(await readRange("basemap/basemap.pmtiles")).toEqual(expected(basemap));

    await page.context().setOffline(true);
    expect(await readRange("basemap/basemap.pmtiles")).toEqual(expected(basemap));
    expect(await readRange("basemap/field-archive.pmtiles")).toBe("failed");
    await page.context().setOffline(false);
  }, 60_000);

  it("shows the update notice for a newly published build and switches to it on Reload", async () => {
    // Back online, the session kept through the offline start resumes without signing in again.
    await page.reload({ waitUntil: "load" });
    await page.getByRole("region", { name: "Offline continuity" }).waitFor();
    const next = `${precache.version}a`;
    writeFileSync(join(DIST, "sw.js"), readFileSync(join(DIST, "sw.js"), "utf8").replace(`"version":"${precache.version}"`, `"version":"${next}"`));
    await page.evaluate("navigator.serviceWorker.getRegistration().then((registration) => registration.update())");
    const notice = page.getByRole("status", { name: "App update" });
    await notice.getByText("A new version is ready.").waitFor({ timeout: 60_000 });
    await page.screenshot({ path: join(SHOTS, "pwa-update-light-1440.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(SHOTS, "pwa-update-light-390.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // A reload alone keeps the old build; the new one still waits behind the notice.
    await page.evaluate("localStorage.setItem('openeoc.theme', 'dark')");
    await page.reload({ waitUntil: "load" });
    await notice.waitFor();
    // Chromium switches workers once the running one reports idle. In this
    // harness a worker still serving the console's background module loading
    // when Reload was chosen took more than 30 seconds to switch, so the walk
    // lets the page settle first.
    await page.waitForLoadState("networkidle");
    await page.getByRole("region", { name: "Offline continuity" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "pwa-update-dark-1440.png") });
    expect(await cacheNames()).toEqual(expect.arrayContaining([`openeoc-precache-${precache.version}`, `openeoc-precache-${next}`]));
    await Promise.all([page.waitForEvent("load"), notice.getByRole("button", { name: "Reload" }).click()]);
    await page.getByRole("region", { name: "Offline continuity" }).waitFor();
    await page.waitForFunction("navigator.serviceWorker.controller !== null");
    expect(await notice.count()).toBe(0);
    expect((await cacheNames()).filter((name) => name.startsWith("openeoc-precache-"))).toEqual([`openeoc-precache-${next}`]);
    expect(pageErrors).toEqual([]);
  }, 120_000);
});
