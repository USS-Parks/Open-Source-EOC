import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The IPAWS operator surface end to end in a real browser: one admin
 * configures a test COG against a loopback stand-in for IPAWS-OPEN that
 * answers with the recorded acceptance, acknowledges the MOA, enables, and
 * requests a send; a second admin confirms it. Nothing leaves the machine.
 */

const DIST = buildDir("ipaws-send-app");
const SHOTS = shotDir("ipaws-send");
const ACCEPTED = readFileSync(join(process.cwd(), "server", "src", "ipaws", "__fixtures__", "postcap-accepted.xml"), "utf8");
const CREDENTIAL = "fixture-pin-never-echoed";
const HEADLINE = "Flood Warning for the Lower Klamath";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let endpoint: Server;
let endpointUrl: string;
let baseUrl: string;
let adminId: string;
let secondId: string;
let hits = 0;
let priorKey: string | undefined;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-ipaws-browser-key";
  await buildWeb(DIST);

  endpoint = createServer((req, res) => {
    hits += 1;
    req.resume();
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(ACCEPTED);
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  endpointUrl = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/IPAWS`;

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  adminId = seed.adminId;
  secondId = await createPerson(admin, { email: "second-admin@example.org", displayName: "Second Admin", password: "second-admin-password" });
  await addMembership(admin, secondId, seed.jurisdictionId, "admin");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  baseUrl = await listen(app);

  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, { templateKey: "daily_ops", name: "Synthetic flood exercise" });
  const draft = await post(app, token, `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`, {
    incidentId: incident.incidentId,
    alert: {
      sender: "oes@example.org", status: "Test", msgType: "Alert", scope: "Public", code: ["IPAWSv1.0"],
      info: [{
        language: "en-US", category: ["Met"], event: "Flood Warning", responseType: ["Prepare"],
        urgency: "Expected", severity: "Severe", certainty: "Likely", eventCode: [{ valueName: "SAME", value: "FLW" }],
        effective: "2026-09-18T12:00:00-07:00", expires: "2026-09-18T18:00:00-07:00", senderName: "Synthetic OES",
        headline: HEADLINE, description: "Synthetic test content. No public warning is sent.",
        area: [{ areaDesc: "Lower Klamath River corridor", geocode: [{ valueName: "SAME", value: "006015" }] }],
      }],
    },
  });
  expect(draft.ipawsEligible).toBe(true);

  browser = await launchBrowser({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await new Promise((resolve) => endpoint?.close(resolve));
  await runtime?.end();
  await admin?.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

async function openAlerts(email: string, password: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto(`${baseUrl}/app/index.html`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await bell.waitFor({ state: "visible", timeout: 20000 });
  await bell.click();
  await page.getByRole("button", { name: "Open center" }).click();
  await page.getByRole("heading", { name: "Alerts and notifications" }).waitFor({ state: "visible", timeout: 20000 });
  return page;
}

describe("IPAWS enablement and the two-person send", () => {
  it("configures a fixture COG, then sends only on a second admin's confirmation", async () => {
    const requester = await openAlerts("admin@example.org", "correct-horse-battery");
    const mode = requester.locator(".ipaws-mode");
    await mode.getByText("IPAWS not configured").waitFor({ state: "visible" });

    await requester.getByRole("tab", { name: "IPAWS" }).click();
    const config = requester.locator(".ipaws-config");
    await config.getByLabel("Environment").selectOption("test");
    await config.getByLabel("COG id").fill("123456");
    await config.getByLabel("IPAWS-OPEN endpoint").fill(endpointUrl);
    await config.getByLabel("COG credential").fill(CREDENTIAL);
    await config.getByRole("button", { name: "Save configuration" }).click();
    await config.getByText(/Stored credential fingerprint [0-9a-f]{12}\./).waitFor({ state: "visible", timeout: 20000 });
    expect(await config.getByLabel("COG credential").inputValue()).toBe("");
    expect(await requester.content()).not.toContain(CREDENTIAL);
    await mode.getByText("Fixture endpoint, not FEMA").waitFor({ state: "visible", timeout: 20000 });

    await config.getByLabel("MOA reference").fill("MOA-FEMA-IPAWS-2026-TEST");
    await config.getByRole("button", { name: "Acknowledge MOA" }).click();
    await config.getByText(/MOA acknowledged: MOA-FEMA-IPAWS-2026-TEST/).waitFor({ state: "visible", timeout: 20000 });
    await config.getByRole("button", { name: "Enable IPAWS" }).click();
    await config.getByRole("button", { name: "Disable IPAWS" }).waitFor({ state: "visible", timeout: 20000 });
    await mode.getByText("Enabled", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await requester.screenshot({ path: join(SHOTS, "ipaws-config-wide-light.png"), fullPage: false });

    await requester.getByRole("tab", { name: /Alert records/ }).click();
    await requester.getByRole("button", { name: new RegExp(HEADLINE) }).click();
    await requester.getByRole("button", { name: "Submit for local review" }).click();
    await requester.getByRole("button", { name: "Approve local alert" }).click();
    await requester.getByRole("button", { name: "Request IPAWS send" }).click();
    await requester.getByText(/Nothing is sent until a\s+different admin confirms it/).waitFor({ state: "visible", timeout: 20000 });
    expect(hits).toBe(0);

    await requester.getByRole("tab", { name: "IPAWS" }).click();
    const own = requester.locator(".ipaws-send-list > li").first();
    await own.getByText("Awaiting a second admin").waitFor({ state: "visible", timeout: 20000 });
    expect(await own.getByRole("button", { name: "Confirm send" }).isDisabled()).toBe(true);
    await own.getByText("You requested this send, so a different admin must confirm it.").waitFor({ state: "visible" });
    await requester.screenshot({ path: join(SHOTS, "ipaws-requested-wide-light.png"), fullPage: false });

    const confirmer = await openAlerts("second-admin@example.org", "second-admin-password");
    await confirmer.getByRole("tab", { name: "IPAWS" }).click();
    const pending = confirmer.locator(".ipaws-send-list > li").first();
    await pending.getByText(HEADLINE).waitFor({ state: "visible", timeout: 20000 });
    await pending.getByText(/^Admin ·/).waitFor({ state: "visible", timeout: 20000 });
    expect(await pending.locator(".ipaws-countdown").textContent()).toMatch(/^1?\d:\d\d$/);
    expect(hits).toBe(0);
    await pending.getByRole("button", { name: "Confirm send" }).click();
    await confirmer.getByText(/^IPAWS-OPEN accepted the alert/).waitFor({ state: "visible", timeout: 20000 });
    await pending.getByText("Accepted by IPAWS-OPEN").waitFor({ state: "visible", timeout: 20000 });
    expect(hits).toBe(1);
    await confirmer.screenshot({ path: join(SHOTS, "ipaws-confirmed-wide-light.png"), fullPage: false });

    const trail = await admin`
      select category, person_id, payload from audit_events
      where category in ('ipaws.send.requested', 'ipaws.send.confirmed', 'ipaws.submitted') order by seq`;
    expect(trail.map((event) => [event.category, event.person_id])).toEqual([
      ["ipaws.send.requested", adminId],
      ["ipaws.send.confirmed", secondId],
      ["ipaws.submitted", secondId],
    ]);
    expect(trail[1]!.payload).toMatchObject({ requestedBy: adminId, confirmedBy: secondId });
    expect(trail[2]!.payload).toMatchObject({ accepted: true, environment: "test", requestedBy: adminId });

    // The requester's list picks up the outcome on its next poll.
    await own.getByText("Accepted by IPAWS-OPEN").waitFor({ state: "visible", timeout: 20000 });
    await own.getByText(/^Second Admin ·/).waitFor({ state: "visible", timeout: 20000 });
    await requester.setViewportSize({ width: 390, height: 844 });
    await requester.screenshot({ path: join(SHOTS, "ipaws-narrow-light.png"), fullPage: false });
    await requester.setViewportSize({ width: 1440, height: 900 });
    await requester.getByRole("button", { name: "Account menu" }).click();
    await requester.getByRole("button", { name: "Use dark theme" }).click();
    await requester.getByRole("button", { name: "Account menu" }).click();
    await requester.screenshot({ path: join(SHOTS, "ipaws-wide-dark.png"), fullPage: false });
    await requester.setViewportSize({ width: 390, height: 844 });
    await requester.screenshot({ path: join(SHOTS, "ipaws-narrow-dark.png"), fullPage: false });
    const contained = await requester.evaluate("(() => { const node = document.querySelector('.notification-workspace'); return !!node && node.scrollWidth <= node.clientWidth; })()");
    expect(contained).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 180000);
});
