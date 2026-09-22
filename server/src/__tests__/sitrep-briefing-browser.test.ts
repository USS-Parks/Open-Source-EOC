import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, buildDir, buildWeb, launchBrowser, listen, login, serveStatic, shotDir } from "./browser.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const DIST = buildDir("d26-sitrep-app");
const SHOTS = shotDir("d26-sitrep");

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let browser: Browser;
let page: Page;
let baseUrl: string;
let token: string;
let jurisdictionId: string;
let incidentId: string;
let significantBoardId: string;
const pageErrors: string[] = [];
const externalRequests: string[] = [];

async function request(
  method: "POST" | "PUT",
  url: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await app.inject({ method, url, headers: auth(token), payload });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json() as Record<string, unknown>;
}

async function createAttachedBoard(templateKey: string): Promise<string> {
  const created = await request(
    "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/boards`,
    { templateKey, title: `D26 ${templateKey}` },
  );
  const boardId = created.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  return boardId;
}

async function addRecord(boardId: string, data: Record<string, unknown>): Promise<void> {
  await request("POST", `/api/v1/boards/${boardId}/records?incidentId=${incidentId}`, data);
}

async function signIn(target: Page): Promise<void> {
  await target.goto(`${baseUrl}/app/index.html`, { waitUntil: "load" });
  await target.getByLabel("Email").fill("admin@example.org");
  await target.getByLabel("Password").fill("correct-horse-battery");
  await target.getByRole("button", { name: "Sign in" }).click();
}

beforeAll(async () => {
  await buildWeb(DIST);

  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });

  serveStatic(app, "/app", DIST);

  token = await login(app);
  const incident = await request(
    "POST",
    `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    { templateKey: "daily_ops", name: "North Fork Flood" },
  );
  incidentId = incident.incidentId as string;
  const now = Date.now();
  await request("PUT", `/api/v1/incidents/${incidentId}/operational-area`, {
    expectedRevision: 0,
    geometry: null,
    operationalPeriod: {
      label: "OP D26",
      startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
    },
    reason: "D26 browser acceptance",
  });
  const attached = await admin`
    select b.id from incident_boards ib join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId} and b.template_key = 'significant_events'`;
  significantBoardId = attached[0]!.id as string;
  const rumorBoard = await createAttachedBoard("rumor_control");
  const talkingBoard = await createAttachedBoard("talking_points");
  await addRecord(significantBoardId, {
    summary: "North Fork bridge is restricted to emergency traffic",
    occurred_at: new Date(now - 20 * 60 * 1000).toISOString(),
    severity: "warning",
    verified: true,
  });
  await addRecord(rumorBoard, {
    rumor: "The bridge has collapsed",
    status: "false",
    response: "The bridge remains open to emergency traffic.",
  });
  await addRecord(talkingBoard, {
    topic: "Road access",
    point: "Use the signed public detour and keep the emergency lane clear.",
    approved: true,
  });
  await request("POST", `/api/v1/incidents/${incidentId}/lifeline-assessments`, {
    lifeline: "transportation",
    condition: "stabilizing",
    assessedAt: new Date(now - 15 * 60 * 1000).toISOString(),
    confidence: "confirmed",
    impactStatement: "Bridge restrictions delay local travel",
    operationalPeriod: "OP D26",
    stabilizationOutlook: "Emergency lane remains available",
    components: [],
    evidence: [],
    responsibleOrganizationIds: [],
    actions: [],
  });

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
  await signIn(page);
}, 120_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("real incident SITREP briefing and JIC preparation", () => {
  it("freezes the selected incident, presents the briefing, and submits a non-public JIC draft", async () => {
    await page.getByRole("button", { name: "SITREP", exact: true }).click();
    await page.getByRole("heading", { name: "Situation reports" }).waitFor();
    const composeRegion = page.getByRole("region", { name: "Compose a frozen situation report" });
    await composeRegion.getByRole("textbox", { name: "Operational period", exact: true }).fill("OP D26");
    const composeButton = composeRegion.getByRole("button", { name: "Compose and freeze" });
    await composeButton.focus();
    expect(await page.evaluate("document.activeElement?.textContent?.trim()")).toBe("Compose and freeze");
    await page.keyboard.press("Enter");
    await page.getByRole("status").filter({ hasText: "Revision 1 frozen" }).waitFor();
    await page.getByRole("button", { name: /OP D26/ }).click();

    const briefing = page.getByRole("article", { name: "Situation report: OP D26" });
    await briefing.waitFor();
    await briefing.getByText("North Fork Flood", { exact: false }).first().waitFor();
    expect(await briefing.getByText("Bridge restrictions delay local travel", { exact: true }).isVisible()).toBe(true);
    expect(await briefing.getByText("North Fork bridge is restricted to emergency traffic", { exact: true }).isVisible()).toBe(true);
    expect(await briefing.getByText("Use the signed public detour and keep the emergency lane clear.", { exact: true }).isVisible()).toBe(true);
    expect(await briefing.getByText("The bridge remains open to emergency traffic.", { exact: true }).isVisible()).toBe(true);
    expect(await briefing.getByText("Revision 1", { exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(`(() => {
      const element = document.querySelector('article.eoc-briefing');
      const bounds = element.getBoundingClientRect();
      const container = element.parentElement?.getBoundingClientRect();
      return Boolean(container) && bounds.left >= container.left - 0.5
        && bounds.right <= container.right + 0.5
        && element.scrollWidth <= element.clientWidth;
    })()`)).toBe(true);

    const jic = page.getByRole("complementary", { name: "JIC draft" });
    const statement = jic.getByLabel("Draft statement");
    expect(await statement.inputValue()).toContain("Use the signed public detour");
    expect(await statement.inputValue()).toContain("The bridge remains open");
    await jic.getByRole("button", { name: "Save JIC draft" }).click();
    await jic.getByText(/saved, not published/).waitFor();
    await jic.getByRole("button", { name: "Submit for review" }).click();
    await jic.getByText(/submitted for review/).waitFor();

    const releases = await admin`
      select status, incident_id from press_releases where incident_id = ${incidentId}`;
    expect(releases).toEqual([expect.objectContaining({ status: "pending", incident_id: incidentId })]);
    const publicCount = await admin`select count(*)::int as n from public_messages`;
    expect(publicCount[0]!.n).toBe(0);
    await page.screenshot({ path: join(SHOTS, "d26-briefing-light-1440.png"), fullPage: false });

    await addRecord(significantBoardId, {
      summary: "Later event after freeze",
      occurred_at: new Date().toISOString(),
      severity: "warning",
      verified: true,
    });
    await page.reload({ waitUntil: "load" });
    await page.getByRole("article", { name: "Situation report: OP D26" }).waitFor();
    expect(await page.getByText("Later event after freeze", { exact: true }).count()).toBe(0);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.screenshot({ path: join(SHOTS, "d26-briefing-dark-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(`(() => {
      const element = document.querySelector('article.eoc-briefing');
      const bounds = element.getBoundingClientRect();
      const container = element.parentElement?.getBoundingClientRect();
      return Boolean(container) && bounds.left >= container.left - 0.5
        && bounds.right <= container.right + 0.5
        && element.scrollWidth <= element.clientWidth;
    })()`)).toBe(true);
    await page.screenshot({ path: join(SHOTS, "d26-briefing-dark-390.png"), fullPage: false });
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  }, 120_000);
});
