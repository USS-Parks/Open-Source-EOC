import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { buildDir, buildWeb, launchBrowser, listen, login, post, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * The JIC and resource follow-through in a real browser. A release drafted
 * from a frozen SITREP is submitted, approved and published, and a media
 * inquiry is logged, assigned and answered with it. A second administrator,
 * signed in separately, finds a release waiting on them and approves it.
 * A resource request gets a
 * reimbursement cost and its CSV export, then escalates to a second running
 * instance over a peer token; that tier's status reports come back over its
 * own token and show in the originating request's history.
 */

const DIST = buildDir("jic-resources-app");
const SHOTS = shotDir("jic-resources");
const RELEASE_TITLE = "Klamath Bridge Closure public information update";
const SECOND_TITLE = "Sandbag distribution";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let stateAdmin: Sql;
let stateRuntime: Sql;
let stateApp: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let stateBaseUrl: string;
let jurisdictionId: string;
let incidentId: string;
let positionId: string;
let requestId: string;
let tokenIntoState: string;
let tokenIntoCounty: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  await buildWeb(DIST);
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  serveStatic(app, "/app", DIST);
  const token = await login(app);
  const incident = await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "daily_ops", name: "Klamath Bridge Closure", kind: "incident",
  });
  incidentId = incident.incidentId as string;
  await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/sitreps`, { incidentId, period: "OP 1" });
  positionId = (await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/positions`, {
    key: "jic_pio", title: "Public Information Officer",
  })).id as string;
  requestId = (await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`, {
    origin: "field", item: "Swiftwater rescue team", quantity: 1, priority: "immediate", incidentId,
  })).id as string;
  for (const toState of ["accepted", "sourcing"]) {
    await post(app, token, `/api/v1/resource-requests/${requestId}/transition`, { toState }, 200);
  }

  // The higher tier is a second instance with its own database. Each side
  // registers the other and so issues the token the other presents.
  ({ admin: stateAdmin, runtime: stateRuntime } = await freshDb());
  const stateSeed = await seedIdentity(stateAdmin);
  stateApp = buildApp(stateRuntime, { oidc: null });
  stateBaseUrl = await listen(stateApp);
  const stateToken = await login(stateApp);
  tokenIntoState = (await post(stateApp, stateToken, `/api/v1/jurisdictions/${stateSeed.jurisdictionId}/peers`, { name: "county" })).token as string;
  tokenIntoCounty = (await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/peers`, { name: "state" })).token as string;

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
  await page.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await page.getByLabel("Email").fill("admin@example.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Selected incident").selectOption(incidentId);
}, 180_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  for (const [server, pool, root] of [[app, runtime, admin], [stateApp, stateRuntime, stateAdmin]] as const) {
    await server?.close();
    await pool?.end();
    await root?.end();
  }
});

function posted(path: string) {
  return page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(path));
}

