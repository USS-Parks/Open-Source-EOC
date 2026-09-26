import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";

/**
 * Service identities on screen (VC-25), at the frames' 1586 by 992 and at
 * 1534 by 790: an administrator creates an identity, copies its token once,
 * sees the integration's use of it on the list, and revokes it, after which
 * the token is refused. The API description downloads from the same panel.
 */

const DIST = buildDir("service-identities");
const SHOTS = shotDir("service-identities");
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
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function signIn(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

/** What an integration does with its token: read this jurisdiction's roster. */
function integrationRead(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/jurisdictions/${seed.jurisdictionId}/volunteers`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("service identities on screen", () => {
  for (const viewport of VIEWPORTS) {
    it(`creates an identity, copies its token once, sees it used and revokes it, at ${viewport.width} by ${viewport.height}`, async () => {
      const name = `CAD bridge ${viewport.width}`;
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await signIn(page);
      await page.getByRole("button", { name: "Administration", exact: true }).click();
      await page.getByRole("tab", { name: "Service identities" }).click();

      // Create it, read and write.
      const form = page.getByRole("region", { name: "Create a service identity" });
      await form.getByLabel("Name").fill(name);
      await form.getByLabel("Access").selectOption({ label: "Read and write" });
      await form.getByRole("button", { name: "Create identity" }).click();
      const tokenField = page.getByLabel(`Token for ${name}`);
      await tokenField.waitFor();
      const token = await tokenField.inputValue();
      expect(token).toMatch(/^oeoc-svc\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
      await page.screenshot({ path: join(SHOTS, `token-${viewport.width}.png`), fullPage: false });
      await page.getByRole("button", { name: "Copy token" }).click();
      await page.getByText("Token copied.").waitFor();
      expect(await page.evaluate("navigator.clipboard.readText()")).toBe(token);
      await page.getByRole("button", { name: "I have stored the token" }).click();
      await tokenField.waitFor({ state: "detached" });
      expect(await page.content()).not.toContain(token);

      // The integration uses it; the list shows the use once refreshed.
      const row = page.getByRole("listitem", { name: `Service identity ${name}` });
      await row.getByText("Never").waitFor();
      expect((await integrationRead(token)).status).toBe(200);
      await page.getByRole("button", { name: "Refresh" }).click();
      await row.getByText("Never").waitFor({ state: "detached" });
      await row.getByText("Read and write in this jurisdiction").waitFor();
      await page.screenshot({ path: join(SHOTS, `used-${viewport.width}.png`), fullPage: false });

      // The API description downloads from the same panel.
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        form.getByRole("button", { name: "Download the API description" }).click(),
      ]);
      expect(download.suggestedFilename()).toBe("openeoc-openapi.json");
      const described = JSON.parse(readFileSync((await download.path())!, "utf8")) as { openapi: string; paths: Record<string, unknown> };
      expect(described.openapi).toBe("3.1.0");
      expect(described.paths["/api/v1/jurisdictions/{jurisdictionId}/service-identities"]).toBeDefined();

      // Revoke it; its next request is refused.
      await row.getByRole("button", { name: `Revoke ${name}` }).click();
      await row.getByRole("button", { name: `Confirm revoking ${name}` }).click();
      await page.getByText(`${name} revoked. Its next request is refused.`).waitFor();
      await row.getByText("Revoked", { exact: true }).waitFor();
      await page.screenshot({ path: join(SHOTS, `revoked-${viewport.width}.png`), fullPage: false });
      const refused = await integrationRead(token);
      expect(refused.status).toBe(401);
      expect(((await refused.json()) as { error: string }).error).toBe("this service identity was revoked");

      // The page fits its width: nothing scrolls sideways.
      expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
      await context.close();
    });
  }

  it("raised no page errors and reached nothing outside the server", () => {
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
});
