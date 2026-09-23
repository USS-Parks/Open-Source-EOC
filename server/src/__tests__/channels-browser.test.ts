import { join } from "node:path";
import type { Server } from "node:net";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildDir, buildWeb, launchBrowser, listen, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";
import { bodyOf, fakeRelay, type SmtpSession } from "./smtp-relay.js";

const DIST = buildDir("channels-app");
const SHOTS = shotDir("channels");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let relay: Server;
let relayPort: number;
let sessions: SmtpSession[];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  ({ server: relay, port: relayPort, sessions } = await fakeRelay({}));
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  browser = await launchBrowser();
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
  relay?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("notification channels screen", () => {
  it("configures an SMTP relay and the SMS fixture and sends a test on each", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    await page.getByRole("tab", { name: "Channels" }).click();

    // Email through a relay on this machine.
    await page.getByLabel("Relay host").fill("127.0.0.1");
    await page.getByLabel("Relay port").fill(String(relayPort));
    await page.getByLabel("Connection security").selectOption("none");
    await page.getByLabel("From address").fill("eoc@example.org");
    await page.getByRole("button", { name: "Save email settings" }).click();
    await page.getByText("Email settings saved.").waitFor();
    await page.getByLabel("Test email recipient").fill("duty@example.org");
    await page.getByRole("button", { name: "Send test email" }).click();
    await page.getByText(/Test message to duty@example\.org delivered: 250 2\.0\.0 Ok: queued as Q1/).waitFor();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.commands).toContain("RCPT TO:<duty@example.org>");
    expect(sessions[0]!.data).toContain("Subject: OpenEOC test message");
    expect(bodyOf(sessions[0]!.data)).toContain("The channel is working.");
    await page.screenshot({ path: join(SHOTS, "channels-email-light-1440.png"), fullPage: false });

    // SMS through the fixture provider: recorded, never sent.
    const sms = page.getByRole("region", { name: "SMS", exact: true });
    await sms.getByLabel("SMS provider").selectOption("fixture");
    await sms.getByRole("button", { name: "Save SMS settings" }).click();
    await sms.getByText("SMS settings saved.").waitFor();
    await sms.getByLabel("Test phone number").fill("+17075550100");
    await sms.getByRole("button", { name: "Send test SMS" }).click();
    await sms.getByText(/recorded by the fixture provider \(fixture: not sent\)/).waitFor();
    const recorded = sms.getByRole("listitem", { name: "Fixture message to +17075550100" });
    await recorded.getByText("fixture: not sent").waitFor();
    await recorded.getByText("The channel is working.", { exact: false }).waitFor();
    await sms.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "channels-sms-light-1440.png"), fullPage: false });

    const tests = await admin`
      select payload ->> 'kind' as kind from audit_events
      where category = 'notification.channel_tested' order by seq`;
    expect(tests.map((t) => t.kind)).toEqual(["email", "sms"]);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Save email settings" }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "channels-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);
});
