import { join } from "node:path";
import type { Server } from "node:net";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { fixtureMessages } from "../notify/channels.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";
import { fakeRelay } from "./smtp-relay.js";

/**
 * VA7 in a real browser: an administrator activates an incident with a notice
 * to a contact group and whoever is on call as Duty Officer, SMS first and
 * email five minutes later, then follows the notice on Mass Notification: who
 * was reached and how, the email waiting its turn, and the email withdrawn
 * once the text is acknowledged.
 */

const DIST = buildDir("activation-notice-app");
const SHOTS = shotDir("activation-notice");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let browser: Browser;
let page: Page;
let baseUrl: string;
let relay: Server;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function created(token: string, url: string, payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({ method: "POST", url, headers: auth(token), payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  const dutyId = await createPerson(admin, { email: "duty@example.org", displayName: "Dana Duty", password: "duty-password-12" });
  await addMembership(admin, dutyId, seed.jurisdictionId, "member");
  const fake = await fakeRelay({});
  relay = fake.server;
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  const token = await login(app);
  const j = `/api/v1/jurisdictions/${seed.jurisdictionId}`;
  for (const [kind, settings] of [
    ["email", { host: "127.0.0.1", port: fake.port, security: "none", from: "eoc@example.org" }],
    ["sms", { provider: "fixture" }],
  ] as const) {
    const res = await app.inject({ method: "PUT", url: `${j}/notification-channels/${kind}`, headers: auth(token), payload: { settings } });
    expect(res.statusCode).toBe(200);
  }
  const avery = await created(token, `${j}/contacts`, { name: "Avery Able", emails: ["avery@example.org"], phones: ["+17075550301"] });
  const blair = await created(token, `${j}/contacts`, { name: "Blair Baker", emails: ["blair@example.org"], phones: ["+17075550302"] });
  await created(token, `${j}/contact-groups`, { name: "Duty officers", contactIds: [avery, blair] });
  const position = await created(token, `${j}/positions`, { key: "duty_officer_x", title: "Duty Officer" });
  const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  await created(token, `${j}/shifts`, { positionId: position, personId: dutyId, startsAt: hours(-1), endsAt: hours(8) });

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
  relay?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("activation that notifies", () => {
  it("activates with a notice to a group and the person on call, and follows the fallback on its receipts", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Incident Setup", exact: true }).click();
    await page.getByLabel("Incident name").fill("Bluff Creek Fire");
    await page.getByLabel("Notify people when it activates").check();
    const notice = page.getByRole("group", { name: "Activation notice" });
    await notice.getByLabel("Duty officers (2)").check();
    await notice.getByLabel("On call: Duty Officer").check();
    await notice.getByLabel("If someone does not acknowledge, try their next device").check();
    await notice.getByLabel("Minutes to wait before the next device").fill("5");
    expect(await notice.getByLabel("Order").inputValue()).toBe("sms");
    // In the app by default, since a person on shift may have no contact card.
    expect(await notice.getByLabel("In app").isChecked()).toBe(true);
    await notice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "activation-notice-1586.png"), fullPage: false });

    const activated = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/jurisdictions/${seed.jurisdictionId}/incidents`));
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    const response = await activated;
    expect(response.status()).toBe(201);
    expect((await response.json()).notice).toMatchObject({ recipients: 3 });

    await page.getByRole("button", { name: "Mass Notification", exact: true }).click();
    const sent = page.getByRole("listitem", { name: "Send Activated: Bluff Creek Fire" });
    await sent.getByText(/Duty officers, On call: Duty Officer/).waitFor();
    await sent.getByRole("button", { name: "Show receipts" }).click();
    const receipts = page.getByRole("region", { name: "Receipts: Activated: Bluff Creek Fire" });
    await receipts.getByText("Everyone at once; the next device after 5 min without an acknowledgement").waitFor();
    const avery = receipts.getByRole("listitem", { name: "Receipt for Avery Able" });
    await avery.getByText("Group: Duty officers").waitFor();
    await avery.getByText("Falls back if not acknowledged").waitFor();
    await avery.getByText(/^Goes at /).waitFor();
    const dana = receipts.getByRole("listitem", { name: "Receipt for Dana Duty" });
    await dana.getByText("On shift as Duty Officer").waitFor();
    await dana.getByText("Delivered").waitFor();

    // The texts go now; Avery answers one, and the email waiting for Avery is withdrawn.
    await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
    const text = fixtureMessages(seed.jurisdictionId).find((m) => m.to === "+17075550301")!;
    const token = /\/api\/v1\/ack\/([A-Za-z0-9_-]{22})/.exec(text.body)![1]!;
    const ack = await app.inject({ method: "POST", url: `/api/v1/ack/${token}`, headers: { "content-type": "text/plain" }, payload: "" });
    expect(ack.statusCode).toBe(200);
    await receipts.getByRole("button", { name: "Refresh receipts" }).click();
    await avery.getByText("Not needed: acknowledged before the fallback").waitFor();
    await receipts.getByRole("listitem", { name: "Receipt for Blair Baker" }).getByText("Falls back if not acknowledged").waitFor();
    await receipts.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "activation-notice-receipts-1586.png"), fullPage: false });

    await page.setViewportSize({ width: 1534, height: 790 });
    await page.screenshot({ path: join(SHOTS, "activation-notice-receipts-1534.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180_000);

  it("asks the duty officers a question with three answers and counts the answers (VA8)", async () => {
    await page.setViewportSize({ width: 1586, height: 992 });
    await page.getByLabel("Subject").fill("Night shift");
    await page.getByLabel("Message", { exact: true }).fill("Can you cover the night shift?");
    await page.getByLabel("Answers to ask for (optional), one per line, up to six").fill("Available\nNot available\nAvailable after 2200");
    await page.getByRole("checkbox", { name: "Duty officers (2)" }).check();
    await page.getByRole("button", { name: "Send notification" }).click();
    const receipts = page.getByRole("region", { name: "Receipts: Night shift" });
    await receipts.waitFor();

    // Blair answers on a phone from the text's link.
    await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
    const text = fixtureMessages(seed.jurisdictionId).find((m) => m.to === "+17075550302" && m.body.includes("Night shift"))!;
    expect(text.body).toContain("Answer Available, Not available or Available after 2200:");
    const link = /http:\/\/\S+\/api\/v1\/ack\/[A-Za-z0-9_-]{22}/.exec(text.body)![0];
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(link, { waitUntil: "load" });
    await phone.getByRole("heading", { name: "Answer this message" }).waitFor();
    await phone.screenshot({ path: join(SHOTS, "answer-link-390.png"), fullPage: false });
    await phone.getByRole("button", { name: "Available after 2200" }).click();
    await phone.getByText("Your answer, Available after 2200, is recorded.").waitFor();
    await phone.close();

    await receipts.getByRole("button", { name: "Refresh receipts" }).click();
    const answers = receipts.getByRole("definition").filter({ hasText: /^\d+$/ });
    await receipts.getByRole("listitem", { name: "Receipt for Blair Baker" }).getByText(/Answered Available after 2200 by link/).waitFor();
    expect(await answers.allTextContents()).toEqual(["0", "0", "1", "1"]);
    await receipts.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "answer-receipts-1586.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
