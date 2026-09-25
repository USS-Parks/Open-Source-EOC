import { join } from "node:path";
import type { Server } from "node:net";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson } from "../auth/service.js";
import { fixtureMessages } from "../notify/channels.js";
import { runDueCalldowns } from "../notify/mass.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type SeedResult, type Sql } from "./helpers.js";
import { bodyOf, fakeRelay, type SmtpSession } from "./smtp-relay.js";

const DIST = buildDir("mass-notification-app");
const SHOTS = shotDir("mass-notification");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let browser: Browser;
let page: Page;
let baseUrl: string;
let relay: Server;
let sessions: SmtpSession[];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  const fake = await fakeRelay({});
  ({ server: relay, sessions } = fake);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);
  // The channels themselves are configured on the Channels tab, walked by its own browser test.
  const token = await login(app);
  const email = await app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/email`,
    headers: auth(token),
    payload: { settings: { host: "127.0.0.1", port: fake.port, security: "none", from: "eoc@example.org" } },
  });
  expect(email.statusCode).toBe(200);
  const sms = await app.inject({
    method: "PUT",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-channels/sms`,
    headers: auth(token),
    payload: { settings: { provider: "fixture" } },
  });
  expect(sms.statusCode).toBe(200);
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

async function drain(): Promise<void> {
  await new DeliveryWorker(runtime, { timeoutMs: 3000 }).drain();
}

async function addContact(name: string, email: string, phone: string): Promise<void> {
  await page.getByRole("button", { name: "Add contact" }).click();
  const form = page.getByRole("region", { name: "Add a contact" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Email addresses").fill(email);
  await form.getByLabel("Phone numbers").fill(phone);
  await form.getByRole("button", { name: "Save contact" }).click();
  await page.getByText(`${name} saved.`).waitFor();
}

describe("contacts and mass notification screens", () => {
  it("builds a call-down group, pages it by email and SMS, escalates, and takes an acknowledgement by link", async () => {
    await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
    await page.getByLabel("Email").fill("admin@example.org");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Account menu" }).waitFor();

    // The directory and a group in call-down order.
    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    await addContact("Avery First", "avery@example.org", "+1 (707) 555-0101");
    await addContact("Bailey Second", "bailey@example.org", "+17075550102");
    await addContact("Cameron Third", "cameron@example.org", "+17075550103");
    await page.getByRole("listitem", { name: "Contact Avery First" }).getByText("+17075550101").waitFor();
    await page.getByRole("button", { name: "New group" }).click();
    const editor = page.getByRole("region", { name: "New group" });
    await editor.getByLabel("Group name").fill("Duty officers");
    for (let i = 0; i < 3; i += 1) await editor.getByRole("button", { name: "Add to group" }).click();
    await editor.getByRole("button", { name: "Save group" }).click();
    await page.getByText("Group Duty officers saved.").waitFor();
    const group = page.getByRole("listitem", { name: "Group Duty officers" });
    expect(await group.locator("ol li").allTextContents()).toEqual(["Avery First", "Bailey Second", "Cameron Third"]);
    await page.screenshot({ path: join(SHOTS, "contacts-light-1440.png"), fullPage: false });

    // A call-down by email and SMS, ten minutes per contact.
    await page.getByRole("button", { name: "Mass Notification", exact: true }).click();
    await page.getByLabel("Subject").fill("Page the duty officer");
    await page.getByLabel("Message", { exact: true }).fill("Levee seepage at mile 4. Call the EOC.");
    await page.getByRole("checkbox", { name: "Duty officers (3)" }).check();
    await page.getByLabel("Mode").selectOption("calldown");
    await page.getByLabel("Minutes to wait for each acknowledgement").fill("10");
    await page.getByRole("button", { name: "Send notification" }).click();
    await page.getByText("Page the duty officer sent.").waitFor();
    const receipts = page.getByRole("region", { name: "Receipts: Page the duty officer" });
    await receipts.getByText(/Calling down · contact 1 of 3/).waitFor();

    // The worker sends; the receipts show what the relay and the fixture provider answered.
    await drain();
    await receipts.getByRole("button", { name: "Refresh receipts" }).click();
    const avery = receipts.getByRole("listitem", { name: "Receipt for Avery First" });
    await avery.getByText(/250 2\.0\.0 Ok: queued as/).waitFor();
    await avery.getByText("fixture: not sent").waitFor();
    await avery.getByText("Not acknowledged").waitFor();
    await receipts.getByRole("listitem", { name: "Receipt for Bailey Second" }).getByText("Not called").waitFor();

    // Avery does not acknowledge within ten minutes: the scheduler's job calls Bailey.
    const actor = await principalForPerson(runtime, seed.adminId);
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, new Date(Date.now() + 11 * 60_000))).toBe(1);
    await drain();
    await receipts.getByRole("button", { name: "Refresh receipts" }).click();
    await receipts.getByText(/Calling down · contact 2 of 3/).waitFor();
    const bailey = receipts.getByRole("listitem", { name: "Receipt for Bailey Second" });
    await bailey.getByText(/250 2\.0\.0 Ok: queued as/).waitFor();
    expect(fixtureMessages(seed.jurisdictionId).map((m) => m.to).sort()).toEqual(["+17075550101", "+17075550102"]);

    // Bailey opens the link from the email on another device and acknowledges.
    const mail = sessions.find((s) => s.commands.includes("RCPT TO:<bailey@example.org>"))!;
    const link = /http:\/\/\S+\/api\/v1\/ack\/[A-Za-z0-9_-]{22}/.exec(bodyOf(mail.data))![0];
    expect(link.startsWith(`${baseUrl}/api/v1/ack/`)).toBe(true);
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(link, { waitUntil: "load" });
    await phone.getByRole("heading", { name: "Acknowledge this message" }).waitFor();
    await phone.getByRole("button", { name: "Acknowledge" }).click();
    await phone.getByRole("heading", { name: "Acknowledged" }).waitFor();
    await phone.screenshot({ path: join(SHOTS, "acknowledged-link-390.png"), fullPage: false });
    await phone.close();

    // The call-down stops at the acknowledgement; Cameron is never called.
    expect(await runDueCalldowns(runtime, actor, seed.jurisdictionId, new Date(Date.now() + 12 * 60_000))).toBe(0);
    await receipts.getByRole("button", { name: "Refresh receipts" }).click();
    await receipts.getByText(/Acknowledged · 1 of 3 acknowledged/).waitFor();
    await page.getByRole("listitem", { name: "Send Page the duty officer" }).getByText(/Acknowledged · 1 of 3 acknowledged/).waitFor();
    await bailey.getByText(/Acknowledged by link/).waitFor();
    await receipts.getByRole("listitem", { name: "Receipt for Cameron Third" }).getByText("Not called").waitFor();
    await receipts.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "mass-notification-receipts-light-1440.png"), fullPage: false });
    const [recipient] = await admin`
      select notified_at from mass_notification_recipients where name = 'Cameron Third'`;
    expect(recipient!.notified_at).toBeNull();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Send notification" }).waitFor();
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
    await page.screenshot({ path: join(SHOTS, "mass-notification-dark-390.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 240_000);
});