describe("real-browser JIC and resource follow-through", () => {
  it("approves and publishes a release, then answers a logged media inquiry with it", async () => {
    await page.getByRole("button", { name: "JIC", exact: true }).click();
    await page.getByRole("heading", { name: "JIC preparation" }).waitFor();
    await page.getByRole("button", { name: /OP 1/ }).click();
    const jic = page.getByRole("complementary", { name: "JIC draft" });
    await jic.getByLabel("Draft statement").fill("The Klamath bridge is closed. Use the signed detour through Weitchpec.");
    await jic.getByLabel("Required reviewing agencies").fill("County PIO");
    await jic.getByRole("button", { name: "Save JIC draft" }).click();
    await jic.getByText(/saved, not published/).waitFor();
    await jic.getByRole("button", { name: "Submit for review" }).click();
    await jic.getByText(/submitted for review/).waitFor();

    await jic.getByLabel("Decision note").fill("Cleared by the county PIO");
    const decided = posted("/decisions");
    await jic.getByRole("button", { name: "Approve for County PIO" }).click();
    expect((await decided).status()).toBe(200);
    await jic.getByText("Approved", { exact: true }).waitFor();

    const inquiries = jic.getByRole("region", { name: "Media inquiries" });
    await inquiries.getByLabel("Media outlet").fill("KHSU Radio");
    await inquiries.getByLabel("Inquiry subject").fill("Detour length");
    await inquiries.getByLabel("Question").fill("How long is the signed detour?");
    const logged = posted("/jic/inquiries");
    await inquiries.getByRole("button", { name: "Log inquiry" }).click();
    expect((await logged).status()).toBe(201);
    await inquiries.getByLabel("Assign to position: Detour length").selectOption(positionId);
    const assigned = posted("/assign");
    await inquiries.getByRole("button", { name: "Assign", exact: true }).click();
    expect((await assigned).status()).toBe(200);
    await inquiries.getByText(/· Public Information Officer/).waitFor();

    const published = posted("/publish");
    await jic.getByRole("button", { name: "Publish release" }).click();
    expect((await published).status()).toBe(200);
    await jic.getByText("Published to the public information feed").waitFor();
    await jic.getByRole("region", { name: "Public information feed" }).getByText(RELEASE_TITLE).waitFor();

    const answered = posted("/answer");
    await inquiries.getByRole("button", { name: "Answer with approved release" }).click();
    expect((await answered).status()).toBe(200);
    await inquiries.getByText("Answered", { exact: true }).waitFor();

    const [release] = await admin`select id, status from press_releases where incident_id = ${incidentId}`;
    expect(release).toMatchObject({ status: "published" });
    const approvals = await admin`
      select agency, decision, note, decided_by_person from press_release_approvals where release_id = ${release!.id}`;
    expect(approvals).toEqual([expect.objectContaining({ agency: "County PIO", decision: "approve", note: "Cleared by the county PIO" })]);
    expect(approvals[0]!.decided_by_person).not.toBeNull();
    expect((await admin`select title from public_messages`).map((row) => row.title)).toEqual([RELEASE_TITLE]);
    const [inquiry] = await admin`select status, assigned_position, response_release_id from media_inquiries`;
    expect(inquiry).toMatchObject({ status: "answered", assigned_position: positionId, response_release_id: release!.id });

    await jic.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "jic-light-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    expect(await page.evaluate(`(() => { const element = document.querySelector('.eoc-jic-preparation');
      return element !== null && element.scrollWidth <= element.clientWidth; })()`)).toBe(true);
    await inquiries.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "jic-light-390.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }, 120_000);

  it("lets a second administrator find a release waiting on them and approve it from their own session", async () => {
    // The first administrator drafts, submits and approves for their agency elsewhere.
    const token = await login(app);
    const releaseId = (await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, {
      incidentId, title: SECOND_TITLE, body: "Sandbags are available at the Weitchpec fire hall.",
      requiredAgencies: ["County PIO", "Public Health"],
    })).id as string;
    await post(app, token, `/api/v1/jic/releases/${releaseId}/submit`, {}, 200);
    await post(app, token, `/api/v1/jic/releases/${releaseId}/decisions`, { agency: "County PIO", decision: "approve" }, 200);
    await post(app, token, `/api/v1/jurisdictions/${jurisdictionId}/jic/inquiries`, {
      outlet: "Times-Standard", subject: "Sandbag supply", question: "Where can residents get sandbags?", incidentId,
    });
    const secondId = await createPerson(admin, {
      email: "second.pio@example.org", displayName: "Second PIO", password: "second-approver-password",
    });
    await addMembership(admin, secondId, jurisdictionId, "admin");

    // A new browser context is a separate session with its own sign-in.
    const second = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      second.on("pageerror", (error) => pageErrors.push(error.message));
      await second.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
        externalRequests.push(url);
        return route.abort();
      });
      await second.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
      await second.getByLabel("Email").fill("second.pio@example.org");
      await second.getByLabel("Password").fill("second-approver-password");
      await second.getByRole("button", { name: "Sign in" }).click();
      await second.getByLabel("Selected incident").selectOption(incidentId);
      await second.getByRole("button", { name: "JIC", exact: true }).click();
      await second.getByRole("heading", { name: "JIC preparation" }).waitFor();
      await second.getByRole("button", { name: /OP 1/ }).click();
      const jic = second.getByRole("complementary", { name: "JIC draft" });
      const waiting = jic.getByRole("region", { name: "Waiting for review" }).getByRole("listitem").filter({ hasText: SECOND_TITLE });
      await waiting.getByText("Awaiting Public Health").waitFor();
      await jic.getByRole("region", { name: "Media inquiries" }).getByText(/Sandbag supply/).waitFor();
      await waiting.getByRole("button", { name: "Review" }).click();

      const review = jic.getByRole("region", { name: `Review: ${SECOND_TITLE}` });
      await review.getByText("Already approved").waitFor();
      const decided = second.waitForResponse((response) =>
        response.request().method() === "POST" && response.url().endsWith(`/jic/releases/${releaseId}/decisions`));
      await review.getByRole("button", { name: "Approve for Public Health" }).click();
      expect((await decided).status()).toBe(200);
      await review.getByText("Approved", { exact: true }).waitFor();
      await jic.getByText("No release on this incident is waiting on your decision.").waitFor();
      await review.scrollIntoViewIfNeeded();
      await second.screenshot({ path: join(SHOTS, "jic-second-approver-light-1440.png"), fullPage: false });
    } finally {
      await second.close();
    }

    const [release] = await admin`select status from press_releases where id = ${releaseId}`;
    expect(release).toEqual({ status: "approved" });
    const approvals = await admin`
      select agency, decided_by_person from press_release_approvals where release_id = ${releaseId} order by agency`;
    expect(approvals.map((row) => row.agency)).toEqual(["County PIO", "Public Health"]);
    expect(approvals[1]!.decided_by_person).toBe(secondId);
    expect(approvals[0]!.decided_by_person).not.toBe(secondId);
  }, 120_000);

  it("records and exports a cost, escalates to a peer tier, and shows the tier's reports", async () => {
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Resource coordination" }).waitFor();
    await page.getByRole("listitem").filter({ hasText: "Swiftwater rescue team" }).getByRole("button", { name: /^Open REQ-/ }).click();
    const costs = page.getByRole("region", { name: "Reimbursement costs" });
    await costs.getByLabel("Cost category").fill("equipment");
    await costs.getByLabel("Amount (USD)").fill("5,400.00");
    await costs.getByLabel("Cost description").fill("Boat and trailer, 72 hours");
    await costs.getByLabel("Incurred on").fill("2026-09-22");
    const costed = posted("/costs");
    await costs.getByRole("button", { name: "Record cost" }).click();
    expect((await costed).status()).toBe(201);
    await page.getByText("Cost recorded: equipment, $5400.00.").waitFor();
    const download = page.waitForEvent("download");
    await costs.getByRole("button", { name: "Export costs (CSV)" }).click();
    const csv = readFileSync((await (await download).path())!, "utf8");
    expect(csv).toContain("Swiftwater rescue team,equipment,\"Boat and trailer, 72 hours\",5400.00,2026-09-22");
    expect(csv).toContain("TOTAL,5400.00");

    const escalation = page.getByRole("region", { name: "Escalate to another tier" });
    await escalation.getByLabel("Peer name").fill("state");
    await escalation.getByLabel("Peer address").fill(stateBaseUrl);
    await escalation.getByLabel("Peer token").fill("not-the-issued-token");
    const refused = posted("/escalate");
    await escalation.getByRole("button", { name: "Escalate request" }).click();
    expect((await refused).status()).toBe(502);
    await page.getByRole("alert").filter({ hasText: "escalation delivery failed" }).waitFor();
    await escalation.getByLabel("Peer token").fill(tokenIntoState);
    const escalated = posted("/escalate");
    await escalation.getByRole("button", { name: "Escalate request" }).click();
    expect((await escalated).status()).toBe(200);
    await page.getByText(/Escalated to state\./).waitFor();
    await page.getByText("escalated to state", { exact: true }).waitFor();
    const received = await stateAdmin`
      select item, state, source_peer from resource_requests where source_request_id = ${requestId}`;
    expect(received).toEqual([{ item: "Swiftwater rescue team", state: "submitted", source_peer: "county" }]);

    // The state tier reports its fulfillment back down over the token county issued it.
    for (const [toState, note] of [["assigned", "State swiftwater team 4 assigned"], ["deployed", "State swiftwater team 4 on scene"]]) {
      const report = await fetch(`${baseUrl}/api/v1/resource-requests/report`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-peer-token": tokenIntoCounty },
        body: JSON.stringify({ sourceRequestId: requestId, toState, note }),
      });
      expect(report.status).toBe(200);
    }
    await page.reload({ waitUntil: "load" });
    await page.getByText("state reported deployed: State swiftwater team 4 on scene").waitFor();
    await page.getByText("state reported assigned: State swiftwater team 4 assigned").waitFor();
    await page.getByRole("listitem").filter({ hasText: "Swiftwater rescue team" }).getByText("In progress", { exact: true }).waitFor();
    await page.getByRole("region", { name: /^REQ-\d+ Swiftwater rescue team$/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resources-light-1440.png"), fullPage: false });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("region", { name: "Reimbursement costs" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resources-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    expect(await page.evaluate(`(() => { const element = document.querySelector('[aria-label="Swiftwater rescue team: costs and mutual aid"]');
      return element !== null && element.scrollWidth <= element.clientWidth; })()`)).toBe(true);
    await page.getByRole("region", { name: "Escalate to another tier" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "resources-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
