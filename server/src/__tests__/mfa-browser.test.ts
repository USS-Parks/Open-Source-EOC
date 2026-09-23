import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { hotp, totpStep } from "../auth/totp.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("mfa-app");
const SHOTS = shotDir("mfa");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let priorKey: string | undefined;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-mfa-browser-key";
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null, requireAdminMfa: true });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

async function signIn(): Promise<void> {
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
}

describe("real-browser two-step sign-in", () => {
  it("enrolls an admin, shows recovery codes once, then signs in again with a code", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await signIn();
    await page.getByRole("heading", { name: "Set up two-step sign-in" }).waitFor();
    const key = page.getByLabel("Setup key");
    await key.waitFor();
    const secret = ((await key.textContent()) ?? "").replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(await page.getByRole("link", { name: /^otpauth:\/\/totp\// }).getAttribute("href")).toContain(`secret=${secret}`);
    await page.screenshot({ path: join(SHOTS, "mfa-enroll.png"), fullPage: false });

    const step = totpStep();
    await page.getByLabel("Authenticator code").fill(hotp(secret, step));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByRole("heading", { name: "Save your recovery codes" }).waitFor();
    const codes = await page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allTextContents();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    await page.screenshot({ path: join(SHOTS, "mfa-recovery-codes.png"), fullPage: false });
    await page.getByRole("button", { name: "I have stored these codes" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn();
    await page.getByRole("heading", { name: "Two-step sign-in" }).waitFor();
    await page.getByLabel("Authenticator or recovery code").fill(hotp(secret, step));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByRole("alert").getByText("invalid verification code").waitFor();
    await page.getByLabel("Authenticator or recovery code").fill(hotp(secret, step + 1));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
